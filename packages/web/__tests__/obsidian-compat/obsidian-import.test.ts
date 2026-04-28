import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  importObsidianPlugin,
  scanObsidianVaultPlugins,
} from '@/lib/obsidian-compat/obsidian-import';

let vaultRoot: string;
let mindRoot: string;

const writeVaultPlugin = (
  pluginId: string,
  mainJs: string,
  options?: { styles?: string; data?: object; manifest?: Record<string, unknown> },
) => {
  const pluginDir = path.join(vaultRoot, '.obsidian', 'plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify(options?.manifest ?? { id: pluginId, name: pluginId, version: '1.0.0' }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
  if (options?.styles) {
    fs.writeFileSync(path.join(pluginDir, 'styles.css'), options.styles, 'utf-8');
  }
  if (options?.data) {
    fs.writeFileSync(path.join(pluginDir, 'data.json'), JSON.stringify(options.data, null, 2), 'utf-8');
  }
};

describe('obsidian import scanner', () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-vault-source-'));
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-vault-target-'));
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('scans .obsidian/plugins and returns compatibility summaries', async () => {
    writeVaultPlugin(
      'quickadd-like',
      `
        const { Plugin, Modal, Notice } = require('obsidian');
        module.exports = class QuickAddLike extends Plugin {
          onload() {
            this.addCommand({ id: 'capture', name: 'Capture', callback: () => new Notice('ok') });
          }
        };
      `,
      { styles: '.test { color: red; }', data: { enabled: true } },
    );

    writeVaultPlugin(
      'desktop-only-like',
      `
        const { Plugin } = require('obsidian');
        const electron = require('electron');
        module.exports = class DesktopOnly extends Plugin {};
      `,
    );

    const result = await scanObsidianVaultPlugins(vaultRoot);

    expect(result.plugins).toHaveLength(2);

    const quickadd = result.plugins.find((item) => item.id === 'quickadd-like');
    expect(quickadd).toMatchObject({
      compatibilityLevel: 'compatible',
      hasStyles: true,
      hasData: true,
    });

    const desktopOnly = result.plugins.find((item) => item.id === 'desktop-only-like');
    expect(desktopOnly).toMatchObject({ compatibilityLevel: 'blocked' });
    expect(desktopOnly?.compatibility.nodeModules).toContain('electron');
  });

  it('skips invalid manifests and reports the reason', async () => {
    writeVaultPlugin('good-plugin', `const { Plugin } = require('obsidian'); module.exports = class Good extends Plugin {};`);
    writeVaultPlugin(
      'bad-plugin',
      `const { Plugin } = require('obsidian'); module.exports = class Bad extends Plugin {};`,
      { manifest: { id: 'bad plugin', name: 'bad', version: '1.0.0' } },
    );

    // Create a plugin dir with no manifest at all
    const noManifestDir = path.join(vaultRoot, '.obsidian', 'plugins', 'no-manifest');
    fs.mkdirSync(noManifestDir, { recursive: true });
    fs.writeFileSync(path.join(noManifestDir, 'main.js'), 'module.exports = {}', 'utf-8');

    const result = await scanObsidianVaultPlugins(vaultRoot);

    expect(result.plugins.map((item) => item.id)).toEqual(['good-plugin']);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((item) => item.dirName).sort()).toEqual(['bad-plugin', 'no-manifest']);
    expect(result.skipped.every((item) => typeof item.reason === 'string' && item.reason.length > 0)).toBe(true);
  });

  it('imports an Obsidian plugin into MindOS .plugins and preserves data and styles', async () => {
    writeVaultPlugin(
      'import-me',
      `const { Plugin } = require('obsidian'); module.exports = class ImportMe extends Plugin {};`,
      { styles: '.plugin-style {}', data: { count: 2 } },
    );

    const imported = await importObsidianPlugin({
      vaultRoot,
      pluginId: 'import-me',
      targetMindRoot: mindRoot,
    });

    expect(imported.targetDir).toBe(path.join(mindRoot, '.plugins', 'import-me'));
    expect(fs.existsSync(path.join(imported.targetDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(imported.targetDir, 'main.js'))).toBe(true);
    expect(fs.existsSync(path.join(imported.targetDir, 'styles.css'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(imported.targetDir, 'data.json'), 'utf-8'))).toEqual({ count: 2 });
  });

  it('rejects importing plugins that escape the source plugins directory', async () => {
    await expect(
      importObsidianPlugin({
        vaultRoot,
        pluginId: '../escape',
        targetMindRoot: mindRoot,
      }),
    ).rejects.toThrow(/escapes/i);
  });
});
