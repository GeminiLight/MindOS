// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@/lib/i18n';
import type { McpContextValue } from '@/lib/stores/mcp-store';
import type { AgentBuckets } from '@/components/agents/agents-content-model';
import AgentsMcpSection from '@/components/agents/AgentsMcpSection';

const mockApiFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy = { ...messages.en.agentsContent.mcp, status: messages.en.agentsContent.status };

function makeAgent(
  key: string,
  name: string,
  options: {
    present?: boolean;
    installed?: boolean;
    configuredMcpServers?: string[];
  } = {},
): McpContextValue['agents'][number] {
  return {
    key,
    name,
    present: options.present ?? true,
    installed: options.installed ?? true,
    hasProjectScope: true,
    hasGlobalScope: true,
    preferredTransport: 'stdio',
    format: 'json',
    configKey: 'mcpServers',
    globalPath: `/tmp/${key}.json`,
    configuredMcpServers: options.configuredMcpServers ?? [],
    configuredMcpServerCount: options.configuredMcpServers?.length ?? 0,
    installedSkillNames: [],
    installedSkillCount: 0,
  } as unknown as McpContextValue['agents'][number];
}

function makeMcp(overrides: Partial<McpContextValue> = {}): McpContextValue {
  return {
    status: {
      running: true,
      transport: 'stdio',
      endpoint: 'http://127.0.0.1:8781/mcp',
      port: 8781,
      toolCount: 1,
      authConfigured: true,
    },
    loading: false,
    skills: [],
    agents: [
      makeAgent('mindos', 'MindOS', { configuredMcpServers: [] }),
      makeAgent('cursor', 'Cursor', { configuredMcpServers: ['github'] }),
      makeAgent('codex', 'Codex', { installed: false, configuredMcpServers: [] }),
      makeAgent('ghost', 'Ghost', { present: false, installed: false, configuredMcpServers: [] }),
    ],
    refresh: vi.fn().mockResolvedValue(undefined),
    toggleSkill: vi.fn().mockResolvedValue(true),
    installAgent: vi.fn().mockResolvedValue(true),
    _init: vi.fn(),
    ...overrides,
  } as unknown as McpContextValue;
}

function renderSection(mcp: McpContextValue) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <AgentsMcpSection
        copy={copy}
        mcp={mcp}
        buckets={{ connected: [mcp.agents[1]!], detected: [mcp.agents[2]!], notFound: [mcp.agents[3]!] } as AgentBuckets}
        copyState={null}
        onCopySnippet={vi.fn()}
      />,
    );
  });
  return { container, root };
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function clickAsync(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function serverCardOf(container: HTMLElement, serverName: string): HTMLElement {
  const label = [...container.querySelectorAll('span')]
    .find((node) => node.textContent?.trim() === serverName);
  expect(label, `server card for ${serverName}`).toBeTruthy();
  return label!.closest('.rounded-lg') as HTMLElement;
}

function findButtonByLabel(container: HTMLElement, label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes(text));
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({ results: [{ agent: 'codex', status: 'ok' }] });
});

describe('AgentsMcpSection server installs', () => {
  it('copies the selected server to another detected agent instead of installing MindOS MCP', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);
    const card = serverCardOf(container, 'github');

    click(findButtonByLabel(card, copy.addAgent)!);
    expect(findButtonByText(card, 'Codex')).toBeTruthy();
    expect(findButtonByText(card, 'Ghost')).toBeFalsy();

    await clickAsync(findButtonByText(card, 'Codex')!);

    expect(mockApiFetch).toHaveBeenCalledWith('/api/mcp/copy-server', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        serverName: 'github',
        sourceAgentKey: 'cursor',
        targets: [{ key: 'codex', scope: 'global' }],
      }),
    }));
    expect(mcp.installAgent).not.toHaveBeenCalled();
    expect(mcp.refresh).toHaveBeenCalledWith({ force: true });
  });
});
