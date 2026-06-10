export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import {
  listAgentEvents,
  listAgentRuns,
  subscribeAgentRunEvents,
  type AgentEvent,
} from '@/lib/agent/run-ledger';

const encoder = new TextEncoder();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const HEARTBEAT_MS = 15000;

function optionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

function sse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function heartbeat(): Uint8Array {
  return encoder.encode(': keep-alive\n\n');
}

function eventMatchesFilter(event: AgentEvent, input: {
  chatSessionId: string;
  rootRunId?: string;
  startedAfter?: number;
}): boolean {
  const record = event.record;
  if (record.chatSessionId !== input.chatSessionId) return false;
  if (input.rootRunId) {
    return record.rootRunId === input.rootRunId || record.id === input.rootRunId;
  }
  return input.startedAfter === undefined || record.startedAt >= input.startedAfter;
}

function listFilteredRuns(input: {
  chatSessionId: string;
  rootRunId?: string;
  startedAfter?: number;
  limit: number;
}) {
  return listAgentRuns({
    chatSessionId: input.chatSessionId,
    ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
    ...(input.rootRunId || input.startedAfter === undefined ? {} : { startedAfter: input.startedAfter }),
    limit: input.limit,
  });
}

function listFilteredEvents(input: {
  chatSessionId: string;
  rootRunId?: string;
  startedAfter?: number;
  limit: number;
}) {
  return listAgentEvents({
    chatSessionId: input.chatSessionId,
    ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
    ...(input.rootRunId || input.startedAfter === undefined ? {} : { startedAfter: input.startedAfter }),
    limit: input.limit,
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chatSessionId = url.searchParams.get('chatSessionId')?.trim();
  if (!chatSessionId) {
    return new Response(JSON.stringify({ error: 'chatSessionId is required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const rootRunId = url.searchParams.get('rootRunId')?.trim() || undefined;
  const startedAfter = optionalNumber(url.searchParams.get('startedAfter'));
  const limit = normalizeLimit(url.searchParams.get('limit'));
  const filter = {
    chatSessionId,
    ...(rootRunId ? { rootRunId } : {}),
    ...(rootRunId || startedAfter === undefined ? {} : { startedAfter }),
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        unsubscribe();
        req.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      };

      const sendSnapshot = (event?: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sse({
            runs: listFilteredRuns({ ...filter, limit }),
            events: listFilteredEvents({ ...filter, limit }),
            ...(event ? { event } : {}),
          }));
        } catch {
          close();
        }
      };

      const unsubscribe = subscribeAgentRunEvents((event) => {
        if (eventMatchesFilter(event, filter)) {
          sendSnapshot(event);
        }
      });

      sendSnapshot();
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(heartbeat());
        } catch {
          close();
        }
      }, HEARTBEAT_MS);

      if (req.signal.aborted) {
        close();
      } else {
        req.signal.addEventListener('abort', close);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}
