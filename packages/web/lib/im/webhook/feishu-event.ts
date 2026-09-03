import type {
  FeishuSdkMessageEvent,
  FeishuWebhookEventEnvelope,
  IncomingIMMessage,
} from '@/lib/im/types';
import type { LarkCliMessageEvent } from '@/lib/im/lark-cli-event-client';
import { emitStudioAutomationEvent, recordStudioAutomationEventSourceFailure } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';

const FEISHU_MESSAGE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const seenFeishuMessages = new Map<string, number>();

function buildMessageDedupeKey(incoming: IncomingIMMessage): string {
  return `${incoming.chatId}:${incoming.messageId}`;
}

function pruneExpiredMessageKeys(now: number): void {
  for (const [key, expiresAt] of seenFeishuMessages.entries()) {
    if (expiresAt <= now) {
      seenFeishuMessages.delete(key);
    }
  }
}

function markMessageForProcessing(incoming: IncomingIMMessage, now = Date.now()): boolean {
  pruneExpiredMessageKeys(now);
  const key = buildMessageDedupeKey(incoming);
  if (seenFeishuMessages.has(key)) {
    return false;
  }
  seenFeishuMessages.set(key, now + FEISHU_MESSAGE_DEDUPE_TTL_MS);
  return true;
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
  emitIncomingAutomationEvent(incoming);
  return queueIncomingFeishuMessage(incoming, decision.reason);
}

export async function handleLarkCliMessageReceiveEvent(event: LarkCliMessageEvent): Promise<Record<string, unknown>> {
  const messageId = event.message_id ?? event.id;
  if (
    event.type !== 'im.message.receive_v1'
    || !event.chat_id
    || !messageId
    || !event.sender_id
    || (event.chat_type !== 'p2p' && event.chat_type !== 'group')
  ) {
    return { ok: true, ignored: true, reason: 'invalid_event_payload' };
  }
  if (event.sender_type === 'bot') return { ok: true, ignored: true, reason: 'bot_sender' };
  const mentionsBot = Array.isArray(event.mentions) && event.mentions.length > 0;
  if (event.chat_type === 'group' && !mentionsBot) {
    return { ok: true, ignored: true, reason: 'group_without_mention' };
  }
  const incoming: IncomingIMMessage = {
    platform: 'feishu',
    senderId: event.sender_id,
    senderName: undefined,
    chatId: event.chat_id,
    chatType: event.chat_type === 'group' ? 'group' : 'dm',
    text: event.content?.trim() ?? '',
    messageId,
    threadId: event.thread_id ?? event.root_id ?? event.reply_to,
    mentionsBot,
    rawEvent: event,
  };
  emitIncomingAutomationEvent(incoming);
  return queueIncomingFeishuMessage(incoming, event.chat_type === 'p2p' ? 'direct_message' : 'group_with_mention');
}

function emitIncomingAutomationEvent(incoming: IncomingIMMessage): void {
  try {
    emitStudioAutomationEvent(getMindRoot(), {
      source: 'feishu',
      key: incoming.messageId,
      type: 'im.message.receive_v1',
      payload: {
        chatId: incoming.chatId,
        chatType: incoming.chatType,
        senderId: incoming.senderId,
        messageId: incoming.messageId,
        threadId: incoming.threadId,
        mentionsBot: Boolean(incoming.mentionsBot),
        text: incoming.text,
      },
    });
  } catch (error) {
    recordStudioAutomationEventSourceFailure(getMindRoot(), {
      source: 'feishu', key: incoming.messageId, error,
    });
    console.error('[feishu/event] Failed to persist automation event:', error instanceof Error ? error.message : String(error));
  }
}

function queueIncomingFeishuMessage(
  incoming: IncomingIMMessage,
  reason: string,
): Record<string, unknown> {
  if (!incoming.text.trim()) {
    return { ok: true, ignored: true, reason: 'empty_text' };
  }
  if (!markMessageForProcessing(incoming)) {
    return {
      ok: true,
      ignored: true,
      reason: 'duplicate_message',
      chatId: incoming.chatId,
      messageId: incoming.messageId,
    };
  }

  void import('./feishu-conversation')
    .then(({ processFeishuIncomingMessage }) => processFeishuIncomingMessage(incoming))
    .catch((error) => {
      console.error('[feishu/webhook] Async processing failed:', error);
    });

  return {
    ok: true,
    queued: true,
    reason,
    incoming,
  };
}

export function __resetFeishuMessageDedupeForTests(): void {
  seenFeishuMessages.clear();
}
