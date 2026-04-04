// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    setLocale: vi.fn(),
    t: {
      settings: {
        title: 'Settings',
        saved: 'Saved',
        saveFailed: 'Save failed',
        save: 'Save',
        reconfigure: 'Reconfigure',
        tabs: {
          ai: 'AI',
          mcp: 'MCP',
          knowledge: 'Knowledge',
          appearance: 'Appearance',
          sync: 'Sync',
          update: 'Update',
        },
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

vi.mock('@/components/settings/AiTab', () => ({ AiTab: () => null }));
vi.mock('@/components/settings/AppearanceTab', () => ({ AppearanceTab: () => null }));
vi.mock('@/components/settings/KnowledgeTab', () => ({ KnowledgeTab: () => null }));
vi.mock('@/components/settings/SyncTab', () => ({ SyncTab: () => null }));
vi.mock('@/components/settings/McpTab', () => ({ McpTab: () => null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

describe('Settings update badge synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  });

  it('shows the Update tab badge after the embedded UpdateTab finds an update', async () => {
    const SettingsContent = (await import('@/components/settings/SettingsContent')).default;

    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/settings') {
        return Promise.resolve({
          ai: {
            provider: 'anthropic',
            providers: {
              anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
              openai: { apiKey: '', model: 'gpt-5.4', baseUrl: '' },
            },
          },
          mindRoot: '/tmp/mind',
          envOverrides: {},
        });
      }
      if (url === '/api/update-check') {
        return Promise.resolve({
          current: '1.0.0',
          latest: '2.0.0',
          hasUpdate: true,
        });
      }
      if (url === '/api/settings' || url === '/api/update') {
        return Promise.resolve({});
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SettingsContent visible initialTab="update" variant="panel" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const badges = host.querySelectorAll('.bg-error');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(localStorage.getItem('mindos_update_latest')).toBe('2.0.0');

    await act(async () => {
      root.unmount();
    });
  });
});
