'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getServerEventsState, subscribeServerEvents } from '@/lib/server-events';
import {
  compactPendingAgentActionError,
  isPendingAgentActionEvent,
  normalizePendingAgentActions,
  pendingAgentActionKey,
  type PendingAgentActionsPayload,
  type PendingAskUserQuestionAction,
  type PendingAutomationApprovalAction,
  type PendingRuntimePermissionAction,
} from '@geminilight/mindos/server/projections/pending-actions';
import type { AskUserQuestionAnswer } from '@/lib/types';

/**
 * Event-driven pending agent actions for the Web ask panel
 * (spec-cross-process-run-events H).
 *
 * Refresh triggers, fastest first:
 * - `run.pending-actions.changed` — emitted by any host the moment a prompt
 *   is created or resolved in ANY process (in-process notification plus the
 *   ledger tail bridge watching the shared store).
 * - `agent-run.event` filtered through the shared `isPendingAgentActionEvent`
 *   (permission / question / run-terminal events).
 * - `ready.resync` after a replay gap.
 * All triggers share one 250ms debounce. Polling runs ONLY while the stream
 * is not connected and the tab is visible (10s fallback), because a host
 * without the tail bridge (old Product Server) still has to work.
 *
 * Resolve semantics: a 404 from a decision POST means the prompt was resolved
 * elsewhere (another tab, another host, or a timeout) — the action disappears
 * from the list without an error and the list refetches immediately, so the
 * UI never spins forever on a stale prompt.
 */

export const PENDING_ACTIONS_EVENT_DEBOUNCE_MS = 250;
export const PENDING_ACTIONS_FALLBACK_POLL_MS = 10_000;
export const PENDING_ACTIONS_URL = '/api/agent/pending-actions';
export const RUNTIME_PERMISSION_DECISION_URL = '/api/agent/runtime-permission';
export const USER_QUESTION_DECISION_URL = '/api/agent/user-question';
export const AUTOMATION_APPROVAL_DECISION_URL = '/api/agent/automation-approval';

const refreshListeners = new Set<() => void>();

/**
 * Asks every mounted hook instance to refetch now. Used by inline controls
 * (ToolCallBlock) that resolved or lost a prompt outside this hook.
 */
export function requestPendingAgentActionsRefresh(): void {
  for (const listener of Array.from(refreshListeners)) {
    try {
      listener();
    } catch {
      // A broken listener must not stop the others.
    }
  }
}

function emptyPayload(): PendingAgentActionsPayload {
  return normalizePendingAgentActions({ permissions: [], questions: [], automationApprovals: [] });
}

interface UsePendingAgentActionsOptions {
  /** Fallback poll period, used only while the server event stream is not connected. */
  pollIntervalMs?: number;
}

