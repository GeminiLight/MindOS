// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { apiFetch } from '@/lib/api';
import { __resetCoreUpdateStoreForTests } from '@/lib/stores/core-update-store';

const mockBridge = {
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getAppInfo: vi.fn(),
  onUpdateAvailable: vi.fn(),
  onUpdateProgress: vi.fn(),
  onUpdateReady: vi.fn(),
  onUpdateError: vi.fn(),
  // Core hot-update surface: present so the panel renders the product card.
  checkCoreUpdate: vi.fn(),
  downloadCoreUpdate: vi.fn(),
  applyCoreUpdate: vi.fn(),
  getCoreUpdatePending: vi.fn(),
  onCoreUpdateProgress: vi.fn(),
  onCoreUpdateAvailable: vi.fn(),
  onUpdateInstalling: vi.fn(),
};

let updateAvailableHandler: ((info: {
  version?: string;
  canInstall?: boolean;
  unsupportedReason?: string;
  manualUrl?: string;
}) => void) | null = null;

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {},
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    t: {
      settings: {
        update: {
          checking: 'Checking for updates...',
          error: 'Failed to check for updates.',
          upToDate: "You're up to date",
          checkButton: 'Check for Updates',
          releaseNotes: 'View release notes',
          desktopReady: 'Update downloaded. Restart to apply.',
          desktopRestart: 'Restart Now',
          retryButton: 'Retry Update',
          coreFetching: (v: string) => `Fetching v${v} in the background`,
          coreReadyAuto: (v: string) => `v${v} ready - applies on next restart`,
          coreApplyNow: 'Apply now',
          coreApplyHint: 'Restarts services in a few seconds',
          coreApplying: 'Applying update...',
          coreError: 'Core update failed.',
          coreRetry: 'Retry',
          coreDesktopTooOld: (v: string) => `v${v} requires a newer Desktop version.`,
          coreDesktopTooOldHint: 'Please update MindOS Desktop first.',
          coreAutoHint: 'Core updates complete in the background.',
          shellRowLabel: 'Desktop shell',
          shellLatest: 'Latest',
          shellCheck: 'Check',
          shellBannerTitle: (v: string) => `New app version v${v} available`,
          shellErrorTitle: 'Desktop update failed',
          shellBannerDesc: 'Requires downloading and restarting the app.',
          shellBannerAction: 'Download & Restart',
        },
      },
    },
  }),
}));

const NOOP = () => () => {};

