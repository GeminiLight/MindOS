// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const mockBridge = {
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getAppInfo: vi.fn(),
  onUpdateProgress: vi.fn(),
  onUpdateReady: vi.fn(),
};

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
          desktopDownloading: 'Downloading update...',
          desktopReady: 'Update downloaded. Restart to apply.',
          desktopRestart: 'Restart Now',
          checkButton: 'Check for Updates',
          releaseNotes: 'View release notes',
          desktopHint: 'Updates are delivered through the Desktop app auto-updater.',
        },
      },
    },
  }),
}));

describe('Desktop UpdateTab error handling', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    mockBridge.getAppInfo.mockResolvedValue({ version: '0.1.0' });
    mockBridge.onUpdateProgress.mockReturnValue(() => {});
    mockBridge.onUpdateReady.mockReturnValue(() => {});

    (window as any).mindos = mockBridge;

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (window as any).mindos;
  });

  it('shows error state when installUpdate fails during download', async () => {
    mockBridge.checkUpdate.mockResolvedValue({ available: true, version: '0.2.0' });
    mockBridge.installUpdate.mockRejectedValue(new Error('Download failed'));

    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    await act(async () => { root.render(<UpdateTab />); });

    const updateBtn = Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Update to v0.2.0'));
    expect(updateBtn).toBeTruthy();

    await act(async () => { updateBtn!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toContain('Update failed');
  });

  it('shows error state when "Restart Now" fails', async () => {
    mockBridge.checkUpdate.mockResolvedValue({ available: true, version: '0.2.0' });
    mockBridge.installUpdate.mockRejectedValue(new Error('quitAndInstall failed'));

    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    await act(async () => { root.render(<UpdateTab />); });

    // Simulate reaching 'ready' state via onUpdateReady callback
    const readyCb = mockBridge.onUpdateReady.mock.calls[0]?.[0];
    expect(readyCb).toBeDefined();

    // First trigger download (to get to a state where 'ready' makes sense)
    mockBridge.installUpdate.mockResolvedValueOnce(undefined);
    const updateBtn = Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Update to v0.2.0'));
    expect(updateBtn).toBeTruthy();

    await act(async () => { updateBtn!.click(); });

    // Simulate update-ready event
    await act(async () => { readyCb(); });

    const restartBtn = Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Restart Now'));
    expect(restartBtn).toBeTruthy();

    // Now make installUpdate fail on the second call (Restart Now click)
    mockBridge.installUpdate.mockRejectedValue(new Error('quitAndInstall failed'));

    await act(async () => { restartBtn!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toContain('Failed to');
  });

  it('shows "up to date" when no update is available', async () => {
    mockBridge.checkUpdate.mockResolvedValue({ available: false });

    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    await act(async () => { root.render(<UpdateTab />); });

    expect(host.textContent).toContain("You're up to date");
  });

  it('resets state to idle on mount to clear stale state after app restart', async () => {
    // This test verifies the fix for: restart → 'state' still 'downloading' → button disabled
    mockBridge.checkUpdate.mockResolvedValue({ available: true, version: '0.2.0' });

    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    // First render (before restart)
    await act(async () => { root.render(<UpdateTab />); });

    const updateBtn = Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Update to v0.2.0'));
    expect(updateBtn).toBeTruthy();
    expect((updateBtn as HTMLButtonElement).disabled).toBe(false);

    // User clicks update, state becomes 'downloading'
    await act(async () => { updateBtn!.click(); });
    await act(async () => { await Promise.resolve(); });

    // In real scenario, app restarts here and component remounts
    // Unmount and create new root to simulate fresh load
    await act(async () => { root.unmount(); });
    host.remove();

    const newHost = document.createElement('div');
    document.body.appendChild(newHost);
    const newRoot = createRoot(newHost);

    await act(async () => { newRoot.render(<UpdateTab />); });

    // CRITICAL: After remount, the "Check for Updates" button should be ENABLED
    // (not disabled like before the fix)
    const checkBtn = Array.from(newHost.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Check for Updates'));
    expect(checkBtn).toBeTruthy();
    expect((checkBtn as HTMLButtonElement).disabled).toBe(false); // Must be enabled!

    await act(async () => { newRoot.unmount(); });
    newHost.remove();
  });
});
