import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeishuConfig, FeishuSdkMessageEvent, FeishuWebhookEventEnvelope } from '@/lib/im/types';

vi.mock('@/lib/im/executor', () => ({
  sendIMMessage: vi.fn().mockResolvedValue({ ok: true, messageId: 'msg_1', timestamp: '2026-04-10T00:00:00.000Z' }),
}));

vi.mock('@/lib/agent/headless', () => ({
  runHeadlessAgent: vi.fn().mockResolvedValue({ text: 'Hello from MindOS', thinking: '', toolCalls: [] }),
}));

vi.mock('@/lib/im/conversation-store', () => ({
  appendConversationTurn: vi.fn(),
  getConversationHistory: vi.fn(() => ({ sessionId: 'session', messages: [] })),
}));

vi.mock('@/lib/im/activity', () => ({
  recordActivity: vi.fn(),
}));

async function importModule() {
  return await import('@/lib/im/webhook/feishu');
}

describe('Feishu webhook helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('builds pending status when conversation is enabled but public url is missing', async () => {
    const { buildFeishuWebhookStatus } = await importModule();
    const config: FeishuConfig = {
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: {
        enabled: true,
        encrypt_key: 'encrypt',
      },
    };

    expect(buildFeishuWebhookStatus(config)).toEqual({
      platform: 'feishu',
      state: 'pending',
      transport: 'webhook',
      publicBaseUrl: undefined,
      webhookUrl: undefined,
      lastError: 'Public base URL is required for Feishu event callbacks.',
    });
  });

  it('builds ready status when conversation is enabled and callback URL is available', async () => {
    const { buildFeishuWebhookStatus } = await importModule();
    const config: FeishuConfig = {
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: {
        enabled: true,
        encrypt_key: 'encrypt',
        public_base_url: 'https://mindos.example.com',
      },
    };

    expect(buildFeishuWebhookStatus(config)).toEqual({
      platform: 'feishu',
      state: 'ready',
      transport: 'webhook',
      publicBaseUrl: 'https://mindos.example.com',
      webhookUrl: 'https://mindos.example.com/api/im/webhook/feishu',
      lastError: undefined,
    });
  });

  it('normalizes a dm text message into the shared incoming message shape', async () => {
    const { normalizeFeishuIncomingMessage } = await importModule();
    const payload: FeishuWebhookEventEnvelope = {
      header: {
        event_type: 'im.message.receive_v1',
      },
      event: {
        sender: {
          sender_id: { open_id: 'ou_sender_123' },
        },
        message: {
          message_id: 'om_message_001',
          chat_id: 'oc_chat_001',
          chat_type: 'p2p',
          content: JSON.stringify({ text: '你好，MindOS' }),
        },
      },
    };

    expect(normalizeFeishuIncomingMessage(payload)).toEqual({
      platform: 'feishu',
      senderId: 'ou_sender_123',
      senderName: undefined,
      chatId: 'oc_chat_001',
      chatType: 'dm',
      text: '你好，MindOS',
      messageId: 'om_message_001',
      threadId: undefined,
      mentionsBot: false,
      rawEvent: payload,
    });
  });

  it('processes direct messages even without mentions', async () => {
    const { shouldProcessFeishuEvent } = await importModule();
    const payload: FeishuWebhookEventEnvelope = {
      event: {
        message: {
          chat_type: 'p2p',
          content: JSON.stringify({ text: 'hello' }),
        },
      },
    };

    expect(shouldProcessFeishuEvent(payload)).toEqual({ ok: true, reason: 'direct_message' });
  });

  it('ignores group messages without bot mentions', async () => {
    const { shouldProcessFeishuEvent } = await importModule();
    const payload: FeishuWebhookEventEnvelope = {
      event: {
        message: {
          chat_type: 'group',
          content: JSON.stringify({ text: 'hello everyone' }),
          mentions: [],
        },
      },
    };

    expect(shouldProcessFeishuEvent(payload)).toEqual({ ok: false, reason: 'group_without_mention' });
  });

  it('queues processing for direct message sdk events', async () => {
    const { handleFeishuMessageReceiveEvent } = await importModule();
    const payload: FeishuSdkMessageEvent = {
      event_type: 'im.message.receive_v1',
      sender: {
        sender_id: { open_id: 'ou_sender_1' },
      },
      message: {
        message_id: 'om_001',
        chat_id: 'oc_chat_001',
        chat_type: 'p2p',
        content: JSON.stringify({ text: '你好' }),
      },
    };

    const result = await handleFeishuMessageReceiveEvent(payload);

    expect(result).toEqual(expect.objectContaining({ ok: true, queued: true, reason: 'direct_message' }));
  });

  it('ignores sdk events with empty text after normalization', async () => {
    const { handleFeishuMessageReceiveEvent } = await importModule();
    const result = await handleFeishuMessageReceiveEvent({
      event_type: 'im.message.receive_v1',
      sender: {
        sender_id: { open_id: 'ou_sender_1' },
      },
      message: {
        chat_type: 'p2p',
        chat_id: 'oc_chat_001',
        message_id: 'om_001',
        content: JSON.stringify({ text: '   ' }),
      },
    });

    expect(result).toEqual({ ok: true, ignored: true, reason: 'empty_text' });
  });

  it('ignores sdk events missing required message identifiers', async () => {
    const { handleFeishuMessageReceiveEvent } = await importModule();
    const result = await handleFeishuMessageReceiveEvent({
      event_type: 'im.message.receive_v1',
      sender: {
        sender_id: { open_id: 'ou_sender_1' },
      },
      message: {
        chat_type: 'p2p',
        content: JSON.stringify({ text: 'hello' }),
      },
    });

    expect(result).toEqual({ ok: true, ignored: true, reason: 'invalid_event_payload' });
  });
});
