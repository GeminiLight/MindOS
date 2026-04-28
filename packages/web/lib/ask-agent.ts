import type { AgentIdentity, ChatSession, Message } from '@/lib/types';

export const MINDOS_AGENT: AgentIdentity = {
  id: 'mindos',
  name: 'MindOS',
};

export function resolveMessageAgent(agent: AgentIdentity | null | undefined): AgentIdentity {
  return agent ?? MINDOS_AGENT;
}

export function annotateMessageWithAgent(message: Message, agent: AgentIdentity | null | undefined): Message {
  const resolved = resolveMessageAgent(agent);
  return {
    ...message,
    agentId: resolved.id,
    agentName: resolved.name,
  };
}

export function resolveComposerAgent({
  sessionAgent,
  initialAgent,
}: {
  sessionAgent?: AgentIdentity | null;
  initialAgent?: AgentIdentity | null;
}): AgentIdentity | null {
  return sessionAgent ?? initialAgent ?? null;
}

export function getSelectedAcpAgentFromMessage(message: Pick<Message, 'agentId' | 'agentName'>): AgentIdentity | null {
  if (!message.agentId || !message.agentName || message.agentId === MINDOS_AGENT.id) {
    return null;
  }
  return {
    id: message.agentId,
    name: message.agentName,
  };
}

export function bindSessionAgent(session: ChatSession, agent: AgentIdentity | null): ChatSession {
  return {
    ...session,
    defaultAcpAgent: agent,
  };
}
