import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpRegistryEntry, AcpJsonRpcResponse } from '../../lib/acp/types';

const mockStdin = { writable: true, write: vi.fn() };
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockProc = {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  pid: 12345,
  on: vi.fn(),
  once: vi.fn(),
  kill: vi.fn(),
  removeListener: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

vi.mock('../../lib/acp/registry', () => ({
  findAcpAgent: vi.fn(),
}));

// Capture notification callbacks for testing
let capturedNotifCallback: ((notif: unknown) => void) | null = null;

vi.mock('../../lib/acp/subprocess', () => {
  return {
    spawnAcpAgent: vi.fn(() => {
      return { id: 'test-proc', agentId: 'test-agent', proc: mockProc, alive: true };
    }),
    sendAndWait: vi.fn(),
    sendMessage: vi.fn(() => 'rpc-99'),
    onMessage: vi.fn(() => () => {}),
    onNotification: vi.fn((_proc: unknown, cb: (notif: unknown) => void) => {
      capturedNotifCallback = cb;
      return () => { capturedNotifCallback = null; };
    }),
    onRequest: vi.fn(() => () => {}),
    sendResponse: vi.fn(),
    installAutoApproval: vi.fn(() => () => {}),
    killAgent: vi.fn((p: { alive: boolean }) => { p.alive = false; }),
  };
});

import { createSessionFromEntry, prompt, cancelPrompt, closeSession, getSession, getActiveSessions } from '../../lib/acp/session';
import { sendAndWait } from '../../lib/acp/subprocess';

const MOCK_ENTRY: AcpRegistryEntry = {
  id: 'test-agent',
  name: 'Test Agent',
  description: 'A test ACP agent',
  transport: 'stdio',
  command: 'test-agent',
};

describe('ACP Session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedNotifCallback = null;
    for (const s of getActiveSessions()) {
      closeSession(s.id).catch(() => {});
    }
  });

  describe('createSessionFromEntry', () => {
    it('creates a session after successful initialize', async () => {
      const mockResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(mockResponse);

      const session = await createSessionFromEntry(MOCK_ENTRY);

      expect(session).toBeDefined();
      expect(session.agentId).toBe('test-agent');
      expect(session.state).toBe('idle');
      expect(session.id).toContain('ses-test-agent-');
    });

    it('extracts agentSessionId from session/new response', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      const sessionNewResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0', id: 'rpc-2',
        result: { sessionId: 'agent-assigned-session-id-123' },
      };
      vi.mocked(sendAndWait)
        .mockResolvedValueOnce(initResponse)
        .mockResolvedValueOnce(sessionNewResponse);

      const session = await createSessionFromEntry(MOCK_ENTRY);

      expect(session.agentSessionId).toBe('agent-assigned-session-id-123');
      expect(session.id).toContain('ses-test-agent-');
      expect(session.id).not.toBe('agent-assigned-session-id-123');
    });

    it('parses modes from nested { availableModes: [...] } format', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      const sessionNewResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0', id: 'rpc-2',
        result: {
          sessionId: 'ses-1',
          modes: {
            availableModes: [
              { id: 'default', name: 'Default' },
              { id: 'code', name: 'Code Mode', description: 'Optimized for coding' },
            ],
            currentModeId: 'default',
          },
        },
      };
      vi.mocked(sendAndWait)
        .mockResolvedValueOnce(initResponse)
        .mockResolvedValueOnce(sessionNewResponse);

      const session = await createSessionFromEntry(MOCK_ENTRY);

      expect(session.modes).toHaveLength(2);
      expect(session.modes![0]).toEqual({ id: 'default', name: 'Default', description: undefined });
      expect(session.modes![1]).toEqual({ id: 'code', name: 'Code Mode', description: 'Optimized for coding' });
    });

    it('parses modes from flat array format (backward compat)', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      const sessionNewResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0', id: 'rpc-2',
        result: {
          sessionId: 'ses-1',
          modes: [
            { id: 'default', name: 'Default' },
          ],
        },
      };
      vi.mocked(sendAndWait)
        .mockResolvedValueOnce(initResponse)
        .mockResolvedValueOnce(sessionNewResponse);

      const session = await createSessionFromEntry(MOCK_ENTRY);
      expect(session.modes).toHaveLength(1);
    });

    it('throws and cleans up on initialize failure', async () => {
      const mockResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0',
        id: 'rpc-1',
        error: { code: -32603, message: 'Init failed' },
      };
      vi.mocked(sendAndWait).mockResolvedValueOnce(mockResponse);

      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('initialize failed');
    });

    it('throws on spawn timeout', async () => {
      vi.mocked(sendAndWait).mockRejectedValueOnce(new Error('timeout'));

      await expect(createSessionFromEntry(MOCK_ENTRY)).rejects.toThrow('timeout');
    });
  });

  describe('prompt', () => {
    it('returns response text from result when no notifications arrive', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      const promptResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0', id: 'rpc-2',
        result: { text: 'Hello from agent!', done: true },
      };
      vi.mocked(sendAndWait).mockResolvedValueOnce(promptResponse);

      const response = await prompt(session.id, 'Hello');
      expect(response.text).toBe('Hello from agent!');
      expect(response.done).toBe(true);
    });

    it('aggregates text from session/update notifications', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      vi.mocked(sendAndWait).mockImplementationOnce(async () => {
        // Simulate notifications arriving before the response
        if (capturedNotifCallback) {
          capturedNotifCallback({
            jsonrpc: '2.0', method: 'session/update',
            params: { sessionId: 'x', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } } },
          });
          capturedNotifCallback({
            jsonrpc: '2.0', method: 'session/update',
            params: { sessionId: 'x', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world!' } } },
          });
        }
        return { jsonrpc: '2.0', id: 'rpc-3', result: { stopReason: 'end_turn' } } as AcpJsonRpcResponse;
      });

      const response = await prompt(session.id, 'Hello');
      expect(response.text).toBe('Hello world!');
      expect(response.stopReason).toBe('end_turn');
    });

    it('uses agentSessionId in RPC params', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      const sessionNewResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0', id: 'rpc-2',
        result: { sessionId: 'agent-ses-42' },
      };
      vi.mocked(sendAndWait)
        .mockResolvedValueOnce(initResponse)
        .mockResolvedValueOnce(sessionNewResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      const promptResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0', id: 'rpc-3',
        result: { text: 'ok', stopReason: 'end_turn' },
      };
      vi.mocked(sendAndWait).mockResolvedValueOnce(promptResponse);

      await prompt(session.id, 'test');

      // Verify sendAndWait was called with the agent's sessionId, not our internal ID
      const promptCalls = vi.mocked(sendAndWait).mock.calls.filter(c => c[1] === 'session/prompt');
      expect(promptCalls).toHaveLength(1);
      expect(promptCalls[0][2]).toEqual(expect.objectContaining({
        sessionId: 'agent-ses-42',
      }));
    });

    it('throws for unknown session', async () => {
      await expect(prompt('nonexistent', 'hello')).rejects.toThrow('Session not found');
    });

    it('sets session state to error on prompt failure', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      const errorResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0', id: 'rpc-2',
        error: { code: -32603, message: 'Agent crashed' },
      };
      vi.mocked(sendAndWait).mockResolvedValueOnce(errorResponse);

      await expect(prompt(session.id, 'crash')).rejects.toThrow('Agent crashed');
      expect(getSession(session.id)?.state).toBe('error');
    });
  });

  describe('cancelPrompt', () => {
    it('does nothing for idle session', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      await cancelPrompt(session.id);
      expect(getSession(session.id)?.state).toBe('idle');
    });

    it('throws for unknown session', async () => {
      await expect(cancelPrompt('nonexistent')).rejects.toThrow('Session not found');
    });
  });

  describe('closeSession', () => {
    it('closes and removes session', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      vi.mocked(sendAndWait).mockResolvedValueOnce({ jsonrpc: '2.0', id: 'rpc-2', result: {} });
      await closeSession(session.id);

      expect(getSession(session.id)).toBeUndefined();
    });

    it('handles close of nonexistent session gracefully', async () => {
      await closeSession('nonexistent');
    });
  });

  describe('getActiveSessions', () => {
    it('returns empty initially', () => {
      expect(getActiveSessions()).toHaveLength(0);
    });
  });
});
