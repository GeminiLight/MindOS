// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModeCapsule, { getPersistedPermissionChoice } from '@/components/ask/ModeCapsule';
import { messages } from '@/lib/i18n';

/**
 * One ladder replaces the old 「模式」+「权限」pair. Plan belongs here because
 * the server already forces a plan run to read-only, so keeping it in a
 * separate control made the permission capsule display a level the run did not
 * actually use.
 */

const locale = vi.hoisted(() => ({ value: 'zh' }));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: locale.value, t: messages.en }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function render(choice: Parameters<typeof ModeCapsule>[0]['choice'], onChange = vi.fn()) {
  act(() => root.render(<ModeCapsule choice={choice} onChange={onChange} />));
  return onChange;
}

function openMenu() {
  act(() => { host.querySelector('button')!.click(); });
}

function optionNodes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** Each option renders its label in a bold span, with the description below. */
function optionLabels(): string[] {
  return optionNodes().map(node => node.querySelector('span.font-medium')?.textContent?.trim() ?? '');
}

beforeEach(() => {
  locale.value = 'zh';
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('permission capsule ladder', () => {
  it('offers one ladder from least to most capable, with plan in it', () => {
    render('ask');
    openMenu();

    expect(optionLabels()).toEqual(['只读', '计划', '询问', '自动', '完全']);
  });

  it('reports the level the user picked', () => {
    const onChange = render('ask');
    openMenu();
    const planOption = optionNodes().find(node => node.textContent?.includes('计划'));
    act(() => { planOption!.click(); });

    expect(onChange).toHaveBeenCalledWith('plan');
  });

  it('shows plan as the current level once chosen, rather than a permission name', () => {
    render('plan');

    expect(host.textContent).toContain('计划');
  });

  it('remembers the level across sessions, including plan', () => {
    const onChange = render('ask');
    openMenu();
    const planOption = optionNodes().find(node => node.textContent?.includes('计划'));
    act(() => { planOption!.click(); });

    expect(getPersistedPermissionChoice()).toBe('plan');
    expect(onChange).toHaveBeenCalledWith('plan');
  });

  it('starts at ask when nothing was stored, the safe middle of the ladder', () => {
    expect(getPersistedPermissionChoice()).toBe('ask');
  });

  it('ignores a corrupted stored level instead of breaking the composer', () => {
    localStorage.setItem('mindos-permission-level.v1', '{{{');
    expect(getPersistedPermissionChoice()).toBe('ask');

    localStorage.setItem('mindos-permission-level.v1', 'nonsense');
    expect(getPersistedPermissionChoice()).toBe('ask');
  });

  it('keeps the English labels readable for non-Chinese users', () => {
    locale.value = 'en';
    render('ask');
    openMenu();

    expect(optionLabels()).toEqual(['Read only', 'Plan', 'Ask', 'Auto', 'Full']);
  });
});
