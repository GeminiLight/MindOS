import { describe, it, expect } from 'vitest';
import type { AgentIdentity, ChatSession, Message } from '@/lib/types';
import {
  MINDOS_AGENT,
  annotateMessageWithAgent,
  bindSessionAgent,
  getSelectedAcpAgentFromMessage,
  resolveComposerAgent,
  resolveMessageAgent,
} from '@/lib/ask-agent';

describe('ask agent helpers', () => {
  const claude: AgentIdentity = { id: 'claude-code', name: 'Claude Code' };

  it('falls back to MindOS for message attribution when no ACP agent is selected', () => {
    expect(resolveMessageAgent(null)).toEqual(MINDOS_AGENT);
    expect(resolveMessageAgent(undefined)).toEqual(MINDOS_AGENT);
  });

  it('uses the selected ACP agent for message attribution', () => {
    expect(resolveMessageAgent(claude)).toEqual(claude);
  });

  it('annotates a message without mutating its content', () => {
    const message: Message = {
      role: 'assistant',
      content: 'Here is the answer.',
    };

    expect(annotateMessageWithAgent(message, claude)).toEqual({
      ...message,
      agentId: 'claude-code',
      agentName: 'Claude Code',
    });
  });

  it('prefers the bound session agent over the initial preselected agent', () => {
    const initial: AgentIdentity = { id: 'cursor', name: 'Cursor' };
    expect(resolveComposerAgent({ sessionAgent: claude, initialAgent: initial })).toEqual(claude);
  });

  it('uses the initial preselected agent when the session has no bound agent yet', () => {
    const initial: AgentIdentity = { id: 'cursor', name: 'Cursor' };
    expect(resolveComposerAgent({ sessionAgent: null, initialAgent: initial })).toEqual(initial);
  });

  it('returns null when neither the session nor the opener provides an ACP agent', () => {
    expect(resolveComposerAgent({ sessionAgent: null, initialAgent: null })).toBeNull();
  });

  it('restores the ACP selection from a message attribution payload', () => {
    expect(getSelectedAcpAgentFromMessage({ agentId: 'claude-code', agentName: 'Claude Code' })).toEqual(claude);
    expect(getSelectedAcpAgentFromMessage({ agentId: 'mindos', agentName: 'MindOS' })).toBeNull();
  });

  it('binds an ACP agent to the active session without touching messages', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'hello' }],
    };

    expect(bindSessionAgent(session, claude)).toEqual({
      ...session,
      defaultAcpAgent: claude,
    });
  });

  it('clears the bound session agent when the user switches back to MindOS', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAcpAgent: claude,
    };

    expect(bindSessionAgent(session, null)).toEqual({
      ...session,
      defaultAcpAgent: null,
    });
  });
});
