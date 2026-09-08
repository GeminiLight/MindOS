// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FILES_CHANGED_EVENT } from '@/lib/files-changed';
import { resetServerEventsForTests } from '@/lib/server-events';
import { FALLBACK_POLL_INTERVAL_MS, REFRESH_COOLDOWN_MS, useTreeVersionSync } from '@/hooks/useTreeVersionSync';
import { MockEventSource, setDocumentVisibility } from '../fixtures/mock-event-source';

vi.mock('@/lib/telemetry', () => ({
  telemetry: { startTimer: () => () => {} },
}));

vi.mock('@/lib/scroll-preservation', () => ({
  refreshPreservingDocumentScroll: (refresh: () => void) => refresh(),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ router }: { router: { refresh: () => void } }) {
  useTreeVersionSync(router);
  return null;
}

describe('useTreeVersionSync', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;
  let serverVersion = 1;
  const router = { refresh: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    resetServerEventsForTests();
    vi.stubGlobal('EventSource', MockEventSource);
    setDocumentVisibility('visible');
    router.refresh.mockReset();
    serverVersion = 1;
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ v: serverVersion }) }));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container.remove();
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount() {
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness router={router} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  function treeVersionRequests(): number {
    return fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/tree-version')).length;
  }

  it('refreshes the router when a tree.changed frame reports a new version', async () => {
    await mount();
    expect(treeVersionRequests()).toBe(1); // mount baseline
    const source = MockEventSource.last();
    await act(async () => {
      source.ready({ lastEventId: 3, treeVersion: 1 });
    });
    expect(router.refresh).not.toHaveBeenCalled();

    await act(async () => {
      source.emit('tree.changed', { type: 'tree.changed', version: 2 }, 4);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      source.emit('tree.changed', { type: 'tree.changed', version: 2 }, 5);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('issues no tree-version requests while the stream is connected (idle-polling budget)', async () => {
    await mount();
    MockEventSource.last().ready({ lastEventId: 1, treeVersion: 1 });
    expect(treeVersionRequests()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(treeVersionRequests()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS * 2);
    });
    expect(treeVersionRequests()).toBe(1);
  });

  it('falls back to a 60s poll when EventSource is unsupported and refreshes on a changed version', async () => {
    vi.stubGlobal('EventSource', undefined);
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const filesChanged = vi.fn();
    window.addEventListener(FILES_CHANGED_EVENT, filesChanged);

    await mount();
    expect(treeVersionRequests()).toBe(1);

    serverVersion = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS - 1);
    });
    expect(treeVersionRequests()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(treeVersionRequests()).toBe(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(filesChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener(FILES_CHANGED_EVENT, filesChanged);
  });

  it('polls only while disconnected when the stream drops', async () => {
    await mount();
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1, treeVersion: 1 });

    await act(async () => {
      source.fail();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    });
    // Reconnect attempts run on their own backoff; the poll fires because the
    // mock never opens the replacement socket.
    expect(treeVersionRequests()).toBe(2);
  });

  it('treats the ready frame after a reconnect as a version signal', async () => {
    await mount();
    MockEventSource.last().ready({ lastEventId: 1, treeVersion: 1 });
    await act(async () => {
      MockEventSource.last().fail();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      MockEventSource.last().ready({ lastEventId: 7, resync: true, treeVersion: 5 });
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('spaces refreshes by the cooldown during bursts', async () => {
    await mount();
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1, treeVersion: 1 });

    await act(async () => {
      source.emit('tree.changed', { type: 'tree.changed', version: 2 }, 2);
      source.emit('tree.changed', { type: 'tree.changed', version: 3 }, 3);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_COOLDOWN_MS);
    });
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it('skips the fallback poll while the document is hidden', async () => {
    vi.stubGlobal('EventSource', undefined);
    delete (globalThis as { EventSource?: unknown }).EventSource;
    await mount();
    expect(treeVersionRequests()).toBe(1);
    setDocumentVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS * 3);
    });
    expect(treeVersionRequests()).toBe(1);
    await act(async () => {
      setDocumentVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(treeVersionRequests()).toBe(2);
  });
});
