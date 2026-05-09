import { json, type MindosServerResponse } from '../response.js';
import type { ImPlatform } from './im-activity.js';

export type ImTestPayload = {
  platform?: unknown;
  recipient_id?: unknown;
  message?: unknown;
};

export type ImTestSendMessage = {
  platform: ImPlatform;
  recipientId: string;
  text: string;
  format: 'text';
};

export type ImTestSendResult = {
  ok: boolean;
  messageId?: string;
  timestamp: string;
  error?: string;
};

export type ImTestServices = {
  sendIMMessage?(
    message: ImTestSendMessage,
    signal?: AbortSignal,
    options?: { activityType?: 'test' },
  ): Promise<ImTestSendResult>;
};

const VALID_PLATFORMS = new Set<ImPlatform>([
  'telegram',
  'discord',
  'feishu',
  'slack',
  'wecom',
  'dingtalk',
  'wechat',
  'qq',
]);

export async function handleImTestPost(
  body: ImTestPayload | unknown,
  services: ImTestServices = {},
): Promise<MindosServerResponse<{ ok: true; messageId?: string; timestamp: string } | { ok: false; error: string }>> {
  try {
    const payload = body && typeof body === 'object' ? body as ImTestPayload : {};
    const platform = typeof payload.platform === 'string' ? payload.platform.trim() : '';
    const recipientId = typeof payload.recipient_id === 'string' ? payload.recipient_id.trim() : '';
    const message = typeof payload.message === 'string' ? payload.message : '';

    if (!platform || !recipientId || !message) {
      return json({ ok: false, error: 'Missing required fields: platform, recipient_id, message' }, { status: 400 });
    }
    if (!VALID_PLATFORMS.has(platform as ImPlatform)) {
      return json({ ok: false, error: 'Invalid platform' }, { status: 400 });
    }

    const sendIMMessage = services.sendIMMessage ?? defaultSendIMMessage;
    const result = await sendIMMessage({
      platform: platform as ImPlatform,
      recipientId,
      text: message,
      format: 'text',
    }, undefined, { activityType: 'test' });

    if (result.ok) {
      return json({ ok: true, messageId: result.messageId, timestamp: result.timestamp });
    }
    return json({ ok: false, error: result.error ?? 'Failed to send test message' }, { status: 422 });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
  }
}

async function defaultSendIMMessage(): Promise<ImTestSendResult> {
  return {
    ok: false,
    error: 'IM sender is not configured',
    timestamp: new Date().toISOString(),
  };
}
