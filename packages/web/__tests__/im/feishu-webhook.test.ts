import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeishuConfig, FeishuSdkMessageEvent, FeishuWebhookEventEnvelope } from '@/lib/im/types';

const emitStudioAutomationEvent = vi.fn();

vi.mock('@geminilight/mindos/server', () => ({
  emitStudioAutomationEvent,
}));

vi.mock('@/lib/fs', () => ({
  getMindRoot: () => '/mind',
}));

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
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { __resetFeishuMessageDedupeForTests } = await import('@/lib/im/webhook/feishu-event');
    __resetFeishuMessageDedupeForTests();
    emitStudioAutomationEvent.mockReturnValue({ created: true, event: { id: 'event-1' } });
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

  it('accepts a bound lark-cli profile as the long-connection credential', async () => {
    const { buildFeishuWebhookStatus } = await importModule();
    expect(buildFeishuWebhookStatus({
      app_id: 'cli_existing',
      credential_source: 'lark_cli_profile',
      credential_ref: { kind: 'lark-cli-profile', executablePath: '/opt/lark-cli', profile: 'cli_existing' },
      conversation: { enabled: true, transport: 'long_connection' },
    })).toMatchObject({ platform: 'feishu', transport: 'long_connection', state: 'pending' });
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
    expect(emitStudioAutomationEvent).toHaveBeenCalledWith('/mind', expect.objectContaining({
      source: 'feishu',
      key: 'om_001',
      type: 'im.message.receive_v1',
      payload: expect.objectContaining({ chatId: 'oc_chat_001', senderId: 'ou_sender_1', text: '你好' }),
    }));
  });

  it('normalizes and queues an existing lark-cli bot event without requiring inline credentials', async () => {
    const { handleLarkCliMessageReceiveEvent } = await importModule();
    const result = await handleLarkCliMessageReceiveEvent({
      type: 'im.message.receive_v1',
      event_id: 'evt_1',
      message_id: 'om_cli_001',
      chat_id: 'oc_chat_001',
      chat_type: 'p2p',
      sender_id: 'ou_sender_1',
      sender_type: 'user',
      content: '来自现有机器人的消息',
      timestamp: '1788410000000',
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      queued: true,
      reason: 'direct_message',
      incoming: expect.objectContaining({
        senderId: 'ou_sender_1',
        messageId: 'om_cli_001',
        text: '来自现有机器人的消息',
      }),
    }));
  });

  it('ignores duplicate sdk events with the same chat and message id', async () => {
    const { handleFeishuMessageReceiveEvent } = await importModule();
    const payload: FeishuSdkMessageEvent = {
      event_type: 'im.message.receive_v1',
      sender: {
        sender_id: { open_id: 'ou_sender_1' },
      },
      message: {
        message_id: 'om_duplicate_001',
        chat_id: 'oc_chat_001',
        chat_type: 'p2p',
        content: JSON.stringify({ text: '为什么会回复两次' }),
      },
    };

    const first = await handleFeishuMessageReceiveEvent(payload);
    const duplicate = await handleFeishuMessageReceiveEvent(payload);

    expect(first).toEqual(expect.objectContaining({ ok: true, queued: true, reason: 'direct_message' }));
    expect(duplicate).toEqual({
      ok: true,
      ignored: true,
      reason: 'duplicate_message',
      chatId: 'oc_chat_001',
      messageId: 'om_duplicate_001',
    });
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
