import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { OBSIDIAN_COMMUNITY_PLUGINS_URL } from '@/lib/obsidian-compat/community-catalog';
import { resetObsidianPluginRuntimeServicesForTests } from '@/lib/obsidian-compat/runtime-service';

let mindRoot: string;
const testState = vi.hoisted(() => ({ mindRoot: '' }));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ mindRoot: testState.mindRoot }),
}));

function writePlugin(pluginId: string, mainJs: string, manifest: Record<string, unknown> = {}) {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0', ...manifest }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
}

function enablePlugin(...pluginIds: string[]) {
  fs.mkdirSync(path.join(mindRoot, '.plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(mindRoot, '.plugins', '.plugin-manager.json'),
    JSON.stringify({ enabled: Object.fromEntries(pluginIds.map((pluginId) => [pluginId, true])) }, null, 2),
    'utf-8',
  );
}

async function importRoute() {
  return import('../../app/api/obsidian/community-catalog/route');
}

describe('/api/obsidian/community-catalog', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-community-catalog-api-'));
    testState.mindRoot = mindRoot;
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    resetObsidianPluginRuntimeServicesForTests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns the official community index with local installed state overlay', async () => {
    writePlugin(
      'dataview',
      `const { Plugin } = require('obsidian'); module.exports = class Dataview extends Plugin {};`,
      { name: 'Dataview', version: '0.5.0' },
    );
    writePlugin(
      'desktop-only',
      `
        const fs = require('fs');
        const { Plugin } = require('obsidian');
        module.exports = class DesktopOnly extends Plugin {
          onload() { fs.readFileSync('/tmp/nope'); }
        };
      `,
      { name: 'Desktop Only', version: '1.2.3' },
    );
    enablePlugin('dataview', 'desktop-only');

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        id: 'quickadd',
        name: 'QuickAdd',
        description: 'Capture workflows',
        author: 'Christian',
        repo: 'chhoumann/quickadd',
      },
      {
        id: 'dataview',
        name: 'Dataview',
        description: 'Query Markdown metadata',
        author: 'Blacksmith',
        repo: 'blacksmithgu/obsidian-dataview',
      },
      {
        id: 'desktop-only',
        name: 'Desktop Only',
        description: 'Requires desktop APIs',
        author: 'Node User',
        repo: 'node/desktop-only',
      },
      { id: 'invalid', name: 'Invalid' },
      {
        id: 'dataview',
        name: 'Duplicate Dataview',
        description: 'Duplicate',
        author: 'Other',
        repo: 'other/dataview',
      },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog?q=data&limit=5'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(OBSIDIAN_COMMUNITY_PLUGINS_URL, expect.objectContaining({
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    }));
    expect(json.ok).toBe(true);
    expect(json.catalog).toMatchObject({
      query: 'data',
      counts: {
        total: 3,
        returned: 1,
        installed: 1,
        enabled: 1,
        blocked: 0,
        errors: 0,
      },
    });
    expect(json.catalog.plugins).toEqual([
      expect.objectContaining({
        id: 'dataview',
        source: 'obsidian-community',
        installed: true,
        installStatus: 'enabled',
        installedVersion: '0.5.0',
        installedEnabled: true,
        installedLoaded: false,
        githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
      }),
    ]);
    expect(json.skipped).toEqual([
      { index: 3, reason: 'Entry is missing id, name, author, or repo.' },
      { index: 4, reason: 'Duplicate plugin id: dataview' },
    ]);
  });

  it('marks locally blocked community plugins without loading them', async () => {
    writePlugin(
      'desktop-only',
      `
        const fs = require('fs');
        const { Plugin } = require('obsidian');
        module.exports = class DesktopOnly extends Plugin {
          onload() { fs.readFileSync('/tmp/nope'); }
        };
      `,
      { name: 'Desktop Only', version: '1.2.3' },
    );
    enablePlugin('desktop-only');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        id: 'desktop-only',
        name: 'Desktop Only',
        description: 'Requires desktop APIs',
        author: 'Node User',
        repo: 'node/desktop-only',
      },
    ]), { status: 200 })));

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.catalog.plugins).toEqual([
      expect.objectContaining({
        id: 'desktop-only',
        installed: true,
        installStatus: 'blocked',
        installedVersion: '1.2.3',
        installedLastError: expect.stringContaining('Requires unsupported runtime module: fs'),
      }),
    ]);
    expect(json.catalog.counts).toMatchObject({
      installed: 1,
      enabled: 1,
      blocked: 1,
    });
  });

  it('returns a safe error when the official index cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog'));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({
      error: 'Failed to fetch Obsidian community plugin index: 503',
    });
  });
});
