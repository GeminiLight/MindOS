import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpRegistryEntry } from '../../../../packages/protocols/acp/src/types';

// Mock SDK connection that records calls
let mockInitialize: ReturnType<typeof vi.fn>;
let mockNewSession: ReturnType<typeof vi.fn>;
let mockAuthenticate: ReturnType<typeof vi.fn>;
let mockPrompt: ReturnType<typeof vi.fn>;
let mockCancel: ReturnType<typeof vi.fn>;
let mockSetSessionMode: ReturnType<typeof vi.fn>;
let mockSetSessionConfigOption: ReturnType<typeof vi.fn>;
let mockUnstableCloseSession: ReturnType<typeof vi.fn>;
let mockLoadSession: ReturnType<typeof vi.fn>;
let mockListSessions: ReturnType<typeof vi.fn>;
let capturedCallbacks: { onSessionUpdate?: (params: unknown) => void } = {};

vi.mock('../../../../packages/protocols/acp/src/registry.js', () => ({
  findAcpAgent: vi.fn(),
}));

vi.mock('../../../../packages/protocols/acp/src/subprocess.js', () => ({
  spawnAndConnect: vi.fn(() => {
    capturedCallbacks = {};
    return {
      connection: {
        initialize: mockInitialize,
        newSession: mockNewSession,
        authenticate: mockAuthenticate,
        prompt: mockPrompt,
        cancel: mockCancel,
        setSessionMode: mockSetSessionMode,
        setSessionConfigOption: mockSetSessionConfigOption,
        unstable_closeSession: mockUnstableCloseSession,
        loadSession: mockLoadSession,
        listSessions: mockListSessions,
        signal: new AbortController().signal,
        closed: new Promise(() => {}),
      },
      callbacks: capturedCallbacks,
      process: { id: 'test-proc', agentId: 'test-agent', proc: { pid: 12345 }, alive: true },
    };
  }),
  killAgent: vi.fn((p: { alive: boolean }) => { p.alive = false; }),
}));

import { createSession, createSessionFromEntry, loadSession, listSessions, prompt, promptStream, cancelPrompt, closeSession, setMode, setConfigOption, getSession, getActiveSessions } from '../../../../packages/protocols/acp/src/session';
import { findAcpAgent } from '../../../../packages/protocols/acp/src/registry.js';

const MOCK_ENTRY: AcpRegistryEntry = {
  id: 'test-agent',
  name: 'Test Agent',
  description: 'A test ACP agent',
  transport: 'stdio',
  command: 'test-agent',
};

