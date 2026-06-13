// @vitest-environment jsdom
/**
 * Spec acceptance: `the skill-centric view and the agent-centric view report
 * the same enabled state for every (skill, agent) cell`.
 *
 * Both views consume the same source of truth (GET /api/skills/matrix) and
 * write through the same endpoint (POST /api/skills {action:'link'|'unlink'}).
 * With one shared mock matrix we assert the skill-centric chips render exactly
 * the matrix cell states, and that both views emit byte-identical link writes
 * for the same (skill, agent) cell.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@/lib/i18n';
import type { AgentInfo, SkillMatrix } from '@/components/settings/types';

const mockApiFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

vi.mock('@/lib/stores/mcp-store', () => ({
  useMcpDataOptional: () => ({
    status: null,
    agents: [],
    skills: [],
    loading: false,
    refresh: vi.fn(),
    toggleSkill: vi.fn(),
    installAgent: vi.fn(),
    _init: vi.fn(),
  }),
}));

vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    copy: vi.fn(),
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* One shared matrix — the single source of truth both views consume. */
const SHARED_MATRIX: SkillMatrix = {
  skills: [{ name: 'mindos', description: 'Default MindOS skill', source: 'user', origin: 'mindos-user', path: '/tmp/SKILL.md' }],
  agents: [
    { key: 'mindos', name: 'MindOS', mode: 'self' },
    { key: 'claude-code', name: 'Claude Code', mode: 'additional', skillDir: '/home/u/.claude/skills' },
    { key: 'cursor', name: 'Cursor', mode: 'universal', skillDir: '/home/u/.agents/skills' },
  ],
  state: {
    mindos: { mindos: true, 'claude-code': true, cursor: false },
  },
  cells: {
    mindos: {
      mindos: { enabled: true, status: 'enabled' },
      'claude-code': { enabled: true, status: 'linked' },
      cursor: { enabled: false, status: 'none' },
    },
  },
};

function installApiMock() {
  mockApiFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url === '/api/skills/matrix') return JSON.parse(JSON.stringify(SHARED_MATRIX));
    if (url === '/api/skills' && opts?.method === 'POST') {
      const body = JSON.parse(opts.body as string);
      if (body.action === 'read') return { content: '# mindos skill' };
      if (body.action === 'link') return { ok: true, result: 'linked' };
      if (body.action === 'unlink') return { ok: true, result: 'removed' };
      return {};
    }
    if (url === '/api/skills') {
      return {
        skills: [{ name: 'mindos', description: 'Default MindOS skill', enabled: true, source: 'user', editable: false, path: '/tmp/SKILL.md' }],
      };
    }
    if (url === '/api/settings') return { skillPaths: { enableAgentsDir: true, custom: [] } };
    if (url === '/api/mcp/install') {
      const body = JSON.parse((opts as RequestInit).body as string) as { agents: Array<{ key: string }> };
      return { results: body.agents.map(a => ({ agent: a.key, status: 'ok' })) };
    }
    throw new Error(`Unexpected apiFetch call: ${url}`);
  });
}

function linkWrites() {
  return mockApiFetch.mock.calls
    .filter(([url, opts]) => url === '/api/skills' && (opts as RequestInit | undefined)?.method === 'POST')
    .map(([, opts]) => JSON.parse((opts as RequestInit).body as string))
    .filter(body => body.action === 'link' || body.action === 'unlink');
}

async function mount(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe('skill-centric and agent-centric views share one matrix state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installApiMock();
  });

  it('the skill-centric chips report exactly the enabled state of the shared matrix cells', async () => {
    const { default: McpSkillsSection } = await import('@/components/settings/McpSkillsSection');
    const view = await mount(<McpSkillsSection t={messages.en} />);

    // The section reads the shared source of truth.
    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills/matrix', expect.anything());

    const nameSpan = Array.from(view.host.querySelectorAll('span')).find(s => s.textContent === 'mindos');
    await act(async () => {
      (nameSpan as HTMLElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const chips = Array.from(view.host.querySelectorAll('button[aria-pressed]')) as HTMLButtonElement[];
    const externalAgents = SHARED_MATRIX.agents.filter(a => a.mode !== 'self');
    expect(chips.map(c => c.dataset.agentKey)).toEqual(externalAgents.map(a => a.key));
    for (const agent of externalAgents) {
      const chip = chips.find(c => c.dataset.agentKey === agent.key)!;
      expect(chip.getAttribute('aria-pressed')).toBe(String(SHARED_MATRIX.cells.mindos[agent.key].enabled));
    }

    await view.unmount();
  });

  it('both views emit identical link writes for the same (skill, agent) cell', async () => {
    /* Skill-centric view: enable mindos for cursor via the chip. */
    const { default: McpSkillsSection } = await import('@/components/settings/McpSkillsSection');
    const skillView = await mount(<McpSkillsSection t={messages.en} />);
    const nameSpan = Array.from(skillView.host.querySelectorAll('span')).find(s => s.textContent === 'mindos');
    await act(async () => {
      (nameSpan as HTMLElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const cursorChip = skillView.host.querySelector('button[data-agent-key="cursor"]') as HTMLButtonElement;
    await act(async () => {
      cursorChip.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const skillViewWrites = linkWrites();
    expect(skillViewWrites).toEqual([{ action: 'link', name: 'mindos', agentKey: 'cursor' }]);
    await skillView.unmount();

    /* Agent-centric view: install MCP config for cursor, which links the same cell. */
    mockApiFetch.mockClear();
    const { default: AgentInstall } = await import('@/components/settings/McpAgentInstall');
    const agents: AgentInfo[] = [{
      key: 'cursor',
      name: 'Cursor',
      present: true,
      installed: false,
      hasProjectScope: false,
      hasGlobalScope: true,
      preferredTransport: 'stdio',
      format: 'json',
      configKey: 'mcpServers',
      globalPath: '/tmp/cursor.json',
    }];
    const agentView = await mount(
      <AgentInstall agents={agents} t={messages.en} onRefresh={() => undefined} mode="mcp" activeSkillName="mindos" />,
    );
    const checkbox = agentView.host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const installButton = Array.from(agentView.host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Install Selected')) as HTMLButtonElement;
    await act(async () => {
      installButton.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const agentViewWrites = linkWrites();
    await agentView.unmount();

    // Identical write for the same cell → both views drive the same state.
    expect(agentViewWrites).toEqual(skillViewWrites);
  });
});
