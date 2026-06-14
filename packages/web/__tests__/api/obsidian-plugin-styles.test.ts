import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

function writePluginStyle(pluginId: string, css: string) {
  fs.writeFileSync(path.join(mindRoot, '.plugins', pluginId, 'styles.css'), css, 'utf-8');
}

function enablePlugin(...pluginIds: string[]) {
  fs.mkdirSync(path.join(mindRoot, '.plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(mindRoot, '.plugins', '.plugin-manager.json'),
    JSON.stringify({ enabled: Object.fromEntries(pluginIds.map((pluginId) => [pluginId, true])) }, null, 2),
    'utf-8',
  );
}

function styleGetRequest(pluginId: string) {
  const url = new URL('http://localhost/api/obsidian-plugins/styles');
  url.searchParams.set('pluginId', pluginId);
  return new NextRequest(url);
}

async function importRoute() {
  return import('../../app/api/obsidian-plugins/styles/route');
}

describe('/api/obsidian-plugins/styles', () => {
  beforeEach(() => {
    resetObsidianPluginRuntimeServicesForTests();
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-plugin-styles-api-'));
    testState.mindRoot = mindRoot;
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    vi.clearAllMocks();
    resetObsidianPluginRuntimeServicesForTests();
  });

  it('returns a scoped stylesheet for an enabled loaded plugin', async () => {
    writePlugin(
      'style-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class StylePlugin extends Plugin {
          onload() {
            this.registerView('style-view', () => ({}));
          }
        };
      `,
    );
    writePluginStyle(
      'style-plugin',
      `
        :root { --plugin-accent: red; }
        .plugin-card, button:hover { color: var(--plugin-accent); }
        @media (min-width: 720px) { body .plugin-card { padding: 12px; } }
        @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
      `,
    );
    enablePlugin('style-plugin');

    const { GET } = await importRoute();
    const res = await GET(styleGetRequest('style-plugin'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.stylesheet).toMatchObject({
      pluginId: 'style-plugin',
      path: 'styles.css',
      scopeSelector: '[data-obsidian-plugin-view="style-plugin"]',
    });
    expect(json.stylesheet.bytes).toBeGreaterThan(0);
    expect(json.stylesheet.css).toContain('.plugin-card');
    expect(json.stylesheet.scopedCss).toContain('[data-obsidian-plugin-view="style-plugin"] .plugin-card');
    expect(json.stylesheet.scopedCss).toContain('[data-obsidian-plugin-view="style-plugin"] button:hover');
    expect(json.stylesheet.scopedCss).toContain('@media (min-width: 720px)');
    expect(json.stylesheet.scopedCss).not.toContain('@keyframes');
  });

  it('does not expose stylesheets for disabled plugins', async () => {
    writePlugin('disabled-style', `const { Plugin } = require('obsidian'); module.exports = class DisabledStyle extends Plugin {};`);
    writePluginStyle('disabled-style', '.disabled-style { display: block; }');

    const { GET } = await importRoute();
    const res = await GET(styleGetRequest('disabled-style'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('enabled plugins');
  });

  it('does not expose stylesheets for plugins blocked by compatibility checks', async () => {
    writePlugin('blocked-style', `const fs = require('fs'); module.exports = class BlockedStyle {};`);
    writePluginStyle('blocked-style', '.blocked-style { display: block; }');
    enablePlugin('blocked-style');

    const { GET } = await importRoute();
    const res = await GET(styleGetRequest('blocked-style'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('unsupported runtime module');
  });

  it('rejects oversized plugin stylesheets before reading content', async () => {
    writePlugin('large-style', `const { Plugin } = require('obsidian'); module.exports = class LargeStyle extends Plugin {};`);
    writePluginStyle('large-style', `.large-style { color: red; }\n${'a'.repeat(256 * 1024)}`);
    enablePlugin('large-style');

    const { GET } = await importRoute();
    const res = await GET(styleGetRequest('large-style'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('too large');
  });
});
