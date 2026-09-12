// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsContent from '@/components/settings/SettingsContent';

const mocks = vi.hoisted(() => ({ push: vi.fn(), api: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: mocks.api }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/stores/locale-store', async () => {
  const { en } = await import('@/lib/i18n/messages-en');
  return { useLocale: () => ({ t: en, locale: 'en', setLocale: vi.fn() }) };
});
vi.mock('@/components/settings/AiTab', () => ({ AiTab: () => <div>AI content</div> }));
vi.mock('@/components/settings/AppearanceTab', () => ({ AppearanceTab: () => <div>Appearance content</div> }));
vi.mock('@/components/settings/KnowledgeTab', () => ({ KnowledgeTab: () => null }));
vi.mock('@/components/settings/NavigationTab', () => ({ NavigationTab: () => null }));
vi.mock('@/components/settings/SyncTab', () => ({ SyncTab: () => null }));
vi.mock('@/components/settings/McpTab', () => ({ McpTab: () => null }));
vi.mock('@/components/settings/PluginsTab', () => ({ PluginsTab: () => null }));
vi.mock('@/components/settings/UpdateTab', () => ({ UpdateTab: () => null }));
vi.mock('@/components/settings/UninstallTab', () => ({ UninstallTab: () => null }));

describe('full settings page navigation', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.api.mockResolvedValue({ ai: { providers: [], activeProvider: '' }, envOverrides: {} });
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('opens the linked category and exposes every category in a labelled mobile selector', async () => {
    await act(async () => root.render(<SettingsContent visible variant="page" initialTab="appearance" />));
    expect(host.querySelector('h1')?.textContent).toBe('Settings');
    expect(host.textContent).toContain('Appearance content');
    const select = host.querySelector('[role=combobox][aria-label="Settings category"]') as HTMLButtonElement;
    expect(select).not.toBeNull();
    expect(select.textContent).toContain('Appearance');
    await act(async () => select.click());
    expect(host.querySelectorAll('[role=option]')).toHaveLength(9);
    expect(document.getElementById(select.getAttribute('aria-activedescendant')!)?.textContent).toContain('Appearance');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('updates the URL when a category is chosen and follows browser navigation back to the default', async () => {
    await act(async () => root.render(<SettingsContent visible variant="page" />));
    const link = host.querySelector('a[href="/settings?tab=appearance"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    await act(async () => link.click());
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(mocks.push).toHaveBeenCalledWith('/settings?tab=appearance');
    expect(host.textContent).toContain('Appearance content');
    await act(async () => root.render(<SettingsContent visible variant="page" initialTab="appearance" />));
    await act(async () => root.render(<SettingsContent visible variant="page" initialTab={undefined} />));
    expect(host.textContent).toContain('AI content');
    expect(host.textContent).not.toContain('Appearance content');
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('keeps panel category changes local to the current workspace', async () => {
    await act(async () => root.render(<SettingsContent visible variant="panel" />));
    const button = Array.from(host.querySelectorAll('button')).find(el => el.textContent === 'Appearance')!;
    await act(async () => button.click());
    expect(host.textContent).toContain('Appearance content');
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
