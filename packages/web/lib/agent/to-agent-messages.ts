import type { Message as FrontendMessage } from '@/lib/types';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  toMindosAgentMessages,
  type MindosUiAgentMessage,
  type MindosUiMessagePart,
} from '@geminilight/mindos/agent/turn/ui-messages';

export type { AgentMessage } from '@earendil-works/pi-agent-core';

export function toMindosUiAgentMessages(messages: FrontendMessage[]): MindosUiAgentMessage[] {
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
  return toMindosAgentMessages(toMindosUiAgentMessages(messages)) as unknown as AgentMessage[];
}
