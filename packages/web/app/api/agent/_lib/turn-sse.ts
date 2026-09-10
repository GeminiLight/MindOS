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
