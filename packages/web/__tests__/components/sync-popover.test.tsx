// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n';
import type { SyncStatus } from '@/components/settings/types';

const mocks = vi.hoisted(() => ({
  syncNow: vi.fn(),
  locale: 'en',
  t: undefined as unknown,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: mocks.locale,
    t: mocks.t,
    setLocale: vi.fn(),
  }),
}));

vi.mock('@/lib/sync-status-store', () => ({
  useSyncAction: () => ({
    syncing: false,
    syncResult: null,
    syncError: null,
    syncNow: mocks.syncNow,
  }),
}));

const baseStatus: SyncStatus = {
  enabled: true,
  provider: 'git',
  remote: 'git@github.com:me/mind.git',
  branch: 'main',
  lastSync: '2026-06-08T00:00:00.000Z',
  lastPull: null,
  unpushed: '0',
  conflicts: [],
  lastError: null,
  autoCommitInterval: 30,
  autoPullInterval: 300,
};

function anchorRect(): DOMRect {
  return {
    x: 0,
    y: 40,
    width: 40,
    height: 40,
    top: 40,
    left: 0,
    right: 40,
    bottom: 80,
    toJSON: () => ({}),
  } as DOMRect;
}

async function renderPopover(props: Partial<React.ComponentProps<typeof import('@/components/panels/SyncPopover').default>> = {}) {
  const SyncPopover = (await import('@/components/panels/SyncPopover')).default;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  const onOpenSyncSettings = vi.fn();
  const onSyncStatusRefresh = vi.fn().mockResolvedValue(undefined);

  await act(async () => {
    root.render(
      <SyncPopover
        open
        anchorRect={anchorRect()}
        railWidth={48}
        syncStatus={baseStatus}
        onClose={onClose}
        onOpenSyncSettings={onOpenSyncSettings}
        onSyncStatusRefresh={onSyncStatusRefresh}
        {...props}
      />,
    );
    await Promise.resolve();
  });

  return { host, root, onClose, onOpenSyncSettings, onSyncStatusRefresh };
}

describe('SyncPopover', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.locale = 'en';
    mocks.t = messages.en;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns conflict state into a settings recovery action instead of Sync Now', async () => {
    const { host, root, onClose, onOpenSyncSettings } = await renderPopover({
      syncStatus: {
        ...baseStatus,
        conflicts: [{ file: 'notes/today.md', time: '2026-06-08T00:00:00.000Z' }],
        lastError: 'network down',
        unpushed: '2',
      },
    });

    expect(host.textContent).toContain('Resolve 1 conflicts');
    expect(host.textContent).not.toContain('Sync now');

    const resolveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Resolve 1 conflicts'));
    await act(async () => {
      resolveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.syncNow).not.toHaveBeenCalled();
    expect(onOpenSyncSettings).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('retries stale status refresh instead of starting a sync', async () => {
    const { host, root, onSyncStatusRefresh } = await renderPopover({ syncStale: true });

    expect(host.textContent).toContain('Sync status stale');
    const retryButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Retry'));

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSyncStatusRefresh).toHaveBeenCalledOnce();
    expect(mocks.syncNow).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('uses localized sync copy and relative time in Chinese', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T00:05:00.000Z'));
    mocks.locale = 'zh';
    mocks.t = messages.zh;

    const { host, root } = await renderPopover();

    expect(host.textContent).toContain('已同步 · 5 分钟前');
    expect(host.textContent).toContain('立即同步');
    expect(host.textContent).toContain('打开设置');
    expect(host.textContent).not.toContain('5m ago');
    expect(host.textContent).not.toContain('Sync now');
    expect(host.textContent).not.toContain('Open settings');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
