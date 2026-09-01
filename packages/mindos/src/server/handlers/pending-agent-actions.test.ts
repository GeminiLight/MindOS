import { describe, expect, it, vi } from 'vitest';
import {
  requestRuntimePermissionForRun,
  runWithRuntimePermissionBridge,
} from '../../agent/bridges/runtime-permission-bridge.js';
import {
  askUserQuestionForRun,
  runWithAskUserQuestionBridge,
} from '../../agent/bridges/user-question-bridge.js';
import {
  handlePendingAgentActionsGet,
  handleRuntimePermissionDecisionPost,
  handleUserQuestionDecisionPost,
} from './pending-agent-actions.js';

describe('pending agent action handlers', () => {
  it('lists and resolves a runtime permission through the shared bridge state', async () => {
    const send = vi.fn();
    const result = runWithRuntimePermissionBridge({ runId: 'run-handler', send }, async () => {
      const pending = requestRuntimePermissionForRun('run-handler', {
        runtime: 'claude',
        toolCallId: 'tool-handler',
        toolName: 'Bash',
        input: { command: 'pnpm test' },
        options: [{ id: 'allow', label: 'Allow once', intent: 'allow', scope: 'once' }],
      }, { requestId: 'permission-handler' });

      expect(handlePendingAgentActionsGet()).toMatchObject({
        status: 200,
        body: {
          permissions: [expect.objectContaining({ requestId: 'permission-handler' })],
          questions: [],
        },
      });
      expect(handleRuntimePermissionDecisionPost({
        runId: 'run-handler',
        requestId: 'permission-handler',
        decision: 'allow',
      })).toEqual({ status: 200, body: { ok: true } });
      return pending;
    });

    await expect(result).resolves.toMatchObject({ decision: 'allow' });
    expect(handlePendingAgentActionsGet().body).toMatchObject({ permissions: [] });
  });

  it('lists and resolves AskUserQuestion through the shared bridge state', async () => {
    const send = vi.fn();
    const question = 'Which release lane?';
    const result = runWithAskUserQuestionBridge({ runId: 'run-question-handler', send }, async () => {
      const pending = askUserQuestionForRun({
        runId: 'run-question-handler',
        toolCallId: 'question-handler',
        params: {
          questions: [{
            question,
            header: 'Release',
            options: [{ label: 'Patch', description: 'Ship a patch.' }],
          }],
        },
      });

      expect(handlePendingAgentActionsGet().body).toMatchObject({
        questions: [expect.objectContaining({ toolCallId: 'question-handler' })],
      });
      expect(handleUserQuestionDecisionPost({
        runId: 'run-question-handler',
        toolCallId: 'question-handler',
        answers: [{ questionIndex: 0, question, kind: 'option', answer: 'Patch' }],
      })).toEqual({ status: 200, body: { ok: true } });
      return pending;
    });

    await expect(result).resolves.toMatchObject({ cancelled: false });
  });

  it('rejects malformed and stale decisions without mutating bridge state', () => {
    expect(handleRuntimePermissionDecisionPost({ decision: 'allow' })).toMatchObject({ status: 400 });
    expect(handleUserQuestionDecisionPost(null)).toMatchObject({ status: 400 });
    expect(handleRuntimePermissionDecisionPost({
      runId: 'missing', requestId: 'missing', decision: 'allow',
    })).toMatchObject({ status: 404 });
    expect(handleUserQuestionDecisionPost({
      runId: 'missing', toolCallId: 'missing', answers: [],
    })).toMatchObject({ status: 404 });
  });
});
