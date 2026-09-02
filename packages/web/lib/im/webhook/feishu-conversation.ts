import { runHeadlessAgent } from '@/lib/agent/headless';
import { appendConversationTurn, getConversationHistory } from '@/lib/im/conversation-store';
import { recordActivity } from '@/lib/im/activity';
import { sendIMMessage } from '@/lib/im/executor';
import type { Message } from '@/lib/types';
import type { IncomingIMMessage } from '@/lib/im/types';
import { tryResolveFeishuAutomationApproval } from './feishu-automation-approval';

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

  const approval = await tryResolveFeishuAutomationApproval(incoming);
  if (approval.handled) {
    await sendReplyAndRemember(incoming, approval.reply);
    return;
  }

  const { messages: historyMessages } = getConversationHistory('feishu', incoming.chatId);
  let replyText = '';

  try {
    const result = await runHeadlessAgent({
      userMessage: incoming.text,
      historyMessages,
      entrypoint: 'im',
      maxSteps: 8,
    });
    replyText = result.text.trim() || buildFallbackReply();
  } catch (error) {
    console.error('[feishu/webhook] Agent run failed:', error);
    replyText = buildFallbackReply();
  }

  await sendReplyAndRemember(incoming, replyText);
}

async function sendReplyAndRemember(incoming: IncomingIMMessage, replyText: string): Promise<void> {
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
