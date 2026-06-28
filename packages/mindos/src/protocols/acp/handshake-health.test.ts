import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpSession } from './types.js';
import {
  checkAcpHandshakeHealth,
  getCachedAcpHandshakeHealth,
  listCachedAcpHandshakeHealth,
  rememberAcpHandshakeHealth,
  resetAcpHandshakeHealthCacheForTest,
} from './handshake-health.js';

function session(overrides: Partial<AcpSession> = {}): AcpSession {
  return {
    id: 'ses-local',
    agentId: 'test-acp',
    agentSessionId: 'agent-session-1',
    state: 'idle',
    cwd: '/tmp/project',
    createdAt: '2026-06-28T00:00:00.000Z',
    lastActivityAt: '2026-06-28T00:00:00.000Z',
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { list: true, close: true },
    },
    modes: [{ id: 'default', name: 'Default' }],
    configOptions: [{
      type: 'select',
      configId: 'model',
      category: 'model',
      currentValue: 'smart',
      options: [{ id: 'smart', label: 'Smart' }],
    }],
    mcpServers: [{ name: 'github', type: 'stdio' }],
    authMethods: [{ id: 'terminal', name: 'Terminal' }],
    ...overrides,
  };
}

describe('ACP handshake health cache', () => {
  beforeEach(() => {
    resetAcpHandshakeHealthCacheForTest();
  });

  it('probes a readonly session, records resumability facts, closes it, and reuses the cached result', async () => {
    const created = session();
    const createSession = vi.fn(async () => created);
    const closeSession = vi.fn(async () => {});

    const first = await checkAcpHandshakeHealth('test-acp', {
      cwd: '/tmp/project',
      ttlMs: 60_000,
      now: () => 1_000,
      createSession,
      closeSession,
    });
    const cached = await checkAcpHandshakeHealth('test-acp', {
      cwd: '/tmp/project',
      ttlMs: 60_000,
      now: () => 2_000,
      createSession,
      closeSession,
    });

    expect(first).toMatchObject({
      agentId: 'test-acp',
      status: 'ready',
      stage: 'session-new',
      session: {
        sessionId: 'ses-local',
        externalSessionId: 'agent-session-1',
        supportsLoadSession: true,
        supportsListSessions: true,
        supportsClose: true,
        modeCount: 1,
        configOptionCount: 1,
        mcpServerCount: 1,
        authMethodCount: 1,
      },
    });
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith('test-acp', {
      cwd: '/tmp/project',
      permissionMode: 'readonly',
    });
    expect(closeSession).toHaveBeenCalledWith('ses-local');
    expect(cached.cached).toBe(true);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it('stores sanitized failures without command or token leakage', async () => {
    const result = rememberAcpHandshakeHealth({
      agentId: 'broken-acp',
      status: 'failed',
      stage: 'initialize',
      startedAt: 1_000,
      now: () => 1_250,
      message: 'failed with TOKEN=secret-value and api_key: abc123',
    });
    const cached = getCachedAcpHandshakeHealth('broken-acp', { now: () => 1_500 });

    expect(result.durationMs).toBe(250);
    expect(cached).toMatchObject({
      agentId: 'broken-acp',
      status: 'failed',
      stage: 'initialize',
      cached: true,
    });
    expect(cached?.message).toContain('[redacted]');
    expect(cached?.message).not.toContain('secret-value');
    expect(cached?.message).not.toContain('abc123');
    expect(listCachedAcpHandshakeHealth(['broken-acp'], { now: () => 1_500 })).toHaveLength(1);
  });

  it('records a failed probe and closes a late session if a timeout wins the race', async () => {
    const createSession = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return session({ id: 'late-session' });
    });
    const closeSession = vi.fn(async () => {});

    const result = await checkAcpHandshakeHealth('slow-acp', {
      timeoutMs: 1,
      ttlMs: 60_000,
      createSession,
      closeSession,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(result).toMatchObject({
      agentId: 'slow-acp',
      status: 'failed',
      stage: 'session-new',
    });
    expect(result.message).toContain('timed out');
    expect(closeSession).toHaveBeenCalledWith('late-session');
  });
});
