import path from 'path';
import {
  MINDOS_SSE_HEADERS,
  encodeMindosSseEvent,
  type MindOSSSEvent,
} from '@geminilight/mindos/agent/turn';
import type { AgentRunRecord } from '@geminilight/mindos/agent/ledger/run-ledger';
import { isAbortLikeError } from '@geminilight/mindos/agent/ledger/run-cancellation';
import { metrics } from '@/lib/metrics';

const AGENT_TURN_SSE_HEARTBEAT_MS = 15_000;
const AGENT_TURN_SSE_HEARTBEAT_EVENT: MindOSSSEvent = {
  type: 'status',
  visible: false,
  message: 'keep-alive',
};

export function agentRunErrorStatus(error: unknown, signal?: AbortSignal): 'failed' | 'canceled' | 'timed_out' {
  if (signal?.aborted || isAbortLikeError(error)) return 'canceled';
  return (error as { code?: unknown })?.code === 'TIMEOUT' ? 'timed_out' : 'failed';
}

export function sendAgentRunContext(
  send: (event: MindOSSSEvent) => void,
  run: AgentRunRecord,
): void {
  send({
    type: 'agent_run_context',
    rootRunId: run.rootRunId ?? run.id,
    ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
    startedAt: run.startedAt,
  } as unknown as MindOSSSEvent);
}

export function formatMindosPiExtensionLoadStatus(errors: Array<{ path: string; error: string }> | undefined): string | null {
  if (!errors?.length) return null;
  const names = [...new Set(errors.map((entry) => path.basename(entry.path || 'extension')).filter(Boolean))].slice(0, 5);
  const hasWebAccessError = errors.some((entry) => entry.path.includes('pi-web-access'));
  const suffix = hasWebAccessError
    ? ' pi-web-access is unavailable or incomplete, so web_search/fetch_content may be unavailable.'
    : ' Some extension tools may be unavailable.';
  return `MindOS detected ${errors.length} extension issue${errors.length === 1 ? '' : 's'}${names.length ? ` (${names.join(', ')})` : ''}.${suffix}`;
}

export function compactStringEnv(env: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const compact: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') compact[key] = value;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

export function omitEnvKeys(
  env: Record<string, string>,
  reserved: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!(key in reserved)) next[key] = value;
  }
  return next;
}

export function createAgentTurnSseResponse(
  runAgent: (send: (event: MindOSSSEvent) => void) => Promise<void>,
  fallbackErrorMessage: (error: unknown) => string = (error) => (
    error instanceof Error && error.message
      ? error.message
      : 'MindOS agent turn stream failed unexpectedly.'
  ),
): Response {
  const encoder = new TextEncoder();
  const requestStartTime = Date.now();
  let streamClosed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  function markStreamClosed() {
    streamClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  }
  const stream = new ReadableStream({
    start(controller) {
      heartbeatTimer = setInterval(() => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(encodeMindosSseEvent(AGENT_TURN_SSE_HEARTBEAT_EVENT)));
        } catch {
          markStreamClosed();
        }
      }, AGENT_TURN_SSE_HEARTBEAT_MS);

      function send(event: MindOSSSEvent) {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(encodeMindosSseEvent(event)));
        } catch {
          markStreamClosed();
        }
      }
      function safeClose() {
        if (streamClosed) return;
        markStreamClosed();
        try { controller.close(); } catch { /* already closed */ }
      }

      runAgent(send).then(() => {
        metrics.recordRequest(Date.now() - requestStartTime);
        safeClose();
      }).catch((err) => {
        metrics.recordRequest(Date.now() - requestStartTime);
        metrics.recordError();
        send({ type: 'error', message: fallbackErrorMessage(err) });
        safeClose();
      });
    },
    cancel() {
      markStreamClosed();
    },
  });

  return new Response(stream, {
    headers: MINDOS_SSE_HEADERS,
  });
}
