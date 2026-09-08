// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SessionContextDock from '@/components/ask/SessionContextDock';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(async () => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ spaces: [] }) });
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<SessionContextDock session={null} workDirEditable={false} onSetWorkDir={() => true} onSetContextSelection={() => true} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function open() { await act(async () => button('Context').click()); }
async function showSpaces() { await act(async () => button('Add Space').click()); }

it('labels the default context without presenting empty selections as status counters', () => {
  expect(button('Context').textContent).toContain('Context');
  expect(button('Context').textContent).toContain('Mind');
  expect(button('Context').textContent).not.toContain('0');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('announces loading rather than no matches while the space catalog is pending', async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  await open(); await showSpaces();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Loading spaces');
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).not.toContain('No matches');
});

it.each(['headers', 'body'])('offers retry when space catalog %s time out after fifteen seconds', async stage => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | undefined;
  fetchMock.mockImplementation((_url: string, options: RequestInit) => {
    requestSignal = options.signal ?? undefined;
    const stalled = new Promise<never>((_resolve, reject) => {
      requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true });
    });
    return stage === 'headers' ? stalled : Promise.resolve({ ok: true, json: () => stalled });
  });
  await open(); await showSpaces();
  await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
  expect(requestSignal?.aborted).toBe(false);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Loading spaces');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(requestSignal?.aborted).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not load spaces');
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).not.toContain('No matches');
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ spaces: [{ path: 'Recovered', name: 'Recovered catalog' }] })));
  await act(async () => button('Retry loading spaces').click());
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).toContain('Recovered catalog');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it.each(['success', 'failure'])('ignores a late catalog %s after closing and reopening the context', async outcome => {
  let oldSignal: AbortSignal | undefined;
  let resolveOld!: (response: Response) => void;
  let rejectOld!: (error: Error) => void;
  fetchMock.mockImplementationOnce((_url: string, options: RequestInit) => {
    oldSignal = options.signal ?? undefined;
    // Deliberately ignore abort so the component must also reject stale results.
    return new Promise<Response>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
  });
  await open(); await showSpaces();
  await act(async () => button('Close context').click());
  expect(oldSignal?.aborted).toBe(true);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ spaces: [{ path: 'Current', name: 'Current catalog' }] })));
  await open(); await showSpaces();
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).toContain('Current catalog');
  await act(async () => {
    if (outcome === 'success') resolveOld(new Response(JSON.stringify({ spaces: [{ path: 'Old', name: 'Obsolete catalog' }] })));
    else rejectOld(new Error('Obsolete request failed'));
  });
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).toContain('Current catalog');
  expect(document.body.textContent).not.toContain('Obsolete');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  { ok: false, status: 503, json: async () => ({ error: 'private server detail' }) },
  { ok: true, json: async () => ({ wrong: [] }) },
  { ok: true, json: async () => ({ spaces: [{ path: 'Research', name: 7 }] }) },
  { ok: true, json: async () => ({ spaces: [{ path: '   ' }] }) },
  { ok: true, json: async () => { throw new SyntaxError('private broken JSON'); } },
])('keeps catalog failures distinct from empty results and supports retry', async response => {
  fetchMock.mockResolvedValue(response);
  await open(); await showSpaces();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not load spaces');
  expect(document.body.textContent).not.toContain('private');
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).not.toContain('No matches');
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ spaces: [{ name: 'Research', path: 'Research' }] }) });
  await act(async () => button('Retry loading spaces').click());
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).toContain('Research');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('moves focus inside the named popup and restores it after Escape', async () => {
  const trigger = button('Context'); trigger.focus(); await open();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  const popup = document.querySelector('[role="dialog"]');
  expect(popup).not.toBeNull();
  expect(popup?.contains(document.activeElement)).toBe(true);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});

it('aborts an unfinished catalog request on unmount', async () => {
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementation((_url: string, options: RequestInit) => { signal = options?.signal ?? undefined; return new Promise(() => {}); });
  await open();
  await act(async () => root.unmount());
  expect(signal?.aborted).toBe(true);
});

it('closes the inner picker before the context popup and returns focus to Add Space', async () => {
  await open(); await showSpaces();
  await act(async () => document.querySelector('input[aria-label="Search spaces"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(button('Context').getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('[data-session-context-picker="spaces"]')).toBeNull();
  expect(document.activeElement).toBe(button('Add Space'));
});

it('shows an empty result only after the catalog successfully returns no spaces', async () => {
  await open(); await showSpaces();
  expect(document.querySelector('[data-session-context-picker="spaces"]')?.textContent).toContain('No matches');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="status"]')).toBeNull();
});
