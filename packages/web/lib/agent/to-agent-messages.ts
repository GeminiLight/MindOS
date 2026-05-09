import type { Message as FrontendMessage } from '@/lib/types';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { toMindosAgentMessages } from '@geminilight/mindos/session';

export type { AgentMessage } from '@mariozechner/pi-agent-core';

export function toAgentMessages(messages: FrontendMessage[]): AgentMessage[] {
  return toMindosAgentMessages(messages) as unknown as AgentMessage[];
}
