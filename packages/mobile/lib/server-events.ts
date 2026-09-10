/**
 * One shared `/api/events` stream for the whole app.
 *
 * React Native has no `EventSource`, so this reads the response body of an
 * `expo/fetch` request (WinterCG fetch with a streaming `body`) and feeds the
 * bytes through `sse-parser.ts`. The public surface mirrors the Web client so
 * consumers look alike: `subscribeServerEvents(type | '*', handler)`,
 * `getServerEventsState()`, `subscribeServerEventsState()`.
 *
 * Events are triggers, not payloads: a consumer that receives `agent-run.event`
 * re-fetches through its usual REST call. The connection opens on the first
 * subscriber and closes when the last one leaves. Failures reconnect with a
 * bounded backoff (1s doubling to 30s) and replay from `Last-Event-ID`; the app
 * going to the background aborts the stream and the foreground transition
 * reconnects immediately. A stream that goes 60s without any byte (the server
 * heartbeats every 25s) is treated as dead, which covers iOS suspending the
 * socket or a Wi-Fi to cellular hand-off that never surfaces as an error.
 *
 * `unsupported` means this runtime cannot stream (`expo/fetch` missing, or the
 * response has no readable body); consumers keep their fallback polling.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { mindosClient } from './api-client';
import { createSseParser, type SseFrame } from './sse-parser';

export const SERVER_EVENTS_PATH = '/api/events';
export const SERVER_EVENTS_RECONNECT_MIN_MS = 1_000;
export const SERVER_EVENTS_RECONNECT_MAX_MS = 30_000;
/** Longer than two server heartbeats (25s each) so one lost frame is not fatal. */
export const SERVER_EVENTS_STALL_MS = 60_000;

export const SERVER_EVENT_TYPES = [
  'tree.changed',
  'agent-run.event',
  'skills.changed',
  'mcp.changed',
  'sync.changed',
  'run.pending-actions.changed',
  'heartbeat',
  'ready',
] as const;

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

export interface AgentRunEventSummary {
  id: string;
  runId: string;
  rootRunId?: string;
  parentRunId?: string;
  type: string;
  category: string;
  status: string;
  ts: number;
}

export interface ServerEventMap {
  'tree.changed': { type: 'tree.changed'; version: number };
  'agent-run.event': { type: 'agent-run.event'; runId: string; chatSessionId?: string; event: AgentRunEventSummary };
  'skills.changed': { type: 'skills.changed' };
  'mcp.changed': { type: 'mcp.changed' };
  'sync.changed': { type: 'sync.changed' };
  /** A pending permission / question / automation-approval prompt was created or resolved in any host process. */
  'run.pending-actions.changed': { type: 'run.pending-actions.changed' };
  heartbeat: { type: 'heartbeat' };
  ready: { type: 'ready'; lastEventId: number; resync: boolean; treeVersion?: number };
}

export type ServerEvent = ServerEventMap[ServerEventType];

/**
 * `idle`: nobody subscribed. `connecting`: first attempt in flight.
 * `connected`: the stream is open. `reconnecting`: lost the stream, retrying
 * with backoff (or waiting for the app to return to the foreground).
 * `unsupported`: this runtime cannot stream; consumers must poll.
 */
export type ServerEventsState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unsupported';

type Handler = (event: ServerEvent) => void;
type StateListener = (state: ServerEventsState) => void;

type StreamReader = {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel?(reason?: unknown): Promise<unknown> | unknown;
};

type StreamResponse = {
  ok: boolean;
  status: number;
  body: { getReader(): StreamReader } | null;
};

type Connection = {
  controller: AbortController;
  reader: StreamReader | null;
};

const KNOWN_TYPES = new Set<string>(SERVER_EVENT_TYPES);

const handlers = new Map<ServerEventType | '*', Set<Handler>>();
const stateListeners = new Set<StateListener>();
let subscriberCount = 0;
let current: Connection | null = null;
let state: ServerEventsState = 'idle';
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let lastEventId: number | null = null;
let appStateSubscription: { remove(): void } | null = null;

function isServerEvent(value: unknown): value is ServerEvent {
  return typeof value === 'object' && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && KNOWN_TYPES.has((value as { type: string }).type);
}

function setState(next: ServerEventsState): void {
  if (state === next) return;
  state = next;
  for (const listener of Array.from(stateListeners)) {
    try {
      listener(state);
    } catch {
      // State observers must not break the transport.
    }
  }
}

function resolveFetch(): typeof expoFetch | null {
  return typeof expoFetch === 'function' ? expoFetch : null;
}

function isBackgrounded(): boolean {
  const appState = AppState as { currentState?: AppStateStatus | null } | undefined;
  return appState?.currentState === 'background';
}

function buildUrl(baseUrl: string): string {
  const url = `${baseUrl}${SERVER_EVENTS_PATH}`;
  return lastEventId === null ? url : `${url}?lastEventId=${lastEventId}`;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  const token = mindosClient.authToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (lastEventId !== null) headers['Last-Event-ID'] = String(lastEventId);
  return headers;
}

function dispatch(event: ServerEvent): void {
  const targets = [...(handlers.get(event.type) ?? []), ...(handlers.get('*') ?? [])];
  for (const handler of targets) {
    try {
      handler(event);
    } catch {
      // One consumer's bug must not stop delivery to the others.
    }
  }
}