describe('Desktop UpdateTab: redesigned panel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetCoreUpdateStoreForTests();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    updateAvailableHandler = null;

    mockBridge.getAppInfo.mockResolvedValue({ version: '0.4.0', mode: 'local' });
    mockBridge.checkUpdate.mockResolvedValue({ available: false });
    mockBridge.onUpdateAvailable.mockImplementation((cb: NonNullable<typeof updateAvailableHandler>) => {
      updateAvailableHandler = cb;
      return () => {};
    });
    mockBridge.onUpdateProgress.mockImplementation(NOOP);
    mockBridge.onUpdateReady.mockImplementation(NOOP);
    mockBridge.onUpdateInstalling.mockImplementation(NOOP);
    mockBridge.onUpdateError.mockImplementation(NOOP);
    mockBridge.onCoreUpdateProgress.mockImplementation(NOOP);
    mockBridge.onCoreUpdateAvailable.mockImplementation(NOOP);
    mockBridge.getCoreUpdatePending.mockResolvedValue({ version: null });
    mockBridge.checkCoreUpdate.mockResolvedValue({
      available: false, currentVersion: '1.1.10', latestVersion: '1.1.10',
      urls: [], size: 0, sha256: '', minDesktopVersion: '0.1.0', desktopTooOld: false,
    });

    (window as any).mindos = mockBridge;

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (window as any).mindos;
    __resetCoreUpdateStoreForTests();
  });

  async function renderTab() {
    const { UpdateTab } = await import('@/components/settings/UpdateTab');
    await act(async () => { root.render(<UpdateTab />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it('shows the single MindOS product version with the shell demoted to a row', async () => {
    await renderTab();
    expect(host.textContent).toContain('MindOS');
    expect(host.textContent).toContain('v1.1.10');       // product/core version headline
    expect(host.textContent).toContain('Desktop shell'); // demoted secondary row
    expect(host.textContent).toContain('v0.4.0');         // shell version on the row
    expect(host.textContent).toContain("You're up to date");
  });

  it('does not run the browser update check when the Desktop bridge is present', async () => {
    await renderTab();

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('silently downloads an available Core update and offers Apply now', async () => {
    mockBridge.checkCoreUpdate.mockResolvedValue({
      available: true, currentVersion: '1.1.10', latestVersion: '1.1.11',
      urls: ['https://cdn/x.tgz'], size: 3_400_000, sha256: 'abc', minDesktopVersion: '0.1.0', desktopTooOld: false,
    });
    await renderTab();

    expect(mockBridge.downloadCoreUpdate).toHaveBeenCalledWith(['https://cdn/x.tgz'], '1.1.11', 3_400_000, 'abc');
    expect(host.textContent).toContain('ready');
    const applyBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Apply now'));
    expect(applyBtn).toBeTruthy();

    mockBridge.applyCoreUpdate.mockResolvedValue({ ok: true, version: '1.1.11' });
    await act(async () => { applyBtn!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(mockBridge.applyCoreUpdate).toHaveBeenCalledTimes(1);
  });

  it('blocks auto-download behind the compatibility gate when the shell is too old', async () => {
    mockBridge.checkCoreUpdate.mockResolvedValue({
      available: true, currentVersion: '1.1.10', latestVersion: '1.1.11',
      urls: ['u'], size: 1, sha256: 's', minDesktopVersion: '0.5.0', desktopTooOld: true,
    });
    await renderTab();

    expect(mockBridge.downloadCoreUpdate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('requires a newer Desktop');
    expect(host.textContent).toContain('0.5.0');
  });

  it('escalates a shell update to the banner with a Download & Restart action', async () => {
    mockBridge.checkUpdate.mockResolvedValue({ available: true, version: '0.5.0' });
    await renderTab();

    expect(host.textContent).toContain('New app version v0.5.0 available');
    const dlBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Download & Restart'));
    expect(dlBtn).toBeTruthy();

    await act(async () => { dlBtn!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(mockBridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows shell check failures instead of hiding them behind the compact row', async () => {
    mockBridge.checkUpdate.mockResolvedValue({ available: false, error: 'GitHub Releases unavailable' });
    await renderTab();

    expect(host.textContent).toContain('Desktop update failed');
    expect(host.textContent).toContain('GitHub Releases unavailable');
    const retryBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Retry Update'));
    expect(retryBtn).toBeTruthy();

    mockBridge.checkUpdate.mockClear();
    await act(async () => { retryBtn!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(mockBridge.checkUpdate).toHaveBeenCalledTimes(1);
    expect(mockBridge.installUpdate).not.toHaveBeenCalled();
  });

  it('recovers a stale shell error when an update-available event arrives later', async () => {
    mockBridge.checkUpdate.mockResolvedValue({ available: false, error: 'GitHub Releases unavailable' });
    await renderTab();
    expect(host.textContent).toContain('Desktop update failed');

    await act(async () => {
      updateAvailableHandler?.({ version: '0.5.0' });
    });

    expect(host.textContent).not.toContain('Desktop update failed');
    expect(host.textContent).toContain('New app version v0.5.0 available');
    expect(host.textContent).toContain('Download & Restart');
  });

  it('lets the user manually re-check Core via the card button', async () => {
    await renderTab();
    const checkBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Check for Updates'));
    expect(checkBtn).toBeTruthy();
    expect((checkBtn as HTMLButtonElement).disabled).toBe(false);

    mockBridge.checkCoreUpdate.mockClear();
    await act(async () => { checkBtn!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(mockBridge.checkCoreUpdate).toHaveBeenCalled();
  });
});
