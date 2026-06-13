/**
 * Behavior tests for the ask-user-question bridge. Migrated from
 * packages/web/__tests__/agent/user-question-bridge.test.ts
 * (spec-agent-core-consolidation Wave 2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  answerAskUserQuestion,
  askUserQuestionForRun,
  askUserQuestionViaBridge,
  cancelAskUserQuestion,
  getPendingAskUserQuestionCount,
  runWithAskUserQuestionBridge,
} from './user-question-bridge.js';

const params = {
  questions: [
    {
      question: 'Which implementation should MindOS use?',
      header: 'Approach',
      options: [
        { label: 'Bridge', description: 'Use the upstream tool and MindOS UI bridge.' },
        { label: 'Fork', description: 'Copy the upstream implementation locally.' },
      ],
    },
  ],
};

const normalizedQuestions = [{
  ...params.questions[0],
  multiSelect: false,
}];

afterEach(() => {
  vi.useRealTimers();
});

describe('ask user question bridge', () => {
  it('emits a start event and resolves the pending tool call with answers', async () => {
    const send = vi.fn();
    const promise = runWithAskUserQuestionBridge(
      { runId: 'run-1', send },
      () => askUserQuestionViaBridge({ toolCallId: 'tool-1', params }),
    );

    expect(getPendingAskUserQuestionCount()).toBe(1);
    expect(send).toHaveBeenCalledWith({
      type: 'user_question_start',
      runId: 'run-1',
      toolCallId: 'tool-1',
      questions: normalizedQuestions,
    });

    const answer = {
      questionIndex: 0,
      question: params.questions[0].question,
      kind: 'option' as const,
      answer: 'Bridge',
    };
    expect(answerAskUserQuestion({ runId: 'run-1', toolCallId: 'tool-1', answers: [answer] })).toEqual({ ok: true });

    await expect(promise).resolves.toEqual({ answers: [answer], cancelled: false });
    expect(getPendingAskUserQuestionCount()).toBe(0);
    expect(send).toHaveBeenLastCalledWith({
      type: 'user_question_answered',
      runId: 'run-1',
      toolCallId: 'tool-1',
      answers: [answer],
    });
  });

  it('cancels a pending question without leaving pending state behind', async () => {
    const send = vi.fn();
    const promise = runWithAskUserQuestionBridge(
      { runId: 'run-2', send },
      () => askUserQuestionViaBridge({ toolCallId: 'tool-2', params }),
    );

    expect(cancelAskUserQuestion({ runId: 'run-2', toolCallId: 'tool-2', reason: 'user_cancelled' })).toEqual({ ok: true });

    await expect(promise).resolves.toEqual({ answers: [], cancelled: true, error: 'user_cancelled' });
    expect(getPendingAskUserQuestionCount()).toBe(0);
    expect(send).toHaveBeenLastCalledWith({
      type: 'user_question_cancelled',
      runId: 'run-2',
      toolCallId: 'tool-2',
      reason: 'user_cancelled',
    });
  });

  it('lets an external runtime bridge ask through the active run id', async () => {
    const send = vi.fn();
    const promise = runWithAskUserQuestionBridge(
      { runId: 'run-external', send },
      async () => {
        const question = askUserQuestionForRun({ runId: 'run-external', toolCallId: 'claude-question-1', params });
        expect(getPendingAskUserQuestionCount()).toBe(1);
        expect(send).toHaveBeenCalledWith({
          type: 'user_question_start',
          runId: 'run-external',
          toolCallId: 'claude-question-1',
          questions: normalizedQuestions,
        });
        expect(answerAskUserQuestion({
          runId: 'run-external',
          toolCallId: 'claude-question-1',
          answers: [{ questionIndex: 0, question: params.questions[0].question, kind: 'option', answer: 'Bridge' }],
        })).toEqual({ ok: true });
        return question;
      },
    );

    await expect(promise).resolves.toMatchObject({
      cancelled: false,
      answers: [{ answer: 'Bridge' }],
    });
    expect(getPendingAskUserQuestionCount()).toBe(0);
  });

  it('returns 404 for a stale answer or cancel request', () => {
    expect(answerAskUserQuestion({ runId: 'missing', toolCallId: 'tool', answers: [] })).toEqual({
      ok: false,
      status: 404,
      error: 'Question is no longer pending.',
    });
    expect(cancelAskUserQuestion({ runId: 'missing', toolCallId: 'tool' })).toEqual({
      ok: false,
      status: 404,
      error: 'Question is no longer pending.',
    });
  });

  it('rejects answers that do not match the pending question contract without resolving it', async () => {
    const send = vi.fn();
    const promise = runWithAskUserQuestionBridge(
      { runId: 'run-invalid', send },
      () => askUserQuestionViaBridge({ toolCallId: 'tool-invalid', params }),
    );

    expect(answerAskUserQuestion({
      runId: 'run-invalid',
      toolCallId: 'tool-invalid',
      answers: [{ questionIndex: 1, question: params.questions[0].question, kind: 'option', answer: 'Bridge' }],
    })).toEqual({
      ok: false,
      status: 400,
      error: 'Answer questionIndex does not match a pending question.',
    });
    expect(answerAskUserQuestion({
      runId: 'run-invalid',
      toolCallId: 'tool-invalid',
      answers: [{ questionIndex: 0, question: 'Different question', kind: 'option', answer: 'Bridge' }],
    })).toEqual({
      ok: false,
      status: 400,
      error: 'Answer question text does not match the pending question.',
    });
    expect(answerAskUserQuestion({
      runId: 'run-invalid',
      toolCallId: 'tool-invalid',
      answers: [{ questionIndex: 0, question: params.questions[0].question, kind: 'option', answer: 'Unknown' }],
    })).toEqual({
      ok: false,
      status: 400,
      error: 'Selected option is not valid for this question.',
    });
    expect(getPendingAskUserQuestionCount()).toBe(1);

    const validAnswer = { questionIndex: 0, question: params.questions[0].question, kind: 'option' as const, answer: 'Bridge' };
    expect(answerAskUserQuestion({ runId: 'run-invalid', toolCallId: 'tool-invalid', answers: [validAnswer] })).toEqual({ ok: true });
    await expect(promise).resolves.toEqual({ answers: [validAnswer], cancelled: false });
    expect(getPendingAskUserQuestionCount()).toBe(0);
  });

  it('validates multi-select answers against the pending options', async () => {
    const send = vi.fn();
    const multiParams = {
      questions: [{
        question: 'Which files should Claude Code update?',
        header: 'Files',
        multiSelect: true,
        options: [
          { label: 'README.md', description: 'Docs' },
          { label: 'SPEC.md', description: 'Spec' },
        ],
      }],
    };
    const promise = runWithAskUserQuestionBridge(
      { runId: 'run-multi', send },
      () => askUserQuestionViaBridge({ toolCallId: 'tool-multi', params: multiParams }),
    );

    expect(answerAskUserQuestion({
      runId: 'run-multi',
      toolCallId: 'tool-multi',
      answers: [{ questionIndex: 0, question: multiParams.questions[0].question, kind: 'multi', answer: null, selected: ['README.md', 'NOPE.md'] }],
    })).toEqual({
      ok: false,
      status: 400,
      error: 'Selected option is not valid for this question.',
    });

    const validAnswer = {
      questionIndex: 0,
      question: multiParams.questions[0].question,
      kind: 'multi' as const,
      answer: null,
      selected: ['README.md', 'SPEC.md'],
    };
    expect(answerAskUserQuestion({ runId: 'run-multi', toolCallId: 'tool-multi', answers: [validAnswer] })).toEqual({ ok: true });
    await expect(promise).resolves.toEqual({ answers: [validAnswer], cancelled: false });
  });

  it('rejects empty question requests without creating a pending UI card', async () => {
    const send = vi.fn();
    const result = await runWithAskUserQuestionBridge(
      { runId: 'run-empty', send },
      () => askUserQuestionViaBridge({ toolCallId: 'tool-empty', params: { questions: [] } }),
    );

    expect(result).toEqual({ answers: [], cancelled: true, error: 'empty_questions' });
    expect(send).not.toHaveBeenCalled();
    expect(getPendingAskUserQuestionCount()).toBe(0);
  });

  it('aborts exactly once and removes the abort listener after normal answer', async () => {
    const send = vi.fn();
    const controller = new AbortController();
    const promise = runWithAskUserQuestionBridge(
      { runId: 'run-3', send },
      () => askUserQuestionViaBridge({ toolCallId: 'tool-3', params, signal: controller.signal }),
    );

    expect(answerAskUserQuestion({
      runId: 'run-3',
      toolCallId: 'tool-3',
      answers: [{ questionIndex: 0, question: params.questions[0].question, kind: 'option', answer: 'Bridge' }],
    })).toEqual({ ok: true });

    await expect(promise).resolves.toMatchObject({ cancelled: false });
    controller.abort();

    expect(send.mock.calls.filter(([event]) => event.type === 'user_question_cancelled')).toHaveLength(0);
  });

  it('does not let a finished bridge cancel a newer bridge registered for the same runId', async () => {
    const sendA = vi.fn();
    const sendB = vi.fn();

    let resolveA!: () => void;
    const bridgeA = runWithAskUserQuestionBridge(
      { runId: 'run-shared', send: sendA },
      () => new Promise<void>((resolve) => { resolveA = resolve; }),
    );

    let questionPromise!: Promise<unknown>;
    let resolveB!: () => void;
    const bridgeB = runWithAskUserQuestionBridge(
      { runId: 'run-shared', send: sendB },
      async () => {
        questionPromise = askUserQuestionForRun({ runId: 'run-shared', toolCallId: 'tool-b', params });
        await new Promise<void>((resolve) => { resolveB = resolve; });
        return questionPromise;
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    // Bridge A finishes while bridge B still has a question pending.
    resolveA();
    await bridgeA;

    // B's question must survive A's cleanup and remain answerable.
    expect(answerAskUserQuestion({
      runId: 'run-shared',
      toolCallId: 'tool-b',
      answers: [{ questionIndex: 0, question: params.questions[0].question, kind: 'option', answer: 'Bridge' }],
    })).toEqual({ ok: true });
    await expect(questionPromise).resolves.toMatchObject({ cancelled: false });
    expect(sendB.mock.calls.filter(([event]) => event.type === 'user_question_cancelled')).toHaveLength(0);

    resolveB();
    await bridgeB;
  });
});
