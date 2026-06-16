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

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/obsidian/community-catalog/install', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function mockCommunityFetch(options: {
  manifest?: Record<string, unknown>;
  mainJs?: string;
  stylesCss?: string | null;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/manifest.json')) {
      return new Response(JSON.stringify(options.manifest ?? {
        id: 'quickadd',
        name: 'QuickAdd',
        version: '1.2.3',
      }), { status: 200 });
    }
    if (url.endsWith('/main.js')) {
      return new Response(options.mainJs ?? "const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
    }
    if (url.endsWith('/styles.css') && options.stylesCss !== null) {
      return new Response(options.stylesCss ?? '.quickadd { display: block; }', { status: 200 });
    }
    return new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function importRoute() {
  return import('../../app/api/obsidian/community-catalog/install/route');
}

describe('/api/obsidian/community-catalog/install', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-community-install-api-'));
    testState.mindRoot = mindRoot;
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('requires explicit confirmation', async () => {
    const fetchMock = mockCommunityFetch();
    const { POST } = await importRoute();

    const res = await POST(createRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Community plugin install requires explicit confirmation.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('installs a compatible community plugin into the configured MindOS root without enabling it', async () => {
    const fetchMock = mockCommunityFetch();
    const { POST } = await importRoute();
    const ignoredRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ignored-install-target-'));

    try {
      const res = await POST(createRequest({
        repo: 'owner/quickadd',
        pluginId: 'quickadd',
        confirm: true,
        targetMindRoot: ignoredRoot,
      }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(json).toMatchObject({
        ok: true,
        plugin: {
          id: 'quickadd',
          name: 'QuickAdd',
          repo: 'owner/quickadd',
        },
        installed: {
          pluginId: 'quickadd',
          targetDir: path.join(mindRoot, '.plugins', 'quickadd'),
          enabled: false,
          loaded: false,
          source: 'obsidian-community',
        },
        preflight: {
          installable: true,
        },
      });
      expect(fs.existsSync(path.join(ignoredRoot, '.plugins', 'quickadd'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '.plugins', '.plugin-manager.json'))).toBe(false);
      expect(fs.existsSync(path.join(mindRoot, '.plugins', 'quickadd', 'obsidian-community.json'))).toBe(true);
    } finally {
      fs.rmSync(ignoredRoot, { recursive: true, force: true });
    }
  });

  it('returns 409 for an already installed plugin and preserves the existing directory', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'local.txt'), 'keep', 'utf-8');
    const fetchMock = mockCommunityFetch();
    const { POST } = await importRoute();

    const res = await POST(createRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Obsidian plugin is already installed: quickadd',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(targetDir, 'local.txt'), 'utf-8')).toBe('keep');
  });

  it('returns 409 for blocked compatibility and does not create the plugin target', async () => {
    mockCommunityFetch({
      mainJs: "const fs = require('fs'); const { Plugin } = require('obsidian'); module.exports = class Bad extends Plugin {};",
    });
    const { POST } = await importRoute();

    const res = await POST(createRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Requires unsupported runtime module: fs',
    });
    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'quickadd'))).toBe(false);
  });

  it('returns 409 for manifest id mismatches and does not create the plugin target', async () => {
    mockCommunityFetch({
      manifest: {
        id: 'other-id',
        name: 'Other',
        version: '1.0.0',
      },
    });
    const { POST } = await importRoute();

    const res = await POST(createRequest({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      confirm: true,
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Manifest id "other-id" does not match requested plugin id "quickadd".',
    });
    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'quickadd'))).toBe(false);
  });
});
