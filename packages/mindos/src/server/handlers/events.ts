import { queryValue, type MindosRequestQuery } from '../context.js';
import type {
  MindosServerEvent,
  MindosServerEventBus,
  MindosServerEventEnvelope,
  MindosServerEventType,
} from '../events/bus.js';
import { MINDOS_SERVER_EVENT_TYPES } from '../events/bus.js';
import { json, type MindosServerResponse } from '../response.js';

/**
 * `GET /api/events` — one Server-Sent Events stream per browser tab carrying
 * change notifications (tree version, agent run ledger, skills / MCP / sync
 * mutations). Events are triggers, not payloads: consumers re-fetch through
 * the REST routes they already use. The stream:
 *   - replays everything after `Last-Event-ID` that the bus ring still holds,
 *   - then sends a `ready` frame (current tree version, whether the client
 *     must resync because the ring could not cover the gap),
 *   - then forwards live events, filtered by `?types=`,
 *   - and keeps the connection alive with a heartbeat frame every 25s.
 */

export const MINDOS_SERVER_EVENTS_HEARTBEAT_MS = 25_000;

export type MindosServerReadyEvent = {
  type: 'ready';
  /** Highest bus id the client has seen after this frame; also the frame's `id:`. */
  lastEventId: number;
  /** True when the client may have missed events and should refresh everything. */
  resync: boolean;
  treeVersion?: number;
};

export type MindosServerStreamEvent = MindosServerEvent | MindosServerReadyEvent;

export type MindosServerEventFrame = {
  id?: number;
  event: MindosServerStreamEvent;
};

export type EventsHandlerServices = {
  events: MindosServerEventBus;
  /** Current tree version for the ready frame; omitted from the frame when it throws. */
  getTreeVersion?(): number;
  heartbeatMs?: number;
};

export type EventsStreamOptions = {
  signal?: AbortSignal;
  /** `Last-Event-ID` header value; takes precedence over `?lastEventId=`. */
  lastEventId?: string | string[] | number | null;
};

export type MindosServerEventStreamResponse =
  | { ok: true; status: 200; headers: Record<string, string>; body: AsyncIterable<string> }
  | ({ ok: false } & MindosServerResponse<{ error: string }>);

const TYPE_ALIASES: Record<string, MindosServerEventType> = {
  tree: 'tree.changed',
  'agent-run': 'agent-run.event',
  skills: 'skills.changed',
  mcp: 'mcp.changed',
  sync: 'sync.changed',
};

/** Types a client may filter on; heartbeat is control traffic, never filterable. */
const FILTERABLE_TYPES = new Set<MindosServerEventType>(
  MINDOS_SERVER_EVENT_TYPES.filter((type) => type !== 'heartbeat'),
);

export function encodeMindosServerEventFrame(frame: MindosServerEventFrame): string {
  const lines: string[] = [];
  if (typeof frame.id === 'number') lines.push(`id: ${frame.id}`);
  lines.push(`event: ${frame.event.type}`);
  // JSON.stringify never emits raw newlines, so one data line is always enough.
  lines.push(`data: ${JSON.stringify(frame.event)}`);
  return `${lines.join('\n')}\n\n`;
}

export function parseLastEventId(value: string | string[] | number | null | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === 'number' ? String(raw) : raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseServerEventTypesFilter(
  raw: string | undefined,
): { types: Set<MindosServerEventType> | null; unknown: string[] } {
  if (raw === undefined || raw.trim() === '') return { types: null, unknown: [] };
  const types = new Set<MindosServerEventType>();
  const unknown: string[] = [];
  for (const entry of raw.split(',')) {
    const token = entry.trim();
    if (!token) continue;
    const resolved = TYPE_ALIASES[token] ?? (FILTERABLE_TYPES.has(token as MindosServerEventType) ? token as MindosServerEventType : null);
    if (resolved) types.add(resolved);
    else unknown.push(token);
  }
  return { types, unknown };
}

export function handleEventsStream(
  query: MindosRequestQuery | undefined,
  services: EventsHandlerServices,
  options: EventsStreamOptions = {},
): MindosServerEventStreamResponse {
  const filter = parseServerEventTypesFilter(queryValue(query, 'types'));
  if (filter.types && filter.types.size === 0) {
    return { ok: false, ...json({ error: `Unknown event types: ${filter.unknown.join(', ')}` }, { status: 400 }) };
  }
  const lastEventId = parseLastEventId(options.lastEventId) ?? parseLastEventId(queryValue(query, 'lastEventId'));
  const heartbeatMs = services.heartbeatMs ?? MINDOS_SERVER_EVENTS_HEARTBEAT_MS;

  return {
    ok: true,
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
    body: streamFrames({
      bus: services.events,
      getTreeVersion: services.getTreeVersion,
      heartbeatMs,
      lastEventId,
      types: filter.types,
      signal: options.signal,
    }),
  };
}

type StreamInput = {
  bus: MindosServerEventBus;
  getTreeVersion?: () => number;
  heartbeatMs: number;
  lastEventId: number | null;
  types: Set<MindosServerEventType> | null;
  signal?: AbortSignal;
};

async function* streamFrames(input: StreamInput): AsyncGenerator<string, void, undefined> {
  const { bus, signal, types } = input;
  if (signal?.aborted) return;

  const queue: string[] = [];
  let closed = false;
  let wake: (() => void) | null = null;

  const push = (frame: string) => {
    if (closed) return;
    queue.push(frame);
    wake?.();
  };
  const close = () => {
    closed = true;
    wake?.();
  };
  const accepts = (event: MindosServerEvent) => !types || types.has(event.type);

  // Everything at or below `baseline` is served from the ring (replay); the
  // live subscription only forwards what arrives after it. Subscribing before
  // reading the baseline guarantees no event falls between the two.
  let baseline = 0;
  const unsubscribe = bus.subscribe((envelope: MindosServerEventEnvelope) => {
    if (envelope.id <= baseline || !accepts(envelope.event)) return;
    push(encodeMindosServerEventFrame({ id: envelope.id, event: envelope.event }));
  });
  baseline = bus.lastEventId();
  const heartbeat = setInterval(() => {
    push(encodeMindosServerEventFrame({ event: { type: 'heartbeat' } }));
  }, input.heartbeatMs);
  heartbeat.unref?.();
  signal?.addEventListener('abort', close, { once: true });

  try {
    const replay = input.lastEventId === null
      ? { events: [] as MindosServerEventEnvelope[], complete: true }
      : bus.replaySince(input.lastEventId);
    for (const envelope of replay.events) {
      if (envelope.id > baseline || !accepts(envelope.event)) continue;
      yield encodeMindosServerEventFrame({ id: envelope.id, event: envelope.event });
    }

    yield encodeMindosServerEventFrame({
      id: baseline,
      event: {
        type: 'ready',
        lastEventId: baseline,
        resync: input.lastEventId !== null && !replay.complete,
        ...readTreeVersion(input.getTreeVersion),
      },
    });

    while (!closed) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    signal?.removeEventListener('abort', close);
  }
}

function readTreeVersion(getTreeVersion?: () => number): { treeVersion?: number } {
  if (!getTreeVersion) return {};
  try {
    const version = getTreeVersion();
    return Number.isFinite(version) ? { treeVersion: version } : {};
  } catch {
    return {};
  }
}
