import type {
  AskUserQuestionAnswer,
  PendingAskUserQuestion,
} from './types';

export type { AskUserQuestionDraft } from '@geminilight/mindos/client-types';
import type { AskUserQuestionDraft } from '@geminilight/mindos/client-types';

/**
 * UI-side helpers for the pending agent action sheet. The payload derivation
 * (validation, expiry filtering, ordering, stable keys) moved to the core
 * projection `server/projections/pending-actions.ts`
 * (spec-cross-process-run-events D/I): the server answers
 * `GET /api/agent/pending-actions` with normalized `actions[].key`, so this
 * module only keeps what is genuinely client-side — turning sheet draft state
 * into wire answers and compacting transport errors.
 */

export function buildAskUserQuestionAnswers(
  action: PendingAskUserQuestion,
  drafts: Record<number, AskUserQuestionDraft>,
): { ok: true; answers: AskUserQuestionAnswer[] } | { ok: false; error: string } {
  const answers: AskUserQuestionAnswer[] = [];
  for (const [questionIndex, question] of action.questions.entries()) {
    const draft = drafts[questionIndex] ?? {};
    const selected = (draft.selected ?? []).filter((label) =>
      question.options.some((option) => option.label === label));
    const custom = draft.custom?.trim() ?? '';
    if (question.multiSelect) {
      if (selected.length === 0) return incompleteAnswers();
      answers.push({ questionIndex, question: question.question, kind: 'multi', answer: null, selected });
    } else if (selected[0]) {
      answers.push({ questionIndex, question: question.question, kind: 'option', answer: selected[0] });
    } else if (custom) {
      answers.push({ questionIndex, question: question.question, kind: 'custom', answer: custom });
    } else {
      return incompleteAnswers();
    }
  }
  return { ok: true, answers };
}

function incompleteAnswers(): { ok: false; error: string } {
  return { ok: false, error: 'Answer every question before submitting.' };
}

export function compactPendingAgentActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/no longer pending|already resolved|expired/i.test(message)) {
    return 'This request was already resolved or expired.';
  }
  return message.trim() || 'Unable to update this request. Try again.';
}
