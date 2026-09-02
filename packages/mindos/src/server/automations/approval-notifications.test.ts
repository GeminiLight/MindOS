import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  handleStudioAutomationsGet,
  handleStudioAutomationsPost,
} from '../handlers/studio-automations.js';
import {
  requestStudioAutomationPermission,
  StudioAutomationApprovalRequiredError,
} from './approvals.js';
import { readStudioAutomationState } from './store.js';
import { tickStudioAutomationWorker } from './worker.js';

describe('Studio automation durable approvals and notifications', () => {
  let mindRoot: string;
  const now = new Date('2026-09-03T08:00:00.000Z');

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-approval-'));
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('routes explicit Codex and Claude models without widening Pi permissions', () => {
    const codex = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        title: 'Codex review',
        prompt: 'Review the repository.',
        scope: 'worktree',
        schedule: 'manual',
        model: 'codex',
        effort: 'high',
        permissionMode: 'ask',
      },
    }, { mindRoot, now: () => now });
    expect(codex.status).toBe(201);
    expect(codex.body).toMatchObject({
      automations: [expect.objectContaining({ model: 'codex', runtime: 'codex', permissionMode: 'ask' })],
    });

    const claude = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        title: 'Claude summary',
        prompt: 'Summarize the changes.',
        scope: 'worktree',
        schedule: 'manual',
        model: 'claude-code',
        effort: 'normal',
        permissionMode: 'read',
      },
    }, { mindRoot, now: () => now });
    expect(claude.status).toBe(201);
    expect(claude.body).toMatchObject({
      automations: expect.arrayContaining([expect.objectContaining({ model: 'claude-code', runtime: 'claude' })]),
    });

    const unsafePi = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        title: 'Invalid Pi approval',
        prompt: 'Do work.',
        scope: 'mind',
        schedule: 'manual',
        model: 'mindos-auto',
        effort: 'high',
        permissionMode: 'ask',
      },
    }, { mindRoot, now: () => now });
    expect(unsafePi.status).toBe(400);
    expect(unsafePi.body).toMatchObject({ error: expect.stringMatching(/ask.*Codex|Codex.*ask/i) });
  });

  it('persists an approval request, resumes after allow-once, and consumes the decision', async () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        title: 'Approval review',
        prompt: 'Inspect and edit one file.',
        scope: 'worktree',
        schedule: 'manual',
        model: 'codex',
        effort: 'high',
        permissionMode: 'ask',
        retry: 'never',
      },
    }, { mindRoot, now: () => now });
    const jobId = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id: jobId }, { mindRoot, now: () => now });

    const permissionRequest = {
      runtime: 'codex' as const,
      toolCallId: 'tool-1',
      toolName: 'apply_patch',
      input: { path: 'Notes/计划.md' },
      action: 'edit file',
      resource: 'Notes/计划.md',
      risk: { level: 'medium' as const, summary: 'Changes a knowledge file.' },
      options: [
        { id: 'accept', label: 'Allow once', intent: 'allow' as const, scope: 'once' as const },
        { id: 'decline', label: 'Deny', intent: 'deny' as const, scope: 'once' as const },
      ],
    };
    let executions = 0;
    const executor = async (job: Parameters<typeof requestStudioAutomationPermission>[1]) => {
      executions += 1;
      const decision = requestStudioAutomationPermission(mindRoot, job, permissionRequest, now);
      return { text: `decision:${decision.decision}`, toolCalls: [] };
    };

    const waiting = await tickStudioAutomationWorker({ mindRoot, now: () => now, executor });
    expect(waiting).toMatchObject({ claimed: 1, completed: 1, waitingApproval: 1, failed: 0 });
    expect(executions).toBe(1);
    let state = readStudioAutomationState(mindRoot);
    expect(state.automations[0]).toMatchObject({ lastStatus: 'waiting_approval' });
    expect(state.automations[0]).not.toHaveProperty('nextRunAt');
    expect(state.approvals).toEqual([
      expect.objectContaining({ jobId, status: 'pending', toolName: 'apply_patch', resource: 'Notes/计划.md' }),
    ]);
    expect(state.notifications).toEqual([
      expect.objectContaining({ jobId, kind: 'approval_required' }),
    ]);
    expect(state.notifications[0]).not.toHaveProperty('readAt');

    const approvalId = state.approvals[0]!.id;
    const resolved = handleStudioAutomationsPost({
      action: 'resolve-approval',
      approvalId,
      decision: 'allow',
    }, { mindRoot, now: () => new Date(now.getTime() + 1_000) });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({
      approvals: [expect.objectContaining({ id: approvalId, status: 'approved' })],
      automations: [expect.objectContaining({ id: jobId, nextRun: new Date(now.getTime() + 1_000).toISOString() })],
    });

    const resumedAt = new Date(now.getTime() + 1_001);
    const resumed = await tickStudioAutomationWorker({ mindRoot, now: () => resumedAt, executor });
    expect(resumed).toMatchObject({ succeeded: 1, waitingApproval: 0 });
    state = readStudioAutomationState(mindRoot);
    expect(state.automations[0]).toMatchObject({ lastStatus: 'success' });
    expect(state.approvals[0]).toMatchObject({ status: 'consumed', decision: 'allow' });
    expect(state.automations[0]!.history.map((run) => run.status)).toEqual(['success', 'waiting_approval']);
  });

  it('creates redacted failure notifications and acknowledges one or all', async () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        title: 'Failing job',
        prompt: 'Fail safely.',
        scope: 'mind',
        schedule: 'manual',
        model: 'mindos-auto',
        effort: 'normal',
        permissionMode: 'read',
        retry: 'never',
      },
    }, { mindRoot, now: () => now });
    const jobId = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id: jobId }, { mindRoot, now: () => now });
    await tickStudioAutomationWorker({
      mindRoot,
      now: () => now,
      executor: async () => { throw new Error('Authorization: Bearer sk-secret-value'); },
    });

    const payload = handleStudioAutomationsGet({ mindRoot, now: () => now });
    expect(payload.body).toMatchObject({
      summary: { unreadNotifications: 1 },
      notifications: [expect.objectContaining({ kind: 'failure', jobId })],
    });
    const notification = 'notifications' in payload.body ? payload.body.notifications[0]! : null;
    expect(notification?.body).not.toContain('sk-secret-value');

    const acknowledged = handleStudioAutomationsPost({
      action: 'acknowledge-notification',
      notificationId: notification?.id,
    }, { mindRoot, now: () => new Date(now.getTime() + 2_000) });
    expect(acknowledged.body).toMatchObject({ summary: { unreadNotifications: 0 } });

    const idempotent = handleStudioAutomationsPost({
      action: 'acknowledge-all-notifications',
    }, { mindRoot, now: () => new Date(now.getTime() + 3_000) });
    expect(idempotent.status).toBe(200);
    expect(idempotent.body).toMatchObject({ summary: { unreadNotifications: 0 } });
  });

  it('fails closed when an approval decision is repeated with a conflicting value', async () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        title: 'Conflict review', prompt: 'Review.', scope: 'worktree', schedule: 'manual',
        model: 'codex', effort: 'normal', permissionMode: 'ask', retry: 'never',
      },
    }, { mindRoot, now: () => now });
    const jobId = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id: jobId }, { mindRoot, now: () => now });
    await tickStudioAutomationWorker({
      mindRoot,
      now: () => now,
      executor: async (job) => {
        try {
          requestStudioAutomationPermission(mindRoot, job, {
            runtime: 'codex', toolCallId: 'tool-2', toolName: 'bash', input: { command: 'pwd' },
            options: [{ id: 'allow', label: 'Allow', intent: 'allow' }, { id: 'deny', label: 'Deny', intent: 'deny' }],
          }, now);
        } catch (error) {
          expect(error).toBeInstanceOf(StudioAutomationApprovalRequiredError);
          throw error;
        }
        return { text: 'unexpected' };
      },
    });
    const approvalId = readStudioAutomationState(mindRoot).approvals[0]!.id;
    expect(handleStudioAutomationsPost({ action: 'resolve-approval', approvalId, decision: 'deny' }, { mindRoot, now: () => now }).status).toBe(200);
    expect(handleStudioAutomationsPost({ action: 'resolve-approval', approvalId, decision: 'allow' }, { mindRoot, now: () => now }).status).toBe(409);
  });
});
