// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@/lib/i18n';
import type { AgentInfo } from '@/components/settings/types';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    copy: vi.fn(),
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MCP settings interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps Select mode open with an empty directTools list so tools can be chosen', async () => {
    const { default: McpExternalTools } = await import('@/components/settings/McpExternalTools');
    mockApiFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/mcp/tools' && !opts?.method) {
        return {
          servers: [{
            name: 'github',
            toolCount: 1,
            tools: [{ name: 'search', description: 'Search issues' }],
            directTools: false,
            lifecycle: 'keep-alive',
            cached: true,
          }],
        };
      }
      if (url === '/api/mcp/direct-tools') return { ok: true };
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<McpExternalTools />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const githubButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('github')) as HTMLButtonElement | undefined;
    expect(githubButton).toBeTruthy();

    await act(async () => {
      githubButton?.click();
    });

    const selectButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Select') as HTMLButtonElement | undefined;
    expect(selectButton).toBeTruthy();

    await act(async () => {
      selectButton?.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('search');
    const postCall = mockApiFetch.mock.calls.find(([url]) => url === '/api/mcp/direct-tools');
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({
      server: 'github',
      directTools: [],
    });

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('reveals the saved MCP token only when installing HTTP agent config', async () => {
    const { default: AgentInstall } = await import('@/components/settings/McpAgentInstall');
    mockApiFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/mcp/token/reveal') {
        expect(opts?.method).toBe('POST');
        return { authConfigured: true, authToken: 'full-token' };
      }
      if (url === '/api/mcp/install') {
        return { results: [{ agent: 'cursor', status: 'ok' }] };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });
    const agents: AgentInfo[] = [{
      key: 'cursor',
      name: 'Cursor',
      present: true,
      installed: false,
      hasProjectScope: false,
      hasGlobalScope: true,
      preferredTransport: 'http',
      format: 'json',
      configKey: 'mcpServers',
      globalPath: '/tmp/cursor.json',
    }];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AgentInstall
          agents={agents}
          t={messages.en}
          onRefresh={() => undefined}
          mode="mcp"
          status={{
            running: true,
            transport: 'http',
            endpoint: 'http://localhost:8567/mcp',
            port: 8567,
            toolCount: 1,
            authConfigured: true,
            maskedToken: 'full-••••',
            localIP: null,
            connectionMode: { cli: true, mcp: true },
          }}
        />,
      );
    });

    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();

    await act(async () => {
      checkbox?.click();
    });

    const urlInput = Array.from(host.querySelectorAll('input[type="text"]'))
      .find((input) => (input as HTMLInputElement).value.includes('/mcp')) as HTMLInputElement | undefined;
    expect(urlInput?.value).toBe('http://localhost:8567/mcp');

    const passwordInput = host.querySelector('input[type="password"]') as HTMLInputElement | null;
    expect(passwordInput?.value).toBe('');
    expect(passwordInput?.placeholder).toBe('full-••••');

    const installButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Install Selected')) as HTMLButtonElement | undefined;
    expect(installButton?.disabled).toBe(false);

    await act(async () => {
      installButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/mcp/token/reveal', { method: 'POST' });
    const installCall = mockApiFetch.mock.calls.find(([url]) => url === '/api/mcp/install');
    expect(JSON.parse((installCall?.[1] as RequestInit).body as string)).toMatchObject({
      agents: [{ key: 'cursor', scope: 'global', transport: 'http' }],
      transport: 'auto',
      url: 'http://localhost:8567/mcp',
      token: 'full-token',
    });

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('does not allow MCP install selection for agents that were not detected', async () => {
    const { default: AgentInstall } = await import('@/components/settings/McpAgentInstall');
    const agents: AgentInfo[] = [{
      key: 'cursor',
      name: 'Cursor',
      present: false,
      installed: false,
      hasProjectScope: false,
      hasGlobalScope: true,
      preferredTransport: 'stdio',
      format: 'json',
      configKey: 'mcpServers',
      globalPath: '/tmp/cursor.json',
    }];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AgentInstall
          agents={agents}
          t={messages.en}
          onRefresh={() => undefined}
          mode="mcp"
          status={{
            running: true,
            transport: 'http',
            endpoint: 'http://localhost:8567/mcp',
            port: 8567,
            toolCount: 1,
            authConfigured: false,
            localIP: null,
            connectionMode: { cli: true, mcp: true },
          }}
        />,
      );
    });

    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox?.disabled).toBe(true);

    await act(async () => {
      checkbox?.click();
      await Promise.resolve();
    });

    const installButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Install Selected')) as HTMLButtonElement | undefined;
    expect(installButton?.disabled).toBe(true);
    expect(mockApiFetch).not.toHaveBeenCalledWith('/api/mcp/install', expect.anything());

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('shows the universal skill install flag for Kilo Code', async () => {
    const { default: AgentInstall } = await import('@/components/settings/McpAgentInstall');
    const agents: AgentInfo[] = [{
      key: 'kilo-code',
      name: 'Kilo Code',
      present: true,
      installed: false,
      hasProjectScope: true,
      hasGlobalScope: true,
      preferredTransport: 'stdio',
      format: 'json',
      configKey: 'mcp',
      entryStyle: 'kilo',
      globalPath: '~/.config/kilo/kilo.jsonc',
      projectPath: '.kilo/kilo.jsonc',
      skillMode: 'universal',
      skillWorkspacePath: '~/.agents/skills',
    }];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AgentInstall
          agents={agents}
          t={messages.en}
          onRefresh={() => undefined}
          mode="cli"
          activeSkillName="mindos"
        />,
      );
    });

    expect(host.textContent).toContain('npx skills add GeminiLight/MindOS --skill mindos -a universal -g -y');
    expect(host.textContent).not.toContain('-a kilo-code');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
