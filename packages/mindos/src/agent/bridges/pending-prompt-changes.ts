import {
  getPendingDecisionTailTimer,
  markPendingDecisionConsumed,
  readPendingDecisionsForOwner,
  setPendingDecisionTailTimer,
  type PendingPromptDecisionRow,
} from './pending-prompt-store.js';
import { getPendingRuntimePermissionCount, resolveRuntimePermission } from './runtime-permission-bridge.js';
import {
  answerAskUserQuestion,
  cancelAskUserQuestion,
  getPendingAskUserQuestionCount,
} from './user-question-bridge.js';

/**
 * Owner-side drain of cross-process prompt decisions
 * (spec-cross-process-run-events C). Another process submitted a decision
 * through the pending prompt store; the process that HOLDS the prompt polls
 * the store every 500 ms while any prompt is pending and resolves the
 * original bridge promise through the normal local path (so SSE
 * `runtime_permission_resolved` / `user_question_answered` frames still go
 * out to the run's stream).
 *
 * The timer lives in the shared process state (AGENT_PENDING_PROMPTS_KEY):
 * Next loads bridges in several module copies and a forked timer would drain
 * each decision more than once.
 */

export const PENDING_DECISION_TAIL_MS = 500;

/**
 * Start the drain timer while this process holds prompts, stop it when both
 * bridge maps are empty. Called by the bridges after every enqueue and finish;
 * cheap enough to call unconditionally.
 */
export function ensurePendingDecisionTail(): void {
  const hasPending = getPendingRuntimePermissionCount() + getPendingAskUserQuestionCount() > 0;
  const current = getPendingDecisionTailTimer();
  if (!hasPending) {
    if (current) {
      clearInterval(current);
      setPendingDecisionTailTimer(null);
    }
    return;
  }
  if (current) return;
  const timer = setInterval(() => {
    drainPendingDecisionsOnce();
  }, PENDING_DECISION_TAIL_MS);
  timer.unref?.();
  setPendingDecisionTailTimer(timer);
}

/** One drain pass: apply every unconsumed decision for this owner, then consume it. */
export function drainPendingDecisionsOnce(): void {
  const decisions = readPendingDecisionsForOwner();
  for (const row of decisions) {
    applyPendingDecision(row);
    // Consume even when the local resolve missed (prompt timed out first):
    // an unconsumed row would be retried every tick forever.
    markPendingDecisionConsumed(row.key);
  }
  if (decisions.length > 0) ensurePendingDecisionTail();
}

function applyPendingDecision(row: PendingPromptDecisionRow): void {
  try {
    if (row.kind === 'runtime-permission') {
      if (row.decision.type === 'permission-decision') {
        resolveRuntimePermission({ runId: row.runId, requestId: row.promptId, decision: row.decision.decision });
      }
      return;
    }
    if (row.decision.type === 'question-answers') {
      answerAskUserQuestion({ runId: row.runId, toolCallId: row.promptId, answers: row.decision.answers });
    } else {
      cancelAskUserQuestion({
        runId: row.runId,
        toolCallId: row.promptId,
        reason: row.decision.type === 'question-cancel' ? row.decision.reason : 'user_cancelled',
      });
    }
  } catch {
    // A failed local resolve must not stop the drain loop; consumption below
    // prevents infinite retries and the prompt's own timeout still applies.
  }
}
