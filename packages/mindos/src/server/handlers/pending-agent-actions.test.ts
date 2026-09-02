import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  handleAutomationApprovalDecisionPost,
  handlePendingAgentActionsGet,
  handleRuntimePermissionDecisionPost,
  handleUserQuestionDecisionPost,
} from './pending-agent-actions.js';
import { requestStudioAutomationPermission } from '../automations/approvals.js';
import { mutateStudioAutomationState, readStudioAutomationState } from '../automations/store.js';
import type { StudioAutomationJob } from '../automations/types.js';

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

  it('lists and resolves durable automation approvals through the shared action surface', () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-pending-automation-'));
    try {
      const now = new Date('2026-09-03T08:00:00.000Z');
      const job: StudioAutomationJob = {
        id: 'automation-release',
        title: 'Release observer',
        prompt: 'Verify release readiness.',
        scope: 'worktree',
        schedule: 'manual',
        timezone: 'Asia/Shanghai',
        model: 'codex',
        runtime: 'codex',
        effort: 'high',
        permissionMode: 'ask',
        status: 'active',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        history: [],
        lease: {
          runId: 'automation-run-1',
          ownerId: 'worker-1',
          occurrenceAt: now.toISOString(),
          claimedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          attempt: 1,
        },
      };
      mutateStudioAutomationState(mindRoot, (state) => {
        state.automations = [job];
      });
      expect(() => requestStudioAutomationPermission(mindRoot, job, {
        runtime: 'codex',
        toolCallId: 'tool-automation-1',
        toolName: 'apply_patch',
        action: 'edit release notes',
        resource: 'wiki/90-changelog.md',
        input: { token: 'secret-token', path: 'wiki/90-changelog.md' },
        risk: { level: 'medium', summary: 'Updates the release notes.' },
        options: [
          { id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' },
          { id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' },
        ],
      }, now)).toThrow(/waiting for approval/i);

      const listed = handlePendingAgentActionsGet({ mindRoot });
      expect(listed.body).toMatchObject({
        pendingCount: 1,
        automationApprovals: [expect.objectContaining({
          kind: 'automation-approval',
          jobId: job.id,
          runId: 'automation-run-1',
          jobTitle: job.title,
          toolName: 'apply_patch',
          resource: 'wiki/90-changelog.md',
          inputPreview: expect.not.stringContaining('secret-token'),
        })],
      });

      const approvalId = readStudioAutomationState(mindRoot).approvals[0]!.id;
      expect(handleAutomationApprovalDecisionPost({ approvalId, decision: 'allow' }, { mindRoot }))
        .toMatchObject({ status: 200, body: { ok: true, result: 'resolved', jobTitle: job.title } });
      expect(readStudioAutomationState(mindRoot).approvals[0]).toMatchObject({
        status: 'approved',
        decision: 'allow',
      });
      expect(handleAutomationApprovalDecisionPost({ approvalId, decision: 'deny' }, { mindRoot }))
        .toMatchObject({ status: 409 });

      expect(() => requestStudioAutomationPermission(mindRoot, job, {
        runtime: 'codex',
        toolCallId: 'tool-without-input',
        toolName: 'read_file',
        action: 'inspect release notes',
        resource: 'wiki/90-changelog.md',
        options: [
          { id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' },
          { id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' },
        ],
      }, now)).toThrow(/waiting for approval/i);

      const approvalWithoutInput = handlePendingAgentActionsGet({ mindRoot }).body.automationApprovals[0];
      expect(approvalWithoutInput).not.toHaveProperty('inputPreview');
    } finally {
      rmSync(mindRoot, { recursive: true, force: true });
    }
  });
});
