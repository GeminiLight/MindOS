// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const mockFetchStatus = vi.fn();
const mockSyncNow = vi.fn();
const syncStatusMock = vi.hoisted(() => ({
  status: {
    enabled: true,
    configured: true,
    remote: 'git@example.com:mind/repo.git',
    branch: 'main',
    conflicts: [] as Array<{ file: string; time: string }>,
    lastError: null as string | null,
    lastSync: '2026-06-08T00:00:00.000Z' as string | null,
    unpushed: '0',
  },
  loaded: true,
  error: 'status request failed' as string | null,
  stale: true,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    t: {
      sidebar: {
        sync: {
          syncStale: 'Sync status stale',
          syncStaleHint: 'MindOS could not refresh sync status.',
          retry: 'Retry',
          syncNow: 'Sync now',
        },
      },
    },
  }),
}));

vi.mock('@/lib/sync-status-store', () => ({
  useSyncStatus: () => ({
    status: syncStatusMock.status,
    loaded: syncStatusMock.loaded,
    error: syncStatusMock.error,
    stale: syncStatusMock.stale,
    fetchStatus: mockFetchStatus,
  }),
  useSyncAction: () => ({
    syncing: false,
    syncResult: null,
    syncError: null,
    syncNow: mockSyncNow,
  }),
}));

describe('SyncStatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    syncStatusMock.status = {
      enabled: true,
      configured: true,
      remote: 'git@example.com:mind/repo.git',
      branch: 'main',
      conflicts: [],
      lastError: null,
      lastSync: '2026-06-08T00:00:00.000Z',
      unpushed: '0',
    };
    syncStatusMock.loaded = true;
    syncStatusMock.error = 'status request failed';
    syncStatusMock.stale = true;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('retries status refresh instead of starting sync when the status is stale', async () => {
    const SyncStatusBar = (await import('@/components/SyncStatusBar')).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncStatusBar onOpenSyncSettings={vi.fn()} />);
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="Retry"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockFetchStatus).toHaveBeenCalledTimes(1);
    expect(mockSyncNow).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the quick action as manual sync when auto-sync is paused', async () => {
    syncStatusMock.status = {
      ...syncStatusMock.status,
      enabled: false,
      configured: true,
      lastSync: '2026-06-08T00:00:00.000Z',
      unpushed: '0',
    };
    syncStatusMock.error = null;
    syncStatusMock.stale = false;

    const SyncStatusBar = (await import('@/components/SyncStatusBar')).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SyncStatusBar onOpenSyncSettings={vi.fn()} />);
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="Sync now"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockFetchStatus).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders a mobile error indicator when sync status cannot load', async () => {
    const { MobileSyncDot } = await import('@/components/SyncStatusBar');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<MobileSyncDot status={null} loadError="server unavailable" />);
      await Promise.resolve();
    });

    expect(host.querySelector('.bg-error')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the mobile sync entry visible when sync is off or already synced', async () => {
    const { MobileSyncDot } = await import('@/components/SyncStatusBar');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<MobileSyncDot status={null} />);
      await Promise.resolve();
    });
    expect(host.querySelector('svg')).toBeTruthy();

    await act(async () => {
      root.render(<MobileSyncDot status={{
        enabled: true,
        configured: true,
        remote: 'git@example.com:mind/repo.git',
        branch: 'main',
        conflicts: [],
        lastError: null,
        lastSync: '2026-06-08T00:00:00.000Z',
        unpushed: '0',
      }} />);
      await Promise.resolve();
    });
    expect(host.querySelector('svg')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it('derives specific mobile sync labels for assistive technology', async () => {
    const { getMobileSyncLabel } = await import('@/components/SyncStatusBar');

    expect(getMobileSyncLabel({
      status: {
        enabled: true,
        configured: true,
        remote: 'git@example.com:mind/repo.git',
        branch: 'main',
        conflicts: [{ file: 'notes/today.md' }],
        lastError: null,
        lastSync: null,
        unpushed: '0',
      },
      syncT: {
        resolveConflicts: 'Resolve {n} conflicts',
      },
      prefix: 'Sync',
    })).toBe('Sync: Resolve 1 conflicts');

    expect(getMobileSyncLabel({
      status: null,
      loadError: 'server unavailable',
      syncT: {
        syncError: 'Sync status unavailable',
      },
      prefix: 'Sync',
    })).toBe('Sync: Sync status unavailable');

    expect(getMobileSyncLabel({
      status: {
        enabled: true,
        configured: true,
        remote: 'git@example.com:mind/repo.git',
        branch: 'main',
        conflicts: [],
        lastError: null,
        lastSync: '2026-06-08T00:00:00.000Z',
        unpushed: '0',
      },
      stale: true,
      loadError: 'server unavailable',
      syncT: {
        syncStale: 'Sync status stale',
      },
      prefix: 'Sync',
    })).toBe('Sync: Sync status stale');
  });
});
