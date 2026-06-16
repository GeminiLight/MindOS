import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

let mindRoot: string;
const testState = vi.hoisted(() => ({ mindRoot: '' }));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ mindRoot: testState.mindRoot }),
}));

async function importRoute() {
  return import('../../app/api/obsidian/community-catalog/update-plan/route');
}

function writeInstalledPlugin(pluginId: string, version = '1.0.0', options: { communityMetadata?: boolean } = {}) {
  const { communityMetadata = true } = options;
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: 'QuickAdd', version }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), 'local main', 'utf-8');
  if (communityMetadata) {
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
      return new Response("const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
    }
    if (url.endsWith('/styles.css')) {
      return new Response('missing', { status: 404 });
    }
    return new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function expectSha256Digest() {
  return expect.stringMatching(/^[a-f0-9]{64}$/);
}

describe('/api/obsidian/community-catalog/update-plan', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-community-update-plan-api-'));
    testState.mindRoot = mindRoot;
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects missing repo or plugin id', async () => {
    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/update-plan?repo=owner/quickadd'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing repo or pluginId' });
  });

  it('returns a read-only update plan for an installed community plugin', async () => {
    writeInstalledPlugin('quickadd', '1.0.0');
    const fetchMock = stubRemotePlugin('1.2.3');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/update-plan?repo=owner/quickadd&pluginId=quickadd'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(json).toMatchObject({
      ok: true,
      readOnly: true,
      writePolicy: 'preview-only',
      plugin: {
        id: 'quickadd',
        repo: 'owner/quickadd',
      },
      installed: {
        pluginId: 'quickadd',
        targetDir: path.join(mindRoot, '.plugins', 'quickadd'),
        version: '1.0.0',
        hasCommunityMetadata: true,
      },
      version: {
        installed: '1.0.0',
        remote: '1.2.3',
        state: 'update-available',
      },
      packageDigest: {
        algorithm: 'sha256',
        manifestJson: expectSha256Digest(),
        mainJs: expectSha256Digest(),
        package: expectSha256Digest(),
      },
      updatable: true,
      blockedReasons: [],
    });
    expect(json.files).toEqual([
      expect.objectContaining({ path: 'manifest.json', action: 'modify' }),
      expect.objectContaining({ path: 'main.js', action: 'modify' }),
      expect.objectContaining({ path: 'styles.css', action: 'unchanged' }),
      expect.objectContaining({ path: 'obsidian-community.json', action: 'refresh', generated: true }),
    ]);
    expect(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'main.js'), 'utf-8')).toBe('local main');
  });

  it('returns 404 when previewing a plugin that is not installed locally', async () => {
    const fetchMock = stubRemotePlugin('1.2.3');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/update-plan?repo=owner/quickadd&pluginId=quickadd'));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Obsidian plugin is not installed: quickadd' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects locally imported plugins without community provenance before fetching remote assets', async () => {
    writeInstalledPlugin('quickadd', '1.0.0', { communityMetadata: false });
    const fetchMock = stubRemotePlugin('1.2.3');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian/community-catalog/update-plan?repo=owner/quickadd&pluginId=quickadd'));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Community plugin update requires Obsidian Community provenance for quickadd.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(mindRoot, '.plugins', 'quickadd', 'main.js'), 'utf-8')).toBe('local main');
  });
});
