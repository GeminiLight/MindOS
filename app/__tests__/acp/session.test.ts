import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpRegistryEntry, AcpJsonRpcResponse } from '../../lib/acp/types';

// Mock child_process
const mockStdin = { writable: true, write: vi.fn() };
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockProc = {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  pid: 12345,
  on: vi.fn(),
  kill: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

// Mock registry
vi.mock('../../lib/acp/registry', () => ({
  findAcpAgent: vi.fn(),
}));

// Mock subprocess
vi.mock('../../lib/acp/subprocess', () => {
  const sessions = new Map<string, { alive: boolean; proc: typeof mockProc }>();
  return {
    spawnAcpAgent: vi.fn(() => {
      const proc = { id: 'test-proc', agentId: 'test-agent', proc: mockProc, alive: true };
      sessions.set('test-proc', proc);
      return proc;
    }),
    sendAndWait: vi.fn(),
    sendMessage: vi.fn(),
    onMessage: vi.fn(() => () => {}),
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
    // Clean up sessions between tests
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
    it('sends prompt and returns response', async () => {
      // Create session
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      // Prompt
      const promptResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0',
        id: 'rpc-2',
        result: { text: 'Hello from agent!', done: true },
      };
      vi.mocked(sendAndWait).mockResolvedValueOnce(promptResponse);

      const response = await prompt(session.id, 'Hello');
      expect(response.text).toBe('Hello from agent!');
      expect(response.done).toBe(true);
    });

    it('throws for unknown session', async () => {
      await expect(prompt('nonexistent', 'hello')).rejects.toThrow('Session not found');
    });

    it('sets session state to error on prompt failure', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      const errorResponse: AcpJsonRpcResponse = {
        jsonrpc: '2.0',
        id: 'rpc-2',
        error: { code: -32603, message: 'Agent crashed' },
      };
      vi.mocked(sendAndWait).mockResolvedValueOnce(errorResponse);

      await expect(prompt(session.id, 'crash')).rejects.toThrow('Agent crashed');

      const updated = getSession(session.id);
      expect(updated?.state).toBe('error');
    });
  });

  describe('cancelPrompt', () => {
    it('does nothing for idle session', async () => {
      const initResponse: AcpJsonRpcResponse = { jsonrpc: '2.0', id: 'rpc-1', result: { ok: true } };
      vi.mocked(sendAndWait).mockResolvedValueOnce(initResponse);
      const session = await createSessionFromEntry(MOCK_ENTRY);

      // Should not throw
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
      // Should not throw
      await closeSession('nonexistent');
    });
  });

  describe('getActiveSessions', () => {
    it('returns empty initially', () => {
      expect(getActiveSessions()).toHaveLength(0);
    });
  });
});
