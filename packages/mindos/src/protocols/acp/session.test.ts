import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AcpPermissionEvent, AcpRegistryEntry } from './types';

// Mock SDK connection that records calls
let mockInitialize: ReturnType<typeof vi.fn>;
let mockNewSession: ReturnType<typeof vi.fn>;
let mockAuthenticate: ReturnType<typeof vi.fn>;
let mockPrompt: ReturnType<typeof vi.fn>;
let mockCancel: ReturnType<typeof vi.fn>;
let mockSetSessionMode: ReturnType<typeof vi.fn>;
let mockSetSessionConfigOption: ReturnType<typeof vi.fn>;
let mockCloseSession: ReturnType<typeof vi.fn>;
let mockLoadSession: ReturnType<typeof vi.fn>;
let mockListSessions: ReturnType<typeof vi.fn>;
let capturedCallbacks: {
  onSessionUpdate?: (params: unknown) => void;
  onPermissionRequest?: (event: AcpPermissionEvent) => void;
  onPermissionResolved?: (event: AcpPermissionEvent) => void;
} = {};

vi.mock('./registry.js', () => ({
  findAcpAgent: vi.fn(),
}));

vi.mock('./subprocess.js', () => ({
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
        closeSession: mockCloseSession,
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

import { createSession, createSessionFromEntry, loadSession, listSessions, listSessionsForAgent, prompt, promptStream, cancelPrompt, closeSession, setMode, setConfigOption, getSession, getActiveSessions, getSessionSnapshot, getActiveSessionSnapshots } from './session';
import { findAcpAgent } from './registry.js';
import { killAgent, spawnAndConnect } from './subprocess.js';
import { setAcpSessionChangedEmitterForTest } from './session-registry.js';
import { RequestError } from '@agentclientprotocol/sdk';
import { getCachedAcpHandshakeHealth, resetAcpHandshakeHealthCacheForTest } from './handshake-health.js';

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
    mockCloseSession = vi.fn().mockResolvedValue({});
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

    it('injects allowlisted MCP servers into new ACP sessions after initialize', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: { mcpCapabilities: { http: true } },
      });

      const session = await createSessionFromEntry(MOCK_ENTRY, {
        mcpConfig: {
          mcpServers: {
            filesystem: {
              command: 'mcp-filesystem',
              args: ['--root', '/tmp/project'],
              env: { FILESYSTEM_TOKEN: 'secret-value' },
              agentSessions: true,
            },
            remoteDocs: {
              type: 'http',
              url: 'https://mcp.example.com',
              headers: { Authorization: 'Bearer secret' },
              agentSessions: true,
            },
            github: {
              command: 'mcp-github',
              env: { GITHUB_TOKEN: 'must-not-inherit' },
              agentSessions: ['search_repositories'],
            },
          },
        },
      });

      expect(mockNewSession).toHaveBeenCalledWith({
        cwd: process.cwd(),
        mcpServers: [
          {
            name: 'filesystem',
            command: 'mcp-filesystem',
            args: ['--root', '/tmp/project'],
            env: [{ name: 'FILESYSTEM_TOKEN', value: 'secret-value' }],
          },
          {
            type: 'http',
            name: 'remoteDocs',
            url: 'https://mcp.example.com',
            headers: [{ name: 'Authorization', value: 'Bearer secret' }],
          },
        ],
      });
      expect(session.mcpServers).toEqual([
        { name: 'filesystem', type: 'stdio' },
        { name: 'remoteDocs', type: 'http' },
      ]);
      expect(getSessionSnapshot(session.id)?.mcpServers).toEqual([
        { name: 'filesystem', type: 'stdio' },
        { name: 'remoteDocs', type: 'http' },
      ]);
      expect(JSON.stringify(getSessionSnapshot(session.id))).not.toContain('secret');
      expect(JSON.stringify(getSessionSnapshot(session.id))).not.toContain('must-not-inherit');
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
      expect(session.currentModeId).toBe('default');
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

    it('does not authenticate up front when agent declares auth methods', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: {},
        authMethods: [{ id: 'terminal', name: 'Terminal Login' }],
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      expect(session.authMethods).toMatchObject([{ id: 'terminal', name: 'Terminal Login' }]);
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });

    it('declares readonly client capabilities when permissionMode is readonly', async () => {
      await createSessionFromEntry(MOCK_ENTRY, { permissionMode: 'readonly' });

      expect(mockInitialize).toHaveBeenCalledWith(expect.objectContaining({
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: false },
          terminal: false,
        },
      }));
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

    it('updates the session snapshot from dynamic ACP updates', async () => {
      mockNewSession.mockResolvedValueOnce({
        sessionId: 'agent-ses-snapshot',
        modes: {
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'code', name: 'Code' },
          ],
          currentModeId: 'default',
        },
        configOptions: [
          {
            configId: 'model',
            category: 'model',
            currentValue: 'cheap',
            options: [{ id: 'cheap', label: 'Cheap' }, { id: 'smart', label: 'Smart' }],
          },
          {
            configId: 'reasoning_effort',
            category: 'thought_level',
            currentValue: 'medium',
            options: [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }],
          },
        ],
      });
      mockPrompt.mockImplementationOnce(async () => {
        capturedCallbacks.onSessionUpdate?.({
          sessionId: 'agent-ses-snapshot',
          update: {
            sessionUpdate: 'available_commands_update',
            availableCommands: [
              { name: 'commit', description: 'Prepare a commit.' },
              '/plan',
            ],
          },
        });
        capturedCallbacks.onSessionUpdate?.({
          sessionId: 'agent-ses-snapshot',
          update: { sessionUpdate: 'current_mode_update', currentModeId: 'code' },
        });
        capturedCallbacks.onSessionUpdate?.({
          sessionId: 'agent-ses-snapshot',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-1',
            title: 'Read file',
            status: 'pending',
            kind: 'read',
            rawInput: '{"path":"README.md"}',
          },
        });
        capturedCallbacks.onSessionUpdate?.({
          sessionId: 'agent-ses-snapshot',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tc-1',
            status: 'completed',
            rawOutput: 'ok',
          },
        });
        return { stopReason: 'end_turn' };
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      await promptStream(session.id, 'inspect', () => {});

      const snapshot = getSessionSnapshot(session.id);
      expect(snapshot).toMatchObject({
        schemaVersion: 1,
        sessionId: session.id,
        agentId: 'test-agent',
        agentSessionId: 'agent-ses-snapshot',
        currentModeId: 'code',
        controls: {
          model: { status: 'available', currentValue: 'cheap', options: [{ id: 'cheap', label: 'Cheap' }, { id: 'smart', label: 'Smart' }] },
          mode: { status: 'available', currentValue: 'code' },
          thoughtLevel: { status: 'available', currentValue: 'medium' },
        },
        availableCommands: [
          { id: 'commit', name: 'commit', description: 'Prepare a commit.' },
          { id: 'plan', name: 'plan' },
        ],
        toolSummary: { total: 1, completed: 1 },
      });
      expect(snapshot?.toolCalls[0]).toMatchObject({
        toolCallId: 'tc-1',
        status: 'completed',
        rawOutput: 'ok',
      });
      expect(getActiveSessionSnapshots().some((item) => item.sessionId === session.id)).toBe(true);
    });

    it('stores ACP permission request and resolution events in the session snapshot', async () => {
      mockPrompt.mockImplementationOnce(async () => {
        capturedCallbacks.onPermissionRequest?.({
          requestId: 'perm-1',
          sessionId: 'agent-ses-perm',
          toolCallId: 'tc-perm',
          toolName: 'Write file',
          status: 'pending',
          options: [
            { id: 'allow', label: 'Allow', kind: 'allow_once' },
            { id: 'reject', label: 'Reject', kind: 'reject_once' },
          ],
          requestedAt: '2026-06-26T00:00:00.000Z',
        });
        capturedCallbacks.onPermissionResolved?.({
          requestId: 'perm-1',
          sessionId: 'agent-ses-perm',
          toolCallId: 'tc-perm',
          toolName: 'Write file',
          status: 'resolved',
          options: [
            { id: 'allow', label: 'Allow', kind: 'allow_once' },
            { id: 'reject', label: 'Reject', kind: 'reject_once' },
          ],
          selectedOptionId: 'allow',
          outcome: 'allow_once',
          requestedAt: '2026-06-26T00:00:00.000Z',
          resolvedAt: '2026-06-26T00:00:01.000Z',
        });
        return { stopReason: 'end_turn' };
      });

      const session = await createSessionFromEntry(MOCK_ENTRY);
      await promptStream(session.id, 'needs permission', () => {});

      const snapshot = getSessionSnapshot(session.id);
      expect(snapshot?.permissionEvents).toEqual([
        expect.objectContaining({
          requestId: 'perm-1',
          status: 'resolved',
          selectedOptionId: 'allow',
          outcome: 'allow_once',
        }),
      ]);
      expect(snapshot?.pendingPermissions).toEqual([]);
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

    it('calls closeSession on SDK connection when the agent declares the close capability', async () => {
      mockInitialize.mockResolvedValueOnce({ agentCapabilities: { sessionCapabilities: { close: {} } } });
      mockNewSession.mockResolvedValueOnce({ sessionId: 'agent-ses-close' });
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await closeSession(session.id);

      expect(mockCloseSession).toHaveBeenCalledWith({
        sessionId: 'agent-ses-close',
      });
    });

    it('skips session/close when the agent does not declare the close capability', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await closeSession(session.id);

      expect(mockCloseSession).not.toHaveBeenCalled();
      expect(killAgent).toHaveBeenCalledTimes(1);
      expect(getSession(session.id)).toBeUndefined();
    });

    it('can release the local process without closing a resumable agent session', async () => {
      mockNewSession.mockResolvedValueOnce({ sessionId: 'agent-ses-preserve' });
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await closeSession(session.id, { closeAgentSession: false });

      expect(mockCloseSession).not.toHaveBeenCalled();
      expect(getSession(session.id)).toBeUndefined();
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

    it('creates sessions for configured custom ACP agents without registry lookup', async () => {
      const session = await createSession('custom-acp', {
        overrides: {
          'custom-acp': {
            name: 'Custom ACP',
            command: 'custom-acp',
            args: ['--acp'],
          },
        },
      });

      expect(session.agentId).toBe('custom-acp');
      expect(findAcpAgent).not.toHaveBeenCalled();
      expect(spawnAndConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom-acp',
          name: 'Custom ACP',
          command: 'custom-acp',
          args: ['--acp'],
          transport: 'stdio',
        }),
        expect.any(Object),
      );
    });
  });

  describe('createSessionFromEntry — edge cases', () => {
    it('throws and cleans up when session/new fails with non-auth error', async () => {
      mockNewSession.mockRejectedValueOnce(new Error('Network timeout'));
      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('test-agent: session/new failed: Network timeout');
      expect(getActiveSessions()).toHaveLength(0);
    });

    it('throws when session/new fails with auth error', async () => {
      mockNewSession.mockRejectedValueOnce(new Error('Authentication required'));
      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('test-agent: session/new failed: Authentication required');
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

    it('injects allowlisted MCP servers when loading ACP sessions', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_ENTRY);
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: { loadSession: true, mcpCapabilities: { sse: true } },
      });
      mockLoadSession.mockResolvedValueOnce({ sessionId: 'ses-loaded', modes: [] });

      const session = await loadSession('test-agent', 'ses-loaded', {
        cwd: '/tmp/project',
        mcpConfig: {
          mcpServers: {
            events: {
              type: 'sse',
              url: 'https://mcp.example.com/events',
              agentSessions: true,
            },
          },
        },
      });

      expect(mockLoadSession).toHaveBeenCalledWith({
        sessionId: 'ses-loaded',
        cwd: '/tmp/project',
        mcpServers: [{
          type: 'sse',
          name: 'events',
          url: 'https://mcp.example.com/events',
          headers: [],
        }],
      });
      expect(session.mcpServers).toEqual([{ name: 'events', type: 'sse' }]);
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
        sessions: [{
          sessionId: 'ses-1',
          cwd: '/home',
          title: 'My Session',
          messages: [{ role: 'user', content: 'hello' }],
          messageCount: 1,
        }],
        nextCursor: 'abc',
      });
      const session = await createSessionFromEntry(MOCK_ENTRY);
      const result = await listSessions(session.id);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('ses-1');
      expect(result.sessions[0].messages).toEqual([{ role: 'user', content: 'hello' }]);
      expect(result.sessions[0].messageCount).toBe(1);
      expect(result.nextCursor).toBe('abc');
    });

    it('lists sessions by agent without creating a new session', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_ENTRY);
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: { sessionCapabilities: { list: true } },
      });
      mockListSessions.mockResolvedValueOnce({
        sessions: [{ sessionId: 'ses-agent-1', title: 'Agent Session', turns: [{ input: 'hi', output: 'there' }] }],
      });

      const result = await listSessionsForAgent('test-agent', { cwd: '/tmp/project' });

      expect(mockNewSession).not.toHaveBeenCalled();
      expect(mockListSessions).toHaveBeenCalledWith({ cwd: '/tmp/project' });
      expect(result.sessions[0]).toMatchObject({
        sessionId: 'ses-agent-1',
        title: 'Agent Session',
        turns: [{ input: 'hi', output: 'there' }],
      });
    });

    it('accepts ACP 1.0 object-shaped session/list capabilities', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: { sessionCapabilities: { list: {} } },
      });
      mockListSessions.mockResolvedValueOnce({
        sessions: [{ sessionId: 'ses-object-cap', title: 'Object Cap' }],
      });
      const session = await createSessionFromEntry(MOCK_ENTRY);
      const result = await listSessions(session.id);
      expect(result.sessions[0].sessionId).toBe('ses-object-cap');
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

  describe('admission control hardening', () => {
    // resolveMindosAgentTimeoutMs() default: the session layer must not cancel
    // an agent before the lane's own 10 minute budget elapses.
    const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60 * 1000;

    it('reserves slots synchronously so concurrent creates cannot exceed the total limit', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      mockInitialize.mockImplementation(async () => {
        await gate;
        return { agentCapabilities: {} };
      });

      const attempts = Array.from({ length: 12 }, (_, i) => createSessionFromEntry({ ...MOCK_ENTRY, id: `agent-${i}` }));
      // Overflow is decided before any handshake completes.
      release();
      const settled = await Promise.allSettled(attempts);

      const fulfilled = settled.filter((r): r is PromiseFulfilledResult<Awaited<typeof attempts[number]>> => r.status === 'fulfilled');
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled).toHaveLength(10);
      expect(rejected).toHaveLength(2);
      for (const r of rejected) expect((r.reason as Error).message).toContain('Maximum concurrent sessions');
      expect(getActiveSessions()).toHaveLength(10);
      expect(spawnAndConnect).toHaveBeenCalledTimes(10);

      for (const r of fulfilled) await closeSession(r.value.id);
    });

    it('counts in-flight creates against the per-agent limit', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      mockInitialize.mockImplementation(async () => {
        await gate;
        return { agentCapabilities: {} };
      });

      const sameAgent = [1, 2, 3].map(() => createSessionFromEntry(MOCK_ENTRY));
      const fourth = createSessionFromEntry(MOCK_ENTRY);
      const otherAgent = createSessionFromEntry({ ...MOCK_ENTRY, id: 'other-agent' });
      release();

      await expect(fourth).rejects.toThrow('Maximum concurrent sessions for agent "test-agent"');
      const created = await Promise.all([...sameAgent, otherAgent]);
      expect(created).toHaveLength(4);
      for (const s of created) await closeSession(s.id);
    });

    it('releases a reserved slot when the handshake fails', async () => {
      mockInitialize.mockRejectedValueOnce(new Error('spawn failed'));
      await expect(createSessionFromEntry({ ...MOCK_ENTRY, id: 'flaky' })).rejects.toThrow();

      const created: string[] = [];
      for (let i = 0; i < 10; i++) {
        created.push((await createSessionFromEntry({ ...MOCK_ENTRY, id: `agent-${i}` })).id);
      }
      expect(created).toHaveLength(10);
      for (const id of created) await closeSession(id);
    });

    it('generates distinct ids for sessions created in the same millisecond', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      try {
        const a = await createSessionFromEntry(MOCK_ENTRY);
        const b = await createSessionFromEntry(MOCK_ENTRY);
        expect(a.id).not.toBe(b.id);
        expect(a.id).toMatch(/^ses-test-agent-1700000000000-[0-9a-f]{8}$/);
        expect(b.id).toMatch(/^ses-test-agent-1700000000000-[0-9a-f]{8}$/);
        await closeSession(a.id);
        await closeSession(b.id);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('reaps stale idle sessions before enforcing the total limit', async () => {
      const created: string[] = [];
      for (let i = 0; i < 10; i++) {
        created.push((await createSessionFromEntry({ ...MOCK_ENTRY, id: `agent-${i}` })).id);
      }
      const stale = getSession(created[0])!;
      stale.lastActivityAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

      const fresh = await createSessionFromEntry({ ...MOCK_ENTRY, id: 'agent-new' });
      expect(fresh.agentId).toBe('agent-new');
      expect(getSession(created[0])).toBeUndefined();
      expect(getActiveSessions()).toHaveLength(10);

      for (const id of [...created.slice(1), fresh.id]) await closeSession(id);
    });

    it('does not reap a stale-looking session that is still active', async () => {
      const created: string[] = [];
      for (let i = 0; i < 10; i++) {
        created.push((await createSessionFromEntry({ ...MOCK_ENTRY, id: `agent-${i}` })).id);
      }
      const busy = getSession(created[0])!;
      busy.lastActivityAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      busy.state = 'active';

      await expect(createSessionFromEntry({ ...MOCK_ENTRY, id: 'agent-new' })).rejects.toThrow('Maximum concurrent sessions');
      expect(getSession(created[0])).toBeDefined();

      busy.state = 'idle';
      for (const id of created) await closeSession(id);
    });

    it('cancels the agent turn when prompt() times out', async () => {
      vi.useFakeTimers();
      try {
        const session = await createSessionFromEntry(MOCK_ENTRY);
        mockPrompt.mockReturnValueOnce(new Promise(() => {}));

        const pending = prompt(session.id, 'hang');
        const expectation = expect(pending).rejects.toThrow('Prompt timed out after 600s');
        await vi.advanceTimersByTimeAsync(DEFAULT_PROMPT_TIMEOUT_MS + 1);
        await expectation;

        expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'agent-ses-1' });
        expect(getSession(session.id)?.state).toBe('error');
        await closeSession(session.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels the agent turn when promptStream() times out even if cancel itself fails', async () => {
      vi.useFakeTimers();
      try {
        const session = await createSessionFromEntry(MOCK_ENTRY);
        mockPrompt.mockReturnValueOnce(new Promise(() => {}));
        mockCancel.mockRejectedValueOnce(new Error('agent gone'));

        const pending = promptStream(session.id, 'hang', () => {});
        const expectation = expect(pending).rejects.toThrow('Prompt timed out');
        await vi.advanceTimersByTimeAsync(DEFAULT_PROMPT_TIMEOUT_MS + 1);
        await expectation;

        expect(mockCancel).toHaveBeenCalledTimes(1);
        await closeSession(session.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not cancel when the prompt completes before the timeout', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      await prompt(session.id, 'quick');
      expect(mockCancel).not.toHaveBeenCalled();
      await closeSession(session.id);
    });
  });

  describe('prompt callback ownership (cancel, then prompt again before the old prompt settles)', () => {
    function permissionEvent(requestId: string): AcpPermissionEvent {
      return {
        requestId,
        sessionId: 'agent-ses-1',
        toolCallId: `tc-${requestId}`,
        toolName: 'Write file',
        status: 'pending',
        options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }],
        requestedAt: new Date().toISOString(),
      };
    }

    it('routes session/update and permission requests of the new prompt to its own callbacks', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      let settleFirst!: (value: { stopReason: string }) => void;
      mockPrompt.mockReturnValueOnce(new Promise((resolve) => { settleFirst = resolve; }));
      const firstUpdates: string[] = [];
      const first = promptStream(session.id, 'first', (update) => firstUpdates.push(update.type));

      await cancelPrompt(session.id);
      expect(getSession(session.id)?.state).toBe('idle');

      let settleSecond!: (value: { stopReason: string }) => void;
      mockPrompt.mockReturnValueOnce(new Promise((resolve) => { settleSecond = resolve; }));
      const secondUpdates: string[] = [];
      const second = promptStream(session.id, 'second', (update) => secondUpdates.push(update.type));
      expect(getSession(session.id)?.state).toBe('active');

      // The agent answers the cancelled prompt late: its cleanup must leave the
      // second prompt's callbacks and session state untouched.
      settleFirst({ stopReason: 'cancelled' });
      await first;
      expect(getSession(session.id)?.state).toBe('active');

      capturedCallbacks.onSessionUpdate?.({
        sessionId: 'agent-ses-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second-text' } },
      });
      capturedCallbacks.onPermissionRequest?.(permissionEvent('req-2'));
      expect(secondUpdates).toEqual(['agent_message_chunk', 'permission_request']);
      expect(getSessionSnapshot(session.id)?.pendingPermissions.map((event) => event.requestId)).toEqual(['req-2']);
      expect(firstUpdates).not.toContain('agent_message_chunk');

      settleSecond({ stopReason: 'end_turn' });
      const response = await second;
      expect(response.text).toBe('second-text');
      expect(getSession(session.id)?.state).toBe('idle');
      await closeSession(session.id);
    });

    it('does not let a late-failing cancelled prompt flip the new prompt into error', async () => {
      const session = await createSessionFromEntry(MOCK_ENTRY);
      let failFirst!: (error: Error) => void;
      mockPrompt.mockReturnValueOnce(new Promise((_resolve, reject) => { failFirst = reject; }));
      const first = prompt(session.id, 'first');

      await cancelPrompt(session.id);

      let settleSecond!: (value: { stopReason: string }) => void;
      mockPrompt.mockReturnValueOnce(new Promise((resolve) => { settleSecond = resolve; }));
      const second = prompt(session.id, 'second');

      failFirst(new Error('cancelled by agent'));
      await expect(first).rejects.toThrow('cancelled by agent');
      expect(getSession(session.id)?.state).toBe('active');

      capturedCallbacks.onSessionUpdate?.({
        sessionId: 'agent-ses-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } },
      });
      settleSecond({ stopReason: 'end_turn' });
      await expect(second).resolves.toMatchObject({ text: 'ok' });
      expect(getSession(session.id)?.state).toBe('idle');
      await closeSession(session.id);
    });
  });

  describe('handshake timeouts and abort signal', () => {
    it('kills the agent and rejects when the signal aborts during initialize', async () => {
      const controller = new AbortController();
      mockInitialize.mockReturnValueOnce(new Promise(() => {}));

      const pending = createSessionFromEntry(MOCK_ENTRY, { signal: controller.signal });
      controller.abort(new Error('turn cancelled'));

      await expect(pending).rejects.toThrow('turn cancelled');
      expect(killAgent).toHaveBeenCalledTimes(1);
      expect(getActiveSessions()).toHaveLength(0);
    });

    it('rejects immediately and never spawns when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('already cancelled'));

      await expect(createSessionFromEntry(MOCK_ENTRY, { signal: controller.signal })).rejects.toThrow('already cancelled');
      expect(spawnAndConnect).not.toHaveBeenCalled();
      expect(getActiveSessions()).toHaveLength(0);
    });

    it('times out session/new with the configured timeout and kills the agent', async () => {
      vi.useFakeTimers();
      try {
        mockNewSession.mockReturnValueOnce(new Promise(() => {}));
        const pending = createSessionFromEntry(MOCK_ENTRY, { timeouts: { sessionOpen: 1_000 } });
        const expectation = expect(pending).rejects.toThrow('session/new timed out after 1s');
        await vi.advanceTimersByTimeAsync(1_001);
        await expectation;
        expect(killAgent).toHaveBeenCalledTimes(1);
        expect(getActiveSessions()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('times out session/load with the configured timeout', async () => {
      vi.useFakeTimers();
      try {
        (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_ENTRY);
        mockInitialize.mockResolvedValueOnce({ agentCapabilities: { loadSession: true } });
        mockLoadSession.mockReturnValueOnce(new Promise(() => {}));
        const pending = loadSession('test-agent', 'ses-hang', { timeouts: { sessionOpen: 1_000 } });
        const expectation = expect(pending).rejects.toThrow('session/load timed out after 1s');
        await vi.advanceTimersByTimeAsync(1_001);
        await expectation;
        expect(killAgent).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still kills the agent when session/close never answers', async () => {
      vi.useFakeTimers();
      try {
        mockInitialize.mockResolvedValueOnce({ agentCapabilities: { sessionCapabilities: { close: {} } } });
        const session = await createSessionFromEntry(MOCK_ENTRY, { timeouts: { close: 1_000 } });
        mockCloseSession.mockReturnValueOnce(new Promise(() => {}));
        const closing = closeSession(session.id);
        await vi.advanceTimersByTimeAsync(1_001);
        await closing;
        expect(killAgent).toHaveBeenCalledTimes(1);
        expect(getSession(session.id)).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('prompt timeout supplied by the caller', () => {
    const originalAgentTimeout = process.env.MINDOS_AGENT_TIMEOUT_MS;

    afterEach(() => {
      if (originalAgentTimeout === undefined) delete process.env.MINDOS_AGENT_TIMEOUT_MS;
      else process.env.MINDOS_AGENT_TIMEOUT_MS = originalAgentTimeout;
      vi.useRealTimers();
    });

    it('uses the timeoutMs passed to promptStream and cancels the agent turn', async () => {
      vi.useFakeTimers();
      const session = await createSessionFromEntry(MOCK_ENTRY);
      mockPrompt.mockReturnValueOnce(new Promise(() => {}));

      const pending = promptStream(session.id, 'hang', () => {}, { timeoutMs: 1_000 });
      const expectation = expect(pending).rejects.toThrow('Prompt timed out after 1s');
      await vi.advanceTimersByTimeAsync(1_001);
      await expectation;

      expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'agent-ses-1' });
      await closeSession(session.id);
    });

    it('defaults the prompt timeout to the agent turn budget (MINDOS_AGENT_TIMEOUT_MS)', async () => {
      process.env.MINDOS_AGENT_TIMEOUT_MS = '2000';
      vi.useFakeTimers();
      const session = await createSessionFromEntry(MOCK_ENTRY);
      mockPrompt.mockReturnValueOnce(new Promise(() => {}));

      const pending = prompt(session.id, 'hang');
      const expectation = expect(pending).rejects.toThrow('Prompt timed out after 2s');
      await vi.advanceTimersByTimeAsync(2_001);
      await expectation;
      await closeSession(session.id);
    });

    it('cancels the agent turn when the prompt signal aborts', async () => {
      const controller = new AbortController();
      const session = await createSessionFromEntry(MOCK_ENTRY);
      mockPrompt.mockReturnValueOnce(new Promise(() => {}));

      const pending = promptStream(session.id, 'hang', () => {}, { signal: controller.signal });
      controller.abort(new Error('user stopped'));

      await expect(pending).rejects.toThrow('user stopped');
      expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'agent-ses-1' });
      await closeSession(session.id);
    });
  });

  describe('loadSession admission control', () => {
    beforeEach(() => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_ENTRY);
      mockInitialize.mockResolvedValue({ agentCapabilities: { loadSession: true } });
    });

    afterEach(() => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockReset();
    });

    it('enforces the total session limit before spawning', async () => {
      const created: string[] = [];
      for (let i = 0; i < 10; i++) {
        created.push((await createSessionFromEntry({ ...MOCK_ENTRY, id: `agent-${i}` })).id);
      }
      await expect(loadSession('test-agent', 'ses-overflow')).rejects.toThrow('Maximum concurrent sessions');
      expect(spawnAndConnect).toHaveBeenCalledTimes(10);
      for (const id of created) await closeSession(id);
    });

    it('registers a fresh local id and keeps the agent session id', async () => {
      const session = await loadSession('test-agent', 'ses-loaded');
      expect(session.id).toMatch(/^ses-test-agent-\d+-[0-9a-f]{8}$/);
      expect(session.id).not.toBe('ses-loaded');
      expect(session.agentSessionId).toBe('ses-loaded');
      expect(getSession(session.id)).toBe(session);
      await closeSession(session.id);
    });

    it('closes the previous local connection when the same agent session is loaded again', async () => {
      const first = await loadSession('test-agent', 'ses-dup');
      const second = await loadSession('test-agent', 'ses-dup');

      expect(second.id).not.toBe(first.id);
      expect(getSession(first.id)).toBeUndefined();
      expect(getActiveSessions().filter((session) => session.agentSessionId === 'ses-dup')).toHaveLength(1);
      // The old local process is gone but the agent-side session must survive: it is being resumed.
      expect(killAgent).toHaveBeenCalledTimes(1);
      expect(mockCloseSession).not.toHaveBeenCalled();
      await closeSession(second.id);
    });

    it('releases the reserved slot when session/load fails', async () => {
      mockLoadSession.mockRejectedValueOnce(new Error('unknown session'));
      await expect(loadSession('test-agent', 'ses-missing')).rejects.toThrow('session/load failed');

      const created: string[] = [];
      for (let i = 0; i < 10; i++) {
        created.push((await createSessionFromEntry({ ...MOCK_ENTRY, id: `agent-${i}` })).id);
      }
      expect(created).toHaveLength(10);
      for (const id of created) await closeSession(id);
    });
  });

  describe('authentication on demand', () => {
    beforeEach(() => {
      resetAcpHandshakeHealthCacheForTest();
    });

    it('authenticates with the first declared method and retries session/new after an auth-required error', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: {},
        authMethods: [{ id: 'terminal', name: 'Terminal Login' }],
      });
      mockNewSession
        .mockRejectedValueOnce(RequestError.authRequired())
        .mockResolvedValueOnce({ sessionId: 'agent-ses-auth' });

      const session = await createSessionFromEntry(MOCK_ENTRY);

      expect(mockAuthenticate).toHaveBeenCalledWith({ methodId: 'terminal' });
      expect(mockNewSession).toHaveBeenCalledTimes(2);
      expect(session.agentSessionId).toBe('agent-ses-auth');
      expect(getCachedAcpHandshakeHealth('test-agent')).toMatchObject({ status: 'ready', stage: 'session-new' });
      await closeSession(session.id);
    });

    it('authenticates up front with the requested method when the caller asks for it', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: {},
        authMethods: [{ id: 'oauth', name: 'OAuth' }, { id: 'terminal', name: 'Terminal Login' }],
      });

      const session = await createSessionFromEntry(MOCK_ENTRY, { authenticate: 'terminal' });

      expect(mockAuthenticate).toHaveBeenCalledWith({ methodId: 'terminal' });
      expect(mockNewSession).toHaveBeenCalledTimes(1);
      await closeSession(session.id);
    });

    it('records an authenticate-stage failure in handshake health when authentication fails', async () => {
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: {},
        authMethods: [{ id: 'terminal', name: 'Terminal Login' }],
      });
      mockNewSession.mockRejectedValueOnce(RequestError.authRequired());
      mockAuthenticate.mockRejectedValueOnce(new Error('browser login cancelled'));

      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('authentication failed');

      const health = getCachedAcpHandshakeHealth('test-agent');
      expect(health).toMatchObject({ status: 'failed', stage: 'authenticate' });
      expect(health?.message).toContain('browser login cancelled');
      expect(killAgent).toHaveBeenCalledTimes(1);
      expect(getActiveSessions()).toHaveLength(0);
    });

    it('records an authenticate-stage failure when the agent requires auth but declares no method', async () => {
      mockNewSession.mockRejectedValueOnce(RequestError.authRequired());

      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow(/authentication required/i);

      expect(mockAuthenticate).not.toHaveBeenCalled();
      expect(getCachedAcpHandshakeHealth('test-agent')).toMatchObject({ status: 'failed', stage: 'authenticate' });
    });

    it('authenticates and retries session/load the same way', async () => {
      (findAcpAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_ENTRY);
      mockInitialize.mockResolvedValueOnce({
        agentCapabilities: { loadSession: true },
        authMethods: [{ id: 'terminal', name: 'Terminal Login' }],
      });
      mockLoadSession
        .mockRejectedValueOnce(RequestError.authRequired())
        .mockResolvedValueOnce({ sessionId: 'ses-resumed' });

      const session = await loadSession('test-agent', 'ses-resumed');

      expect(mockAuthenticate).toHaveBeenCalledWith({ methodId: 'terminal' });
      expect(mockLoadSession).toHaveBeenCalledTimes(2);
      await closeSession(session.id);
    });
  });

  describe('periodic reaping', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('reaps stale idle sessions from a timer instead of from the getters', async () => {
      vi.useFakeTimers();
      const session = await createSessionFromEntry(MOCK_ENTRY);
      getSession(session.id)!.lastActivityAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

      expect(getActiveSessions().map((entry) => entry.id)).toContain(session.id);
      expect(getActiveSessionSnapshots().map((entry) => entry.sessionId)).toContain(session.id);
      expect(getSession(session.id)).toBeDefined();

      await vi.advanceTimersByTimeAsync(60_001);

      expect(getSession(session.id)).toBeUndefined();
      expect(killAgent).toHaveBeenCalledTimes(1);
    });
  });
});

