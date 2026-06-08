// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@/lib/i18n';

const mockApiFetch = vi.hoisted(() => vi.fn());
const mockToggleSkill = vi.hoisted(() => vi.fn());

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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('McpSkillsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({
      skills: [{
        name: 'mindos',
        description: 'Default MindOS skill',
        enabled: true,
        source: 'user',
        editable: false,
        path: '/tmp/SKILL.md',
      }],
    });
  });

  it('keeps the switch state and shows an error when store toggle fails', async () => {
    const { default: McpSkillsSection } = await import('@/components/settings/McpSkillsSection');
    mockToggleSkill.mockResolvedValue(false);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<McpSkillsSection t={messages.en} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const skillSwitch = host.querySelector('[role="switch"]') as HTMLButtonElement | null;
    expect(skillSwitch?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      skillSwitch?.click();
      await Promise.resolve();
    });

    expect(mockToggleSkill).toHaveBeenCalledWith('mindos', false);
    expect(skillSwitch?.getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Failed to toggle skill');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
