// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@/lib/i18n';
import type { SkillMatrix } from '@/components/settings/types';

const mockApiFetch = vi.hoisted(() => vi.fn());
const mockToggleSkill = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());

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
    toggleSkill: mockToggleSkill,
    installAgent: vi.fn(),
    _init: vi.fn(),
  }),
}));

vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: mockToastSuccess,
    error: vi.fn(),
    copy: vi.fn(),
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sampleSkills = [{
  name: 'mindos',
  description: 'Default MindOS skill',
  enabled: true,
  source: 'user',
  editable: false,
  path: '/tmp/SKILL.md',
}];

/** Unsupported-mode agents never appear here — the backend already filters them out. */
const sampleMatrix: SkillMatrix = {
  skills: [{ name: 'mindos', description: 'Default MindOS skill', source: 'user', origin: 'mindos-user', path: '/tmp/SKILL.md' }],
  agents: [
    { key: 'mindos', name: 'MindOS', mode: 'self' },
    { key: 'claude-code', name: 'Claude Code', mode: 'additional', skillDir: '/home/u/.claude/skills' },
    { key: 'cursor', name: 'Cursor', mode: 'universal', skillDir: '/home/u/.agents/skills' },
    { key: 'windsurf', name: 'Windsurf', mode: 'additional', skillDir: '/home/u/.codeium/windsurf/skills' },
    { key: 'qwen-code', name: 'Qwen Code', mode: 'additional', skillDir: '/home/u/.qwen/skills' },
    { key: 'opencode', name: 'OpenCode', mode: 'universal', skillDir: '/home/u/.agents/skills' },
  ],
  state: {
    mindos: { mindos: true, 'claude-code': true, cursor: false, windsurf: false, 'qwen-code': false, opencode: false },
  },
  cells: {
    mindos: {
      mindos: { enabled: true, status: 'enabled' },
      'claude-code': { enabled: true, status: 'linked' },
      cursor: { enabled: false, status: 'none' },
      windsurf: { enabled: true, status: 'conflict' },
      'qwen-code': { enabled: false, status: 'broken' },
      opencode: { enabled: false, status: 'native-disabled' },
    },
  },
};

function installDefaultApiMock() {
  mockApiFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url === '/api/skills/matrix') return JSON.parse(JSON.stringify(sampleMatrix));
    if (url === '/api/skills' && opts?.method === 'POST') {
      const body = JSON.parse(opts.body as string);
      if (body.action === 'read') return { content: '# mindos skill' };
      if (body.action === 'link') return { ok: true, result: 'linked' };
      if (body.action === 'unlink') return { ok: true, result: 'removed' };
      return {};
    }
    if (url === '/api/skills') return { skills: sampleSkills };
    if (url === '/api/settings') return { skillPaths: { enableAgentsDir: true, custom: [] } };
    throw new Error(`Unexpected apiFetch call: ${url}`);
  });
}

async function renderSection() {
  const { default: McpSkillsSection } = await import('@/components/settings/McpSkillsSection');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<McpSkillsSection t={messages.en} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { host, root };
}

