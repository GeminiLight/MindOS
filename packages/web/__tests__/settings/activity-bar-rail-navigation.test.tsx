// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getRailPanelClickDecision, type PanelId, type RoutePanelId } from '@/lib/navigation-panel';

const mockRouterPush = vi.fn();
let mockPathname = '/';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    t: {
      sidebar: {
        files: 'Files',
        capture: 'Inbox',
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
  default: ({ children, href, onClick, onNavigate, ...props }: any) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;

        event.preventDefault();
        let navigatePrevented = false;
        onNavigate?.({ preventDefault: () => { navigatePrevented = true; } });
        if (!navigatePrevented && href) {
          mockRouterPush(String(href));
        }
      }}
    >
      {children}
    </a>
  ),
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
    paused: 'bg-[var(--amber)]',
    unknown: 'bg-[var(--amber)]',
    off: 'bg-muted',
  },
  getStatusLevel: (status: any) => {
    if (!status) return 'off';
    if (!status.enabled) return status.configured ? 'paused' : 'off';
    return 'synced';
  },
}));

const flushSmoothNavigation = () => act(async () => {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
});

function applyRailDecision(
  event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  activePanel: PanelId | null,
  targetPanel: RoutePanelId,
  onPanelChange: (panel: PanelId | null) => void,
) {
  const decision = getRailPanelClickDecision(mockPathname, activePanel, targetPanel);
  if (decision.preventDefault) event.preventDefault();
  onPanelChange(decision.nextPanel);
}

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

  it('does not render Search as a rail item', async () => {
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

    expect(host.querySelector('button[aria-label="Search"]')).toBeNull();
    expect(host.querySelector('[data-titlebar-search-trigger]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('shows Echo as a first-class rail destination without a labs flag', async () => {
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

    const echoButton = host.querySelector('[data-walkthrough="echo-panel"]');
    expect(echoButton).not.toBeNull();
    expect(echoButton?.getAttribute('href')).toBe('/echo/imprint');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('keeps the rail home row aligned with the titlebar height variable', async () => {
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
          expanded={false}
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const home = host.querySelector<HTMLButtonElement>('button[aria-label="MindOS Home"]');
    expect(home).not.toBeNull();
    expect(home!.className).toContain('h-[var(--app-titlebar-h)]');
    expect(home!.className).not.toContain('h-[46px]');
    expect((home!.style as unknown as Record<string, string>).WebkitAppRegion).toBe('no-drag');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('can suppress route-derived rail active state while Home navigation is pending', async () => {
    mockPathname = '/echo/imprint';
    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel={null}
          suppressRouteActive
          onPanelChange={vi.fn()}
          syncStatus={null}
          expanded={false}
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const echoButton = host.querySelector('[data-walkthrough="echo-panel"]');
    expect(echoButton).not.toBeNull();
    expect(echoButton?.getAttribute('data-hit-active')).toBeNull();
    expect(echoButton?.getAttribute('aria-current')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('clicking the rail logo from Echo opens Home instead of Echo or Wiki', async () => {
    mockPathname = '/echo/imprint';
    const mockPanelChange = vi.fn();
    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="echo"
          onPanelChange={mockPanelChange}
          syncStatus={null}
          expanded={false}
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const home = host.querySelector<HTMLButtonElement>('button[aria-label="MindOS Home"]');
    expect(home).not.toBeNull();

    await act(async () => {
      home?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockPanelChange).toHaveBeenCalledWith(null);
    await flushSmoothNavigation();
    expect(mockRouterPush).toHaveBeenCalledWith('/');
    expect(mockRouterPush).not.toHaveBeenCalledWith('/wiki');
    expect(mockRouterPush).not.toHaveBeenCalledWith('/echo/imprint');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('keeps Settings shortcut out of the expanded rail row', async () => {
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

    const settingsButton = host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    expect(settingsButton).not.toBeNull();
    expect(settingsButton?.textContent).toContain('Settings');
    expect(settingsButton?.textContent).not.toContain('⌘,');

    await act(async () => {
      root.unmount();
    });
    host.remove();
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
          onSpacesClick={(event) => applyRailDecision(event, 'files', 'files', mockPanelChange)}
        />,
      );
    });

    // Find and click the Files button
    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');
    expect(filesButton).not.toBeNull();

    await act(async () => {
      filesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

  it('clicking Settings action invokes the settings handler', async () => {
    const mockSettingsClick = vi.fn();
    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="files"
          onPanelChange={vi.fn()}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={mockSettingsClick}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const settingsButton = host.querySelector('button[aria-label="Settings"]');
    expect(settingsButton).not.toBeNull();

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockSettingsClick).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('shows Plugin Entries as an action only when plugin entries are available', async () => {
    const mockPluginEntriesClick = vi.fn();
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
          onPluginEntriesClick={mockPluginEntriesClick}
          pluginEntriesAvailable={false}
          onSyncClick={vi.fn()}
        />,
      );
    });

    expect(host.querySelector('button[aria-label="Plugin Entries"]')).toBeNull();

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="files"
          onPanelChange={mockPanelChange}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onPluginEntriesClick={mockPluginEntriesClick}
          pluginEntriesAvailable
          onSyncClick={vi.fn()}
        />,
      );
    });

    const pluginEntriesButton = host.querySelector('button[aria-label="Plugin Entries"]');
    expect(pluginEntriesButton).not.toBeNull();

    await act(async () => {
      pluginEntriesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockPluginEntriesClick).toHaveBeenCalledTimes(1);
    expect(mockPanelChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    host.remove();
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
          onSpacesClick={(event) => applyRailDecision(event, 'files', 'files', mockPanelChange)}
        />,
      );
    });

    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');
    expect(filesButton).not.toBeNull();

    await act(async () => {
      filesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
    });

    // On /wiki with files already active, should toggle off
    expect(mockPanelChange).toHaveBeenCalledWith(null);
    expect(mockRouterPush).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('clicking Inbox opens the Inbox workbench as a first-class rail destination', async () => {
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
        />,
      );
    });

    const captureButton = host.querySelector('[data-walkthrough="capture-page"]');
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
    });

    expect(captureButton?.getAttribute('href')).toBe('/capture');
    expect(mockPanelChange).toHaveBeenCalledWith('capture');

    await act(async () => {
      root.unmount();
    });
  });

  it('clicking collapsed Inbox rail button on Mind opens the Inbox workbench', async () => {
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
          expanded={false}
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const captureButton = host.querySelector('[data-walkthrough="capture-page"]');
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(captureButton?.getAttribute('href')).toBe('/capture');
    expect(mockPanelChange).toHaveBeenCalledWith('capture');

    await act(async () => {
      root.unmount();
    });
  });

  it('places Inbox above Files in the rail', async () => {
    mockPathname = '/capture';

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

    const captureButton = host.querySelector('[data-walkthrough="capture-page"]');
    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');

    expect(captureButton).not.toBeNull();
    expect(filesButton).not.toBeNull();
    expect(
      captureButton!.compareDocumentPosition(filesButton!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it('does not keep Files highlighted on the Inbox route', async () => {
    mockPathname = '/capture';

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="capture"
          onPanelChange={vi.fn()}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');
    const captureButton = host.querySelector('[data-walkthrough="capture-page"]');

    expect(filesButton?.getAttribute('aria-current')).toBeNull();
    expect(captureButton?.getAttribute('aria-current')).toBe('page');
    expect(captureButton?.hasAttribute('aria-pressed')).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it('optimistically highlights Inbox after clicking it from Mind before the route commits', async () => {
    mockPathname = '/wiki';

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="capture"
          onPanelChange={vi.fn()}
          syncStatus={null}
          expanded={false}
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const captureButton = host.querySelector('[data-walkthrough="capture-page"]');
    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');

    expect(captureButton?.className).toContain('text-[var(--amber)]');
    expect(captureButton?.getAttribute('aria-current')).toBeNull();
    expect(filesButton?.getAttribute('aria-current')).toBe('page');

    await act(async () => {
      root.unmount();
    });
  });

  it('allows leaving Inbox with an immediate rail click instead of swallowing the next destination', async () => {
    mockPathname = '/wiki';
    const mockPanelChange = vi.fn();
    const mockSpacesClick = vi.fn(() => {
      mockPanelChange('files');
      mockRouterPush('/wiki');
    });

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
          onSpacesClick={mockSpacesClick}
        />,
      );
    });

    const captureButton = host.querySelector('[data-walkthrough="capture-page"]');
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(captureButton?.getAttribute('href')).toBe('/capture');
    expect(mockPanelChange).toHaveBeenCalledWith('capture');

    mockPathname = '/capture';
    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="capture"
          onPanelChange={mockPanelChange}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
          onSpacesClick={mockSpacesClick}
        />,
      );
    });

    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');
    expect(filesButton).not.toBeNull();

    await act(async () => {
      filesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockSpacesClick).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith('/wiki');

    await act(async () => {
      root.unmount();
    });
  });

  it('clicking collapsed Mind rail button on Inbox invokes the spaces navigation callback', async () => {
    mockPathname = '/capture';
    const mockPanelChange = vi.fn();
    const mockSpacesClick = vi.fn(() => {
      mockPanelChange('files');
      mockRouterPush('/wiki');
    });

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="capture"
          onPanelChange={mockPanelChange}
          syncStatus={null}
          expanded={false}
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
          onSpacesClick={mockSpacesClick}
        />,
      );
    });

    const filesButton = host.querySelector('[data-walkthrough="files-panel"]');
    expect(filesButton).not.toBeNull();

    await act(async () => {
      filesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockSpacesClick).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith('/wiki');

    await act(async () => {
      root.unmount();
    });
  });

  it('allows leaving Inbox for another workbench without waiting for the debounce window', async () => {
    mockPathname = '/capture';
    const mockPanelChange = vi.fn();
    const mockAgentsClick = vi.fn(() => {
      mockPanelChange('agents');
      mockRouterPush('/agents');
    });

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="capture"
          onPanelChange={mockPanelChange}
          onAgentsClick={mockAgentsClick}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const captureButton = host.querySelector('[data-walkthrough="capture-page"]');
    const agentsButton = host.querySelector('[data-walkthrough="agents-panel"]');
    expect(captureButton).not.toBeNull();
    expect(agentsButton).not.toBeNull();

    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      agentsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockAgentsClick).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith('/agents');

    await act(async () => {
      root.unmount();
    });
  });

  it('prevents a repeated active route click from bypassing the route handler', async () => {
    mockPathname = '/agents/codex';
    const mockPanelChange = vi.fn();
    const mockAgentsClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
      applyRailDecision(event, 'agents', 'agents', mockPanelChange);
    });

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="agents"
          onPanelChange={mockPanelChange}
          onAgentsClick={mockAgentsClick}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const agentsButton = host.querySelector('[data-walkthrough="agents-panel"]');
    expect(agentsButton).not.toBeNull();

    await act(async () => {
      agentsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      agentsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockAgentsClick).toHaveBeenCalledTimes(1);
    expect(mockPanelChange).toHaveBeenCalledWith('agents');
    expect(mockRouterPush).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('uses the shared rail decision when no route callback is provided', async () => {
    mockPathname = '/agents/codex';
    const mockPanelChange = vi.fn();

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="agents"
          onPanelChange={mockPanelChange}
          syncStatus={null}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const agentsButton = host.querySelector('[data-walkthrough="agents-panel"]');
    expect(agentsButton).not.toBeNull();

    await act(async () => {
      agentsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(mockPanelChange).toHaveBeenCalledWith('agents');
    expect(mockRouterPush).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('exposes sync popover state on the sync rail trigger', async () => {
    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel={null}
          onPanelChange={vi.fn()}
          syncStatus={{ enabled: true, remote: 'origin' } as any}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
          syncPopoverOpen
          syncPopoverId="test-sync-popover"
        />,
      );
    });

    const syncButton = host.querySelector('[aria-label="Sync"]');
    expect(syncButton?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(syncButton?.getAttribute('aria-expanded')).toBe('true');
    expect(syncButton?.getAttribute('aria-controls')).toBe('test-sync-popover');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the sync rail trigger visible for paused configured repositories', async () => {
    const ActivityBar = (await import('@/components/ActivityBar')).default;
    const onSyncClick = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel={null}
          onPanelChange={vi.fn()}
          syncStatus={{ enabled: false, configured: true, remote: 'origin' } as any}
          expanded
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={onSyncClick}
        />,
      );
    });

    expect(host.querySelector('[aria-label="Sync"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the sync rail trigger visible before sync is configured', async () => {
    const ActivityBar = (await import('@/components/ActivityBar')).default;
    const onSyncClick = vi.fn();

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
          onSyncClick={onSyncClick}
        />,
      );
    });

    const syncButton = host.querySelector('[aria-label="Sync"]') as HTMLButtonElement | null;
    expect(syncButton).not.toBeNull();
    expect(syncButton?.querySelector('.rounded-full')).toBeNull();

    await act(async () => {
      syncButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onSyncClick).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
    });
  });

  it('marks Agents active and exposes a stable /agents rail href', async () => {
    mockPathname = '/agents';

    const ActivityBar = (await import('@/components/ActivityBar')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ActivityBar
          activePanel="agents"
          onPanelChange={vi.fn()}
          syncStatus={null}
          expanded={false}
          onExpandedChange={vi.fn()}
          onSettingsClick={vi.fn()}
          onSyncClick={vi.fn()}
        />,
      );
    });

    const agentsButton = host.querySelector('[data-walkthrough="agents-panel"]');
    expect(agentsButton?.getAttribute('href')).toBe('/agents');
    expect(agentsButton?.getAttribute('aria-current')).toBe('page');

    await act(async () => {
      root.unmount();
    });
  });
});
