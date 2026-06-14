import { describe, expect, it, vi } from 'vitest';
import {
  OBSIDIAN_COMMUNITY_PLUGINS_URL,
  buildObsidianCommunityPluginReleaseUrls,
  buildObsidianCommunityCatalog,
  fetchObsidianCommunityPluginPackage,
  githubUrlForRepo,
  parseObsidianCommunityCatalog,
  preflightObsidianCommunityPluginPackage,
  type ObsidianCommunityCatalogEntry,
} from '@/lib/obsidian-compat/community-catalog';

function entry(id: string, overrides: Partial<ObsidianCommunityCatalogEntry> = {}): ObsidianCommunityCatalogEntry {
  return {
    id,
    name: `Plugin ${id}`,
    description: `Description for ${id}`,
    author: 'Community Author',
    repo: `owner/${id}`,
    githubUrl: `https://github.com/owner/${id}`,
    ...overrides,
  };
}

describe('Obsidian community catalog adapter', () => {
  it('builds release asset URLs for GitHub owner/repo values', () => {
    expect(githubUrlForRepo(' blacksmithgu/obsidian-dataview ')).toBe('https://github.com/blacksmithgu/obsidian-dataview');
    expect(githubUrlForRepo('not-a-repo')).toBeUndefined();

    expect(buildObsidianCommunityPluginReleaseUrls('blacksmithgu/obsidian-dataview')).toEqual({
      manifestUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/manifest.json',
      mainUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/main.js',
      stylesUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/styles.css',
    });
    expect(() => buildObsidianCommunityPluginReleaseUrls('../bad/repo')).toThrow('Invalid Obsidian community repo');
  });

  it('parses valid community plugin entries and derives GitHub URLs', () => {
    const result = parseObsidianCommunityCatalog([
      {
        id: 'quickadd',
        name: 'QuickAdd',
        description: 'Capture and template workflows',
        author: 'Christian B. B. Houmann',
        repo: 'chhoumann/quickadd',
      },
      {
        id: 'local-only',
        name: 'Local Only',
        author: 'MindOS',
        description: '',
        repo: 'not-a-github-repo-url',
      },
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.items).toEqual([
      {
        id: 'quickadd',
        name: 'QuickAdd',
        description: 'Capture and template workflows',
        author: 'Christian B. B. Houmann',
        repo: 'chhoumann/quickadd',
        githubUrl: 'https://github.com/chhoumann/quickadd',
      },
      {
        id: 'local-only',
        name: 'Local Only',
        description: '',
        author: 'MindOS',
        repo: 'not-a-github-repo-url',
      },
    ]);
  });

  it('skips invalid entries and duplicate plugin ids without rejecting the whole index', () => {
    const result = parseObsidianCommunityCatalog([
      null,
      { id: 'dataview', name: 'Dataview', author: 'Blacksmith', repo: 'blacksmithgu/obsidian-dataview' },
      { id: 'missing-author', name: 'Missing Author', repo: 'example/missing-author' },
      { id: 'dataview', name: 'Duplicate Dataview', author: 'Other', repo: 'other/dataview' },
    ]);

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'dataview', name: 'Dataview' }),
    ]);
    expect(result.skipped).toEqual([
      { index: 0, reason: 'Entry is not an object.' },
      { index: 2, reason: 'Entry is missing id, name, author, or repo.' },
      { index: 3, reason: 'Duplicate plugin id: dataview' },
    ]);
  });

  it('returns a parse diagnostic when the official index shape is not an array', () => {
    const result = parseObsidianCommunityCatalog({ plugins: [] });

    expect(result.items).toEqual([]);
    expect(result.skipped).toEqual([
      { index: -1, reason: 'Community plugin index must be an array.' },
    ]);
  });

  it('filters by query across name, description, author, and repo', () => {
    const catalog = buildObsidianCommunityCatalog([
      entry('quickadd', {
        name: 'QuickAdd',
        description: 'Capture workflows',
        author: 'Christian',
        repo: 'chhoumann/quickadd',
      }),
      entry('dataview', {
        name: 'Dataview',
        description: 'Query Markdown metadata',
        author: 'Blacksmith',
        repo: 'blacksmithgu/obsidian-dataview',
      }),
      entry('templater', {
        name: 'Templater',
        description: 'Template engine',
        author: 'SilentVoid',
        repo: 'SilentVoid13/Templater',
      }),
    ], { query: 'metadata' });

    expect(catalog.source).toEqual({
      type: 'obsidian-releases',
      url: OBSIDIAN_COMMUNITY_PLUGINS_URL,
    });
    expect(catalog.query).toBe('metadata');
    expect(catalog.plugins).toHaveLength(1);
    expect(catalog.plugins[0]).toMatchObject({
      id: 'dataview',
      installed: false,
      installStatus: 'available',
      source: 'obsidian-community',
    });
    expect(catalog.counts).toMatchObject({
      total: 3,
      returned: 1,
      installed: 0,
      enabled: 0,
      blocked: 0,
      errors: 0,
    });
  });

  it('clamps limits and keeps counts based on the full filtered set', () => {
    const entries = Array.from({ length: 260 }, (_, index) => entry(`plugin-${String(index).padStart(3, '0')}`));

    const defaultCatalog = buildObsidianCommunityCatalog(entries);
    const maxCatalog = buildObsidianCommunityCatalog(entries, { limit: 500 });

    expect(defaultCatalog.plugins).toHaveLength(50);
    expect(defaultCatalog.counts.returned).toBe(50);
    expect(maxCatalog.plugins).toHaveLength(200);
    expect(maxCatalog.counts).toMatchObject({
      total: 260,
      returned: 200,
    });
  });

  it('overlays local installed plugin state without exposing lifecycle actions', () => {
    const catalog = buildObsidianCommunityCatalog([
      entry('blocked-plugin'),
      entry('dataview'),
      entry('quickadd'),
    ], {
      installed: [
        {
          id: 'dataview',
          enabled: true,
          loaded: true,
          status: 'loaded',
          version: '0.5.0',
        },
        {
          id: 'blocked-plugin',
          enabled: true,
          loaded: false,
          status: 'blocked',
          version: '1.2.3',
          lastError: 'Requires unsupported Node module: fs',
        },
      ],
    });

    expect(catalog.plugins).toEqual([
      expect.objectContaining({
        id: 'blocked-plugin',
        installed: true,
        installStatus: 'blocked',
        installedVersion: '1.2.3',
        installedEnabled: true,
        installedLoaded: false,
        installedLastError: 'Requires unsupported Node module: fs',
      }),
      expect.objectContaining({
        id: 'dataview',
        installed: true,
        installStatus: 'loaded',
        installedVersion: '0.5.0',
        installedEnabled: true,
        installedLoaded: true,
      }),
      expect.objectContaining({
        id: 'quickadd',
        installed: false,
        installStatus: 'available',
      }),
    ]);
    expect(catalog.counts).toMatchObject({
      installed: 2,
      enabled: 2,
      blocked: 1,
      errors: 0,
    });
  });

  it('preflights remote release files without installing or enabling the plugin', async () => {
    const urls = buildObsidianCommunityPluginReleaseUrls('owner/quickadd');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === urls.manifestUrl) {
        return new Response(JSON.stringify({
          id: 'quickadd',
          name: 'QuickAdd',
          version: '1.2.3',
          minAppVersion: '1.7.2',
        }), { status: 200 });
      }
      if (url === urls.mainUrl) {
        return new Response("const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
      }
      if (url === urls.stylesUrl) {
        return new Response('.quickadd { display: block; }', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const preflight = await preflightObsidianCommunityPluginPackage({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(preflight).toMatchObject({
      ok: true,
      plugin: {
        id: 'quickadd',
        name: 'QuickAdd',
        repo: 'owner/quickadd',
        githubUrl: 'https://github.com/owner/quickadd',
      },
      package: {
        manifest: {
          id: 'quickadd',
          name: 'QuickAdd',
          version: '1.2.3',
          minAppVersion: '1.7.2',
        },
        assets: {
          manifestJson: true,
          mainJs: true,
          stylesCss: true,
        },
        source: urls,
      },
      compatibility: {
        level: 'compatible',
      },
      installable: true,
      installBlockedReasons: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, urls.manifestUrl, expect.objectContaining({
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    }));
  });

  it('fetches remote community plugin package files for explicit install flows', async () => {
    const urls = buildObsidianCommunityPluginReleaseUrls('owner/quickadd');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === urls.manifestUrl) {
        return new Response(JSON.stringify({
          id: 'quickadd',
          name: 'QuickAdd',
          version: '1.2.3',
        }), { status: 200 });
      }
      if (url === urls.mainUrl) {
        return new Response("const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
      }
      if (url === urls.stylesUrl) {
        return new Response('.quickadd { display: block; }', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const fetched = await fetchObsidianCommunityPluginPackage({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetched.preflight.installable).toBe(true);
    expect(fetched.preflight.package.assets.stylesCss).toBe(true);
    expect(fetched.files.manifestJson).toContain('"quickadd"');
    expect(fetched.files.mainJs).toContain('class QuickAdd');
    expect(fetched.files.stylesCss).toBe('.quickadd { display: block; }');
  });

  it('keeps manifest id mismatches as a blocked preflight result', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          id: 'manifest-id',
          name: 'Different Manifest',
          version: '1.0.0',
        }), { status: 200 });
      }
      if (url.endsWith('/main.js')) {
        return new Response("const { Plugin } = require('obsidian'); module.exports = class Demo extends Plugin {};", { status: 200 });
      }
      return new Response('missing', { status: 404 });
    });

    const preflight = await preflightObsidianCommunityPluginPackage({
      repo: 'owner/catalog-id',
      pluginId: 'catalog-id',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(preflight.installable).toBe(false);
    expect(preflight.compatibility.level).toBe('compatible');
    expect(preflight.package.assets.stylesCss).toBe(false);
    expect(preflight.package.manifest.id).toBe('manifest-id');
    expect(preflight.installBlockedReasons).toEqual([
      'Manifest id "manifest-id" does not match requested plugin id "catalog-id".',
    ]);
  });

  it('blocks community plugin preflight when main.js imports unsupported modules', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          id: 'desktop-only',
          name: 'Desktop Only',
          version: '1.0.0',
        }), { status: 200 });
      }
      if (url.endsWith('/main.js')) {
        return new Response("const fs = require('fs'); const { Plugin } = require('obsidian'); module.exports = class DesktopOnly extends Plugin {};", { status: 200 });
      }
      return new Response('missing', { status: 404 });
    });

    const preflight = await preflightObsidianCommunityPluginPackage({
      repo: 'owner/desktop-only',
      pluginId: 'desktop-only',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(preflight.compatibility.level).toBe('blocked');
    expect(preflight.compatibility.report.unsupportedModules).toEqual(['fs']);
    expect(preflight.installable).toBe(false);
    expect(preflight.installBlockedReasons).toEqual([
      'Requires unsupported runtime module: fs',
    ]);
  });

  it('rejects oversized release assets during community plugin preflight', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          id: 'huge-plugin',
          name: 'Huge Plugin',
          version: '1.0.0',
        }), { status: 200 });
      }
      if (url.endsWith('/main.js')) {
        return new Response('', {
          status: 200,
          headers: { 'content-length': String(3 * 1024 * 1024) },
        });
      }
      return new Response('missing', { status: 404 });
    });

    await expect(preflightObsidianCommunityPluginPackage({
      repo: 'owner/huge-plugin',
      pluginId: 'huge-plugin',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Obsidian plugin main.js is too large to preflight.');
  });
});
