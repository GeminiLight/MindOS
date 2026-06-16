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

function writePlugin(pluginId: string, mainJs: string, manifest: Record<string, unknown> = {}) {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: 'Catalog Plugin', version: '1.0.0', ...manifest }, null, 2),
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
  return import('../../app/api/plugins/catalog/route');
}

describe('/api/plugins/catalog', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-plugin-catalog-api-'));
    testState.mindRoot = mindRoot;
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns one catalog containing built-in extension manifests and loaded Obsidian plugins', async () => {
    writePlugin(
      'catalog-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class CatalogPlugin extends Plugin {
          async onload() {
            await this.saveData({ inbox: 'Inbox.md', enabled: true });
            this.addCommand({ id: 'capture', name: 'Capture item', callback: () => {} });
            this.addRibbonIcon('sparkles', 'Capture from ribbon', () => {});
          }
        };
      `,
      {
        name: 'Catalog Plugin',
        minAppVersion: '1.7.2',
        description: 'Catalog plugin description.',
        author: 'Fixture Author',
        authorUrl: 'https://example.com/author',
        fundingUrl: { Sponsor: 'https://example.com/sponsor' },
        isDesktopOnly: false,
      },
    );
    fs.writeFileSync(
      path.join(mindRoot, '.plugins', 'catalog-plugin', 'obsidian-community.json'),
      JSON.stringify({
        source: 'obsidian-community',
        pluginId: 'catalog-plugin',
        repo: 'owner/catalog-plugin',
        githubUrl: 'https://github.com/owner/catalog-plugin',
        installedAt: '2026-06-14T00:00:00.000Z',
        compatibilityLevel: 'compatible',
      }, null, 2),
      'utf-8',
    );
    enablePlugin('catalog-plugin');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/catalog?loadEnabled=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({ loaded: ['catalog-plugin'], failed: [], skipped: [] });
    expect(json.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'backlinks',
        source: 'mindos-renderer',
        name: 'Backlinks Explorer',
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        status: 'enabled',
        enabled: true,
        loaded: true,
        manifest: expect.objectContaining({
          id: 'backlinks',
          name: 'Backlinks Explorer',
          version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
          minAppVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
          description: expect.any(String),
          author: 'MindOS',
          isDesktopOnly: false,
        }),
        surfaces: expect.objectContaining({
          total: 1,
          available: 1,
          byKind: expect.objectContaining({ 'document-renderer': 1 }),
        }),
        metadata: expect.objectContaining({
          manifest: expect.objectContaining({
            id: 'backlinks',
            isDesktopOnly: false,
          }),
        }),
      }),
      expect.objectContaining({
        id: 'catalog-plugin',
        source: 'obsidian',
        name: 'Catalog Plugin',
        description: 'Catalog plugin description.',
        author: 'Fixture Author',
        status: 'loaded',
        enabled: true,
        loaded: true,
        manifest: expect.objectContaining({
          id: 'catalog-plugin',
          name: 'Catalog Plugin',
          version: '1.0.0',
          minAppVersion: '1.7.2',
          description: 'Catalog plugin description.',
          author: 'Fixture Author',
          authorUrl: 'https://example.com/author',
          fundingUrl: { Sponsor: 'https://example.com/sponsor' },
        }),
        compatibility: expect.objectContaining({
          level: 'partial',
          kind: 'limited',
          label: 'Limited',
        }),
        surfaces: expect.objectContaining({
          total: 2,
          available: 2,
          byKind: expect.objectContaining({
            command: 1,
            ribbon: 1,
          }),
        }),
        metadata: expect.objectContaining({
          manifest: expect.objectContaining({
            id: 'catalog-plugin',
            author: 'Fixture Author',
          }),
          dataFile: expect.objectContaining({
            exists: true,
            bytes: expect.any(Number),
            validJson: true,
          }),
          communityOrigin: expect.objectContaining({
            source: 'obsidian-community',
            repo: 'owner/catalog-plugin',
            validJson: true,
          }),
        }),
      }),
    ]));
    expect(json.counts).toMatchObject({
      total: expect.any(Number),
      enabled: expect.any(Number),
      loaded: expect.any(Number),
      bySource: expect.objectContaining({
        obsidian: 1,
        'mindos-renderer': expect.any(Number),
      }),
      buckets: expect.objectContaining({
        all: expect.any(Number),
        mindos: expect.any(Number),
        obsidian: 1,
        problem: 0,
      }),
      surfaces: expect.objectContaining({
        total: expect.any(Number),
        available: expect.any(Number),
      }),
    });
  });

  it('keeps blocked Obsidian plugins in the catalog without loading their surfaces', async () => {
    writePlugin(
      'desktop-only-plugin',
      `
        const fs = require('fs');
        const { Plugin } = require('obsidian');
        module.exports = class DesktopOnlyPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'unsafe', name: 'Unsafe command', callback: () => fs.readFileSync('/tmp/x') });
          }
        };
      `,
      { name: 'Desktop Only Plugin' },
    );
    enablePlugin('desktop-only-plugin');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/catalog?loadEnabled=1'));
    const json = await res.json();
    const item = json.plugins.find((plugin: { id: string }) => plugin.id === 'desktop-only-plugin');

    expect(res.status).toBe(200);
    expect(json.result).toEqual({ loaded: [], failed: [], skipped: ['desktop-only-plugin'] });
    expect(item).toMatchObject({
      id: 'desktop-only-plugin',
      source: 'obsidian',
      status: 'blocked',
      enabled: true,
      loaded: false,
      compatibility: expect.objectContaining({
        level: 'blocked',
        kind: 'blocked',
        blockers: [expect.stringContaining('fs')],
      }),
      metadata: expect.objectContaining({
        moduleImports: expect.arrayContaining(['fs']),
        nodeModules: expect.arrayContaining(['fs']),
        unsupportedModules: expect.arrayContaining(['fs']),
      }),
      surfaces: expect.objectContaining({
        total: 0,
      }),
    });
    expect(json.counts.blocked).toBeGreaterThanOrEqual(1);
  });

  it('filters catalog plugins by source and status', async () => {
    writePlugin(
      'blocked-plugin',
      `
        const fs = require('fs');
        const { Plugin } = require('obsidian');
        module.exports = class BlockedPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'unsafe', name: 'Unsafe command', callback: () => fs.readFileSync('/tmp/x') });
          }
        };
      `,
      { name: 'Blocked Plugin' },
    );
    enablePlugin('blocked-plugin');

    const { GET } = await importRoute();
    const obsidianRes = await GET(new NextRequest('http://localhost/api/plugins/catalog?loadEnabled=1&source=obsidian'));
    const obsidianJson = await obsidianRes.json();
    const blockedRes = await GET(new NextRequest('http://localhost/api/plugins/catalog?loadEnabled=1&source=obsidian&status=blocked'));
    const blockedJson = await blockedRes.json();
    const problemRes = await GET(new NextRequest('http://localhost/api/plugins/catalog?loadEnabled=1&bucket=problem'));
    const problemJson = await problemRes.json();

    expect(obsidianRes.status).toBe(200);
    expect(obsidianJson.plugins).toHaveLength(1);
    expect(obsidianJson.plugins[0]).toMatchObject({
      id: 'blocked-plugin',
      source: 'obsidian',
      status: 'blocked',
    });
    expect(obsidianJson.counts.bySource).toEqual({ obsidian: 1, 'mindos-renderer': 0 });

    expect(blockedRes.status).toBe(200);
    expect(blockedJson.plugins).toHaveLength(1);
    expect(blockedJson.plugins[0]).toMatchObject({
      id: 'blocked-plugin',
      source: 'obsidian',
      status: 'blocked',
    });
    expect(blockedJson.counts).toMatchObject({
      total: 1,
      blocked: 1,
      bySource: { obsidian: 1, 'mindos-renderer': 0 },
      buckets: expect.objectContaining({
        all: 1,
        obsidian: 1,
        problem: 1,
      }),
    });

    expect(problemRes.status).toBe(200);
    expect(problemJson.plugins).toHaveLength(1);
    expect(problemJson.plugins[0]).toMatchObject({
      id: 'blocked-plugin',
      source: 'obsidian',
      status: 'blocked',
    });
    expect(problemJson.counts).toMatchObject({
      total: 1,
      blocked: 1,
      bySource: { obsidian: 1, 'mindos-renderer': 0 },
      buckets: expect.objectContaining({
        all: 1,
        problem: 1,
      }),
    });
  });
});
