import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactSensitiveText } from '../../agent/redaction.js';
import { mutateStudioAutomationState, readStudioAutomationState } from './store.js';
import type { StudioAutomationApproval } from './types.js';

const FEISHU_TENANT_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_SEND_MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';

export type FeishuApprovalDeliveryResult =
  | { status: 'sent'; messageId?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export type FeishuApprovalDeliveryOptions = {
  mindRoot: string;
  approvalId: string;
  configPath?: string;
  fetch?: typeof globalThis.fetch;
  now?(): Date;
};

export async function notifyStudioAutomationApprovalViaFeishu(
  options: FeishuApprovalDeliveryOptions,
): Promise<FeishuApprovalDeliveryResult> {
  const state = readStudioAutomationState(options.mindRoot);
  const approval = state.approvals.find((item) => item.id === options.approvalId);
  if (!approval || approval.status !== 'pending') {
    return { status: 'skipped', reason: 'Automation approval is no longer pending.' };
  }
  const job = state.automations.find((item) => item.id === approval.jobId);
  const feishu = readFeishuConfig(options.configPath);
  if (!feishu) return { status: 'skipped', reason: 'Feishu is not configured.' };
  if (!feishu.openId) return { status: 'skipped', reason: 'Feishu OAuth owner is not connected.' };

  const fetch = options.fetch ?? globalThis.fetch;
  const attemptedAt = (options.now?.() ?? new Date()).toISOString();
  try {
    const tokenResponse = await fetch(FEISHU_TENANT_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: feishu.appId, app_secret: feishu.appSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenBody = await readJson(tokenResponse);
    const tenantToken = stringValue(tokenBody, 'tenant_access_token');
    if (!tokenResponse.ok || numberValue(tokenBody, 'code') !== 0 || !tenantToken) {
      throw new Error(apiError('Feishu tenant token request failed', tokenResponse.status, tokenBody));
    }
    const sendResponse = await fetch(FEISHU_SEND_MESSAGE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tenantToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        receive_id: feishu.openId,
        msg_type: 'text',
        content: JSON.stringify({ text: approvalMessage(approval, job?.title ?? 'Automation') }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const sendBody = await readJson(sendResponse);
    if (!sendResponse.ok || numberValue(sendBody, 'code') !== 0) {
      throw new Error(apiError('Feishu approval message failed', sendResponse.status, sendBody));
    }
    const data = recordValue(sendBody, 'data');
    const messageId = data ? stringValue(data, 'message_id') : undefined;
    persistDelivery(options.mindRoot, approval.id, {
      channel: 'feishu', status: 'sent', attemptedAt, ...(messageId ? { messageId } : {}),
    });
    return { status: 'sent', ...(messageId ? { messageId } : {}) };
  } catch (error) {
    const safeError = redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 500);
    persistDelivery(options.mindRoot, approval.id, {
      channel: 'feishu', status: 'failed', attemptedAt, error: safeError,
    });
    return { status: 'failed', error: safeError };
  }
}

function readFeishuConfig(configPath?: string): { appId: string; appSecret: string; openId?: string } | null {
  const target = configPath ?? process.env.MINDOS_IM_CONFIG_PATH ?? join(homedir(), '.mindos', 'im.json');
  if (!existsSync(target)) return null;
  try {
    const root = JSON.parse(readFileSync(target, 'utf8')) as unknown;
    const providers = isRecord(root) ? recordValue(root, 'providers') : undefined;
    const feishu = providers ? recordValue(providers, 'feishu') : undefined;
    const appId = feishu ? stringValue(feishu, 'app_id') : undefined;
    const appSecret = feishu ? stringValue(feishu, 'app_secret') : undefined;
    if (!appId || !appSecret) return null;
    const oauth = feishu ? recordValue(feishu, 'oauth') : undefined;
    const user = oauth?.status === 'connected' ? recordValue(oauth, 'user') : undefined;
    const openId = user ? stringValue(user, 'open_id') : undefined;
    return { appId, appSecret, ...(openId ? { openId } : {}) };
  } catch {
    return null;
  }
}

function approvalMessage(approval: StudioAutomationApproval, jobTitle: string): string {
  return [
    `MindOS Automation「${jobTitle}」等待审批`,
    `${approval.runtime.toUpperCase()} · ${approval.toolName}`,
    approval.action ? `动作：${approval.action}` : undefined,
    approval.resource ? `目标：${approval.resource}` : undefined,
    approval.risk ? `风险：${approval.risk.level} · ${approval.risk.summary}` : undefined,
    approval.runId ? `Run：${approval.runId}` : undefined,
    '',
    `批准 ${approval.id}`,
    `拒绝 ${approval.id}`,
    '请完整回复其中一条命令；决定仅对本轮生效。',
  ].filter((line): line is string => line !== undefined).join('\n').slice(0, 2_000);
}

function persistDelivery(mindRoot: string, approvalId: string, delivery: NonNullable<StudioAutomationApproval['delivery']>) {
  mutateStudioAutomationState(mindRoot, (state) => {
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval) return;
    approval.delivery = delivery;
    state.updatedAt = delivery.attemptedAt;
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return isRecord(value) ? value : {};
}

function apiError(prefix: string, status: number, body: Record<string, unknown>): string {
  const message = stringValue(body, 'msg') ?? stringValue(body, 'message');
  return `${prefix} (${status})${message ? `: ${message}` : ''}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return isRecord(record[key]) ? record[key] : undefined;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === 'number' ? record[key] : undefined;
}