function onFrame(frame: SseFrame): void {
  if (frame.lastEventId !== '') {
    const id = Number(frame.lastEventId);
    if (Number.isSafeInteger(id) && id >= 0) lastEventId = id;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return;
  }
  if (!isServerEvent(parsed)) return;
  if (parsed.type === 'ready') {
    attempts = 0;
    setState('connected');
  }
  dispatch(parsed);
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearStallTimer(): void {
  if (stallTimer !== null) {
    clearTimeout(stallTimer);
    stallTimer = null;
  }
}

function armStallTimer(connection: Connection): void {
  clearStallTimer();
  stallTimer = setTimeout(() => {
    stallTimer = null;
    if (current !== connection) return;
    closeCurrentConnection();
    scheduleReconnect();
  }, SERVER_EVENTS_STALL_MS);
}

/** Abort the live request (if any) and forget it; callers decide what state follows. */
function closeCurrentConnection(): void {
  clearStallTimer();
  const connection = current;
  current = null;
  if (!connection) return;
  try {
    connection.controller.abort();
  } catch {
    // Aborting twice or on an exotic signal implementation is harmless.
  }
  const cancel = connection.reader?.cancel;
  if (typeof cancel === 'function') {
    try {
      void Promise.resolve(cancel.call(connection.reader)).catch(() => {});
    } catch {
      // Releasing the reader is best effort.
    }
  }
}

function failConnection(connection: Connection): void {
  if (current !== connection) return;
  closeCurrentConnection();
  scheduleReconnect();
}

function markUnsupported(connection: Connection | null): void {
  if (connection && current !== connection) return;
  closeCurrentConnection();
  clearReconnectTimer();
  setState('unsupported');
}

async function runConnection(connection: Connection, fetchImpl: typeof expoFetch, baseUrl: string): Promise<void> {
  try {
    const response = await fetchImpl(buildUrl(baseUrl), {
      method: 'GET',
      headers: buildHeaders(),
      signal: connection.controller.signal,
    }) as unknown as StreamResponse;
    if (current !== connection) return;
    if (!response.ok) {
      failConnection(connection);
      return;
    }
    const body = response.body;
    if (!body || typeof body.getReader !== 'function') {
      markUnsupported(connection);
      return;
    }

    const reader = body.getReader();
    connection.reader = reader;
    setState('connected');
    armStallTimer(connection);
    const parser = createSseParser(onFrame);

    for (;;) {
      const { value, done } = await reader.read();
      if (current !== connection) return;
      if (done) break;
      armStallTimer(connection);
      if (value && value.length > 0) parser.push(value);
    }
    parser.end();
    failConnection(connection);
  } catch {
    // Network error, abort, or a reader rejection: reconnect only when this is
    // still the live connection (a deliberate close already moved on).
    failConnection(connection);
  }
}

function connect(): void {
  if (current || subscriberCount === 0) return;
  if (isBackgrounded()) {
    setState('reconnecting');
    return;
  }
  const fetchImpl = resolveFetch();
  if (!fetchImpl) {
    markUnsupported(null);
    return;
  }
  const baseUrl = mindosClient.baseUrl;
  if (!baseUrl) {
    // No server configured yet; try again with backoff so a later connect() picks it up.
    scheduleReconnect();
    return;
  }
  setState(state === 'reconnecting' ? 'reconnecting' : 'connecting');
  const connection: Connection = { controller: new AbortController(), reader: null };
  current = connection;
  void runConnection(connection, fetchImpl, baseUrl);
}

function scheduleReconnect(): void {
  if (subscriberCount === 0) {
    setState('idle');
    return;
  }
  setState('reconnecting');
  // Backgrounded apps do not retry; the AppState listener reconnects on return.
  if (isBackgrounded()) return;
  const delay = Math.min(SERVER_EVENTS_RECONNECT_MIN_MS * 2 ** attempts, SERVER_EVENTS_RECONNECT_MAX_MS);
  attempts += 1;
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'background') {
    clearReconnectTimer();
    closeCurrentConnection();
    if (subscriberCount > 0) setState('reconnecting');
    return;
  }
  if (next !== 'active') return;
  if (subscriberCount === 0 || current || state === 'unsupported') return;
  clearReconnectTimer();
  connect();
}

function bindAppState(): void {
  if (appStateSubscription) return;
  const appState = AppState as { addEventListener?: (type: 'change', handler: (next: AppStateStatus) => void) => { remove(): void } } | undefined;
  if (typeof appState?.addEventListener !== 'function') return;
  appStateSubscription = appState.addEventListener('change', onAppStateChange);
}

function unbindAppState(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
}

function start(): void {
  bindAppState();
  connect();
}

function teardown(): void {
  clearReconnectTimer();
  closeCurrentConnection();
  attempts = 0;
  unbindAppState();
  setState('idle');
}

export function subscribeServerEvents<T extends ServerEventType>(
  type: T,
  handler: (event: ServerEventMap[T]) => void,
): () => void;
export function subscribeServerEvents(type: '*', handler: (event: ServerEvent) => void): () => void;
export function subscribeServerEvents(type: ServerEventType | '*', handler: (event: never) => void): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  const entry = handler as Handler;
  set.add(entry);
  subscriberCount += 1;
  if (subscriberCount === 1) start();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    set.delete(entry);
    if (set.size === 0) handlers.delete(type);
    subscriberCount -= 1;
    if (subscriberCount === 0) teardown();
  };
}

export function getServerEventsState(): ServerEventsState {
  return state;
}

/** True only while the stream is live; consumers poll in every other state. */
export function isServerEventsConnected(): boolean {
  return state === 'connected';
}

export function subscribeServerEventsState(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function getServerEventsLastEventId(): number | null {
  return lastEventId;
}

export function resetServerEventsForTests(): void {
  teardown();
  handlers.clear();
  stateListeners.clear();
  subscriberCount = 0;
  lastEventId = null;
  state = 'idle';
}
