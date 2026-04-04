// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    t: {
      sidebar: {
        files: 'Files',
        searchTitle: 'Search',
        echo: 'Echo',
        agents: 'Agents',
        discover: 'Discover',
        help: 'Help',
        settingsTitle: 'Settings',
        syncLabel: 'Sync',
      },
    },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock('@/components/SyncStatusBar', () => ({
  DOT_COLORS: {
    synced: 'bg-success',
    syncing: 'bg-[var(--amber)]',
    error: 'bg-error',
    conflicts: 'bg-error',
    off: 'bg-muted',
  },
  getStatusLevel: () => 'synced',
}));

describe('ActivityBar update badge synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hasUpdate: false, current: '1.0.0', latest: '1.0.0' }),
    }));
  });

  it('reacts immediately to update-available events from the current tab', async () => {
    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel={null}
          onPanelChange={vi.fn()}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    expect(host.querySelectorAll('.bg-error').length).toBe(0);

    await act(async () => {
      localStorage.setItem('mindos_update_latest', '2.0.0');
      window.dispatchEvent(new Event('mindos:update-available'));
      await Promise.resolve();
    });

    expect(host.querySelectorAll('.bg-error').length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      root.unmount();
    });
  });
});