export function usePendingAgentActions({
  pollIntervalMs = PENDING_ACTIONS_FALLBACK_POLL_MS,
}: UsePendingAgentActionsOptions = {}) {
  const [snapshot, setSnapshot] = useState<PendingAgentActionsPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const resolvingKeyRef = useRef<string | null>(null);

  const refresh = useCallback(async (options: { force?: boolean; showLoading?: boolean } = {}) => {
    if (inFlight.current && !options.force) return;
    if (options.force) requestController.current?.abort();

    const sequence = requestSequence.current + 1;
    const controller = new AbortController();
    requestSequence.current = sequence;
    requestController.current = controller;
    inFlight.current = true;
    if (options.showLoading) setLoading(true);
    try {
      const response = await fetch(PENDING_ACTIONS_URL, { cache: 'no-store', signal: controller.signal });
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (requestSequence.current !== sequence) return;
      if (!response.ok) {
        throw new Error(typeof (body as { error?: unknown } | null)?.error === 'string'
          ? (body as { error: string }).error
          : 'Failed to load pending agent actions.');
      }
      setSnapshot(normalizePendingAgentActions(body));
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
  }, []);

  const removeByKey = useCallback((key: string) => {
    setSnapshot((current) => normalizePendingAgentActions({
      permissions: current.permissions.filter((item) => pendingAgentActionKey(item) !== key),
      questions: current.questions.filter((item) => pendingAgentActionKey(item) !== key),
      automationApprovals: current.automationApprovals.filter((item) => pendingAgentActionKey(item) !== key),
      generatedAt: current.generatedAt,
    }));
  }, []);

  const resolveAction = useCallback(async (key: string, request: () => Promise<Response>): Promise<boolean> => {
    if (resolvingKeyRef.current) return false;
    resolvingKeyRef.current = key;
    setResolvingKey(key);
    setError('');
    try {
      const response = await request();
      if (response.ok || response.status === 404) {
        // 404 = resolved elsewhere (another tab/host, timeout, dead owner).
        // Drop it locally and refetch; never surface it as an error.
        removeByKey(key);
        await refresh({ force: true });
        return response.ok;
      }
      const body = await response.json().catch(() => null);
      throw new Error(typeof (body as { error?: unknown } | null)?.error === 'string'
        ? (body as { error: string }).error
        : 'Could not resolve this request.');
    } catch (requestError) {
      // Refetch first, then surface the error: a successful refresh clears
      // `error`, and a failed decision must stay visible to the user.
      await refresh({ force: true });
      setError(compactPendingAgentActionError(requestError));
      return false;
    } finally {
      resolvingKeyRef.current = null;
      setResolvingKey(null);
    }
  }, [refresh, removeByKey]);

  const postJson = useCallback((url: string, body: unknown) => () => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), []);

  const resolvePermission = useCallback((action: PendingRuntimePermissionAction, decision: string) => (
    resolveAction(
      pendingAgentActionKey(action),
      postJson(RUNTIME_PERMISSION_DECISION_URL, {
        runId: action.runId,
        requestId: action.requestId,
        decision,
      }),
    )
  ), [postJson, resolveAction]);

  const answerQuestion = useCallback((action: PendingAskUserQuestionAction, answers: AskUserQuestionAnswer[]) => (
    resolveAction(
      pendingAgentActionKey(action),
      postJson(USER_QUESTION_DECISION_URL, {
        runId: action.runId,
        toolCallId: action.toolCallId,
        action: 'answer',
        answers,
      }),
    )
  ), [postJson, resolveAction]);

  const cancelQuestion = useCallback((action: PendingAskUserQuestionAction) => (
    resolveAction(
      pendingAgentActionKey(action),
      postJson(USER_QUESTION_DECISION_URL, {
        runId: action.runId,
        toolCallId: action.toolCallId,
        action: 'cancel',
        reason: 'user_cancelled',
      }),
    )
  ), [postJson, resolveAction]);

  const resolveAutomationApproval = useCallback((
    action: PendingAutomationApprovalAction,
    decision: 'allow' | 'deny',
  ) => (
    resolveAction(
      pendingAgentActionKey(action),
      postJson(AUTOMATION_APPROVAL_DECISION_URL, { approvalId: action.approvalId, decision }),
    )
  ), [postJson, resolveAction]);

  // Initial snapshot.
  useEffect(() => {
    void refresh({ force: true, showLoading: true });
  }, [refresh]);

  // Event-driven refreshes: one 250ms debounce shared by every trigger.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounceTimer !== null) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void refresh({ force: true });
      }, PENDING_ACTIONS_EVENT_DEBOUNCE_MS);
    };
    const unsubscribePending = subscribeServerEvents('run.pending-actions.changed', schedule);
    const unsubscribeRuns = subscribeServerEvents('agent-run.event', (event) => {
      if (isPendingAgentActionEvent(event)) schedule();
    });
    const unsubscribeReady = subscribeServerEvents('ready', (event) => {
      if (event.resync) schedule();
    });
    refreshListeners.add(schedule);
    return () => {
      unsubscribePending();
      unsubscribeRuns();
      unsubscribeReady();
      refreshListeners.delete(schedule);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
    };
  }, [refresh]);

  // Degraded path: poll only while the stream is NOT connected and the tab is
  // visible; catch up once when the tab returns.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (getServerEventsState() === 'connected') return;
      void refresh({});
    };
    const interval = setInterval(tick, pollIntervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [pollIntervalMs, refresh]);

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
    answerQuestion,
    cancelQuestion,
    resolveAutomationApproval,
  };
}
