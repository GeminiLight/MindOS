// @vitest-environment jsdom
import React, { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AppearanceTab } from '@/components/settings/AppearanceTab';
import { en } from '@/lib/i18n/messages-en';

it('hydrates default preferences before restoring saved theme and language', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  const view = <AppearanceTab font="inter" setFont={vi.fn()} fontSize="15px" setFontSize={vi.fn()} contentWidth="80%" setContentWidth={vi.fn()} dark={false} setDark={vi.fn()} locale="en" setLocale={vi.fn()} t={en} />;
  const host = document.createElement('div');
  host.innerHTML = renderToString(view);
  document.body.append(host);
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('locale', 'zh');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let root: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { root = hydrateRoot(host, view); });
    expect(errors.mock.calls.flat().join(' ')).not.toContain('hydrated');
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.find(b => b.textContent === en.settings.appearance.dark)?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons.find(b => b.textContent === '中文')?.getAttribute('aria-pressed')).toBe('true');
  } finally {
    await act(async () => root!.unmount());
    errors.mockRestore(); host.remove(); localStorage.clear();
  }
});
