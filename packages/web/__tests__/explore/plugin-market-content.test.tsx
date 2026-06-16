// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginMarketContent from '@/components/explore/PluginMarketContent';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const localCatalogResponse = {
  ok: true,
  plugins: [
    {
      id: 'dataview',
      source: 'obsidian',
      name: 'Dataview',
      tags: [],
      builtin: false,
      core: false,
      enabled: true,
      loaded: true,
      status: 'loaded',
      surfaces: { total: 3, available: 3, recorded: 0, blocked: 0, disabled: 0, byKind: { command: 2 } },
    },
  ],
  counts: {
    total: 3,
    enabled: 3,
    disabled: 0,
    loaded: 1,
    blocked: 0,
    errors: 0,
    bySource: { obsidian: 1, 'mindos-renderer': 2 },
    buckets: { all: 3, mindos: 2, obsidian: 1, disabled: 0, problem: 0 },
    surfaces: { total: 5, available: 5, recorded: 0, blocked: 0, disabled: 0, byKind: { command: 2 } },
  },
};

const communityCatalogResponse = {
  ok: true,
  skipped: [],
  cache: {
    state: 'refreshed',
    fetchedAt: '2026-06-16T00:00:00.000Z',
    ttlMs: 1800000,
  },
  catalog: {
    source: {
      type: 'obsidian-releases',
      url: 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',
    },
    query: '',
    counts: {
      total: 2,
      returned: 2,
      installed: 1,
      enabled: 1,
      blocked: 0,
      errors: 0,
    },
    plugins: [
      {
        id: 'dataview',
        name: 'Dataview',
        description: 'Data views for Markdown notes.',
        author: 'blacksmithgu',
        repo: 'blacksmithgu/obsidian-dataview',
        githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
        source: 'obsidian-community',
        installed: true,
        installStatus: 'loaded',
        installedVersion: '0.5.0',
        installedEnabled: true,
        installedLoaded: true,
      },
      {
        id: 'quickadd',
        name: 'QuickAdd',
        description: 'Capture and command workflows.',
        author: 'chhoumann',
        repo: 'chhoumann/quickadd',
        githubUrl: 'https://github.com/chhoumann/quickadd',
        source: 'obsidian-community',
        installed: false,
        installStatus: 'available',
      },
    ],
  },
};

function buildCommunityResponseWithPlugins(count: number) {
  return {
    ...communityCatalogResponse,
    catalog: {
      ...communityCatalogResponse.catalog,
      counts: {
        total: count,
        returned: count,
        installed: 0,
        enabled: 0,
        blocked: 0,
        errors: 0,
      },
      plugins: Array.from({ length: count }, (_, index) => ({
        id: `plugin-${String(index).padStart(2, '0')}`,
        name: `Plugin ${String(index).padStart(2, '0')}`,
        description: `Plugin ${index} description.`,
        author: 'Community',
        repo: `owner/plugin-${index}`,
        githubUrl: `https://github.com/owner/plugin-${index}`,
        source: 'obsidian-community',
        installed: false,
        installStatus: 'available',
      })),
    },
  };
}

const quickAddPreflight = {
  ok: true,
  plugin: {
    id: 'quickadd',
    name: 'QuickAdd',
    repo: 'chhoumann/quickadd',
    githubUrl: 'https://github.com/chhoumann/quickadd',
  },
  package: {
    manifest: { id: 'quickadd', name: 'QuickAdd', version: '1.0.0', minAppVersion: '1.0.0' },
    assets: { manifestJson: true, mainJs: true, stylesCss: false },
    source: {
      manifestUrl: 'https://raw.githubusercontent.com/chhoumann/quickadd/master/manifest.json',
      mainUrl: 'https://raw.githubusercontent.com/chhoumann/quickadd/master/main.js',
      stylesUrl: 'https://raw.githubusercontent.com/chhoumann/quickadd/master/styles.css',
    },
    digest: {
      algorithm: 'sha256',
      manifestJson: 'manifest-digest',
      mainJs: 'main-digest',
      package: 'package-digest',
    },
  },
  compatibility: {
    level: 'partial',
    report: {
      pluginId: 'quickadd',
      level: 'partial',
      summary: 'Limited APIs are routed through safe MindOS hosts',
      blockers: [],
      warnings: [],
      capabilities: [],
    },
  },
  support: {
    kind: 'limited',
    reason: 'Limited APIs are routed through safe MindOS hosts',
  },
  surfacePreview: [
    { id: 'commands', state: 'mounted', count: 2 },
    { id: 'settings', state: 'mounted', count: 1 },
  ],
  installable: true,
  installBlockedReasons: [],
};

