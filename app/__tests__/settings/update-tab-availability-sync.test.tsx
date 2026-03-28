// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApiFetch = vi.fn();
const mockDispatchEvent = vi.spyOn(window, 'dispatchEvent');

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

vi.mock('@/lib/LocaleContext', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    t: {
      settings: {
        update: {
          checking: 'Checking for updates...',
          error: 'Failed to check for updates.',
          upToDate: "You're up to date",
          available: (current: string, latest: string) => `Update available: v${current} → v${latest}`,
          timeout: 'Update may still be in progress.',
          timeoutHint: 'The server may need more time to rebuild. Try refreshing.',
          refreshButton: 'Refresh Page',
          retryButton: 'Retry Update',
          releaseNotes: 'View release notes',
          hint: 'Updates are installed via npm. Equivalent to running',
          inTerminal: 'in your terminal.',
          checkButton: 'Check for Updates',
          updateButton: (latest: string) => `Update to v${latest}`,
          serverRestarting: 'Server is restarting, please wait...',
          updatingHint: 'This may take 1–3 minutes. Do not close this page.',
          updated: 'Updated successfully! Reloading...',
        },
      },
    },
  }),
}));

describe('Browser UpdateTab availability synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('persists the latest available version when a manual check finds an update', async () => {
    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    mockApiFetch.mockResolvedValue({
      current: '1.0.0',
      latest: '2.0.0',
      hasUpdate: true,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<UpdateTab />);
    });

    const checkButton = Array.from(host.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Check for Updates'),
    ) as HTMLButtonElement | undefined;
    expect(checkButton).toBeTruthy();

    await act(async () => {
      checkButton?.click();
      await Promise.resolve();
    });

    expect(localStorage.getItem('mindos_update_latest')).toBe('2.0.0');

    await act(async () => {
      root.unmount();
    });
  });

  it('dispatches an availability event so existing UI badges can react immediately', async () => {
    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    mockApiFetch.mockResolvedValue({
      current: '1.0.0',
      latest: '2.0.0',
      hasUpdate: true,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<UpdateTab />);
    });

    const checkButton = Array.from(host.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Check for Updates'),
    ) as HTMLButtonElement | undefined;
    expect(checkButton).toBeTruthy();

    await act(async () => {
      checkButton?.click();
      await Promise.resolve();
    });

    expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mindos:update-available' }));

    await act(async () => {
      root.unmount();
    });
  });
});
