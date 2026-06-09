// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

describe('useSyncAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('uses the long sync timeout for manual sync actions', async () => {
    const { useSyncAction } = await import('@/lib/sync-status-store');
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockApiFetch.mockResolvedValue({});

    function Harness() {
      const { syncNow } = useSyncAction(refresh);
      return <button type="button" onClick={() => void syncNow()}>sync</button>;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      method: 'POST',
      timeout: 120_000,
    }));
    expect(refresh).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps failed sync action errors visible to the caller', async () => {
    const { useSyncAction } = await import('@/lib/sync-status-store');
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockApiFetch.mockRejectedValue(new Error('push failed'));

    function Harness() {
      const { syncNow, syncError } = useSyncAction(refresh);
      return (
        <div>
          <button type="button" onClick={() => void syncNow()}>sync</button>
          <p>{syncError}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('push failed');
    expect(refresh).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('shares in-flight sync state across every sync action entry point', async () => {
    const { useSyncAction } = await import('@/lib/sync-status-store');
    let resolveSync!: () => void;
    mockApiFetch.mockReturnValue(new Promise(resolve => {
      resolveSync = () => resolve({});
    }));
    const refresh = vi.fn().mockResolvedValue(undefined);

    function Harness() {
      const first = useSyncAction(refresh);
      const second = useSyncAction(refresh);
      return (
        <div>
          <button type="button" onClick={() => void first.syncNow()}>first</button>
          <button type="button" onClick={() => void second.syncNow()}>second</button>
          <p>{first.syncing ? 'first syncing' : 'first idle'}</p>
          <p>{second.syncing ? 'second syncing' : 'second idle'}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.textContent).toContain('first syncing');
    expect(host.textContent).toContain('second syncing');

    await act(async () => {
      resolveSync();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('first idle');
    expect(host.textContent).toContain('second idle');

    await act(async () => {
      root.unmount();
    });
  });

  it('deduplicates same-tick sync actions across entry points', async () => {
    const { useSyncAction } = await import('@/lib/sync-status-store');
    let resolveSync!: () => void;
    mockApiFetch.mockReturnValue(new Promise(resolve => {
      resolveSync = () => resolve({});
    }));
    const refresh = vi.fn().mockResolvedValue(undefined);

    function Harness() {
      const first = useSyncAction(refresh);
      const second = useSyncAction(refresh);
      return (
        <div>
          <button type="button" onClick={() => void first.syncNow()}>first</button>
          <button type="button" onClick={() => void second.syncNow()}>second</button>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      const buttons = host.querySelectorAll('button');
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSync();
      await Promise.resolve();
      await Promise.resolve();
      root.unmount();
    });
  });

  it('does not flash success when the refreshed status contains conflicts', async () => {
    const { fetchSharedSyncStatus, resetSyncStatusStoreForTests, useSyncAction } = await import('@/lib/sync-status-store');
    resetSyncStatusStoreForTests();
    mockApiFetch
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [{ file: 'notes/today.md', time: '2026-06-05T10:00:00.000Z' }],
        lastError: null,
      });

    function Harness() {
      const { syncNow, syncResult } = useSyncAction(() => fetchSharedSyncStatus({ force: true }));
      return (
        <div>
          <button type="button" onClick={() => void syncNow()}>sync</button>
          <p>{syncResult ?? 'none'}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('none');
    expect(host.textContent).not.toContain('success');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not flash success when the refreshed status contains lastError', async () => {
    const { fetchSharedSyncStatus, resetSyncStatusStoreForTests, useSyncAction } = await import('@/lib/sync-status-store');
    resetSyncStatusStoreForTests();
    mockApiFetch
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '0',
        conflicts: [],
        lastError: 'Push failed: auth denied',
      });

    function Harness() {
      const { syncNow, syncResult, syncError } = useSyncAction(() => fetchSharedSyncStatus({ force: true }));
      return (
        <div>
          <button type="button" onClick={() => void syncNow()}>sync</button>
          <p>{syncResult ?? 'none'}</p>
          <p>{syncError}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('error');
    expect(host.textContent).toContain('Push failed: auth denied');
    expect(host.textContent).not.toContain('success');

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces refresh failure after a successful sync POST instead of flashing success', async () => {
    const { fetchSharedSyncStatus, resetSyncStatusStoreForTests, useSyncAction } = await import('@/lib/sync-status-store');
    resetSyncStatusStoreForTests();
    mockApiFetch
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('status refresh failed'));

    function Harness() {
      const { syncNow, syncResult, syncError } = useSyncAction(() => fetchSharedSyncStatus({ force: true }));
      return (
        <div>
          <button type="button" onClick={() => void syncNow()}>sync</button>
          <p>{syncResult ?? 'none'}</p>
          <p>{syncError}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('error');
    expect(host.textContent).toContain('status refresh failed');
    expect(host.textContent).not.toContain('success');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not flash success when the refreshed status cannot confirm unpushed changes', async () => {
    const { fetchSharedSyncStatus, resetSyncStatusStoreForTests, useSyncAction } = await import('@/lib/sync-status-store');
    resetSyncStatusStoreForTests();
    mockApiFetch
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        enabled: true,
        remote: 'git@github.com:me/mind.git',
        branch: 'main',
        lastSync: null,
        unpushed: '?',
        conflicts: [],
        lastError: null,
      });

    function Harness() {
      const { syncNow, syncResult } = useSyncAction(() => fetchSharedSyncStatus({ force: true }));
      return (
        <div>
          <button type="button" onClick={() => void syncNow()}>sync</button>
          <p>{syncResult ?? 'none'}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('none');
    expect(host.textContent).not.toContain('success');

    await act(async () => {
      root.unmount();
    });
  });

  it('normalizes legacy sync status payloads before exposing them to subscribers', async () => {
    const { fetchSharedSyncStatus, resetSyncStatusStoreForTests, useSyncStatus } = await import('@/lib/sync-status-store');
    resetSyncStatusStoreForTests();
    mockApiFetch.mockResolvedValueOnce({
      enabled: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: 'not-a-date',
      unpushed: 2,
      conflicts: ['notes/today.md', { file: 'notes/other.md', time: 'bad-date' }],
      lastError: null,
    });

    await act(async () => {
      await fetchSharedSyncStatus({ force: true });
    });
    mockApiFetch.mockResolvedValue({
      enabled: true,
      remote: 'git@github.com:me/mind.git',
      branch: 'main',
      lastSync: null,
      unpushed: '2',
      conflicts: [{ file: 'notes/today.md' }, { file: 'notes/other.md' }],
      lastError: null,
    });

    function Harness() {
      const { status } = useSyncStatus();
      return (
        <div>
          <p>{status?.lastSync === null ? 'lastSync null' : status?.lastSync}</p>
          <p>{status?.unpushed}</p>
          <p>{status?.conflicts?.map(conflict => `${conflict.file}:${conflict.time ?? 'no-time'}`).join('|')}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(host.textContent).toContain('lastSync null');
    expect(host.textContent).toContain('2');
    expect(host.textContent).toContain('notes/today.md:no-time');
    expect(host.textContent).toContain('notes/other.md:no-time');
    expect(host.textContent).not.toContain('bad-date');

    await act(async () => {
      root.unmount();
    });
  });
});
