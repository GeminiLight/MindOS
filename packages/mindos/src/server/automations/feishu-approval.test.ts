import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redactSensitiveText } from '../../agent/redaction.js';
import { requestStudioAutomationPermission, StudioAutomationApprovalRequiredError } from './approvals.js';
import { notifyStudioAutomationApprovalViaFeishu } from './feishu-approval.js';
import { mutateStudioAutomationState, readStudioAutomationState } from './store.js';
import type { StudioAutomationJob } from './types.js';

describe('Feishu automation approval delivery', () => {
  let root: string;
  let mindRoot: string;
  let configPath: string;
  let approvalId: string;
  const now = new Date('2026-09-03T09:00:00.000Z');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-feishu-approval-'));
    mindRoot = join(root, 'mind');
    configPath = join(root, '.mindos', 'im.json');
    mkdirSync(mindRoot, { recursive: true });
    const job: StudioAutomationJob = {
      id: 'automation-release', title: 'Release observer', prompt: 'Review release.',
      scope: 'worktree', schedule: 'manual', timezone: 'Asia/Shanghai', model: 'codex',
      runtime: 'codex', effort: 'high', permissionMode: 'ask', status: 'active',
      createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [],
      lease: {
        runId: 'automation-run-1', ownerId: 'worker-1', occurrenceAt: now.toISOString(),
        claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), attempt: 1,
      },
    };
    mutateStudioAutomationState(mindRoot, (state) => { state.automations = [job]; });
    try {
      requestStudioAutomationPermission(mindRoot, job, {
        runtime: 'codex', toolCallId: 'tool-1', toolName: 'apply_patch',
        action: 'edit release notes', resource: 'wiki/90-changelog.md',
        input: { token: 'secret-token', path: 'wiki/90-changelog.md' },
        risk: { level: 'medium', summary: 'Updates release notes.' },
        options: [
          { id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' },
          { id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' },
        ],
      }, now);
      throw new Error('Expected approval request.');
    } catch (error) {
      expect(error).toBeInstanceOf(StudioAutomationApprovalRequiredError);
      approvalId = (error as StudioAutomationApprovalRequiredError).approvalId;
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sends a bounded approval prompt to the connected Feishu owner and records delivery', async () => {
    writeConfig(configPath, {
      providers: { feishu: {
        app_id: 'cli_test_app', app_secret: 'app-secret',
        oauth: { status: 'connected', user: { open_id: 'ou_owner' } },
      } },
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, tenant_access_token: 'tenant-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { message_id: 'om_approval_1' } }));

    await expect(notifyStudioAutomationApprovalViaFeishu({
      mindRoot, approvalId, configPath, fetch, now: () => now,
    })).resolves.toMatchObject({ status: 'sent', messageId: 'om_approval_1' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const sendBody = JSON.parse(String(fetch.mock.calls[1]![1]?.body));
    const content = JSON.parse(sendBody.content);
    expect(sendBody).toMatchObject({ receive_id: 'ou_owner', msg_type: 'text' });
    expect(content.text).toContain(`批准 ${approvalId}`);
    expect(content.text).toContain(`拒绝 ${approvalId}`);
    expect(content.text).not.toContain('secret-token');
    expect(readStudioAutomationState(mindRoot).approvals[0]).toMatchObject({
      delivery: { channel: 'feishu', status: 'sent', messageId: 'om_approval_1' },
    });
  });

  it('skips delivery when no OAuth owner is connected', async () => {
    writeConfig(configPath, { providers: { feishu: { app_id: 'app', app_secret: 'secret' } } });
    const fetch = vi.fn();
    await expect(notifyStudioAutomationApprovalViaFeishu({ mindRoot, approvalId, configPath, fetch }))
      .resolves.toEqual({ status: 'skipped', reason: 'Feishu OAuth owner is not connected.' });
    expect(fetch).not.toHaveBeenCalled();
    expect(readStudioAutomationState(mindRoot).approvals[0]).not.toHaveProperty('delivery');
  });

  it('keeps approval pending and persists a redacted delivery error', async () => {
    writeConfig(configPath, {
      providers: { feishu: {
        app_id: 'app', app_secret: 'app-secret',
        oauth: { status: 'connected', user: { open_id: 'ou_owner' } },
      } },
    });
    const fetch = vi.fn().mockRejectedValue(new Error('Authorization: Bearer sk-secret-value-123456789'));
    const result = await notifyStudioAutomationApprovalViaFeishu({ mindRoot, approvalId, configPath, fetch, now: () => now });
    expect(result).toMatchObject({ status: 'failed' });
    expect(result).not.toEqual(expect.objectContaining({ error: expect.stringContaining('sk-secret') }));
    expect(readStudioAutomationState(mindRoot).approvals[0]).toMatchObject({
      status: 'pending',
      delivery: { channel: 'feishu', status: 'failed', error: redactSensitiveText('Authorization: Bearer sk-secret-value-123456789') },
    });
  });
});

function writeConfig(configPath: string, value: unknown) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(value)}\n`, 'utf8');
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
