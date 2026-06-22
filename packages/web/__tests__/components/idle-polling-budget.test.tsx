// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const apiFetchMock = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/lib/stores/locale-store', async () => {
  const { en } = await import('@/lib/i18n/messages-en');
  return { useLocale: () => ({ t: en, locale: 'en' }) };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/echo/imprint',
}));

import EchoSidebarStats from '@/components/panels/EchoSidebarStats';
import ChangesBanner from '@/components/changes/ChangesBanner';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function renderComponent(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
}

function emitFilesChanged() {
  window.dispatchEvent(new Event('mindos:files-changed'));
}

beforeEach(() => {
  vi.useFakeTimers();
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/monitoring')) return { knowledgeBase: { fileCount: 3 } };
    if (url.startsWith('/api/changes')) return { events: [], unreadCount: 0 };
    if (url.startsWith('/api/agent/sessions')) return [];
    return {};
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  host?.remove();
  vi.useRealTimers();
});

describe('idle polling budget (35s 空闲请求数 ≤10 的支撑契约)', () => {
  it('EchoSidebarStats is disabled and makes no idle requests', async () => {
    await renderComponent(<EchoSidebarStats />);
    await act(() => vi.advanceTimersByTimeAsync(50));
    const initialCalls = apiFetchMock.mock.calls.length;
    expect(initialCalls).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(35_000));
    expect(apiFetchMock.mock.calls.length).toBe(initialCalls);
  });

  it('EchoSidebarStats ignores files-changed events after the Recent section was removed', async () => {
    await renderComponent(<EchoSidebarStats />);
    await act(() => vi.advanceTimersByTimeAsync(50));
    const initialCalls = apiFetchMock.mock.calls.length;

    emitFilesChanged();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(apiFetchMock.mock.calls.length).toBe(initialCalls);
  });

  it('ChangesBanner stays quiet for 35 idle seconds after the initial load', async () => {
    await renderComponent(<ChangesBanner />);
    await act(() => vi.advanceTimersByTimeAsync(50));
    const initialCalls = apiFetchMock.mock.calls.length;
    expect(initialCalls).toBe(2);

    await act(() => vi.advanceTimersByTimeAsync(35_000));
    expect(apiFetchMock.mock.calls.length).toBe(initialCalls);
  });

  it('ChangesBanner refetches the unread summary on a files-changed event', async () => {
    await renderComponent(<ChangesBanner />);
    await act(() => vi.advanceTimersByTimeAsync(50));
    const initialCalls = apiFetchMock.mock.calls.length;

    emitFilesChanged();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(apiFetchMock.mock.calls.length).toBe(initialCalls + 2);
  });

  it('ChangesBanner links unread agent changes to the scoped review surface', async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/changes?op=summary') {
        return { unreadCount: 1, totalCount: 1, lastSeenAt: '2026-06-22T00:00:00.000Z' };
      }
      if (url.startsWith('/api/changes?') && url.includes('source=agent')) {
        return {
          events: [{
            id: 'agent-1',
            ts: '2026-06-22T00:01:00.000Z',
            op: 'update_lines',
            path: 'Research/notes.md',
            source: 'agent',
            summary: 'Updated lines 1-2',
          }],
        };
      }
      return {};
    });

    await renderComponent(<ChangesBanner />);
    await act(() => vi.advanceTimersByTimeAsync(50));

    expect(host.textContent).toContain('1 agent change pending review in 1 file');
    const link = host.querySelector<HTMLAnchorElement>('a[href^="/changelog?source=agent"]');
    expect(link?.getAttribute('href')).toBe('/changelog?source=agent');
  });

  it('SidebarLayout tree-version poll runs at most every 15s (own writes arrive via events)', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../components/SidebarLayout.tsx'),
      'utf-8',
    );
    const m = src.match(/POLL_INTERVAL_MS = (\d+_?\d*)/);
    expect(m, 'SidebarLayout must define POLL_INTERVAL_MS').toBeTruthy();
    expect(Number(m![1].replace('_', ''))).toBeGreaterThanOrEqual(15_000);
  });
});
