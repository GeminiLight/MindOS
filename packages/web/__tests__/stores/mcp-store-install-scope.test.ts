// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('@/lib/mcp-token', () => ({ revealMcpAuthToken: async () => 'fixture-token' }));

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { resetMcpStoreForTests, useMcpStore } from '@/lib/stores/mcp-store';
import type { AgentInfo, McpStatus } from '@/components/settings/types';

/**
 * `installAgent` scope selection. A project-scoped install writes a config
 * relative to a project root the server picks; the Web store must never
 * choose that scope on the user's behalf just because the agent supports it.
 */

function agent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    key: 'claude-code',
    name: 'Claude Code',
    present: true,
    installed: false,
    hasProjectScope: true,
    hasGlobalScope: true,
    preferredTransport: 'stdio',
    format: 'json',
    configKey: 'mcpServers',
    globalPath: '~/.claude.json',
    projectPath: '.mcp.json',
    ...overrides,
  } as AgentInfo;
}

function lastInstallBody(): { agents: Array<{ key: string; scope: string; transport: string }> } {
  const call = apiFetchMock.mock.calls.find(([url]) => url === '/api/mcp/install');
  expect(call, 'expected an /api/mcp/install request').toBeDefined();
  return JSON.parse((call![1] as { body: string }).body);
}

describe('mcp-store installAgent scope', () => {
  beforeEach(() => {
    resetMcpStoreForTests();
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/mcp/install') return { results: [{ agent: 'claude-code', status: 'ok' }] };
      if (url.startsWith('/api/mcp/status')) return { running: true };
      if (url.startsWith('/api/mcp/agents')) return { agents: [] };
      if (url.startsWith('/api/skills')) return { skills: [] };
      return {};
    });
  });

  afterEach(() => {
    resetMcpStoreForTests();
  });

  it('defaults to global scope even when the agent supports project scope', async () => {
    useMcpStore.setState({ agents: [agent({ hasProjectScope: true })] });

    await expect(useMcpStore.getState().installAgent('claude-code')).resolves.toBe(true);

    expect(lastInstallBody().agents).toEqual([{ key: 'claude-code', scope: 'global', transport: 'stdio' }]);
  });

  it('passes an explicitly chosen project scope and transport through unchanged', async () => {
    useMcpStore.setState({ agents: [agent({ hasProjectScope: true })] });

    await useMcpStore.getState().installAgent('claude-code', { scope: 'project', transport: 'http' });

    expect(lastInstallBody().agents).toEqual([{ key: 'claude-code', scope: 'project', transport: 'http' }]);
  });

  it('includes the local endpoint and authentication for an HTTP quick install', async () => {
    useMcpStore.setState({ agents: [agent({ preferredTransport: 'http' })], status: { endpoint: 'http://127.0.0.1:8567/mcp', authConfigured: true } as McpStatus });
    await useMcpStore.getState().installAgent('claude-code');
    expect(lastInstallBody()).toMatchObject({ url: 'http://127.0.0.1:8567/mcp', token: 'fixture-token' });
  });

  it('returns false without calling the API for an unknown agent', async () => {
    useMcpStore.setState({ agents: [] });

    await expect(useMcpStore.getState().installAgent('ghost')).resolves.toBe(false);
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/mcp/install')).toBe(false);
  });
});
