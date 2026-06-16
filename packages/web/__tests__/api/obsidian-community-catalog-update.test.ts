import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resetObsidianPluginRuntimeServicesForTests,
  withObsidianPluginRuntime,
} from '@/lib/obsidian-compat/runtime-service';

let mindRoot: string;
const testState = vi.hoisted(() => ({ mindRoot: '' }));
const DEFAULT_REMOTE_MAIN_JS = "const { Plugin } = require('obsidian'); module.exports = class QuickAddUpdated extends Plugin {};";

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ mindRoot: testState.mindRoot }),
}));

async function importRoute() {
  return import('../../app/api/obsidian/community-catalog/update/route');
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/obsidian/community-catalog/update', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function writeInstalledPlugin(pluginId: string, version = '1.0.0', mainJs?: string) {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: 'QuickAdd', version }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(pluginDir, 'main.js'),
    mainJs ?? "const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};",
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'data.json'), '{"keep":true}', 'utf-8');
  fs.writeFileSync(path.join(pluginDir, 'obsidian-community.json'), JSON.stringify({
    schemaVersion: 1,
    source: 'obsidian-community',
    pluginId,
    repo: 'owner/quickadd',
    manifestUrl: 'old',
    mainUrl: 'old',
    stylesUrl: 'old',
    installedAt: '2026-06-13T00:00:00.000Z',
    compatibilityLevel: 'compatible',
    installBlockedReasons: [],
  }), 'utf-8');
}

function writeLocalImportedPlugin(pluginId: string, version = '1.0.0') {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: 'QuickAdd', version }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), 'local imported main', 'utf-8');
}