async function expandSkillRow(host: HTMLElement, name: string) {
  const nameSpan = Array.from(host.querySelectorAll('span')).find(s => s.textContent === name);
  expect(nameSpan).toBeTruthy();
  await act(async () => {
    (nameSpan as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function skillsPostBodies() {
  return mockApiFetch.mock.calls
    .filter(([url, opts]) => url === '/api/skills' && (opts as RequestInit | undefined)?.method === 'POST')
    .map(([, opts]) => JSON.parse((opts as RequestInit).body as string));
}

async function cleanup(root: ReturnType<typeof createRoot>, host: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  host.remove();
}

describe('McpSkillsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultApiMock();
  });

  it('keeps the switch state and shows an error when store toggle fails', async () => {
    mockToggleSkill.mockResolvedValue(false);
    const { host, root } = await renderSection();

    const skillSwitch = host.querySelector('[role="switch"]') as HTMLButtonElement | null;
    expect(skillSwitch?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      skillSwitch?.click();
      await Promise.resolve();
    });

    expect(mockToggleSkill).toHaveBeenCalledWith('mindos', false);
    expect(skillSwitch?.getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Failed to toggle skill');

    await cleanup(root, host);
  });

  it('renders one agent chip per external matrix agent, mirroring each cell state', async () => {
    const { host, root } = await renderSection();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills/matrix', expect.anything());

    await expandSkillRow(host, 'mindos');

    const chips = Array.from(host.querySelectorAll('button[aria-pressed]')) as HTMLButtonElement[];
    // Exactly matrix.agents minus the MindOS self column — no extra, no MindOS chip.
    expect(chips.map(c => c.dataset.agentKey)).toEqual(['claude-code', 'cursor', 'windsurf', 'qwen-code', 'opencode']);
    expect(chips.map(c => c.textContent)).toEqual(['Claude Code', 'Cursor', 'Windsurf', 'Qwen Code', 'OpenCode']);

    const byKey = Object.fromEntries(chips.map(c => [c.dataset.agentKey ?? '', c]));
    expect(byKey['claude-code'].getAttribute('aria-pressed')).toBe('true');   // linked
    expect(byKey['cursor'].getAttribute('aria-pressed')).toBe('false');       // none
    expect(byKey['windsurf'].disabled).toBe(false);                           // conflict → agent-owned, click disables
    expect(byKey['windsurf'].title).toContain('Agent-owned skill');
    expect(byKey['windsurf'].getAttribute('aria-pressed')).toBe('true');      // it IS loaded by the agent
    expect(byKey['qwen-code'].title).toContain('Link broken');                // broken → warning hint
    expect(byKey['qwen-code'].disabled).toBe(false);
    expect(byKey['opencode'].title).toContain('click to restore');            // parked native
    expect(byKey['opencode'].getAttribute('aria-pressed')).toBe('false');

    await cleanup(root, host);
  });

  it('links an unlinked agent and unlinks a linked agent via the chips', async () => {
    const { host, root } = await renderSection();
    await expandSkillRow(host, 'mindos');

    const cursorChip = host.querySelector('button[data-agent-key="cursor"]') as HTMLButtonElement;
    await act(async () => {
      cursorChip.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(skillsPostBodies()).toContainEqual({ action: 'link', name: 'mindos', agentKey: 'cursor' });

    const matrixCallsAfterLink = mockApiFetch.mock.calls.filter(([url]) => url === '/api/skills/matrix').length;
    expect(matrixCallsAfterLink).toBeGreaterThanOrEqual(2); // initial load + refresh after link

    const claudeChip = host.querySelector('button[data-agent-key="claude-code"]') as HTMLButtonElement;
    await act(async () => {
      claudeChip.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(skillsPostBodies()).toContainEqual({ action: 'unlink', name: 'mindos', agentKey: 'claude-code' });

    await cleanup(root, host);
  });

  it('parks an agent-owned skill via disable-native when its conflict chip is clicked', async () => {
    const { host, root } = await renderSection();
    await expandSkillRow(host, 'mindos');

    const windsurfChip = host.querySelector('button[data-agent-key="windsurf"]') as HTMLButtonElement;
    expect(windsurfChip.disabled).toBe(false);
    await act(async () => {
      windsurfChip.click();
      await Promise.resolve();
    });
    expect(skillsPostBodies()).toContainEqual({ action: 'disable-native', name: 'mindos', agentKey: 'windsurf' });

    await cleanup(root, host);
  });

  it('restores a parked native skill via enable-native when its chip is clicked', async () => {
    installDefaultApiMock();
    const { host } = await renderSection();
    await expandSkillRow(host, 'mindos');

    const opencodeChip = host.querySelector('button[data-agent-key="opencode"]') as HTMLButtonElement;
    expect(opencodeChip.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      opencodeChip.click();
    });

    expect(skillsPostBodies()).toContainEqual({ action: 'enable-native', name: 'mindos', agentKey: 'opencode' });
  });

  it('relinks a broken cell and toasts a restart hint for additional-mode agents', async () => {
    const { host, root } = await renderSection();
    await expandSkillRow(host, 'mindos');

    const qwenChip = host.querySelector('button[data-agent-key="qwen-code"]') as HTMLButtonElement;
    await act(async () => {
      qwenChip.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // broken → clicking repairs via link (not unlink)
    expect(skillsPostBodies()).toContainEqual({ action: 'link', name: 'mindos', agentKey: 'qwen-code' });
    expect(mockToastSuccess).toHaveBeenCalledWith('Takes effect the next time Qwen Code starts');

    await cleanup(root, host);
  });

  it('shows the link error inline on the skill row when the API rejects', async () => {
    mockApiFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/skills/matrix') return JSON.parse(JSON.stringify(sampleMatrix));
      if (url === '/api/skills' && opts?.method === 'POST') {
        const body = JSON.parse(opts.body as string);
        if (body.action === 'read') return { content: '# mindos skill' };
        if (body.action === 'link') throw new Error('agent skill directory is not writable');
        return {};
      }
      if (url === '/api/skills') return { skills: sampleSkills };
      if (url === '/api/settings') return { skillPaths: { enableAgentsDir: true, custom: [] } };
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();
    await expandSkillRow(host, 'mindos');

    const cursorChip = host.querySelector('button[data-agent-key="cursor"]') as HTMLButtonElement;
    await act(async () => {
      cursorChip.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('agent skill directory is not writable');

    await cleanup(root, host);
  });

  it('shows a muted empty hint when no external agent supports skills', async () => {
    const emptyMatrix: SkillMatrix = {
      ...sampleMatrix,
      agents: [{ key: 'mindos', name: 'MindOS', mode: 'self' }],
      cells: { mindos: { mindos: { enabled: true, status: 'enabled' } } },
      state: { mindos: { mindos: true } },
    };
    mockApiFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/skills/matrix') return JSON.parse(JSON.stringify(emptyMatrix));
      if (url === '/api/skills' && opts?.method === 'POST') return { content: '# mindos skill' };
      if (url === '/api/skills') return { skills: sampleSkills };
      if (url === '/api/settings') return { skillPaths: { enableAgentsDir: true, custom: [] } };
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();
    await expandSkillRow(host, 'mindos');

    expect(host.querySelectorAll('button[aria-pressed]').length).toBe(0);
    expect(host.textContent).toContain('No external agents with Skill support detected');

    await cleanup(root, host);
  });
});
