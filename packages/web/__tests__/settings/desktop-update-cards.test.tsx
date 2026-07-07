// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellUpdateBanner, ShellVersionRow, type ShellUpdate } from '@/components/settings/DesktopUpdateCards';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      settings: {
        update: {
          desktopInstalling: 'Restarting to apply update...',
          desktopReady: 'Update downloaded. Restart to apply.',
          error: 'Update failed.',
          retryButton: 'Retry Update',
          shellBannerAction: 'Download & Restart',
          shellBannerDesc: 'Requires downloading and restarting the app.',
          shellBannerTitle: (version: string) => `New app version v${version} available`,
          shellManualAction: 'Open downloads',
          shellManualDesc: 'Download the latest Desktop installer from the release page.',
          shellRowLabel: 'Desktop shell',
          shellLatest: 'Latest',
          shellCheck: 'Check',
          releaseNotes: 'Release notes',
        },
      },
    },
  }),
}));

function makeShell(overrides: Partial<ShellUpdate>): ShellUpdate {
  return {
    appVersion: '0.4.14',
    available: true,
    version: '0.4.15',
    phase: 'idle',
    progress: 0,
    errorMsg: '',
    canInstall: true,
    unsupportedReason: '',
    manualUrl: 'https://github.com/GeminiLight/MindOS/releases/latest',
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function renderBanner(shell: ShellUpdate): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ShellUpdateBanner shell={shell} />);
  });
  return host;
}

async function renderRow(shell: ShellUpdate): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ShellVersionRow shell={shell} />);
  });
  return host;
}

describe('Desktop shell update banner', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('uses a manual download action when the current install cannot update in place', async () => {
    const host = await renderBanner(makeShell({
      canInstall: false,
      unsupportedReason: 'Debian/Ubuntu package updates must be installed manually.',
      manualUrl: 'https://example.com/downloads',
    }));

    const link = host.querySelector('a') as HTMLAnchorElement | null;
    expect(host.textContent).toContain('Debian/Ubuntu package updates must be installed manually.');
    expect(link?.textContent).toContain('Open downloads');
    expect(link?.href).toBe('https://example.com/downloads');
  });

  it('shows an installing state without another restart button', async () => {
    const host = await renderBanner(makeShell({ phase: 'installing' }));

    expect(host.textContent).toContain('Restarting to apply update...');
    expect(host.querySelector('button')).toBeNull();
  });

  it('disables manual shell checks while a downloaded update is ready to restart', async () => {
    const host = await renderRow(makeShell({ phase: 'ready' }));
    const checkButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Check'));

    expect(checkButton).toBeTruthy();
    expect((checkButton as HTMLButtonElement).disabled).toBe(true);
  });
});
