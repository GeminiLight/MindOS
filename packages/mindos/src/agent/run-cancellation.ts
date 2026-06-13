/**
 * Agent run cancellation: handler registry + abort-signal plumbing on top of
 * the run ledger. Sunk from packages/web/lib/agent/run-cancellation.ts
 * (spec-agent-core-consolidation Wave 2). The cancel API route resolves
 * handlers registered by the streaming route, so the handler map is shared
 * across module copies via global-state.
 */
import {
  cancelAgentRun,
  getAgentRun,
  listAgentRuns,
  type AgentRunRecord,
} from './run-ledger.js';
import { AGENT_RUN_CANCEL_HANDLERS_KEY, getProcessGlobal } from './global-state.js';

export interface AgentRunCancelInput {
  reason?: unknown;
  metadata?: Record<string, unknown>;
}

export type AgentRunCancelHandler = (input: AgentRunCancelInput) => Promise<void> | void;

function getHandlers(): Map<string, Set<AgentRunCancelHandler>> {
  return getProcessGlobal(AGENT_RUN_CANCEL_HANDLERS_KEY, () => new Map<string, Set<AgentRunCancelHandler>>());
}

function isTerminal(record: AgentRunRecord | undefined): boolean {
  return record?.status === 'completed'
    || record?.status === 'failed'
    || record?.status === 'canceled'
    || record?.status === 'timed_out';
}

export function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) {
    return error.name === 'AbortError'
      || error.message.toLowerCase().includes('aborted')
      || error.message.toLowerCase().includes('cancelled')
      || error.message.toLowerCase().includes('canceled');
  }
  return false;
}

export function abortErrorFromSignal(signal?: AbortSignal, fallback = 'Agent run was canceled.'): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (typeof DOMException !== 'undefined' && reason instanceof DOMException) return new Error(reason.message);
  const error = new Error(typeof reason === 'string' && reason ? reason : fallback);
  error.name = 'AbortError';
  return error;
}

export function registerAgentRunCancelHandler(runId: string, handler: AgentRunCancelHandler): () => void {
  const handlers = getHandlers();
  const set = handlers.get(runId) ?? new Set<AgentRunCancelHandler>();
  set.add(handler);
  handlers.set(runId, set);
  return () => {
    const current = handlers.get(runId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) handlers.delete(runId);
  };
}

export async function cancelAgentRunWithHandlers(runId: string, input: AgentRunCancelInput = {}): Promise<void> {
  const record = getAgentRun(runId);
  if (isTerminal(record)) return;

  cancelAgentRun(runId, {
    reason: input.reason ?? 'Agent run was canceled.',
    metadata: {
      ...input.metadata,
      canceledBy: input.metadata?.canceledBy ?? 'signal',
    },
  });

  const handlers = Array.from(getHandlers().get(runId) ?? []);
  await Promise.allSettled(handlers.map(async (handler) => {
    await handler(input);
  }));
}

export function linkAbortSignalToAgentRun(
  runId: string,
  signal: AbortSignal | undefined,
  input: AgentRunCancelInput = {},
): () => void {
  if (!signal) return () => {};

  const cancel = () => {
    void cancelAgentRunWithHandlers(runId, {
      reason: input.reason ?? abortErrorFromSignal(signal),
      metadata: input.metadata,
    });
  };

  if (signal.aborted) {
    cancel();
    return () => {};
  }

  signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

export async function cancelAgentRunTree(rootRunId: string, input: AgentRunCancelInput = {}): Promise<void> {
  const records = listAgentRuns({ limit: 500 })
    .filter((record) => record.id === rootRunId || record.rootRunId === rootRunId || record.parentRunId === rootRunId)
    .filter((record) => !isTerminal(record));

  await Promise.allSettled(records.map((record) => cancelAgentRunWithHandlers(record.id, input)));
}

export function resetAgentRunCancellationForTest(): void {
  getHandlers().clear();
}
