import { describe, expect, it } from 'vitest';
import {
  buildAskUserQuestionAnswers,
  compactPendingAgentActionError,
  isPendingAgentActionEvent,
  normalizePendingAgentActions,
  pendingAgentActionKey,
} from './pending-actions.js';

/**
 * Core pending-actions projection (spec-cross-process-run-events D). These
 * cases were ported from packages/mobile/__tests__/pending-agent-actions.test.ts
 * so the derivation exists exactly once; mobile keeps only UI draft helpers.
 */

const NOW = 10_000;

describe('pending agent action model', () => {
  it('normalizes, orders, and identifies permission and question actions', () => {
    const result = normalizePendingAgentActions({
      automationApprovals: [{
        kind: 'automation-approval',
        approvalId: 'approval-release',
        jobId: 'automation-release',
        runId: 'automation-run-1',
        jobTitle: 'Release observer',
        runtime: 'codex',
        toolName: 'apply_patch',
        action: 'edit release notes',
        resource: 'wiki/90-changelog.md',
        inputPreview: '{"path":"wiki/90-changelog.md"}',
        risk: { level: 'medium', summary: 'Updates release notes.' },
        createdAt: 9_000,
      }],
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

    expect(result.pendingCount).toBe(3);
    expect(result.actions.map((action) => action.key)).toEqual([
      'automation-approval:approval-release',
      'user-question:run-1:tool-1',
      'runtime-permission:run-2:permission-1',
    ]);
    expect(result.actions.map(pendingAgentActionKey)).toEqual(result.actions.map((action) => action.key));
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
      automationApprovals: [
        { kind: 'automation-approval', approvalId: '', jobId: 'job', createdAt: 1 },
        { kind: 'automation-approval', approvalId: 'approval', jobId: 'job', runtime: 'pi', createdAt: 1 },
      ],
    }, NOW);

    expect(result).toMatchObject({
      permissions: [], questions: [], automationApprovals: [], actions: [], pendingCount: 0,
    });
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

  it('tolerates a completely missing or malformed payload', () => {
    for (const payload of [undefined, null, 'pending', 42, []]) {
      const result = normalizePendingAgentActions(payload, NOW);
      expect(result).toMatchObject({
        permissions: [], questions: [], automationApprovals: [], actions: [], pendingCount: 0, generatedAt: NOW,
      });
    }
  });
});

describe('isPendingAgentActionEvent', () => {
  function agentRunEvent(type: string, category: string) {
    return {
      type: 'agent-run.event' as const,
      runId: 'run-1',
      chatSessionId: 'chat-1',
      event: { id: 'evt-1', runId: 'run-1', type, category, status: 'running', ts: 1 },
    };
  }

  it('accepts permission and question events and run terminations', () => {
    expect(isPendingAgentActionEvent(agentRunEvent('permission_requested', 'permission'))).toBe(true);
    expect(isPendingAgentActionEvent(agentRunEvent('permission_resolved', 'permission'))).toBe(true);
    expect(isPendingAgentActionEvent(agentRunEvent('user_question_started', 'question'))).toBe(true);
    expect(isPendingAgentActionEvent(agentRunEvent('user_question_resolved', 'question'))).toBe(true);
    expect(isPendingAgentActionEvent(agentRunEvent('run_completed', 'status'))).toBe(true);
    expect(isPendingAgentActionEvent(agentRunEvent('run_failed', 'status'))).toBe(true);
    expect(isPendingAgentActionEvent(agentRunEvent('run_canceled', 'status'))).toBe(true);
  });

  it('rejects tool, text and status-progress events so busy runs do not cause a fetch per tool call', () => {
    expect(isPendingAgentActionEvent(agentRunEvent('tool_started', 'tool'))).toBe(false);
    expect(isPendingAgentActionEvent(agentRunEvent('text', 'text'))).toBe(false);
    expect(isPendingAgentActionEvent(agentRunEvent('run_started', 'status'))).toBe(false);
    expect(isPendingAgentActionEvent(agentRunEvent('run_updated', 'status'))).toBe(false);
  });

  it('rejects other server event types and malformed summaries', () => {
    expect(isPendingAgentActionEvent({ type: 'tree.changed', version: 1 })).toBe(false);
    expect(isPendingAgentActionEvent({ type: 'mcp.changed' })).toBe(false);
    expect(isPendingAgentActionEvent({ type: 'heartbeat' })).toBe(false);
    expect(isPendingAgentActionEvent({
      type: 'agent-run.event',
      runId: 'run-1',
      event: null as unknown as { id: string; runId: string; type: string; category: string; status: string; ts: number },
    })).toBe(false);
  });

  it('accepts the dedicated run.pending-actions.changed trigger from any process', () => {
    expect(isPendingAgentActionEvent({ type: 'run.pending-actions.changed' })).toBe(true);
  });
});
