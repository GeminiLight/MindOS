import { runHeadlessAgent } from '@/lib/agent/headless';
import { appendConversationTurn, getConversationHistory } from '@/lib/im/conversation-store';
import { recordActivity } from '@/lib/im/activity';
import { sendIMMessage } from '@/lib/im/executor';
import { getFeishuWSClientStatus } from '@/lib/im/feishu-ws-client';
import type { Message } from '@/lib/types';
import type {
  FeishuConfig,
  FeishuSdkMessageEvent,
  FeishuWebhookEventEnvelope,
  IMWebhookStatus,
  IncomingIMMessage,
} from '@/lib/im/types';

function getFeishuTransport(config?: FeishuConfig): 'webhook' | 'long_connection' {
  return config?.conversation?.transport ?? 'webhook';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseTextContent(content?: string): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return typeof parsed.text === 'string' ? parsed.text.trim() : '';
  } catch {
    return '';
  }
}

function hasBotMention(event: FeishuWebhookEventEnvelope): boolean {
  const mentions = event.event?.message?.mentions;
  return Array.isArray(mentions) && mentions.length > 0;
}

export function buildFeishuWebhookStatus(config?: FeishuConfig): IMWebhookStatus {
  const conversation = config?.conversation;
  const transport = getFeishuTransport(config);
  const publicBaseUrl = conversation?.public_base_url?.trim();
  const normalizedBaseUrl = publicBaseUrl ? trimTrailingSlash(publicBaseUrl) : undefined;
  const webhookUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/api/im/webhook/feishu` : undefined;

  if (!conversation?.enabled) {
    return {
      platform: 'feishu',
      state: 'disabled',
      transport,
      publicBaseUrl: normalizedBaseUrl,
      webhookUrl,
    };
  }

  if (transport === 'long_connection') {
    const wsStatus = getFeishuWSClientStatus();
    if (!config?.app_id || !config?.app_secret) {
      return {
        platform: 'feishu',
        state: 'error',
        transport,
        lastError: 'Feishu App ID and App Secret are required for long connection mode.',
      };
    }

    return {
      platform: 'feishu',
      state: wsStatus.running ? 'ready' : 'pending',
      transport,
      lastError: wsStatus.running ? undefined : (wsStatus.lastError ?? 'Start the Feishu long connection client to receive events locally.'),
    };
  }

  if (!conversation.encrypt_key) {
    return {
      platform: 'feishu',
      state: 'error',
      transport,
      publicBaseUrl: normalizedBaseUrl,
      webhookUrl,
      lastError: 'Encrypt Key is required to enable Feishu conversations.',
    };
  }

  if (!normalizedBaseUrl) {
    return {
      platform: 'feishu',
      state: 'pending',
      transport,
      publicBaseUrl: undefined,
      webhookUrl: undefined,
      lastError: 'Public base URL is required for Feishu event callbacks.',
    };
  }

  return {
    platform: 'feishu',
    state: 'ready',
    transport,
    publicBaseUrl: normalizedBaseUrl,
    webhookUrl,
    lastError: undefined,
  };
}

export function shouldProcessFeishuEvent(event: FeishuWebhookEventEnvelope): { ok: boolean; reason: string } {
  const chatType = event.event?.message?.chat_type;
  if (chatType === 'p2p') return { ok: true, reason: 'direct_message' };
  if (chatType === 'group') {
    return hasBotMention(event)
      ? { ok: true, reason: 'group_with_mention' }
      : { ok: false, reason: 'group_without_mention' };
  }
  return { ok: false, reason: 'unsupported_chat_type' };
}

export function normalizeFeishuIncomingMessage(event: FeishuWebhookEventEnvelope): IncomingIMMessage {
  const message = event.event?.message;
  const sender = event.event?.sender;
  return {
    platform: 'feishu',
    senderId: sender?.sender_id?.open_id ?? sender?.sender_id?.union_id ?? sender?.sender_id?.user_id ?? 'unknown',
    senderName: undefined,
    chatId: message?.chat_id ?? 'unknown',
    chatType: message?.chat_type === 'group' ? 'group' : 'dm',
    text: parseTextContent(message?.content),
    messageId: message?.message_id ?? 'unknown',
    threadId: undefined,
    mentionsBot: hasBotMention(event),
    rawEvent: event,
  };
}

function buildFallbackReply(): string {
  return 'I received your message, but I could not generate a reply just now. Please try again from MindOS or send another message.';
}

export async function processFeishuIncomingMessage(incoming: IncomingIMMessage): Promise<void> {
  recordActivity({
    platform: 'feishu',
    type: 'conversation_inbound',
    status: 'success',
    recipient: incoming.senderId,
    message: incoming.text,
  });

  const { messages: historyMessages } = getConversationHistory('feishu', incoming.chatId);
  let replyText = '';

  try {
    const result = await runHeadlessAgent({
      userMessage: incoming.text,
      historyMessages,
      mode: 'agent',
      maxSteps: 8,
    });
    replyText = result.text.trim() || buildFallbackReply();
  } catch (error) {
    console.error('[feishu/webhook] Agent run failed:', error);
    replyText = buildFallbackReply();
  }

  const sendResult = await sendIMMessage({
    platform: 'feishu',
    recipientId: incoming.chatId,
    text: replyText,
    format: 'markdown',
  }, undefined, { activityType: 'conversation_reply' });

  const userMessage: Message = {
    role: 'user',
    content: incoming.text,
    timestamp: Date.now(),
  };
  const assistantMessage: Message = {
    role: 'assistant',
    content: sendResult.ok ? replyText : buildFallbackReply(),
    timestamp: Date.now(),
  };

  appendConversationTurn({
    platform: 'feishu',
    chatId: incoming.chatId,
    userMessage,
    assistantMessage,
  });
}

export async function handleFeishuMessageReceiveEvent(event: FeishuSdkMessageEvent): Promise<Record<string, unknown>> {
  if (!event.message?.chat_id || !event.message?.message_id || !event.sender?.sender_id) {
    return { ok: true, ignored: true, reason: 'invalid_event_payload' };
  }

  const envelope: FeishuWebhookEventEnvelope = {
    header: {
      event_type: event.event_type ?? 'im.message.receive_v1',
    },
    event: {
      message: event.message,
      sender: event.sender,
    },
  };

  const decision = shouldProcessFeishuEvent(envelope);
  if (!decision.ok) {
    return { ok: true, ignored: true, reason: decision.reason };
  }

  const incoming = normalizeFeishuIncomingMessage(envelope);
  if (!incoming.text.trim()) {
    return { ok: true, ignored: true, reason: 'empty_text' };
  }

  void processFeishuIncomingMessage(incoming).catch((error) => {
    console.error('[feishu/webhook] Async processing failed:', error);
  });

  return {
    ok: true,
    queued: true,
    reason: decision.reason,
    incoming,
  };
}
