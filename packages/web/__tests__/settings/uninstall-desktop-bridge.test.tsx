// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UninstallTab } from '@/components/settings/UninstallTab';
import { messages } from '@/lib/i18n';

vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en', t: messages.en }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const copy = messages.en.settings.uninstall;
const fetchMock = vi.fn();
const uninstallApp = vi.fn();
let root: Root;
let host: HTMLDivElement;
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label)!;
const option = (label: string) => Array.from(host.querySelectorAll<HTMLInputElement>('input')).find(input => input.closest('label')?.textContent?.includes(label))!;
async function click(label: string) { await act(async () => button(label).click()); }
async function confirm() { await click(copy.confirmButton); await click(copy.confirmButton); }

beforeEach(async () => {
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
  uninstallApp.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(window, { mindos: { uninstallApp } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<UninstallTab />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (window as unknown as { mindos?: unknown }).mindos;
  vi.unstubAllGlobals();
});

it('waits for server acknowledgement before calling Desktop removal and reports submission only after its acknowledgement', async () => {
  let acknowledgeServer!: (response: Response) => void;
  let acknowledgeDesktop!: (response: { ok: boolean }) => void;
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => { acknowledgeServer = resolve; }));
  uninstallApp.mockImplementation(() => new Promise<{ ok: boolean }>(resolve => { acknowledgeDesktop = resolve; }));
  await confirm();
  expect(fetchMock).toHaveBeenCalledWith('/api/uninstall', expect.objectContaining({ method: 'POST', body: JSON.stringify({ removeConfig: false }) }));
  expect(uninstallApp).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(copy.running);
  await act(async () => acknowledgeServer(new Response(JSON.stringify({ ok: true }))));
  expect(uninstallApp).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="status"]')?.textContent).toContain(copy.running);
  expect(host.textContent).not.toContain(copy.successDesktop);
  await act(async () => acknowledgeDesktop({ ok: true }));
  expect(host.querySelector('[role="status"]')?.textContent).toContain(copy.successDesktop);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['negative acknowledgement', 'rejection'])('preserves options and offers review after Desktop bridge %s', async failure => {
  const error = 'Desktop removal was denied';
  if (failure === 'negative acknowledgement') uninstallApp.mockResolvedValue({ ok: false, error });
  else uninstallApp.mockRejectedValue(new Error(error));
  await act(async () => option(copy.removeConfig).click());
  await confirm();
  expect(uninstallApp).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(copy.error);
  expect(host.textContent).toContain(error);
  expect(host.textContent).not.toContain(copy.successDesktop);
  await click(copy.reviewOptions);
  expect(option(copy.removeConfig).checked).toBe(true);
  expect(option(copy.removeApp).checked).toBe(true);
  expect(document.activeElement).toBe(button(copy.confirmButton));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(uninstallApp).toHaveBeenCalledTimes(1);
});
