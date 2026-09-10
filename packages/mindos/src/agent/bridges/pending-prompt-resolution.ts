import {
  pendingPromptKey,
  readOpenPendingPrompt,
  submitPendingPromptDecision,
  type SubmitPendingPromptDecisionResult,
} from './pending-prompt-store.js';
import { resolveRuntimePermission } from './runtime-permission-bridge.js';
import {
  answerAskUserQuestion,
  cancelAskUserQuestion,
  validateAskUserQuestionAnswers,
  type AskUserQuestionAnswer,
} from './user-question-bridge.js';

/**
 * Resolve-or-forward entry points for the HTTP decision routes
 * (spec-cross-process-run-events C). A POST /api/agent/runtime-permission or
 * /api/agent/user-question lands on whichever host the client is talking to;
 * the prompt itself may be pending in a DIFFERENT process (the Next host
 * while the client talks to the Product Server, or an automation worker).
 *
 * Path: try the in-process bridge map first (unchanged behavior, 200). On a
 * local 404, look the prompt up in the cross-process store, validate the
 * decision against the persisted snapshot (same rules as the local path) and
 * submit it; the owning process drains it into the original promise. Status
 * codes and error messages are unchanged so existing clients keep working:
 * 400 for an invalid decision, 404 for a prompt that is gone either way.
 */

export type PendingPromptResolution =
  | { ok: true; forwarded?: true }
  | { ok: false; status: number; error: string };

const PERMISSION_EXPIRED_ERROR = 'Permission request is no longer pending.';
const QUESTION_EXPIRED_ERROR = 'Question is no longer pending.';

function forwardedResult(submitted: SubmitPendingPromptDecisionResult, expiredError: string): PendingPromptResolution {
  if (submitted.ok) return { ok: true, forwarded: true };
  return { ok: false, status: 404, error: expiredError };
}

export function resolveRuntimePermissionOrForward(input: {
  runId: string;
  requestId: string;
  decision: string;
}): PendingPromptResolution {
  const local = resolveRuntimePermission(input);
  if (local.ok || local.status !== 404) return local;

  const key = pendingPromptKey({ kind: 'runtime-permission', runId: input.runId, requestId: input.requestId });
  const row = readOpenPendingPrompt(key, Date.now());
  if (!row || row.snapshot.kind !== 'runtime-permission') return local;
  const decision = input.decision || 'cancel';
  if (decision !== 'cancel' && !row.snapshot.options.some((option) => option.id === decision)) {
    return { ok: false, status: 400, error: 'Permission decision is not valid for this request.' };
  }
  return forwardedResult(
    submitPendingPromptDecision(key, { type: 'permission-decision', decision }),
    PERMISSION_EXPIRED_ERROR,
  );
}

export function answerAskUserQuestionOrForward(input: {
  runId: string;
  toolCallId: string;
  answers: AskUserQuestionAnswer[];
  cancelled?: boolean;
}): PendingPromptResolution {
  const local = answerAskUserQuestion(input);
  if (local.ok || local.status !== 404) return local;

  const key = pendingPromptKey({ kind: 'user-question', runId: input.runId, toolCallId: input.toolCallId });
  const row = readOpenPendingPrompt(key, Date.now());
  if (!row || row.snapshot.kind !== 'user-question') return local;
  if (input.cancelled === true) {
    return forwardedResult(
      submitPendingPromptDecision(key, { type: 'question-cancel', reason: 'user_cancelled' }),
      QUESTION_EXPIRED_ERROR,
    );
  }
  const validation = validateAskUserQuestionAnswers(row.snapshot.questions, input.answers);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };
  return forwardedResult(
    submitPendingPromptDecision(key, { type: 'question-answers', answers: validation.answers }),
    QUESTION_EXPIRED_ERROR,
  );
}

export function cancelAskUserQuestionOrForward(input: {
  runId: string;
  toolCallId: string;
  reason?: string;
}): PendingPromptResolution {
  const local = cancelAskUserQuestion(input);
  if (local.ok || local.status !== 404) return local;

  const key = pendingPromptKey({ kind: 'user-question', runId: input.runId, toolCallId: input.toolCallId });
  const row = readOpenPendingPrompt(key, Date.now());
  if (!row || row.snapshot.kind !== 'user-question') return local;
  return forwardedResult(
    submitPendingPromptDecision(key, { type: 'question-cancel', reason: input.reason ?? 'user_cancelled' }),
    QUESTION_EXPIRED_ERROR,
  );
}
