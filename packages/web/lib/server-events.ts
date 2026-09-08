/**
 * One shared `EventSource('/api/events')` per browser tab.
 *
 * Consumers call `subscribeServerEvents(type, handler)`; the connection opens
 * on the first subscriber and closes when the last one leaves. Events are
 * triggers, not payloads (see `handlers/events.ts` in the core package): a
 * consumer that receives `mcp.changed` re-fetches through its usual REST route.
 *
 * Reconnection is managed here rather than left to the browser so the backoff
 * is bounded (1s doubling to 30s), hidden tabs stop retrying, and
 * `Last-Event-ID` survives a manual reconnect (browsers only send the header
 * on their own automatic retries, so the id is passed as a query parameter).
 *
 * `tree.changed` is bridged onto the existing `mindos:files-changed` window
 * event so every current files-changed consumer benefits without changes.
 */

import { notifyFilesChanged } from '@/lib/files-changed';

export const SERVER_EVENTS_URL = '/api/events';
export const SERVER_EVENTS_RECONNECT_MIN_MS = 1_000;
export const SERVER_EVENTS_RECONNECT_MAX_MS = 30_000;

export const SERVER_EVENT_TYPES = [
  'tree.changed',
  'agent-run.event',
  'skills.changed',
  'mcp.changed',
  'sync.changed',
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
  heartbeat: { type: 'heartbeat' };
  ready: { type: 'ready'; lastEventId: number; resync: boolean; treeVersion?: number };
}

export type ServerEvent = ServerEventMap[ServerEventType];

/**
 * `idle`: nobody subscribed. `connecting`: first attempt in flight.
 * `connected`: the stream delivered `open`/`ready`. `reconnecting`: lost the
 * stream, retrying with backoff (or waiting for the tab to become visible).
 * `unsupported`: no EventSource in this environment; consumers must poll.
 */
export type ServerEventsState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unsupported';

type Handler = (event: ServerEvent) => void;
type StateListener = (state: ServerEventsState) => void;

const handlers = new Map<ServerEventType | '*', Set<Handler>>();
const stateListeners = new Set<StateListener>();
let subscriberCount = 0;
let source: EventSource | null = null;
let state: ServerEventsState = 'idle';
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastEventId: number | null = null;
let visibilityBound = false;

const KNOWN_TYPES = new Set<string>(SERVER_EVENT_TYPES);

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

function eventSourceConstructor(): typeof EventSource | undefined {
  const candidate = (globalThis as { EventSource?: unknown }).EventSource;
  return typeof candidate === 'function' ? candidate as typeof EventSource : undefined;
}

function buildUrl(): string {
  return lastEventId === null ? SERVER_EVENTS_URL : `${SERVER_EVENTS_URL}?lastEventId=${lastEventId}`;
}

function dispatch(event: ServerEvent): void {
  if (event.type === 'tree.changed') notifyFilesChanged();
  const targets = [...(handlers.get(event.type) ?? []), ...(handlers.get('*') ?? [])];
  for (const handler of targets) {
    try {
      handler(event);
    } catch {
      // One consumer's bug must not stop delivery to the others.
    }
  }
}

function onFrame(raw: MessageEvent): void {
  if (typeof raw.lastEventId === 'string' && raw.lastEventId !== '') {
    const id = Number(raw.lastEventId);
    if (Number.isSafeInteger(id) && id >= 0) lastEventId = id;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw.data));
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

function connect(): void {
  if (source || subscriberCount === 0) return;
  const EventSourceCtor = eventSourceConstructor();
  if (!EventSourceCtor) {
    setState('unsupported');
    return;
  }
  setState(state === 'reconnecting' ? 'reconnecting' : 'connecting');
  let next: EventSource;
  try {
    next = new EventSourceCtor(buildUrl());
  } catch {
    setState('unsupported');
    return;
  }
  source = next;
  next.onopen = () => {
    if (source !== next) return;
    attempts = 0;
    setState('connected');
  };
  next.onerror = () => {
    if (source !== next) return;
    next.close();
    source = null;
    scheduleReconnect();
  };
  const listener = (raw: Event) => {
    if (source !== next) return;
    onFrame(raw as MessageEvent);
  };
  for (const type of SERVER_EVENT_TYPES) next.addEventListener(type, listener);
  next.addEventListener('message', listener);
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (subscriberCount === 0) {
    setState('idle');
    return;
  }
  setState('reconnecting');
  // Hidden tabs do not retry; onVisibilityChange reconnects immediately on return.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const delay = Math.min(SERVER_EVENTS_RECONNECT_MIN_MS * 2 ** attempts, SERVER_EVENTS_RECONNECT_MAX_MS);
  attempts += 1;
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return;
  if (subscriberCount === 0 || source) return;
  clearReconnectTimer();
  connect();
}

function start(): void {
  if (typeof document !== 'undefined' && !visibilityBound) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = true;
  }
  connect();
}

function teardown(): void {
  clearReconnectTimer();
  const current = source;
  source = null;
  current?.close();
  attempts = 0;
  if (visibilityBound && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = false;
  }
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
