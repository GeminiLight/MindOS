import { useCallback, useEffect, useRef, useState } from 'react';
import { mindosClient } from '@/lib/api-client';
import { compactPendingAgentActionError } from '@/lib/pending-agent-actions';
import type {
  AskUserQuestionAnswer,
  PendingAgentActionsResponse,
  PendingAskUserQuestion,
  PendingAutomationApproval,
  PendingRuntimePermission,
} from '@/lib/types';
import type { ServerEvent } from '@/lib/server-events';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';

/**
 * Pending actions are now event-driven from EVERY host process
 * (spec-cross-process-run-events I): the host tails the shared prompt store
 * and emits `run.pending-actions.changed` when any process creates or
 * resolves a prompt (automation approvals included), so the old 10s
 * connected poll is gone. Payload derivation lives in the core projection —
 * the server answers with normalized `actions[].key` and this hook only
 * manages transport state.
 */
const PENDING_AGENT_ACTIONS_EVENT_TYPES = ['agent-run.event', 'run.pending-actions.changed'] as const;
const PENDING_AGENT_ACTIONS_EVENT_DEBOUNCE_MS = 250;
const PENDING_ACTION_EVENT_CATEGORIES = new Set(['permission', 'question']);
const PENDING_ACTION_RUN_TERMINAL_TYPES = new Set(['run_completed', 'run_failed', 'run_canceled']);

/** Mirrors the core `isPendingAgentActionEvent` filter (runtime code mobile cannot import). */
function acceptPendingAgentActionEvent(event: ServerEvent): boolean {
  if (event.type === 'run.pending-actions.changed') return true;
  if (event.type !== 'agent-run.event') return false;
  return PENDING_ACTION_EVENT_CATEGORIES.has(event.event.category)
    || PENDING_ACTION_RUN_TERMINAL_TYPES.has(event.event.type);
}

const EMPTY_SNAPSHOT: PendingAgentActionsResponse = {
  permissions: [],
  questions: [],
  automationApprovals: [],
  actions: [],
  pendingCount: 0,
  generatedAt: 0,
};

interface UsePendingAgentActionsOptions {
  enabled?: boolean;
  /** Fallback poll period, used only while the server event stream is not connected. */
  pollIntervalMs?: number;
}

export function usePendingAgentActions({
  enabled = true,
  pollIntervalMs = 2500,
}: UsePendingAgentActionsOptions = {}) {
  const [snapshot, setSnapshot] = useState<PendingAgentActionsResponse>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const resolvingKeyRef = useRef<string | null>(null);

  const refresh = useCallback(async (options: { force?: boolean; showLoading?: boolean } = {}) => {
    if (!enabled) {
      requestSequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      inFlight.current = false;
      setSnapshot(EMPTY_SNAPSHOT);
      setLoading(false);
      setError('');
      return;
    }
    if (inFlight.current && !options.force) return;
    if (options.force) requestController.current?.abort();

    const sequence = requestSequence.current + 1;
    const controller = new AbortController();
    requestSequence.current = sequence;
    requestController.current = controller;
    inFlight.current = true;
    if (options.showLoading) setLoading(true);
    try {
      const payload = await mindosClient.getPendingAgentActions({ signal: controller.signal });
      if (requestSequence.current !== sequence) return;
      setSnapshot(payload);
      setError('');
    } catch (requestError) {
      if (controller.signal.aborted || requestSequence.current !== sequence) return;
      setError(compactPendingAgentActionError(requestError));
    } finally {
      if (requestSequence.current === sequence) {
        inFlight.current = false;
        requestController.current = null;
        setLoading(false);
      }
    }
  }, [enabled]);

  const resolveAction = useCallback(async (
    key: string,
    operation: () => Promise<{ ok: true }>,
  ) => {
    if (resolvingKeyRef.current) return false;
    resolvingKeyRef.current = key;
    setResolvingKey(key);
    setError('');
    try {
      await operation();
      setSnapshot((current) => {
        const actions = current.actions.filter((item) => item.key !== key);
        return {
          permissions: actions.filter((item): item is PendingRuntimePermission & { key: string } => item.kind === 'runtime-permission'),
          questions: actions.filter((item): item is PendingAskUserQuestion & { key: string } => item.kind === 'user-question'),
          automationApprovals: actions.filter((item): item is PendingAutomationApproval & { key: string } => item.kind === 'automation-approval'),
          actions,
          pendingCount: actions.length,
          generatedAt: current.generatedAt,
        };
      });
      await refresh({ force: true });
      return true;
    } catch (operationError) {
      setError(compactPendingAgentActionError(operationError));
      await refresh({ force: true });
      return false;
    } finally {
      resolvingKeyRef.current = null;
      setResolvingKey(null);
    }
  }, [refresh]);

  const resolvePermission = useCallback((
    action: PendingRuntimePermission & { key: string },
    decision: string,
  ) => resolveAction(action.key, () =>
    mindosClient.resolveRuntimePermission({
      runId: action.runId,
      requestId: action.requestId,
      decision,
    })), [resolveAction]);

  const answerQuestion = useCallback((
    action: PendingAskUserQuestion & { key: string },
    answers: AskUserQuestionAnswer[],
  ) => resolveAction(action.key, () =>
    mindosClient.resolveUserQuestion({
      runId: action.runId,
      toolCallId: action.toolCallId,
      action: 'answer',
      answers,
    })), [resolveAction]);

  const cancelQuestion = useCallback((action: PendingAskUserQuestion & { key: string }) =>
    resolveAction(action.key, () =>
      mindosClient.resolveUserQuestion({
        runId: action.runId,
        toolCallId: action.toolCallId,
        action: 'cancel',
        reason: 'user_cancelled',
      })), [resolveAction]);

  const resolveAutomationApproval = useCallback((
    action: PendingAutomationApproval & { key: string },
    decision: 'allow' | 'deny',
  ) => resolveAction(action.key, () =>
    mindosClient.resolveAutomationApproval({ approvalId: action.approvalId, decision })), [resolveAction]);

  useEffect(() => {
    void refresh({ force: true, showLoading: true });
  }, [refresh]);

  useEventDrivenRefresh({
    enabled,
    eventTypes: PENDING_AGENT_ACTIONS_EVENT_TYPES,
    accept: acceptPendingAgentActionEvent,
    // An event aborts any in-flight poll so a fresh prompt is never hidden behind a stale response.
    refresh: (reason) => refresh(reason === 'poll' ? {} : { force: true }),
    debounceMs: PENDING_AGENT_ACTIONS_EVENT_DEBOUNCE_MS,
    fallbackPollMs: pollIntervalMs,
  });

  useEffect(() => () => {
    requestSequence.current += 1;
    requestController.current?.abort();
  }, []);

  return {
    ...snapshot,
    loading,
    error,
    resolvingKey,
    refresh,
    resolvePermission,
    resolveAutomationApproval,
    answerQuestion,
    cancelQuestion,
  };
}