async function flushPluginMarketPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('PluginMarketContent', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.apiFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/plugins/catalog') return localCatalogResponse;
      if (url === '/api/obsidian/community-catalog?limit=80') return communityCatalogResponse;
      if (url === '/api/obsidian/community-catalog?limit=80&q=data') {
        return {
          ...communityCatalogResponse,
          catalog: {
            ...communityCatalogResponse.catalog,
            query: 'data',
            plugins: [communityCatalogResponse.catalog.plugins[0]],
            counts: { ...communityCatalogResponse.catalog.counts, returned: 1 },
          },
        };
      }
      if (url === '/api/obsidian/community-catalog/preflight?repo=chhoumann%2Fquickadd&pluginId=quickadd') {
        return quickAddPreflight;
      }
      if (url === '/api/obsidian/community-catalog/install' && opts?.method === 'POST') {
        return {
          ok: true,
          plugin: quickAddPreflight.plugin,
          installed: {
            pluginId: 'quickadd',
            targetDir: '/tmp/mind/.mindos/plugins/quickadd',
            enabled: false,
            loaded: false,
            source: 'obsidian-community',
          },
          preflight: quickAddPreflight,
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('renders a Discover-family market without the Settings manager shell', async () => {
    await act(async () => {
      root.render(<PluginMarketContent />);
      await flushPluginMarketPromises();
    });

    expect(mocks.apiFetch).not.toHaveBeenCalledWith(
      '/api/plugins/catalog',
      expect.anything(),
    );
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/obsidian/community-catalog?limit=80',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(host.textContent).toContain('Plugin Market');
    expect(host.textContent).toContain('Official Obsidian index');
    expect(host.textContent).toContain('Dataview');
    expect(host.textContent).toContain('QuickAdd');
    expect(host.textContent).toContain('Local snapshot');
    expect(host.textContent).toContain('Load the local inventory only when you need installed-package details.');
    expect(host.textContent).not.toContain('Plugin Manager');
    expect(host.textContent).not.toContain('Read-only update plan');

    const links = Array.from(host.querySelectorAll('a')).map((link) => link.getAttribute('href'));
    expect(links).toContain('/explore');
    expect(links).toContain('/settings?tab=plugins');
    expect(links).toContain('/settings?tab=plugins&panel=import');
  });

  it('searches, preflights, and installs without bypassing confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const packageChanged = vi.fn();
    window.addEventListener('mindos:obsidian-plugin-packages-changed', packageChanged);

    try {
      await act(async () => {
        root.render(<PluginMarketContent />);
        await flushPluginMarketPromises();
      });

      const input = host.querySelector('[data-plugin-market-search]') as HTMLInputElement;
      const submit = host.querySelector('[data-plugin-market-search-submit]') as HTMLButtonElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

      await act(async () => {
        setter?.call(input, 'data');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
      });

      await act(async () => {
        submit.click();
        await flushPluginMarketPromises();
      });

      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog?limit=80&q=data',
        expect.objectContaining({ cache: 'no-store' }),
      );
      expect(host.textContent).toContain('Search: data');

      await act(async () => {
        setter?.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        submit.click();
        await flushPluginMarketPromises();
      });

      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog?limit=80',
        expect.objectContaining({ cache: 'no-store' }),
      );

      const preflight = host.querySelector('[data-plugin-market-preflight="quickadd"]') as HTMLButtonElement;
      await act(async () => {
        preflight.click();
        await flushPluginMarketPromises();
      });

      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog/preflight?repo=chhoumann%2Fquickadd&pluginId=quickadd',
        expect.objectContaining({ cache: 'no-store' }),
      );
      expect(host.textContent).toContain('Installable with limited support');
      expect(host.textContent).toContain('Limited');
      expect(host.textContent).toContain('Command Center');

      const install = host.querySelector('[data-plugin-market-install="quickadd"]') as HTMLButtonElement;
      expect(install).toBeTruthy();

      await act(async () => {
        install.click();
        await flushPluginMarketPromises();
      });

      expect(confirmSpy).toHaveBeenCalledWith(
        'Install "QuickAdd" from Obsidian Community? MindOS will download plugin code into this local vault and keep it disabled until you enable it.',
      );
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog/install',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repo: 'chhoumann/quickadd',
            pluginId: 'quickadd',
            confirm: true,
          }),
        }),
      );
      expect(packageChanged).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('Installed locally (1.0.0). Manage it from Installed to enable it.');
      expect(host.querySelector('[data-plugin-market-manage="quickadd"]')).toBeTruthy();
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/plugins/catalog',
        expect.objectContaining({ cache: 'no-store' }),
      );
    } finally {
      window.removeEventListener('mindos:obsidian-plugin-packages-changed', packageChanged);
      confirmSpy.mockRestore();
    }
  });

  it('loads the local snapshot on demand and does not show empty state when local load fails', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/obsidian/community-catalog?limit=80') return communityCatalogResponse;
      if (url === '/api/plugins/catalog') throw new Error('disk unavailable');
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<PluginMarketContent />);
      await flushPluginMarketPromises();
    });

    const localLoad = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Load snapshot')) as HTMLButtonElement;
    expect(localLoad).toBeTruthy();

    await act(async () => {
      localLoad.click();
      await flushPluginMarketPromises();
    });

    expect(host.textContent).toContain('Could not load local plugin inventory: disk unavailable');
    expect(host.textContent).not.toContain('No imported or problem plugins are visible yet.');
  });

  it('shows a retry action when the community catalog load fails', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/obsidian/community-catalog?limit=80') throw new Error('network offline');
      if (url === '/api/obsidian/community-catalog?limit=80&refresh=1') return communityCatalogResponse;
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<PluginMarketContent />);
      await flushPluginMarketPromises();
    });

    expect(host.textContent).toContain('Could not load community catalog: network offline');
    const retry = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Retry')) as HTMLButtonElement;
    expect(retry).toBeTruthy();

    await act(async () => {
      retry.click();
      await flushPluginMarketPromises();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/obsidian/community-catalog?limit=80&refresh=1',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(host.textContent).toContain('QuickAdd');
  });

  it('keeps filter empty states clear without making extra catalog requests', async () => {
    await act(async () => {
      root.render(<PluginMarketContent />);
      await flushPluginMarketPromises();
    });
    const callsBeforeFilter = mocks.apiFetch.mock.calls.length;
    const issuesFilter = host.querySelector('[data-plugin-market-filter="issues"]') as HTMLButtonElement;

    await act(async () => {
      issuesFilter.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('No community plugins match this search.');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(callsBeforeFilter);
  });

  it('renders large result sets progressively', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/obsidian/community-catalog?limit=80') return buildCommunityResponseWithPlugins(30);
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<PluginMarketContent />);
      await flushPluginMarketPromises();
    });

    expect(host.textContent).toContain('Plugin 23');
    expect(host.textContent).not.toContain('Plugin 24');
    const showMore = host.querySelector('[data-plugin-market-show-more]') as HTMLButtonElement;
    expect(showMore).toBeTruthy();

    await act(async () => {
      showMore.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Plugin 24');
  });
});
