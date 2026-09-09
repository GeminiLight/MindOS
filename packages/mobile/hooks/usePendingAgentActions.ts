import { useCallback, useEffect, useRef, useState } from 'react';
import { mindosClient } from '@/lib/api-client';
import {
  compactPendingAgentActionError,
  isPendingAgentActionEvent,
  normalizePendingAgentActions,
  pendingAgentActionKey,
  type NormalizedPendingAgentActions,
} from '@/lib/pending-agent-actions';
import type {
  AskUserQuestionAnswer,
  PendingAskUserQuestion,
  PendingAutomationApproval,
  PendingRuntimePermission,
} from '@/lib/types';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';

/**
 * Automation approvals are written by the automation executor and have no
 * server event yet, so a slow poll stays on even while the stream is
 * connected. Permission and question prompts arrive through `agent-run.event`.
 */
export const PENDING_AGENT_ACTIONS_CONNECTED_POLL_MS = 10_000;
const PENDING_AGENT_ACTIONS_EVENT_TYPES = ['agent-run.event'] as const;
const PENDING_AGENT_ACTIONS_EVENT_DEBOUNCE_MS = 250;

interface UsePendingAgentActionsOptions {
  enabled?: boolean;
  /** Fallback poll period, used only while the server event stream is not connected. */
  pollIntervalMs?: number;
}

export function usePendingAgentActions({
  enabled = true,
  pollIntervalMs = 2500,
}: UsePendingAgentActionsOptions = {}) {
  const [snapshot, setSnapshot] = useState<NormalizedPendingAgentActions>(() =>
    normalizePendingAgentActions({ permissions: [], questions: [], automationApprovals: [] }));
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
      setSnapshot(normalizePendingAgentActions({ permissions: [], questions: [], automationApprovals: [] }));
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
      setSnapshot(normalizePendingAgentActions(payload));
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
        const permissions = current.permissions.filter((item) => pendingAgentActionKey(item) !== key);
        const questions = current.questions.filter((item) => pendingAgentActionKey(item) !== key);
        const automationApprovals = current.automationApprovals
          .filter((item) => pendingAgentActionKey(item) !== key);
        return normalizePendingAgentActions({ permissions, questions, automationApprovals });
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
    action: PendingRuntimePermission,
    decision: string,
  ) => resolveAction(pendingAgentActionKey(action), () =>
    mindosClient.resolveRuntimePermission({
      runId: action.runId,
      requestId: action.requestId,
      decision,
    })), [resolveAction]);

  const answerQuestion = useCallback((
    action: PendingAskUserQuestion,
    answers: AskUserQuestionAnswer[],
  ) => resolveAction(pendingAgentActionKey(action), () =>
    mindosClient.resolveUserQuestion({
      runId: action.runId,
      toolCallId: action.toolCallId,
      action: 'answer',
      answers,
    })), [resolveAction]);

  const cancelQuestion = useCallback((action: PendingAskUserQuestion) =>
    resolveAction(pendingAgentActionKey(action), () =>
      mindosClient.resolveUserQuestion({
        runId: action.runId,
        toolCallId: action.toolCallId,
        action: 'cancel',
        reason: 'user_cancelled',
      })), [resolveAction]);

  const resolveAutomationApproval = useCallback((
    action: PendingAutomationApproval,
    decision: 'allow' | 'deny',
  ) => resolveAction(pendingAgentActionKey(action), () =>
    mindosClient.resolveAutomationApproval({ approvalId: action.approvalId, decision })), [resolveAction]);

  useEffect(() => {
    void refresh({ force: true, showLoading: true });
  }, [refresh]);

  useEventDrivenRefresh({
    enabled,
    eventTypes: PENDING_AGENT_ACTIONS_EVENT_TYPES,
    accept: isPendingAgentActionEvent,
    // An event aborts any in-flight poll so a fresh prompt is never hidden behind a stale response.
    refresh: (reason) => refresh(reason === 'poll' ? {} : { force: true }),
    debounceMs: PENDING_AGENT_ACTIONS_EVENT_DEBOUNCE_MS,
    fallbackPollMs: pollIntervalMs,
    connectedPollMs: PENDING_AGENT_ACTIONS_CONNECTED_POLL_MS,
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
