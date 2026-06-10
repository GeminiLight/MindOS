import type { Message as FrontendMessage } from '@/lib/types';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  toMindosAgentMessages,
  type MindosUiAskMessage,
  type MindosUiMessagePart,
} from '@geminilight/mindos/session';

export type { AgentMessage } from '@earendil-works/pi-agent-core';

export function toMindosUiAskMessages(messages: FrontendMessage[]): MindosUiAskMessage[] {
  return messages.map((message) => {
    const parts = message.parts
      ?.map(toMindosUiMessagePart)
      .filter((part): part is MindosUiMessagePart => part !== null);
    return {
      role: message.role,
      content: message.content,
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
      ...(message.skillName ? { skillName: message.skillName } : {}),
      ...(parts && parts.length > 0 ? { parts } : {}),
      ...(message.images && message.images.length > 0 ? { images: message.images } : {}),
    };
  });
}

function toMindosUiMessagePart(part: NonNullable<FrontendMessage['parts']>[number]): MindosUiMessagePart | null {
  if (part.type === 'agent-run-timeline') return null;
  return part;
}

export function toAgentMessages(messages: FrontendMessage[]): AgentMessage[] {
  return toMindosAgentMessages(toMindosUiAskMessages(messages)) as unknown as AgentMessage[];
}
