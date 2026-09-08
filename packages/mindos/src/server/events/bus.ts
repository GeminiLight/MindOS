import { getProcessGlobal, deleteProcessGlobal } from '../../agent/global-state.js';

/**
 * In-process typed event bus behind `GET /api/events`.
 *
 * Every host process (Next server, Product Server) runs exactly one bus; a
 * browser tab talks to one host, so cross-process fanout is out of scope. The
 * bus keeps a small ring of recent envelopes so a reconnecting client can pass
 * its `Last-Event-ID` and receive what it missed instead of doing a full
 * refresh, and it lets producers register lazy sources that only run while at
 * least one subscriber is connected (the tree cache uses this to avoid
 * background scans when nobody is listening).
 */

export type MindosServerEventType =
  | 'tree.changed'
  | 'agent-run.event'
  | 'skills.changed'
  | 'mcp.changed'
  | 'sync.changed'
  | 'heartbeat';

/** Compact projection of a ledger event; the client only uses it as a trigger. */
export type MindosAgentRunEventSummary = {
  id: string;
  runId: string;
  rootRunId?: string;
  parentRunId?: string;
  type: string;
  category: string;
  status: string;
  ts: number;
};

export type MindosServerEvent =
  | { type: 'tree.changed'; version: number }
  | { type: 'agent-run.event'; runId: string; chatSessionId?: string; event: MindosAgentRunEventSummary }
  | { type: 'skills.changed' }
  | { type: 'mcp.changed' }
  | { type: 'sync.changed' }
  | { type: 'heartbeat' };

export const MINDOS_SERVER_EVENT_TYPES: readonly MindosServerEventType[] = [
  'tree.changed',
  'agent-run.event',
  'skills.changed',
  'mcp.changed',
  'sync.changed',
  'heartbeat',
];

export type MindosServerEventEnvelope = {
  /** Monotonically increasing per bus instance; used as the SSE `id:` field. */
  id: number;
  ts: number;
  event: MindosServerEvent;
};

export type MindosServerEventListener = (envelope: MindosServerEventEnvelope) => void;

export type MindosServerEventReplay = {
  events: MindosServerEventEnvelope[];
  /**
   * False when the ring no longer covers everything after `lastEventId`, or
   * when `lastEventId` is ahead of this bus (the server restarted). Clients
   * should treat an incomplete replay as "refresh everything".
   */
  complete: boolean;
};

/** Minimal emitter surface handed to request handlers so they stay testable. */
export type MindosServerEventEmitter = {
  emit(event: MindosServerEvent): MindosServerEventEnvelope;
};

export type MindosServerEventBus = MindosServerEventEmitter & {
  subscribe(listener: MindosServerEventListener): () => void;
  replaySince(lastEventId: number): MindosServerEventReplay;
  lastEventId(): number;
  subscriberCount(): number;
  /**
   * Register a lazy producer. `start` runs when the subscriber count goes from
   * 0 to 1 (or immediately when subscribers already exist) and its returned
   * stop function runs when the last subscriber leaves. Returns a function
   * that removes (and stops) the source.
   */
  addSource(start: () => () => void): () => void;
};

export type MindosServerEventBusOptions = {
  /** How many envelopes to keep for replay. Default 500. */
  ringSize?: number;
  now?: () => number;
};

const DEFAULT_RING_SIZE = 500;
const KNOWN_TYPES = new Set<string>(MINDOS_SERVER_EVENT_TYPES);

export function createMindosServerEventBus(options: MindosServerEventBusOptions = {}): MindosServerEventBus {
  const ringSize = options.ringSize ?? DEFAULT_RING_SIZE;
  if (!Number.isInteger(ringSize) || ringSize < 1) {
    throw new Error(`ringSize must be a positive integer, received ${String(options.ringSize)}`);
  }
  const now = options.now ?? Date.now;

  let nextId = 1;
  const ring: MindosServerEventEnvelope[] = [];
  const listeners = new Set<MindosServerEventListener>();
  const sources = new Map<() => () => void, (() => void) | null>();

  function startSources(): void {
    for (const [start, stop] of sources) {
      if (stop) continue;
      try {
        sources.set(start, start());
      } catch {
        // A broken source must not prevent the stream from serving other events.
        sources.set(start, null);
      }
    }
  }

  function stopSources(): void {
    for (const [start, stop] of sources) {
      if (!stop) continue;
      sources.set(start, null);
      try {
        stop();
      } catch {
        // Stopping is best-effort; the source is already detached from the map.
      }
    }
  }

  return {
    emit(event) {
      if (!event || typeof event !== 'object' || !KNOWN_TYPES.has((event as { type?: unknown }).type as string)) {
        throw new Error(`Unknown server event type: ${String((event as { type?: unknown })?.type)}`);
      }
      const envelope: MindosServerEventEnvelope = { id: nextId, ts: now(), event };
      nextId += 1;
      ring.push(envelope);
      if (ring.length > ringSize) ring.splice(0, ring.length - ringSize);
      for (const listener of Array.from(listeners)) {
        try {
          listener(envelope);
        } catch {
          // Subscribers are observers; one failing stream must not affect the others.
        }
      }
      return envelope;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) startSources();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0) stopSources();
      };
    },
    replaySince(lastEventId) {
      const current = nextId - 1;
      const oldestRetained = ring[0]?.id ?? current + 1;
      if (!Number.isFinite(lastEventId) || lastEventId < 0) {
        return { events: [...ring], complete: oldestRetained <= 1 };
      }
      if (lastEventId > current) return { events: [], complete: false };
      const events = ring.filter((entry) => entry.id > lastEventId);
      // Everything after lastEventId is retained when the ring's oldest entry
      // is at most lastEventId + 1 (or the bus never dropped anything).
      const complete = oldestRetained <= lastEventId + 1;
      return { events, complete };
    },
    lastEventId() {
      return nextId - 1;
    },
    subscriberCount() {
      return listeners.size;
    },
    addSource(start) {
      sources.set(start, null);
      if (listeners.size > 0) {
        try {
          sources.set(start, start());
        } catch {
          sources.set(start, null);
        }
      }
      return () => {
        const stop = sources.get(start);
        sources.delete(start);
        if (stop) {
          try {
            stop();
          } catch {
            // Best-effort stop, see stopSources().
          }
        }
      };
    },
  };
}

/**
 * Process-wide singleton. Next.js compiles core modules into several route
 * bundles, so a module-level instance would fork per bundle and events emitted
 * by one route would never reach the stream served by another; the
 * `Symbol.for` registry makes every copy share one bus (same reasoning as
 * `agent/global-state.ts`).
 */
const SERVER_EVENT_BUS_KEY = Symbol.for('mindos.serverEventBus');

export function getMindosServerEventBus(): MindosServerEventBus {
  return getProcessGlobal(SERVER_EVENT_BUS_KEY, () => createMindosServerEventBus());
}

export function resetMindosServerEventBusForTest(): void {
  deleteProcessGlobal(SERVER_EVENT_BUS_KEY);
}
