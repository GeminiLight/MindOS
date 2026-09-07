// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import EchoTransferQueue from '@/components/echo/learning/EchoTransferQueue';
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en' }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const row = { id: 'transfer-' + '1'.repeat(24), learningId: 'learn-' + '2'.repeat(24), title: 'Evidence and conclusions', stage: 'waiting', version: 4, updatedAt: '2026-09-01T00:00:00Z', dueAt: '2026-09-07T00:00:00Z', status: 'due' };
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('links directly to the saved practice and refreshes completed items away without claiming growth', async () => {
  let practices = [row];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ practices, unavailableCount: 0 })));
  await act(async () => root.render(<EchoTransferQueue />));
  const link = host.querySelector('a')!; expect(link.href).toContain('learning=' + row.learningId + '&practice=1');
  expect(host.textContent).toContain('Ready to return'); expect(host.textContent).toContain('Illustrative practice');
  practices = [];
  await act(async () => window.dispatchEvent(new Event('mindos:transfer-updated')));
  expect(host.querySelector('a')).toBeNull(); expect(host.textContent).toContain('No pending practice');
});
it('preserves the last known list on failure and exposes retry and partial-read warnings', async () => {
  let fail = false;
  vi.stubGlobal('fetch', vi.fn(async () => { if (fail) throw new Error('offline'); return Response.json({ practices: [row], unavailableCount: 1 }); }));
  await act(async () => root.render(<EchoTransferQueue />));
  expect(host.textContent).toContain('Some records could not be read');
  fail = true; await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.querySelector('a')).not.toBeNull(); expect(host.querySelector('[role=alert]')).not.toBeNull();
  fail = false; await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role=alert]')).toBeNull();
});
it('updates scheduled entries from server state while visible and ignores an older response', async () => {
  vi.useFakeTimers();
  const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  try {
    let resolveOld!: (response: Response) => void; let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 2) return new Promise<Response>(resolve => { resolveOld = resolve; });
      return Response.json({ practices: [{ ...row, status: calls === 1 ? 'scheduled' : 'due' }], unavailableCount: 0 });
    }));
    await act(async () => root.render(<EchoTransferQueue />));
    expect(host.textContent).toContain('Scheduled');
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.textContent).toContain('Ready to return');
    await act(async () => resolveOld(Response.json({ practices: [], unavailableCount: 0 })));
    expect(host.querySelector('a')).not.toBeNull();
  } finally {
    vi.useRealTimers();
    if (original) Object.defineProperty(document, 'visibilityState', original);
    else Reflect.deleteProperty(document, 'visibilityState');
  }
});