describe('acp.session.changed events', () => {
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
    mockCloseSession = vi.fn().mockResolvedValue({});
    mockLoadSession = vi.fn().mockResolvedValue({ sessionId: 'loaded-ses-1' });
    mockListSessions = vi.fn().mockResolvedValue({ sessions: [] });
    await Promise.allSettled(getActiveSessions().map(s => closeSession(s.id)));
  });

  afterEach(() => {
    setAcpSessionChangedEmitterForTest(undefined);
  });

  it('emits idle on register, active on prompt start, idle on prompt end, and closed on close', async () => {
    const events: Array<{ agentId: string; sessionId: string; state: string }> = [];
    setAcpSessionChangedEmitterForTest((event) => {
      events.push({ agentId: event.agentId, sessionId: event.sessionId, state: event.state });
    });

    const session = await createSessionFromEntry(MOCK_ENTRY);
    await promptStream(session.id, 'hi', () => {});
    await closeSession(session.id);

    expect(events.map((event) => event.state)).toEqual(['idle', 'active', 'idle', 'closed']);
    expect(new Set(events.map((event) => event.sessionId))).toEqual(new Set([session.id]));
    expect(new Set(events.map((event) => event.agentId))).toEqual(new Set(['test-agent']));
  });

  it('emits error when a prompt fails and closed when a dead session is reaped', async () => {
    const events: Array<{ sessionId: string; state: string }> = [];
    setAcpSessionChangedEmitterForTest((event) => {
      events.push({ sessionId: event.sessionId, state: event.state });
    });

    const session = await createSessionFromEntry(MOCK_ENTRY);
    mockPrompt.mockRejectedValueOnce(new Error('prompt blew up'));
    await expect(promptStream(session.id, 'hi', () => {})).rejects.toThrow('prompt blew up');

    const states = events.filter((event) => event.sessionId === session.id).map((event) => event.state);
    expect(states).toContain('error');
  });
});
