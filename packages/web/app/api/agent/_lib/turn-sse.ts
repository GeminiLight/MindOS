import {
  MINDOS_SSE_HEADERS,
  encodeMindosSseEvent,
  startMindosAgentTurnSseHeartbeat,
  type MindOSSSEvent,
} from '@geminilight/mindos/agent/turn';
import { classifyLaneTerminalStatus } from '@geminilight/mindos/agent/runtime';
import { metrics } from '@/lib/metrics';

/**
 * SSE shell utilities for the agent turn lanes. Terminal classification moved
 * to the core lane runner; this alias keeps the historical web name
 * (spec-runtime-lane-contract 方案 2).
 */
export const agentRunErrorStatus = classifyLaneTerminalStatus;

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
  let stopHeartbeat: (() => void) | undefined;

  function markStreamClosed() {
    streamClosed = true;
    stopHeartbeat?.();
    stopHeartbeat = undefined;
  }

  const stream = new ReadableStream({
    start(controller) {
      stopHeartbeat = startMindosAgentTurnSseHeartbeat((event) => {
        if (streamClosed) return;
        controller.enqueue(encoder.encode(encodeMindosSseEvent(event)));
      }, { onError: markStreamClosed });

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

/**
 * Prepend one visible `status` SSE frame (e.g. the reasoning-effort fallback
 * notice produced by `agent/turn/request.ts` normalisation) to a lane's SSE
 * response so the client sees it before any lane output. Non-SSE responses
 * (JSON error replies) and empty notices pass through untouched.
 */
export function prependMindosSseStatusEvent(response: Response, message: string | undefined): Response {
  if (!message || !response.body) return response;
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) return response;
  const prefix = new TextEncoder().encode(encodeMindosSseEvent({ type: 'status', message, visible: true }));
  const original = response.body;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
      const reader = original.getReader();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          try { controller.error(error); } catch { /* already errored/closed */ }
        }
      })();
    },
    cancel(reason) {
      return original.cancel(reason);
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
