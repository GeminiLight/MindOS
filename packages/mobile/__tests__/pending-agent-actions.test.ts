import { describe, expect, it } from 'vitest';
import {
  buildAskUserQuestionAnswers,
  compactPendingAgentActionError,
} from '@/lib/pending-agent-actions';
import type { PendingAskUserQuestion } from '@/lib/types';

/**
 * The payload derivation (validation / expiry / ordering / keys) moved to the
 * core projection `server/projections/pending-actions.ts`, covered by
 * packages/mindos/src/server/projections/pending-actions.test.ts
 * (spec-cross-process-run-events D/I). Mobile keeps only the UI-side helpers.
 */

const NOW = 10_000;

function questionAction(questions: PendingAskUserQuestion['questions']): PendingAskUserQuestion {
  return {
    kind: 'user-question',
    runId: 'run',
    toolCallId: 'question',
    questions,
    createdAt: 1,
    expiresAt: NOW + 10_000,
  };
}

describe('buildAskUserQuestionAnswers', () => {
  it('builds single, custom, and multi-select answers for every question', () => {
    const action = questionAction([
      { header: 'Mode', question: 'Choose mode', options: [{ label: 'Safe', description: '' }] },
      { header: 'Checks', question: 'Choose checks', multiSelect: true, options: [
        { label: 'Tests', description: '' }, { label: 'Build', description: '' },
      ] },
      { header: 'Notes', question: 'Add context', options: [] },
    ]);

    expect(buildAskUserQuestionAnswers(action, {
      0: { selected: ['Safe'] },
      1: { selected: ['Tests', 'Build'] },
      2: { custom: 'Release after CI' },
    })).toEqual({
      ok: true,
      answers: [
        { questionIndex: 0, question: 'Choose mode', kind: 'option', answer: 'Safe' },
        { questionIndex: 1, question: 'Choose checks', kind: 'multi', answer: null, selected: ['Tests', 'Build'] },
        { questionIndex: 2, question: 'Add context', kind: 'custom', answer: 'Release after CI' },
      ],
    });
  });

  it('rejects incomplete drafts', () => {
    const action = questionAction([
      { header: 'Mode', question: 'Choose mode', options: [{ label: 'Safe', description: '' }] },
    ]);
    expect(buildAskUserQuestionAnswers(action, {})).toEqual({
      ok: false,
      error: 'Answer every question before submitting.',
    });
  });

  it('ignores stale selections that no longer match an option and falls back to custom text', () => {
    const action = questionAction([
      { header: 'Mode', question: 'Choose mode', options: [{ label: 'Safe', description: '' }] },
    ]);
    expect(buildAskUserQuestionAnswers(action, { 0: { selected: ['Removed option'], custom: 'Do it manually' } }))
      .toEqual({
        ok: true,
        answers: [{ questionIndex: 0, question: 'Choose mode', kind: 'custom', answer: 'Do it manually' }],
      });
  });
});

describe('compactPendingAgentActionError', () => {
  it('compacts resolved-or-expired failures into one calm message', () => {
    expect(compactPendingAgentActionError(new Error('Question is no longer pending.')))
      .toBe('This request was already resolved or expired.');
    expect(compactPendingAgentActionError(new Error('Permission request is no longer pending.')))
      .toBe('This request was already resolved or expired.');
  });

  it('passes other messages through and never returns an empty string', () => {
    expect(compactPendingAgentActionError('network down')).toBe('network down');
    expect(compactPendingAgentActionError(new Error('   '))).toBe('Unable to update this request. Try again.');
    expect(compactPendingAgentActionError(undefined)).toBe('Unable to update this request. Try again.');
  });
});
