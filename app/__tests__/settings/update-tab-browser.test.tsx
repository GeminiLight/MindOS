// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApiFetch = vi.fn();

class MockApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
  ApiError: MockApiError,
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

describe('Browser UpdateTab immediate failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('surfaces an immediate /api/update failure as an error instead of staying in updating state', async () => {
    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/update-check') {
        return Promise.resolve({
          current: '1.0.0',
          latest: '2.0.0',
          hasUpdate: true,
        });
      }
      if (url === '/api/update') {
        return Promise.reject(new MockApiError('spawn failed', 500));
      }
      if (url === '/api/update-status') {
        return Promise.resolve({
          stage: 'idle',
          stages: [],
          error: null,
          version: null,
          startedAt: null,
        });
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<UpdateTab />);
    });

    const updateButton = Array.from(host.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Update to v2.0.0'),
    ) as HTMLButtonElement | undefined;
    expect(updateButton).toBeTruthy();

    await act(async () => {
      updateButton?.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Retry Update');
    expect(host.textContent).not.toContain('This may take 1–3 minutes. Do not close this page.');

    await act(async () => {
      root.unmount();
    });
  });

  it('clears persisted update-in-progress state when /api/update fails immediately', async () => {
    const { UpdateTab } = await import('@/components/settings/UpdateTab');

    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/update-check') {
        return Promise.resolve({
          current: '1.0.0',
          latest: '2.0.0',
          hasUpdate: true,
        });
      }
      if (url === '/api/update') {
        return Promise.reject(new MockApiError('spawn failed', 500));
      }
      if (url === '/api/update-status') {
        return Promise.resolve({
          stage: 'idle',
          stages: [],
          error: null,
          version: null,
          startedAt: null,
        });
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<UpdateTab />);
    });

    const updateButton = Array.from(host.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Update to v2.0.0'),
    ) as HTMLButtonElement | undefined;
    expect(updateButton).toBeTruthy();

    await act(async () => {
      updateButton?.click();
      await Promise.resolve();
    });

    expect(localStorage.getItem('mindos_update_in_progress')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
