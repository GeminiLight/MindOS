// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import type { McpContextValue } from '@/lib/stores/mcp-store';
import type { AgentBuckets } from '@/components/agents/agents-content-model';
import AgentsSkillsSection from '@/components/agents/AgentsSkillsSection';

const mockApiFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return { apiFetch: mockApiFetch, ApiError: MockApiError };
});

// Virtuoso measures the viewport in a real browser; in jsdom just render every item.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (i: number, item: unknown) => React.ReactNode }) => (
    <div>{data.map((item, i) => <div key={i}>{itemContent(i, item)}</div>)}</div>
  ),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy = messages.en.agentsContent.skills;

function makeAgent(
  key: string,
  name: string,
  installedSkillNames: string[],
  options: { present?: boolean } = {},
): McpContextValue['agents'][number] {
  return {
    key,
    name,
    present: options.present ?? true,
    installed: options.present ?? true,
    hasProjectScope: true,
    hasGlobalScope: true,
    preferredTransport: 'stdio',
    format: 'json',
    configKey: 'mcpServers',
    globalPath: `/tmp/${key}.json`,
    skillMode: 'additional',
    skillWorkspacePath: `/home/u/.${key}/skills`,
    skillCapabilities: {
      mode: 'additional',
      workspacePath: `/home/u/.${key}/skills`,
      visibility: 'agent',
      nativeSkillScope: 'none',
      canLinkMindosSkills: true,
      canReceiveLinkedSkills: true,
      canExportNativeSkills: false,
      linkStrategy: 'symlink',
    },
    installedSkillNames,
    installedSkillCount: installedSkillNames.length,
    installedSkillSourcePath: `/home/u/.${key}/skills`,
  } as unknown as McpContextValue['agents'][number];
}

function makeMcp(overrides: Partial<McpContextValue> = {}): McpContextValue {
  return {
    status: null,
    loading: false,
    skills: [{
      name: 'todo-task-lookup',
      description: 'Personal todo lookup rules',
      enabled: true,
      source: 'builtin',
      editable: false,
      path: '/home/u/.codex/skills/todo-task-lookup/SKILL.md',
    }],
    agents: [
      makeAgent('claude-code', 'Claude Code', ['todo-task-lookup', 'claude-native-helper']),
      makeAgent('cursor', 'Cursor', []),
      // Owns todo-task-lookup as a REAL directory (matrix cell: conflict).
      makeAgent('windsurf', 'Windsurf', ['todo-task-lookup']),
      // A registry entry that is NOT on this machine but scans the same shared
      // dir as other universal agents — must never appear as a skill owner.
      makeAgent('kilo-code', 'Kilo Code', ['todo-task-lookup'], { present: false }),
    ],
    refresh: vi.fn().mockResolvedValue(undefined),
    toggleSkill: vi.fn().mockResolvedValue(true),
    installAgent: vi.fn(),
    _init: vi.fn(),
    ...overrides,
  } as unknown as McpContextValue;
}

function renderSection(mcp: McpContextValue) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AgentsSkillsSection copy={copy} mcp={mcp} buckets={{} as AgentBuckets} />);
  });
  return { container, root };
}

function findButtonByLabel(container: HTMLElement, label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === text);
}

/** Picker options render avatar + name; match by inclusion. */
function findPickerOption(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes(name) && button.textContent?.trim() !== name);
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

function agentCardOf(container: HTMLElement, agentName: string): HTMLElement {
  const link = [...container.querySelectorAll<HTMLAnchorElement>('a')]
    .find((a) => a.textContent?.trim() === agentName);
  expect(link, `agent card for ${agentName}`).toBeTruthy();
  return link!.closest('.rounded-xl') as HTMLElement;
}

function matrixRowOf(card: HTMLElement, skillName: string): HTMLElement {
  const nameButton = [...card.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim() === skillName);
  expect(nameButton, `matrix row for ${skillName}`).toBeTruthy();
  return nameButton!.closest('.justify-between') as HTMLElement;
}

function skillCardOf(container: HTMLElement, name: string): HTMLElement {
  const title = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === name);
  expect(title, `card for ${name}`).toBeTruthy();
  return title!.closest('.rounded-xl') as HTMLElement;
}

