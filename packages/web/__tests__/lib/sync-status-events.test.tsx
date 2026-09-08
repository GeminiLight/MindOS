// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const apiFetchMock = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import {
  SYNC_STATUS_POLL_INTERVAL_MS,
  resetSyncStatusStoreForTests,
  useSyncStatus,
} from '@/lib/sync-status-store';
import { resetServerEventsForTests } from '@/lib/server-events';
import { MockEventSource, setDocumentVisibility } from '../fixtures/mock-event-source';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const { status } = useSyncStatus();
  return <p>{status?.branch ?? 'none'}</p>;
}

describe('sync-status-store server event refreshes', () => {
  let host: HTMLDivElement;
  let root: Root | null = null;
  let branch = 'main';

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    resetServerEventsForTests();
    resetSyncStatusStoreForTests();
    vi.stubGlobal('EventSource', MockEventSource);
    setDocumentVisibility('visible');
    branch = 'main';
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async () => ({
      enabled: true,
      remote: 'git@github.com:me/mind.git',
      branch,
      lastSync: null,
      unpushed: '0',
      conflicts: [],
      lastError: null,
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    root = null;
    host.remove();
    resetSyncStatusStoreForTests();
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount() {
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness />);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('re-fetches the sync status when the server reports sync.changed', async () => {
    await mount();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('main');
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });

    branch = 'feature';
    await act(async () => {
      source.emit('sync.changed', { type: 'sync.changed' }, 2);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe('feature');
  });

  it('keeps only a five minute safety poll and stays quiet for 35 idle seconds', async () => {
    expect(SYNC_STATUS_POLL_INTERVAL_MS).toBe(5 * 60_000);
    await mount();
    MockEventSource.last().ready({ lastEventId: 1 });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_INTERVAL_MS - 35_000);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes after a reconnect that could not replay the gap', async () => {
    await mount();
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });
    await act(async () => {
      source.emit('ready', { type: 'ready', lastEventId: 80, resync: true }, 80);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('closes the stream when the last subscriber unmounts', async () => {
    await mount();
    const source = MockEventSource.last();
    await act(async () => {
      root!.unmount();
    });
    root = null;
    expect(source.closed).toBe(true);
  });
});
