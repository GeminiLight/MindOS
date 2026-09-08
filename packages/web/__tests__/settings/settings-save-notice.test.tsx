// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n';
import type { SettingsData } from '@/components/settings/types';

const saveApi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ apiFetch: saveApi }));
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ t: messages.en, locale: 'en' }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let store: typeof import('@/components/settings/settings-draft').settingsDraftStore;
let Notice: typeof import('@/components/settings/SettingsSaveNotice').default;
const value: SettingsData = { ai: { activeProvider: 'private-provider', providers: [{ id: 'private-provider', name: 'Private', protocol: 'openai', apiKey: 'secret-must-not-appear', model: 'example-model', baseUrl: '' }] }, mindRoot: '/private/knowledge' };

beforeEach(async () => {
  vi.resetModules(); saveApi.mockReset(); localStorage.clear(); sessionStorage.clear();
  store = (await import('@/components/settings/settings-draft')).settingsDraftStore;
  Notice = (await import('@/components/settings/SettingsSaveNotice')).default;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function failSave() {
  saveApi.mockRejectedValue(new Error('Server includes secret-must-not-appear'));
  await act(async () => { store.update(value, 'knowledge'); await store.flush(); });
}

it('shows a persistent, non-secret recovery notice outside the closed settings editor', async () => {
  const open = vi.fn();
  await act(async () => root.render(<Notice editing={false} onOpen={open} />));
  await failSave();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Settings were not saved');
  expect(host.textContent).not.toContain('secret-must-not-appear');
  expect(host.textContent).not.toContain('/private/knowledge');
  const review = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Review settings')!;
  await act(async () => review.click());
  expect(open).toHaveBeenCalledWith('knowledge');
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

it('keeps recovery feedback visible during retry and removes it after success', async () => {
  await act(async () => root.render(<Notice editing={false} onOpen={vi.fn()} />));
  await failSave();
  let finish!: () => void;
  saveApi.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const retry = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Retry save')!;
  expect(retry).toBeTruthy();
  await act(async () => { retry.click(); retry.click(); });
  expect(host.textContent).toContain('Retrying settings save');
  expect(retry.disabled).toBe(true);
  expect(saveApi).toHaveBeenCalledTimes(2);
  await act(async () => { finish(); await store.flush(); });
  expect(host.textContent).toBe('');
});

it('does not duplicate the visible form error but still protects unsaved changes', async () => {
  await act(async () => root.render(<Notice editing onOpen={vi.fn()} />));
  await failSave();
  expect(host.textContent).toBe('');
  const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  saveApi.mockResolvedValue({});
  await act(async () => store.flush());
  const savedLeaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedLeaving);
  expect(savedLeaving.defaultPrevented).toBe(false);
});

it('keeps the ordinary successful save path free of a flashing banner', async () => {
  await act(async () => root.render(<Notice editing={false} onOpen={vi.fn()} />));
  saveApi.mockResolvedValue({});
  await act(async () => { store.update(value, 'ai'); await store.flush(); });
  expect(host.textContent).toBe('');
});