const SAMPLE_MATRIX = {
  skills: [{ name: 'todo-task-lookup', description: '', source: 'builtin', origin: 'custom', path: '/home/u/.codex/skills/todo-task-lookup/SKILL.md' }],
  agents: [
    { key: 'mindos', name: 'MindOS', mode: 'self' },
    { key: 'claude-code', name: 'Claude Code', mode: 'additional', skillDir: '/home/u/.claude-code/skills' },
    { key: 'cursor', name: 'Cursor', mode: 'additional', skillDir: '/home/u/.cursor/skills' },
    { key: 'windsurf', name: 'Windsurf', mode: 'additional', skillDir: '/home/u/.windsurf/skills' },
  ],
  state: { 'todo-task-lookup': { mindos: true, 'claude-code': true, cursor: false, windsurf: true } },
  cells: {
    'todo-task-lookup': {
      mindos: { enabled: true, status: 'enabled' },
      'claude-code': { enabled: true, status: 'linked' },
      cursor: { enabled: false, status: 'native-disabled' },
      windsurf: { enabled: true, status: 'conflict' },
    },
  },
};

beforeEach(() => {
  document.body.innerHTML = '';
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/skills/matrix') return JSON.parse(JSON.stringify(SAMPLE_MATRIX));
    return { ok: true, result: 'removed' };
  });
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('AgentsSkillsSection agent links', () => {
  it('the by-agent card shows per-agent matrix toggles with state badges, unmanaged natives listed read-only', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);
    await flushEffects(); // matrix fetch

    click(findButtonByText(container, copy.tabs.byAgent)!);
    await flushEffects();

    const card = agentCardOf(container, 'Claude Code');
    const row = matrixRowOf(card, 'todo-task-lookup');
    expect(row.textContent).toContain(copy.availabilityLinked); // managed link badge
    expect(row.textContent).toContain('~/.codex/skills'); // where the body originates
    expect(row.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');

    // The agent's own unknown skill is listed under Native Skills without a toggle.
    const nativeIdx = card.textContent!.indexOf(copy.agentNativeSkills);
    expect(nativeIdx).toBeGreaterThan(-1);
    expect(card.textContent!.slice(nativeIdx)).toContain('claude-native-helper');
  });

  it('toggling a linked cell on the agent card unlinks it through the unified write interface', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);
    await flushEffects();

    click(findButtonByText(container, copy.tabs.byAgent)!);
    await flushEffects();

    const row = matrixRowOf(agentCardOf(container, 'Claude Code'), 'todo-task-lookup');
    await clickAsync(row.querySelector('[role="switch"]')!);

    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'unlink', name: 'todo-task-lookup', agentKey: 'claude-code' }),
    }));
    expect(mcp.refresh).toHaveBeenCalled();
  });

  it('a parked-only skill (vanished from the skill list) still shows on the agent card via the matrix union', async () => {
    // The body dir doubled as a skill root: once parked, /api/skills no longer
    // lists it — but the matrix unions it back, so the card keeps the handle.
    const mcp = makeMcp({ skills: [] } as never);
    const { container } = renderSection(mcp);
    await flushEffects();

    click(findButtonByText(container, copy.tabs.byAgent)!);
    await flushEffects();

    const row = matrixRowOf(agentCardOf(container, 'Cursor'), 'todo-task-lookup');
    expect(row.textContent).toContain(copy.cellParked);

    await clickAsync(row.querySelector('[role="switch"]')!);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'enable-native', name: 'todo-task-lookup', agentKey: 'cursor' }),
    }));
  });

  it('a parked native skill shows as Parked on the agent card and toggling restores it', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);
    await flushEffects();

    click(findButtonByText(container, copy.tabs.byAgent)!);
    await flushEffects();

    const row = matrixRowOf(agentCardOf(container, 'Cursor'), 'todo-task-lookup');
    expect(row.textContent).toContain(copy.cellParked);
    expect(row.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');

    await clickAsync(row.querySelector('[role="switch"]')!);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'enable-native', name: 'todo-task-lookup', agentKey: 'cursor' }),
    }));
  });

  it('the by-agent view shows no installed skills for agents absent from this machine', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);
    await flushEffects();

    click(findButtonByText(container, copy.tabs.byAgent)!);
    await flushEffects();

    // Kilo Code is absent — its card must not list the shared-dir skill.
    const text = container.textContent!;
    const kiloIdx = text.indexOf('Kilo Code');
    expect(kiloIdx).toBeGreaterThan(-1);
    expect(text.slice(kiloIdx).split(copy.agentMindosSkills)[0]).not.toContain('todo-task-lookup');
  });

  it('agents not present on this machine never appear as skill owners', () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);

    const card = skillCardOf(container, 'todo-task-lookup');
    expect(findButtonByLabel(card, 'Remove Claude Code')).toBeTruthy();
    expect(findButtonByLabel(card, 'Remove Kilo Code')).toBeNull();
    expect(card.textContent).toContain(copy.skillAgentCount(2));
  });

  it('removing a linked agent from a skill unlinks it through the unified write interface and refreshes', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);

    const card = skillCardOf(container, 'todo-task-lookup');
    click(findButtonByLabel(card, 'Remove Claude Code')!);

    // Confirm dialog explains link-only removal, then actually unlinks.
    expect(document.body.textContent).toContain('the skill itself is untouched');
    await clickAsync(findButtonByText(document.body, copy.removeAgentFromSkill)!);

    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'unlink', name: 'todo-task-lookup', agentKey: 'claude-code' }),
    }));
    expect(mcp.refresh).toHaveBeenCalled();
    expect(document.body.textContent).toContain(copy.unlinkSkillSuccess('todo-task-lookup', 'Claude Code'));
  });

  it('removing an agent-owned skill parks it via disable-native instead of refusing', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);
    await flushEffects(); // matrix fetch

    const card = skillCardOf(container, 'todo-task-lookup');
    click(findButtonByLabel(card, 'Remove Windsurf')!);

    // The confirm dialog explains the reversible park, not a deletion.
    expect(document.body.textContent).toContain('parked under .mindos-disabled');
    await clickAsync(findButtonByText(document.body, copy.removeAgentFromSkill)!);

    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'disable-native', name: 'todo-task-lookup', agentKey: 'windsurf' }),
    }));
    expect(document.body.textContent).toContain(copy.disableNativeSuccess('todo-task-lookup', 'Windsurf'));
  });

  it('an agent-owned real directory (409 conflict) falls back to the agent-owned hint instead of deleting', async () => {
    mockApiFetch.mockRejectedValue(new ApiError('refusing to delete', 409));
    const mcp = makeMcp();
    const { container } = renderSection(mcp);

    const card = skillCardOf(container, 'todo-task-lookup');
    click(findButtonByLabel(card, 'Remove Claude Code')!);
    await clickAsync(findButtonByText(document.body, copy.removeAgentFromSkill)!);

    expect(document.body.textContent).toContain(copy.manualSkillHint);
    expect(mcp.refresh).not.toHaveBeenCalled();
  });

  it('adding an agent to a MindOS-managed skill links it through the unified write interface', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);

    const card = skillCardOf(container, 'todo-task-lookup');
    click(findButtonByLabel(card, copy.addAgentToSkill)!);
    const option = findPickerOption(card, 'Cursor') ?? findButtonByText(card, 'Cursor');
    expect(option, 'Cursor picker option').toBeTruthy();
    await clickAsync(option!);

    expect(mockApiFetch).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'link', name: 'todo-task-lookup', agentKey: 'cursor' }),
    }));
    expect(mockApiFetch).not.toHaveBeenCalledWith('/api/agents/copy-skill', expect.anything());
  });

  it('adding an agent to a native skill still goes through the copy-skill route with its source path', async () => {
    const mcp = makeMcp();
    const { container } = renderSection(mcp);

    // claude-native-helper exists only inside Claude Code's directory → kind 'native'.
    const card = skillCardOf(container, 'claude-native-helper');
    click(findButtonByLabel(card, copy.addAgentToSkill)!);
    const option = findPickerOption(card, 'Cursor') ?? findButtonByText(card, 'Cursor');
    expect(option, 'Cursor picker option').toBeTruthy();
    await clickAsync(option!);

    expect(mockApiFetch).toHaveBeenCalledWith('/api/agents/copy-skill', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        skillName: 'claude-native-helper',
        sourcePath: '/home/u/.claude-code/skills',
        targetPath: '/home/u/.cursor/skills',
        strategy: 'symlink',
      }),
    }));
  });
});
