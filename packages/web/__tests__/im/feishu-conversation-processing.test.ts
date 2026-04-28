import { beforeEach, describe, expect, it, vi } from 'vitest';

const runHeadlessAgent = vi.fn();
const getConversationHistory = vi.fn();
const appendConversationTurn = vi.fn();
const recordActivity = vi.fn();
const sendIMMessage = vi.fn();

vi.mock('@/lib/agent/headless', () => ({
  runHeadlessAgent,
}));

vi.mock('@/lib/im/conversation-store', () => ({
  getConversationHistory,
  appendConversationTurn,
}));

vi.mock('@/lib/im/activity', () => ({
  recordActivity,
}));

vi.mock('@/lib/im/executor', () => ({
  sendIMMessage,
}));

async function importModule() {
  return await import('@/lib/im/webhook/feishu');
}

describe('Feishu conversation processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getConversationHistory.mockReturnValue({
      sessionId: 'feishu-oc_chat_001-1',
      messages: [{ role: 'assistant', content: 'Previous reply', timestamp: 1 }],
    });
    sendIMMessage.mockResolvedValue({ ok: true, messageId: 'msg_1', timestamp: '2026-04-10T00:00:00.000Z' });
  });

  it('runs the agent, sends the reply, and appends conversation history', async () => {
    runHeadlessAgent.mockResolvedValue({ text: 'Hello from MindOS', thinking: '', toolCalls: [] });
    const { processFeishuIncomingMessage } = await importModule();

    await processFeishuIncomingMessage({
      platform: 'feishu',
      senderId: 'ou_sender_1',
      chatId: 'oc_chat_001',
      chatType: 'dm',
      text: '你好',
      messageId: 'om_001',
      rawEvent: {},
    });

    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'conversation_inbound',
      recipient: 'ou_sender_1',
      message: '你好',
    }));
    expect(runHeadlessAgent).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: '你好',
      historyMessages: [{ role: 'assistant', content: 'Previous reply', timestamp: 1 }],
      mode: 'agent',
    }));
    expect(sendIMMessage).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'feishu',
      recipientId: 'oc_chat_001',
      text: 'Hello from MindOS',
    }), undefined, { activityType: 'conversation_reply' });
    expect(appendConversationTurn).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'feishu',
      chatId: 'oc_chat_001',
      userMessage: expect.objectContaining({ role: 'user', content: '你好' }),
      assistantMessage: expect.objectContaining({ role: 'assistant', content: 'Hello from MindOS' }),
    }));
  });

  it('falls back when the agent run fails', async () => {
    runHeadlessAgent.mockRejectedValue(new Error('model exploded'));
    const { processFeishuIncomingMessage } = await importModule();

    await processFeishuIncomingMessage({
      platform: 'feishu',
      senderId: 'ou_sender_1',
      chatId: 'oc_chat_001',
      chatType: 'dm',
      text: '你好',
      messageId: 'om_001',
      rawEvent: {},
    });

    expect(sendIMMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'I received your message, but I could not generate a reply just now. Please try again from MindOS or send another message.',
    }), undefined, { activityType: 'conversation_reply' });
  });
});
