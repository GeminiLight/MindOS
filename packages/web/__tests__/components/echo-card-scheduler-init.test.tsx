// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EchoCardSchedulerInit from '@/components/echo/EchoCardSchedulerInit';
import { ECHO_CARDS_UPDATED_EVENT } from '@/lib/echo-card-events';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'zh' }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushAsyncWork(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe('EchoCardSchedulerInit', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/echo/cards?')) {
        const segment = new URL(url, 'http://localhost').searchParams.get('segment');
        return jsonResponse({
          state: {
            schedule: {
              due: segment === 'imprint' || segment === 'promotion',
            },
          },
          cards: [],
        });
      }
      if (url === '/api/echo/cards' && init?.method === 'POST') {
        return jsonResponse({ ok: true, cards: [] });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('auto-generates only due Echo card segments and announces refreshed cards', async () => {
    const updatedSegments: string[] = [];
    const onUpdated = (event: Event) => {
      updatedSegments.push((event as CustomEvent<{ segment?: string }>).detail?.segment ?? '');
    };
    window.addEventListener(ECHO_CARDS_UPDATED_EVENT, onUpdated);

    await act(async () => {
      root = createRoot(container);
      root.render(<EchoCardSchedulerInit />);
      await flushAsyncWork();
    });

    window.removeEventListener(ECHO_CARDS_UPDATED_EVENT, onUpdated);

    const statusUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/echo/cards?segment='));
    expect(statusUrls).toEqual([
      '/api/echo/cards?segment=imprint',
      '/api/echo/cards?segment=insight',
      '/api/echo/cards?segment=promotion',
    ]);

    const generationCalls = fetchMock.mock.calls.filter(([url, init]) => (
      url === '/api/echo/cards' && init?.method === 'POST'
    ));
    expect(generationCalls).toHaveLength(2);
    expect(generationCalls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { segment: 'imprint', trigger: 'auto', locale: 'zh' },
      { segment: 'promotion', trigger: 'auto', locale: 'zh' },
    ]);
    expect(updatedSegments).toEqual(['imprint', 'promotion']);
  });

  it('runs again on the visible polling interval', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<EchoCardSchedulerInit />);
      await flushAsyncWork();
    });
    const initialCalls = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await flushAsyncWork();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
