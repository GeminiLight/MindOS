import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

async function importRoute() {
  return import('../../app/api/obsidian/community-catalog/preflight/route');
}

describe('/api/obsidian/community-catalog/preflight', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects missing repo', async () => {
    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/preflight'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing repo' });
  });

  it('returns a read-only compatibility preflight for a community plugin release', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          id: 'quickadd',
          name: 'QuickAdd',
          version: '1.2.3',
          minAppVersion: '1.7.2',
        }), { status: 200 });
      }
      if (url.endsWith('/main.js')) {
        return new Response("const { Plugin, Notice } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
      }
      if (url.endsWith('/styles.css')) {
        return new Response('.quickadd { display: block; }', { status: 200 });
      }
      return new Response('missing', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/preflight?repo=owner/quickadd&pluginId=quickadd'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
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
        source: {
          type: 'github-release',
          strategy: 'latest-release',
          resolvedVersion: '1.2.3',
          latestVersion: '1.2.3',
          versionsUrl: 'https://raw.githubusercontent.com/owner/quickadd/HEAD/versions.json',
          manifestUrl: 'https://github.com/owner/quickadd/releases/download/1.2.3/manifest.json',
          mainUrl: 'https://github.com/owner/quickadd/releases/download/1.2.3/main.js',
          stylesUrl: 'https://github.com/owner/quickadd/releases/download/1.2.3/styles.css',
        },
      },
      compatibility: {
        level: 'partial',
      },
      support: {
        kind: 'limited',
        label: 'Limited',
        installable: true,
      },
      surfacePreview: [
        { id: 'entries', state: 'mounted', count: 1 },
        { id: 'styles', state: 'mounted', count: 1 },
      ],
      installable: true,
      installBlockedReasons: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/owner/quickadd/HEAD/manifest.json',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('caches identical read-only preflight requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          id: 'quickadd',
          name: 'QuickAdd',
          version: '1.2.3',
        }), { status: 200 });
      }
      if (url.endsWith('/main.js')) {
        return new Response("const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
      }
      return new Response('missing', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await importRoute();
    const url = 'http://localhost/api/obsidian/community-catalog/preflight?repo=owner/quickadd&pluginId=quickadd';
    const first = await GET(new NextRequest(url));
    const second = await GET(new NextRequest(url));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await second.json()).toMatchObject({
      ok: true,
      plugin: { id: 'quickadd' },
    });
  });

  it('keeps cached preflight results separate by target Obsidian app version', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://raw.githubusercontent.com/owner/quickadd/HEAD/manifest.json') {
        return new Response(JSON.stringify({
          id: 'quickadd',
          name: 'QuickAdd',
          version: '2.0.0',
          minAppVersion: '2.0.0',
        }), { status: 200 });
      }
      if (url === 'https://raw.githubusercontent.com/owner/quickadd/HEAD/versions.json') {
        return new Response(JSON.stringify({
          '1.0.0': '1.0.0',
          '1.5.0': '1.5.0',
          '2.0.0': '2.0.0',
        }), { status: 200 });
      }
      if (url === 'https://github.com/owner/quickadd/releases/download/1.5.0/manifest.json') {
        return new Response(JSON.stringify({
          id: 'quickadd',
          name: 'QuickAdd',
          version: '1.5.0',
          minAppVersion: '1.5.0',
        }), { status: 200 });
      }
      if (url === 'https://github.com/owner/quickadd/releases/download/2.0.0/manifest.json') {
        return new Response(JSON.stringify({
          id: 'quickadd',
          name: 'QuickAdd',
          version: '2.0.0',
          minAppVersion: '2.0.0',
        }), { status: 200 });
      }
      if (url.endsWith('/main.js')) {
        return new Response("const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
      }
      if (url.endsWith('/styles.css')) {
        return new Response('missing', { status: 404 });
      }
      return new Response('missing', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await importRoute();
    const latest = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/preflight?repo=owner/quickadd&pluginId=quickadd'));
    const compatible = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/preflight?repo=owner/quickadd&pluginId=quickadd&appVersion=1.5.0'));

    expect((await latest.json()).package.source).toMatchObject({
      strategy: 'latest-release',
      resolvedVersion: '2.0.0',
    });
    expect((await compatible.json()).package.source).toMatchObject({
      strategy: 'compatible-release',
      resolvedVersion: '1.5.0',
      targetAppVersion: '1.5.0',
    });
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('reports blocked compatibility without installing the remote package', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
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
    }));

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/preflight?repo=owner/desktop-only&pluginId=desktop-only'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      compatibility: {
        level: 'blocked',
        report: {
          unsupportedModules: ['fs'],
          blockers: ['Requires unsupported runtime module: fs'],
        },
      },
      support: {
        kind: 'native',
        label: 'Needs native runtime',
        installable: false,
      },
      installable: false,
      installBlockedReasons: ['Requires unsupported runtime module: fs'],
    });
  });

  it('returns safe errors for invalid repos and missing release files', async () => {
    const { GET } = await importRoute();
    const invalidRepo = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/preflight?repo=not-a-repo'));

    expect(invalidRepo.status).toBe(400);
    expect(await invalidRepo.json()).toEqual({
      error: 'Invalid Obsidian community repo. Expected "owner/repo".',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    const missingManifest = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/preflight?repo=owner/missing'));

    expect(missingManifest.status).toBe(500);
    expect(await missingManifest.json()).toEqual({
      error: 'Failed to fetch Obsidian plugin manifest.json: 404',
    });
  });
});