describe('ACP Session (SDK-based)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    capturedCallbacks = {};

    mockInitialize = vi.fn().mockResolvedValue({ agentCapabilities: {} });
    mockNewSession = vi.fn().mockResolvedValue({ sessionId: 'agent-ses-1' });
    mockAuthenticate = vi.fn().mockResolvedValue({});
    mockPrompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    mockCancel = vi.fn().mockResolvedValue(undefined);
    mockSetSessionMode = vi.fn().mockResolvedValue({});
    mockSetSessionConfigOption = vi.fn().mockResolvedValue({ configOptions: [] });
    mockUnstableCloseSession = vi.fn().mockResolvedValue({});
    mockLoadSession = vi.fn().mockResolvedValue({ sessionId: 'loaded-ses-1' });
    mockListSessions = vi.fn().mockResolvedValue({ sessions: [] });

    await Promise.allSettled(getActiveSessions().map(s => closeSession(s.id)));
  });

  describe('createSessionFromEntry', () => {
    it('creates a session via SDK initialize + newSession', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);

      expect(session).toBeDefined();
      expect(session.agentId).toBe('test-agent');
      expect(session.state).toBe('idle');
      expect(session.id).toContain('ses-test-agent-');
      expect(mockInitialize).toHaveBeenCalledOnce();
      expect(mockNewSession).toHaveBeenCalledOnce();
    });

    it('extracts agentSessionId from SDK newSession response', async () => {
      mockNewSession.mockResolvedValueOnce({ sessionId: 'agent-assigned-id-123' });

      const session = await createSessionFromEntry(MOCK_ENTRY);

      expect(session.agentSessionId).toBe('agent-assigned-id-123');
      expect(session.id).toContain('ses-test-agent-');
      expect(session.id).not.toBe('agent-assigned-id-123');
    });

    it('parses modes from nested { availableModes: [...] } format', async () => {
      mockNewSession.mockResolvedValueOnce({
        sessionId: 'ses-1',
        modes: {
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'code', name: 'Code Mode', description: 'Optimized for coding' },
          ],
          currentModeId: 'default',
        },
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);

      expect(session.modes).toHaveLength(2);
      expect(session.modes![0]).toEqual({ id: 'default', name: 'Default', description: undefined });
      expect(session.modes![1]).toEqual({ id: 'code', name: 'Code Mode', description: 'Optimized for coding' });
    });

    it('parses modes from flat array format', async () => {
      mockNewSession.mockResolvedValueOnce({
        sessionId: 'ses-1',
        modes: [{ id: 'default', name: 'Default' }],
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      expect(session.modes).toHaveLength(1);
    });

    it('throws and cleans up on initialize failure', async () => {
      mockInitialize.mockRejectedValueOnce(new Error('Init failed'));

      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('initialize failed');
    });

    it('throws on spawn timeout', async () => {
      mockInitialize.mockRejectedValueOnce(new Error('timeout'));

      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('timeout');
    });

    it('authenticates when agent declares auth methods', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: {},
        authMethods: [{ id: 'terminal', name: 'Terminal Login' }],
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      expect(session).toBeDefined();
      expect(mockAuthenticate).toHaveBeenCalledWith({ methodId: 'terminal' });
    });
  });

  describe('prompt', () => {
    it('returns aggregated notification text', async () => {
      mockPrompt.mockImplementationOnce(async () => {
        if (capturedCallbacks.onSessionUpdate) {
          capturedCallbacks.onSessionUpdate({
            sessionId: 'x',
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } },
          });
          capturedCallbacks.onSessionUpdate({
            sessionId: 'x',
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world!' } },
          });
        }
        return { stopReason: 'end_turn' };
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      const response = await prompt(session.id, 'Hello');

      expect(response.text).toBe('Hello world!');
      expect(response.done).toBe(true);
      expect(response.stopReason).toBe('end_turn');
    });

    it('uses agentSessionId in SDK prompt call', async () => {
      mockNewSession.mockResolvedValueOnce({ sessionId: 'agent-ses-42' });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      await prompt(session.id, 'test');

      expect(mockPrompt).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'agent-ses-42',
      }));
    });

    it('throws for unknown session', async () => {
      await expect(prompt('nonexistent', 'hello')).rejects.toThrow('Session not found');
    });

    it('sets session state to error on prompt failure', async () => {
      mockPrompt.mockRejectedValueOnce(new Error('Agent crashed'));

      const session = await createSessionFromEntry(MOCK_ENTRY);
      await expect(prompt(session.id, 'crash')).rejects.toThrow('Agent crashed');
      expect(getSession(session.id)?.state).toBe('error');
    });

    it('cleans up update handler after prompt (success)', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await prompt(session.id, 'test');
      expect(capturedCallbacks.onSessionUpdate).toBeUndefined();
    });

    it('cleans up update handler after prompt (error)', async () => {
      mockPrompt.mockRejectedValueOnce(new Error('fail'));

      const session = await createSessionFromEntry(MOCK_ENTRY);
      await expect(prompt(session.id, 'test')).rejects.toThrow('fail');
      expect(capturedCallbacks.onSessionUpdate).toBeUndefined();
    });

    it('rejects concurrent prompts on same session', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      mockPrompt.mockImplementationOnce(() => new Promise(() => {})); // never resolves
      const p1 = prompt(session.id, 'first');
      await expect(prompt(session.id, 'second')).rejects.toThrow('busy');
      // Clean up the hanging prompt
      session.state = 'idle';
    });
  });

  describe('promptStream', () => {
    it('forwards updates via onUpdate callback', async () => {
      const updates: unknown[] = [];

      mockPrompt.mockImplementationOnce(async () => {
        if (capturedCallbacks.onSessionUpdate) {
          capturedCallbacks.onSessionUpdate({
            sessionId: 'x',
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'streaming...' } },
          });
        }
        return { stopReason: 'end_turn' };
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      const response = await promptStream(session.id, 'Hello', (update) => updates.push(update));

      expect(response.text).toBe('streaming...');
      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates[updates.length - 1]).toEqual(expect.objectContaining({ type: 'done' }));
    });
  });

  describe('cancelPrompt', () => {
    it('does nothing for idle session', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await cancelPrompt(session.id);
      expect(getSession(session.id)?.state).toBe('idle');
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it('throws for unknown session', async () => {
      await expect(cancelPrompt('nonexistent')).rejects.toThrow('Session not found');
    });
  });

  describe('setMode', () => {
    it('calls SDK setSessionMode with wireSessionId', async () => {
      mockNewSession.mockResolvedValueOnce({ sessionId: 'agent-ses-99' });
      const session = await createSessionFromEntry(MOCK_ENTRY);

      await setMode(session.id, 'code');

      expect(mockSetSessionMode).toHaveBeenCalledWith({
        sessionId: 'agent-ses-99',
        modeId: 'code',
      });
    });
  });

  describe('setConfigOption', () => {
    it('calls SDK setSessionConfigOption and returns updated options', async () => {
      mockSetSessionConfigOption.mockResolvedValueOnce({
        configOptions: [
          { configId: 'model', category: 'model', currentValue: 'gpt-4', options: [] },
        ],
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      const result = await setConfigOption(session.id, 'model', 'gpt-4');

      expect(result).toHaveLength(1);
      expect(result[0].configId).toBe('model');
    });
  });

  describe('closeSession', () => {
    it('closes and removes session', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await closeSession(session.id);
      expect(getSession(session.id)).toBeUndefined();
    });

    it('handles close of nonexistent session gracefully', async () => {
      await closeSession('nonexistent');
    });

    it('calls unstable_closeSession on SDK connection', async () => {
      mockNewSession.mockResolvedValueOnce({ sessionId: 'agent-ses-close' });
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await closeSession(session.id);

      expect(mockUnstableCloseSession).toHaveBeenCalledWith({
        sessionId: 'agent-ses-close',
      });
    });
  });

  describe('getActiveSessions', () => {
    it('returns empty initially', () => {
      expect(getActiveSessions()).toHaveLength(0);
    });
  });

  describe('createSession (by agentId)', () => {
    it('throws when agent is not found in registry', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      await expect(createSession('nonexistent-agent')).rejects.toThrow('not found in registry');
    });

    it('delegates to createSessionFromEntry when agent is found', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_ENTRY);
      const session = await createSession('test-agent');
      expect(session.agentId).toBe('test-agent');
    });
  });

  describe('createSessionFromEntry — edge cases', () => {
    it('continues when session/new fails with non-auth error', async () => {
      mockNewSession.mockRejectedValueOnce(new Error('Network timeout'));
      const session = await createSessionFromEntry(MOCK_ENTRY);
      expect(session).toBeDefined();
      expect(session.agentSessionId).toBeUndefined();
    });

    it('throws when session/new fails with auth error', async () => {
      mockNewSession.mockRejectedValueOnce(new Error('Authentication required'));
      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('Authentication required');
    });

    it('enforces max total sessions limit', async () => {
      const created: string[] = [];
      for (let i = 0; i < 10; i++) {
        const s = await createSessionFromEntry({
          ...MOCK_ENTRY,
          id: `agent-${i}`,
        });
        created.push(s.id);
      }
      await expect(createSessionFromEntry({ ...MOCK_ENTRY, id: 'agent-overflow' })).rejects.toThrow('Maximum concurrent sessions');
      for (const id of created) await closeSession(id);
    });

    it('enforces per-agent limit when filling total limit', async () => {
      const created: string[] = [];
      // Create 3 sessions for same agent (fills per-agent limit)
      for (let i = 0; i < 3; i++) {
        const s = await createSessionFromEntry(MOCK_ENTRY);
        created.push(s.id);
      }
      // 4th session with different agent should succeed
      const s4 = await createSessionFromEntry({ ...MOCK_ENTRY, id: 'other-agent' });
      created.push(s4.id);
      expect(s4.agentId).toBe('other-agent');
      for (const id of created) await closeSession(id);
    });

    it('parses config options from session/new response', async () => {
      mockNewSession.mockResolvedValueOnce({
        sessionId: 'ses-cfg',
        configOptions: [
          { configId: 'model', category: 'model', currentValue: 'gpt-4', options: [{ id: 'gpt-4', label: 'GPT-4' }] },
        ],
      });
      const session = await createSessionFromEntry(MOCK_ENTRY);
      expect(session.configOptions).toHaveLength(1);
      expect(session.configOptions![0].configId).toBe('model');
    });
  });

  describe('loadSession', () => {
    it('throws when agent is not found', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      await expect(loadSession('unknown', 'ses-1')).rejects.toThrow('not found in registry');
    });

    it('throws when agent does not support loadSession', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_ENTRY);
      mockInitialize.mockResolvedValueOnce({ agentCapabilities: { loadSession: false } });
      await expect(loadSession('test-agent', 'ses-1')).rejects.toThrow('does not support session/load');
    });

    it('loads session when agent supports it', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_ENTRY);
      mockInitialize.mockResolvedValueOnce({ agentCapabilities: { loadSession: true } });
      mockLoadSession.mockResolvedValueOnce({ sessionId: 'ses-loaded', modes: [] });
      const session = await loadSession('test-agent', 'ses-loaded');
      expect(session.agentSessionId).toBe('ses-loaded');
    });
  });

  describe('listSessions', () => {
    it('throws when agent does not support session/list', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await expect(listSessions(session.id)).rejects.toThrow('does not support session/list');
    });

    it('returns sessions when supported', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: { sessionCapabilities: { list: true } },
      });
      mockListSessions.mockResolvedValueOnce({
        sessions: [{ sessionId: 'ses-1', cwd: '/home', title: 'My Session' }],
        nextCursor: 'abc',
      });
      const session = await createSessionFromEntry(MOCK_ENTRY);
      const result = await listSessions(session.id);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('ses-1');
      expect(result.nextCursor).toBe('abc');
    });
  });

  describe('prompt — notification types', () => {
    it('aggregates thinking content as text', async () => {
      mockPrompt.mockImplementationOnce(async () => {
        if (capturedCallbacks.onSessionUpdate) {
          capturedCallbacks.onSessionUpdate({
            sessionId: 'x',
            update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'thinking', text: 'hmm...' } },
          });
        }
        return { stopReason: 'end_turn' };
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      const response = await prompt(session.id, 'think');
      expect(response.text).toBe('');
    });

    it('handles tool_call notifications in promptStream', async () => {
      const updates: unknown[] = [];
      mockPrompt.mockImplementationOnce(async () => {
        if (capturedCallbacks.onSessionUpdate) {
          capturedCallbacks.onSessionUpdate({
            sessionId: 'x',
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tc-1',
              title: 'Read file',
              status: 'completed',
              kind: 'read',
            },
          });
        }
        return { stopReason: 'end_turn' };
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      await promptStream(session.id, 'do something', (u) => updates.push(u));
      const toolUpdate = updates.find((u: any) => u.type === 'tool_call');
      expect(toolUpdate).toBeDefined();
    });
  });
});