function enablePlugin(pluginId: string) {
  fs.mkdirSync(path.join(mindRoot, '.plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(mindRoot, '.plugins', '.plugin-manager.json'),
    JSON.stringify({ enabled: { [pluginId]: true } }),
    'utf-8',
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

function remotePackageDigest(version = '1.2.3', mainJs = DEFAULT_REMOTE_MAIN_JS): string {
  const manifestJson = JSON.stringify({
    id: 'quickadd',
    name: 'QuickAdd',
    version,
  });
  return sha256(JSON.stringify({
    manifestJson: sha256(manifestJson),
    mainJs: sha256(mainJs),
    stylesCss: null,
  }));
}

function stubRemotePlugin(version = '1.2.3') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/manifest.json')) {
      return new Response(JSON.stringify({
        id: 'quickadd',
        name: 'QuickAdd',
        version,
      }), { status: 200 });
    }
    if (url.endsWith('/main.js')) {
      return new Response(DEFAULT_REMOTE_MAIN_JS, { status: 200 });
    }
    if (url.endsWith('/styles.css')) {
      return new Response('missing', { status: 404 });
    }
    return new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('/api/obsidian/community-catalog/update', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-community-update-api-'));
    testState.mindRoot = mindRoot;
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    resetObsidianPluginRuntimeServicesForTests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects missing repo or plugin id', async () => {
    const { POST } = await importRoute();
    const res = await POST(postRequest({ repo: 'owner/quickadd', confirm: true }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing repo or pluginId' });
  });

  it('requires explicit confirmation before fetching remote update assets', async () => {
    writeInstalledPlugin('quickadd');
    const fetchMock = stubRemotePlugin();

    const { POST } = await importRoute();
    const res = await POST(postRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: false,
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Community plugin update requires explicit confirmation.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects locally imported plugins without community provenance before fetching remote update assets', async () => {
    writeLocalImportedPlugin('quickadd');
    const fetchMock = stubRemotePlugin();

    const { POST } = await importRoute();
    const res = await POST(postRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
      expectedRemoteVersion: '1.2.3',
      expectedPackageDigest: remotePackageDigest('1.2.3'),
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Community plugin update requires Obsidian Community provenance for quickadd.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'main.js'), 'utf-8')).toBe('local imported main');
  });

  it('requires a preview version and package digest before fetching remote update assets', async () => {
    writeInstalledPlugin('quickadd', '1.0.0');
    const fetchMock = stubRemotePlugin('1.2.3');

    const { POST } = await importRoute();
    const res = await POST(postRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
      expectedRemoteVersion: '1.2.3',
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Community plugin update requires a fresh preview version and package digest.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies a confirmed update through the settings mind root and preserves enabled state', async () => {
    writeInstalledPlugin('quickadd', '1.0.0');
    enablePlugin('quickadd');
    const fetchMock = stubRemotePlugin('1.2.3');

    const { POST } = await importRoute();
    const res = await POST(postRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
      expectedRemoteVersion: '1.2.3',
      expectedPackageDigest: remotePackageDigest('1.2.3'),
      targetMindRoot: '/tmp/ignored',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(json).toMatchObject({
      ok: true,
      updated: {
        pluginId: 'quickadd',
        previousVersion: '1.0.0',
        version: '1.2.3',
        preservedDataJson: true,
      },
    });
    expect(json.plugins).toEqual([
      expect.objectContaining({
        id: 'quickadd',
        version: '1.2.3',
        enabled: true,
        loaded: false,
      }),
    ]);
    expect(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'data.json'), 'utf-8')).toBe('{"keep":true}');
    expect(fs.readFileSync(path.join(mindRoot, '.plugins', '.plugin-manager.json'), 'utf-8')).toBe(JSON.stringify({ enabled: { quickadd: true } }));
    expect(JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'manifest.json'), 'utf-8'))).toMatchObject({
      version: '1.2.3',
    });
  });

  it('unloads a loaded old runtime before swapping the package and does not auto-load the update', async () => {
    writeInstalledPlugin(
      'quickadd',
      '1.0.0',
      `
        const { Plugin } = require('obsidian');
        module.exports = class QuickAdd extends Plugin {
          onload() {
            this.addCommand({ id: 'old-command', name: 'Old command', callback: () => {} });
            this.addStatusBarItem().setText('old runtime');
          }
        };
      `,
    );
    enablePlugin('quickadd');
    stubRemotePlugin('1.2.3');

    await withObsidianPluginRuntime(mindRoot, async (manager) => {
      const result = await manager.loadEnabledPlugins();
      expect(result.loaded).toEqual(['quickadd']);
      expect(manager.getLoader().getLoadedPlugins().map((loaded) => loaded.manifest.id)).toEqual(['quickadd']);
      expect(manager.getLoader().getApp().getCommands().map((command) => command.id)).toEqual(['old-command']);
      expect(manager.list()[0]).toMatchObject({
        id: 'quickadd',
        enabled: true,
        loaded: true,
        runtime: {
          commands: 1,
          statusBarItems: 1,
        },
      });
    });

    const { POST } = await importRoute();
    const res = await POST(postRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
      expectedRemoteVersion: '1.2.3',
      expectedPackageDigest: remotePackageDigest('1.2.3'),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.plugins).toEqual([
      expect.objectContaining({
        id: 'quickadd',
        version: '1.2.3',
        enabled: true,
        loaded: false,
      }),
    ]);
    await withObsidianPluginRuntime(mindRoot, (manager) => {
      expect(manager.getLoader().getLoadedPlugins()).toEqual([]);
      expect(manager.getLoader().getApp().getCommands()).toEqual([]);
      expect(manager.list()[0]).toMatchObject({
        id: 'quickadd',
        version: '1.2.3',
        enabled: true,
        loaded: false,
        runtime: {
          commands: 0,
          statusBarItems: 0,
        },
      });
    });
  });

  it('rejects stale preview versions without changing local files', async () => {
    writeInstalledPlugin('quickadd', '1.0.0');
    stubRemotePlugin('1.2.3');

    const { POST } = await importRoute();
    const res = await POST(postRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
      expectedRemoteVersion: '1.2.2',
      expectedPackageDigest: remotePackageDigest('1.2.3'),
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Remote plugin version changed from 1.2.2 to 1.2.3. Preview the update again.',
    });
    expect(JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'manifest.json'), 'utf-8'))).toMatchObject({
      version: '1.0.0',
    });
  });

  it('rejects stale preview package digests without changing local files', async () => {
    writeInstalledPlugin('quickadd', '1.0.0');
    stubRemotePlugin('1.2.3');

    const { POST } = await importRoute();
    const res = await POST(postRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
      expectedRemoteVersion: '1.2.3',
      expectedPackageDigest: 'stale-preview-digest',
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Remote plugin package changed since preview. Preview the update again.',
    });
    expect(JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'manifest.json'), 'utf-8'))).toMatchObject({
      version: '1.0.0',
    });
    expect(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'main.js'), 'utf-8')).not.toContain('QuickAddUpdated');
  });
});
