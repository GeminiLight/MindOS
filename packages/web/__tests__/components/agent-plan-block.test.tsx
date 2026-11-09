// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPlanPart } from '@/lib/types';
import AgentPlanBlock from '@/components/ask/AgentPlanBlock';
import { messages } from '@/lib/i18n';

/**
 * External agents stream a todo list; it used to be flattened into emoji text
 * inside the reply (spec-acp-first-agent-integration Phase 1c).
 */

const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: locale.value, t: messages.en }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function planOf(entries: AgentPlanPart['entries']): AgentPlanPart {
  return { type: 'agent-plan', runtime: 'acp', entries };
}

function render(part: AgentPlanPart) {
  act(() => root.render(<AgentPlanBlock part={part} />));
}

beforeEach(() => {
  locale.value = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('AgentPlanBlock', () => {
  it('shows every step and how many are done', () => {
    render(planOf([
      { content: 'Read the spec', status: 'completed' },
      { content: 'Write the parser', status: 'in_progress' },
      { content: 'Wire the UI', status: 'pending' },
    ]));

    expect(host.textContent).toContain('Read the spec');
    expect(host.textContent).toContain('Write the parser');
    expect(host.textContent).toContain('Wire the UI');
    expect(host.textContent).toContain('1/3');
  });

  it('stays open while work is in flight', () => {
    render(planOf([{ content: 'Step A', status: 'in_progress' }]));

    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses itself once every step is done, so finished turns stay compact', () => {
    render(planOf([{ content: 'Step A', status: 'completed' }]));

    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('Step A');
    expect(host.textContent).toContain('1/1');
  });

  it('lets the user reopen a finished plan', () => {
    render(planOf([{ content: 'Step A', status: 'completed' }]));
    act(() => { host.querySelector('button')!.click(); });

    expect(host.textContent).toContain('Step A');
  });

  it('renders nothing for an empty plan instead of an empty box', () => {
    render(planOf([]));

    expect(host.textContent).toBe('');
  });

  it('shows a single-step plan without odd pluralization', () => {
    render(planOf([{ content: 'Only step', status: 'pending' }]));

    expect(host.textContent).toContain('0/1');
  });

  it('keeps unicode and emoji step text intact', () => {
    render(planOf([{ content: '写测试 ✅', status: 'pending' }]));

    expect(host.textContent).toContain('写测试 ✅');
  });

  it('wraps a very long step rather than overflowing the chat column', () => {
    render(planOf([{ content: 'x'.repeat(1200), status: 'pending' }]));

    expect(host.querySelector('li span')?.className).toContain('break-words');
  });

  it('localizes its title for Chinese users', () => {
    locale.value = 'zh';
    render(planOf([{ content: 'Step', status: 'pending' }]));

    expect(host.textContent).toContain('计划');
  });
});
