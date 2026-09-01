import { describe, expect, it } from 'vitest';
import {
  buildAskUserQuestionAnswers,
  compactPendingAgentActionError,
  normalizePendingAgentActions,
  pendingAgentActionKey,
} from '@/lib/pending-agent-actions';

const NOW = 10_000;

describe('pending agent action model', () => {
  it('normalizes, orders, and identifies permission and question actions', () => {
    const result = normalizePendingAgentActions({
      permissions: [{
        kind: 'runtime-permission',
        runId: 'run-2',
        requestId: 'permission-1',
        runtime: 'codex',
        toolCallId: 'tool-2',
        toolName: 'bash',
        action: 'command',
        resource: 'pnpm test',
        options: [{ id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' }],
        risk: { level: 'medium', summary: 'Runs a command.' },
        createdAt: 9_200,
        expiresAt: 20_000,
      }],
      questions: [{
        kind: 'user-question',
        runId: 'run-1',
        toolCallId: 'tool-1',
        questions: [{
          header: 'Release',
          question: 'Ship now?',
          options: [{ label: 'Yes', description: 'Publish the patch.' }],
        }],
        createdAt: 9_100,
        expiresAt: 20_000,
      }],
    }, NOW);

    expect(result.pendingCount).toBe(2);
    expect(result.actions.map(pendingAgentActionKey)).toEqual([
      'user-question:run-1:tool-1',
      'runtime-permission:run-2:permission-1',
    ]);
  });

  it('drops expired and malformed actions instead of exposing broken approvals', () => {
    const result = normalizePendingAgentActions({
      permissions: [
        { kind: 'runtime-permission', expiresAt: 20_000 },
        {
          kind: 'runtime-permission', runId: 'run', requestId: 'expired', runtime: 'codex',
          toolCallId: 'tool', toolName: 'bash', action: 'command', options: [],
          risk: { level: 'low', summary: 'Read only.' }, createdAt: 1, expiresAt: NOW,
        },
      ],
      questions: [{ kind: 'user-question', runId: '', toolCallId: 'tool', questions: [], createdAt: 1, expiresAt: 20_000 }],
    }, NOW);

    expect(result).toMatchObject({ permissions: [], questions: [], actions: [], pendingCount: 0 });
  });

  it('builds single, custom, and multi-select answers for every question', () => {
    const action = normalizePendingAgentActions({
      questions: [{
        kind: 'user-question', runId: 'run', toolCallId: 'question', createdAt: 1, expiresAt: 20_000,
        questions: [
          { header: 'Mode', question: 'Choose mode', options: [{ label: 'Safe', description: '' }] },
          { header: 'Checks', question: 'Choose checks', multiSelect: true, options: [
            { label: 'Tests', description: '' }, { label: 'Build', description: '' },
          ] },
          { header: 'Notes', question: 'Add context', options: [] },
        ],
      }],
    }, NOW).questions[0];

    expect(buildAskUserQuestionAnswers(action!, {
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

  it('rejects incomplete answers and compacts transport errors', () => {
    const action = normalizePendingAgentActions({
      questions: [{
        kind: 'user-question', runId: 'run', toolCallId: 'question', createdAt: 1, expiresAt: 20_000,
        questions: [{ header: 'Mode', question: 'Choose mode', options: [{ label: 'Safe', description: '' }] }],
      }],
    }, NOW).questions[0];

    expect(buildAskUserQuestionAnswers(action!, {})).toEqual({
      ok: false,
      error: 'Answer every question before submitting.',
    });
    expect(compactPendingAgentActionError(new Error('Question is no longer pending.')))
      .toBe('This request was already resolved or expired.');
    expect(compactPendingAgentActionError('network down')).toBe('network down');
  });
});
