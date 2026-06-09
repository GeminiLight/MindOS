import { describe, it, expect } from 'vitest';
import type { AgentIdentity, ChatSession, Message } from '@/lib/types';
import {
  MINDOS_AGENT,
  annotateMessageWithAgent,
  annotateMessageWithAgentRuntime,
  bindSessionAgent,
  bindSessionAgentRuntime,
  filterSessionsByRuntimeLane,
  getMatchingRuntimeSessionBinding,
  getMessageAgentRuntime,
  getSelectedAcpAgentFromMessage,
  getSessionAgentRuntime,
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

  it('annotates a native runtime message with its runtime kind', () => {
    const message: Message = {
      role: 'assistant',
      content: 'Here is the answer.',
    };

    expect(annotateMessageWithAgentRuntime(message, {
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
    })).toEqual({
      ...message,
      agentId: 'codex',
      agentName: 'Codex',
      agentKind: 'codex',
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

  it('does not restore a native runtime as a legacy ACP selection', () => {
    expect(getSelectedAcpAgentFromMessage({
      agentId: 'codex',
      agentName: 'Codex',
      agentKind: 'codex',
    })).toBeNull();
  });

  it('restores native and legacy runtime selections from message attribution', () => {
    expect(getMessageAgentRuntime({
      agentId: 'codex',
      agentName: 'Codex',
      agentKind: 'codex',
    })).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
    });

    expect(getMessageAgentRuntime({
      agentId: 'claude-code',
      agentName: 'Claude Code',
    })).toEqual({
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'acp',
    });
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
      defaultAgentRuntime: { id: 'claude-code', name: 'Claude Code', kind: 'acp' },
      externalAgentBinding: null,
      runtimeSessionBinding: null,
    });
  });

  it('clears the bound session agent when the user switches back to MindOS', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAcpAgent: claude,
      externalAgentBinding: {
        runtime: 'codex',
        externalSessionId: 'thr_old',
        status: 'active',
        updatedAt: 1,
      },
    };

    expect(bindSessionAgent(session, null)).toEqual({
      ...session,
      defaultAcpAgent: null,
      defaultAgentRuntime: null,
      externalAgentBinding: null,
      runtimeSessionBinding: null,
    });
  });

  it('normalizes a legacy ACP session binding into a runtime identity', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAcpAgent: claude,
    };

    expect(getSessionAgentRuntime(session)).toEqual({
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'acp',
    });
  });

  it('prefers the new runtime binding over the legacy ACP binding', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAcpAgent: claude,
      defaultAgentRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    };

    expect(getSessionAgentRuntime(session)).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
    });
  });

  it('binds a native runtime and stores its external session metadata', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAcpAgent: claude,
    };

    expect(bindSessionAgentRuntime(session, {
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
    }, {
      externalSessionId: 'thr_123',
      cwd: '/tmp/mind',
      updatedAt: 123,
    })).toEqual({
      ...session,
      defaultAcpAgent: null,
      defaultAgentRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      externalAgentBinding: {
        runtime: 'codex',
        externalSessionId: 'thr_123',
        cwd: '/tmp/mind',
        status: 'active',
        updatedAt: 123,
      },
      runtimeSessionBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr_123',
        cwd: '/tmp/mind',
        status: 'active',
        updatedAt: 123,
      },
    });
  });

  it('filters Chat Panel sessions into MindOS and native runtime lanes', () => {
    const mindosSession: ChatSession = {
      id: 'mindos-session',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'mindos' }],
    };
    const acpSession: ChatSession = {
      id: 'acp-session',
      createdAt: 2,
      updatedAt: 2,
      messages: [{ role: 'user', content: 'acp' }],
      defaultAgentRuntime: { id: 'local-agent', name: 'Local ACP Agent', kind: 'acp' },
    };
    const codexSession: ChatSession = {
      id: 'codex-session',
      createdAt: 3,
      updatedAt: 3,
      messages: [{ role: 'user', content: 'codex' }],
      defaultAgentRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    };
    const claudeSession: ChatSession = {
      id: 'claude-session',
      createdAt: 4,
      updatedAt: 4,
      messages: [{ role: 'user', content: 'claude' }],
      defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
    };
    const sessions = [mindosSession, acpSession, codexSession, claudeSession];

    expect(filterSessionsByRuntimeLane(sessions, null).map((session) => session.id)).toEqual([
      'mindos-session',
      'acp-session',
    ]);
    expect(filterSessionsByRuntimeLane(sessions, { id: 'codex', name: 'Codex', kind: 'codex' }).map((session) => session.id)).toEqual([
      'codex-session',
    ]);
    expect(filterSessionsByRuntimeLane(sessions, { id: 'claude', name: 'Claude Code', kind: 'claude' }).map((session) => session.id)).toEqual([
      'claude-session',
    ]);
  });

  it('unlinks local external session metadata while keeping the selected native runtime lane', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'continue' }],
      defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      externalAgentBinding: {
        runtime: 'claude',
        externalSessionId: 'session_123',
        cwd: '/tmp/mind',
        status: 'active',
        updatedAt: 123,
      },
      runtimeSessionBinding: {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        externalSessionId: 'session_123',
        cwd: '/tmp/mind',
        status: 'active',
        updatedAt: 123,
      },
    };

    expect(bindSessionAgentRuntime(session, {
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
    }, {
      updatedAt: 456,
    })).toEqual({
      ...session,
      defaultAcpAgent: null,
      defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      externalAgentBinding: {
        runtime: 'claude',
        status: 'active',
        updatedAt: 456,
      },
      runtimeSessionBinding: {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        status: 'active',
        updatedAt: 456,
      },
    });
  });

  it('returns only the binding that matches the active native runtime identity', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      runtimeSessionBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex-main',
        externalSessionId: 'thr_123',
        status: 'active',
        updatedAt: 123,
      },
    };

    expect(getMatchingRuntimeSessionBinding(session, {
      id: 'codex-main',
      name: 'Codex',
      kind: 'codex',
    })).toEqual(session.runtimeSessionBinding);

    expect(getMatchingRuntimeSessionBinding(session, {
      id: 'codex-other',
      name: 'Codex Other',
      kind: 'codex',
    })).toBeNull();
  });

  it('normalizes matching legacy native session metadata for display and resume', () => {
    const session: ChatSession = {
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      externalAgentBinding: {
        runtime: 'claude',
        externalSessionId: 'claude-session-1',
        cwd: '/tmp/mind',
        status: 'active',
        updatedAt: 456,
      },
    };

    expect(getMatchingRuntimeSessionBinding(session, {
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
    })).toEqual({
      kind: 'claude-session',
      runtime: 'claude',
      runtimeId: 'claude',
      externalSessionId: 'claude-session-1',
      cwd: '/tmp/mind',
      status: 'active',
      updatedAt: 456,
    });
  });
});
