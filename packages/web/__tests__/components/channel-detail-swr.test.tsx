// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AgentsContentChannelDetail from '@/components/agents/AgentsContentChannelDetail';
import { clearChannelCache, setCachedStatuses } from '@/components/agents/channel-detail/cache';
import type { PlatformStatus } from '@/lib/im/platforms';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/stores/locale-store', async () => {
  const { messages } = await import('@/lib/i18n');
  return { useLocale: () => ({ locale: 'en', t: messages.en }) };
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const connectedTelegram: PlatformStatus = {
  platform: 'telegram',
  connected: true,
  botName: 'Cached Bot',
  capabilities: ['text'],
} as PlatformStatus;

const disconnectedTelegram: PlatformStatus = {
  platform: 'telegram',
  connected: false,
  capabilities: ['text'],
} as PlatformStatus;

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('AgentsContentChannelDetail stale-while-revalidate', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearChannelCache();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('revalidates activities when the shared status cache is fresh but the activity cache is missing', async () => {
    setCachedStatuses([connectedTelegram]);
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/im/status')) return Promise.resolve(jsonResponse({ platforms: [connectedTelegram] }));
      if (url.includes('/api/im/activity')) {
        return Promise.resolve(jsonResponse({
          activities: [{
            id: 'a1', platform: 'telegram', type: 'test', status: 'success',
            recipient: '12345', messageSummary: 'Hello from revalidation',
            timestamp: '2026-04-10T10:00:00.000Z',
          }],
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => { root.render(<AgentsContentChannelDetail platformId="telegram" />); });
    await flush();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/im/activity?platform=telegram'))).toBe(true);
    expect(host.textContent).toContain('Hello from revalidation');
  });

  it('clears the refreshing spinner when a background revalidation fails', async () => {
    setCachedStatuses([connectedTelegram]);
    const seededAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(seededAt + 10 * 60_000);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'boom' }, false))));

    await act(async () => { root.render(<AgentsContentChannelDetail platformId="telegram" />); });
    await flush();

    // Cached data stays on screen, but the spinner must not stick around.
    expect(host.textContent).toContain('Cached Bot');
    expect(host.querySelector('.animate-spin')).toBeNull();
  });

  it('ignores a stale in-flight response after a newer request has resolved', async () => {
    setCachedStatuses([connectedTelegram]);
    const seededAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(seededAt + 10 * 60_000);

    const slowStatus = deferred<ReturnType<typeof jsonResponse>>();
    const slowActivity = deferred<ReturnType<typeof jsonResponse>>();
    let statusCalls = 0;
    let activityCalls = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/api/im/config') && init?.method === 'DELETE') return Promise.resolve(jsonResponse({ ok: true }));
      if (url.includes('/api/im/status')) {
        statusCalls += 1;
        if (statusCalls === 1) return slowStatus.promise;
        return Promise.resolve(jsonResponse({ platforms: [disconnectedTelegram] }));
      }
      if (url.includes('/api/im/activity')) {
        activityCalls += 1;
        if (activityCalls === 1) return slowActivity.promise;
        return Promise.resolve(jsonResponse({ activities: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => { root.render(<AgentsContentChannelDetail platformId="telegram" />); });
    await flush();
    expect(host.textContent).toContain('Cached Bot');

    // Disconnect (two clicks: arm + confirm) → onDisconnected → fresh non-background fetch.
    const disconnectButton = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Disconnect'))!;
    expect(disconnectButton).toBeTruthy();
    await act(async () => { disconnectButton.click(); });
    await act(async () => { disconnectButton.click(); });
    await flush();
    await flush();

    expect(host.textContent).not.toContain('Cached Bot');

    // The stale background request now resolves with the old connected snapshot.
    slowStatus.resolve(jsonResponse({ platforms: [connectedTelegram] }));
    slowActivity.resolve(jsonResponse({
      activities: [{
        id: 'stale', platform: 'telegram', type: 'test', status: 'success',
        recipient: '1', messageSummary: 'Stale hello', timestamp: '2026-04-10T10:00:00.000Z',
      }],
    }));
    await flush();
    await flush();

    expect(host.textContent).not.toContain('Stale hello');
    expect(host.textContent).not.toContain('Cached Bot');
  });
});
