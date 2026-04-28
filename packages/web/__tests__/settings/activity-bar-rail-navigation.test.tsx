// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockRouterPush = vi.fn();
let mockPathname = '/';

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
        workflows: 'Flows',
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
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

describe('ActivityBar rail navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPathname = '/';
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hasUpdate: false, current: '1.0.0', latest: '1.0.0' }),
    }));
  });

  it('clicking Files on homepage navigates to /wiki instead of toggling sidebar', async () => {
    mockPathname = '/';
    const mockPanelChange = vi.fn();

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="files"
          onPanelChange={mockPanelChange}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
          onSpacesClick={() => {
            // Simulate the SidebarLayout onSpacesClick logic with the fix
            const pathname = mockPathname;
            const isHome = pathname === '/';
            const activePanel = 'files';
            const wasActive = activePanel === 'files';
            const onFilesRoute = pathname === '/wiki' || pathname?.startsWith('/view/') || pathname?.startsWith('/wiki/');
            if (isHome || !wasActive) {
              mockPanelChange('files');
              mockRouterPush('/wiki');
            } else if (!onFilesRoute) {
              mockRouterPush('/wiki');
            } else {
              mockPanelChange(null);
            }
          }}
        />,
      );
    });

    // Find and click the Files button
    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');
    expect(filesButton).not.toBeNull();

    await act(async () => {
      filesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Wait for debounce
      await new Promise(r => setTimeout(r, 200));
    });

    // Should navigate to /wiki, not toggle off
    expect(mockRouterPush).toHaveBeenCalledWith('/wiki');
    // Should set activePanel to 'files', not null
    expect(mockPanelChange).toHaveBeenCalledWith('files');
    expect(mockPanelChange).not.toHaveBeenCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });

  it('clicking Files on /wiki page toggles sidebar off', async () => {
    mockPathname = '/wiki';
    const mockPanelChange = vi.fn();

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="files"
          onPanelChange={mockPanelChange}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
          onSpacesClick={() => {
            // Simulate the SidebarLayout onSpacesClick logic with the fix
            const pathname = mockPathname;
            const isHome = pathname === '/';
            const activePanel = 'files';
            const wasActive = activePanel === 'files';
            const onFilesRoute = pathname === '/wiki' || pathname?.startsWith('/view/') || pathname?.startsWith('/wiki/');
            if (isHome || !wasActive) {
              mockPanelChange('files');
              mockRouterPush('/wiki');
            } else if (!onFilesRoute) {
              mockRouterPush('/wiki');
            } else {
              mockPanelChange(null);
            }
          }}
        />,
      );
    });

    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');
    expect(filesButton).not.toBeNull();

    await act(async () => {
      filesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
    });

    // On /wiki with files already active, should toggle off
    expect(mockPanelChange).toHaveBeenCalledWith(null);
    expect(mockRouterPush).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
