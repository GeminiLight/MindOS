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
  options?: { styles?: string; data?: object; manifest?: Record<string, unknown>; configDir?: string },
) => {
  const pluginDir = path.join(vaultRoot, options?.configDir ?? '.obsidian', 'plugins', pluginId);
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

const writeObsidianConfig = (fileName: string, value: unknown, configDir = '.obsidian') => {
  const obsidianDir = path.join(vaultRoot, configDir);
  fs.mkdirSync(obsidianDir, { recursive: true });
  fs.writeFileSync(
    path.join(obsidianDir, fileName),
    typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    'utf-8',
  );
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
    writeObsidianConfig('community-plugins.json', ['quickadd-like']);
    writeObsidianConfig('hotkeys.json', {
      'quickadd-like:capture': [{ modifiers: ['Mod', 'Shift'], key: 'Q' }],
      'app:open-vault': [{ modifiers: ['Mod'], key: 'O' }],
    });

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
      compatibilityLevel: 'partial',
      hasStyles: true,
      hasData: true,
      obsidianConfig: {
        enabledInObsidian: true,
        hasEnabledList: true,
        hotkeyCount: 1,
        hotkeys: [{
          commandId: 'quickadd-like:capture',
          hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'Q' }],
        }],
      },
    });

    const desktopOnly = result.plugins.find((item) => item.id === 'desktop-only-like');
    expect(desktopOnly).toMatchObject({ compatibilityLevel: 'blocked' });
    expect(desktopOnly?.obsidianConfig).toMatchObject({ enabledInObsidian: false, hasEnabledList: true, hotkeyCount: 0 });
    expect(desktopOnly?.compatibility.nodeModules).toContain('electron');
    expect(result.vault).toMatchObject({ pluginsDirFound: true, hasEnabledList: true, configDir: '.obsidian', pluginsRelativePath: '.obsidian/plugins' });
  });

  it('scans custom Obsidian config folders and reads their enabled list and hotkeys', async () => {
    writeObsidianConfig('community-plugins.json', ['custom-plugin'], '.obsidian-mobile');
    writeObsidianConfig('hotkeys.json', {
      'custom-plugin:open': [{ modifiers: ['Mod'], key: 'M' }],
    }, '.obsidian-mobile');
    writeVaultPlugin(
      'custom-plugin',
      `const { Plugin } = require('obsidian'); module.exports = class CustomPlugin extends Plugin {};`,
      { configDir: '.obsidian-mobile' },
    );

    const result = await scanObsidianVaultPlugins(vaultRoot, { configDir: '.obsidian-mobile' });

    expect(result.vault).toMatchObject({
      pluginsDirFound: true,
      hasEnabledList: true,
      configDir: '.obsidian-mobile',
      pluginsRelativePath: '.obsidian-mobile/plugins',
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({
      id: 'custom-plugin',
      obsidianConfig: {
        enabledInObsidian: true,
        hasEnabledList: true,
        hotkeyCount: 1,
        hotkeys: [{
          commandId: 'custom-plugin:open',
          hotkeys: [{ modifiers: ['Mod'], key: 'M' }],
        }],
      },
    });
  });

  it('skips invalid manifests and reports the reason', async () => {
    writeObsidianConfig('community-plugins.json', '{invalid-json');
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

  it('imports an Obsidian plugin into MindOS .mindos/plugins and preserves data and styles', async () => {
    writeObsidianConfig('community-plugins.json', ['import-me']);
    writeObsidianConfig('hotkeys.json', { 'import-me:open': [{ modifiers: ['Mod'], key: 'I' }] });
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

    expect(imported.targetDir).toBe(path.join(mindRoot, '.mindos', 'plugins', 'import-me'));
    expect(fs.existsSync(path.join(imported.targetDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(imported.targetDir, 'main.js'))).toBe(true);
    expect(fs.existsSync(path.join(imported.targetDir, 'styles.css'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(imported.targetDir, 'data.json'), 'utf-8'))).toEqual({ count: 2 });
    expect(JSON.parse(fs.readFileSync(path.join(imported.targetDir, 'obsidian-import.json'), 'utf-8'))).toEqual({
      schemaVersion: 1,
      source: 'obsidian',
      pluginId: 'import-me',
      sourceConfigDir: '.obsidian',
      enabledInObsidian: true,
      hasEnabledList: true,
      hotkeyCount: 1,
      hotkeys: [{
        commandId: 'import-me:open',
        hotkeys: [{ modifiers: ['Mod'], key: 'I' }],
      }],
    });
    expect(imported.obsidianConfig.enabledInObsidian).toBe(true);
    expect(imported.copiedFiles).toEqual(['manifest.json', 'main.js', 'styles.css', 'data.json', 'obsidian-import.json']);
  });

  it('returns a safe MindOS Linter profile mapping when importing Obsidian Linter data.json', async () => {
    writeVaultPlugin(
      'obsidian-linter',
      `const { Plugin } = require('obsidian'); module.exports = class ObsidianLinter extends Plugin {};`,
      {
        data: {
          ruleConfigs: {
            'trailing-spaces': { enabled: false },
            'consecutive-blank-lines': { enabled: false },
            'line-break-at-document-end': { enabled: true },
            'yaml-title': { enabled: false },
          },
        },
      },
    );

    const imported = await importObsidianPlugin({
      vaultRoot,
      pluginId: 'obsidian-linter',
      targetMindRoot: mindRoot,
    });

    expect(JSON.parse(fs.readFileSync(path.join(imported.targetDir, 'data.json'), 'utf-8'))).toMatchObject({
      ruleConfigs: {
        'trailing-spaces': { enabled: false },
      },
    });
    expect(imported.linterProfile).toMatchObject({
      schemaVersion: 1,
      source: 'obsidian-linter-data-json',
      pluginId: 'obsidian-linter',
      mappedRules: ['trailing-whitespace', 'multiple-blank-lines', 'missing-final-newline'],
      ignoredRules: ['yaml-title'],
      profile: {
        enabledRules: {
          'trailing-whitespace': false,
          'multiple-blank-lines': false,
          'missing-final-newline': true,
        },
      },
    });
    expect(JSON.parse(fs.readFileSync(path.join(imported.targetDir, 'obsidian-import.json'), 'utf-8'))).not.toHaveProperty('linterProfile');
  });

  it('imports from a custom config folder and records its source config directory', async () => {
    writeObsidianConfig('community-plugins.json', ['custom-import'], 'config/obsidian');
    writeObsidianConfig('hotkeys.json', { 'custom-import:open': [{ modifiers: ['Mod'], key: 'U' }] }, 'config/obsidian');
    writeVaultPlugin(
      'custom-import',
      `const { Plugin } = require('obsidian'); module.exports = class CustomImport extends Plugin {};`,
      { configDir: 'config/obsidian' },
    );

    const imported = await importObsidianPlugin({
      vaultRoot,
      pluginId: 'custom-import',
      targetMindRoot: mindRoot,
      configDir: 'config/obsidian',
    });

    expect(imported.targetDir).toBe(path.join(mindRoot, '.mindos', 'plugins', 'custom-import'));
    expect(imported.obsidianConfig).toMatchObject({
      sourceConfigDir: 'config/obsidian',
      enabledInObsidian: true,
      hotkeyCount: 1,
    });
    expect(JSON.parse(fs.readFileSync(path.join(imported.targetDir, 'obsidian-import.json'), 'utf-8'))).toMatchObject({
      sourceConfigDir: 'config/obsidian',
      hotkeys: [{
        commandId: 'custom-import:open',
        hotkeys: [{ modifiers: ['Mod'], key: 'U' }],
      }],
    });
  });

  it('skips plugin folders whose directory name does not match the manifest id', async () => {
    writeVaultPlugin(
      'folder-name',
      `const { Plugin } = require('obsidian'); module.exports = class Mismatch extends Plugin {};`,
      { manifest: { id: 'manifest-id', name: 'Mismatch', version: '1.0.0' } },
    );

    const result = await scanObsidianVaultPlugins(vaultRoot);

    expect(result.plugins).toEqual([]);
    expect(result.skipped).toEqual([
      {
        dirName: 'folder-name',
        reason: 'Plugin folder name "folder-name" does not match manifest id "manifest-id".',
      },
    ]);
  });

  it('rejects importing a plugin when the source manifest id does not match the requested id', async () => {
    writeVaultPlugin(
      'folder-name',
      `const { Plugin } = require('obsidian'); module.exports = class Mismatch extends Plugin {};`,
      { manifest: { id: 'manifest-id', name: 'Mismatch', version: '1.0.0' } },
    );

    await expect(importObsidianPlugin({
      vaultRoot,
      pluginId: 'folder-name',
      targetMindRoot: mindRoot,
    })).rejects.toThrow(/manifest id does not match/);
  });

  it('rejects source plugin files that are symlinks outside the plugin directory', async () => {
    const pluginDir = path.join(vaultRoot, '.obsidian', 'plugins', 'symlink-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify({ id: 'symlink-plugin', name: 'Symlink Plugin', version: '1.0.0' }, null, 2),
      'utf-8',
    );
    const outsideFile = path.join(vaultRoot, 'outside-main.js');
    fs.writeFileSync(outsideFile, `const { Plugin } = require('obsidian'); module.exports = class Outside extends Plugin {};`, 'utf-8');
    fs.symlinkSync(outsideFile, path.join(pluginDir, 'main.js'));

    const result = await scanObsidianVaultPlugins(vaultRoot);

    expect(result.plugins).toEqual([]);
    expect(result.skipped).toEqual([
      { dirName: 'symlink-plugin', reason: 'Plugin file must be a regular file: main.js' },
    ]);

    await expect(importObsidianPlugin({
      vaultRoot,
      pluginId: 'symlink-plugin',
      targetMindRoot: mindRoot,
    })).rejects.toThrow(/symlink|regular file/);
    expect(fs.existsSync(path.join(mindRoot, '.mindos', 'plugins', 'symlink-plugin', 'main.js'))).toBe(false);
  });

  it('reports missing required plugin files without leaking absolute paths', async () => {
    const pluginDir = path.join(vaultRoot, '.obsidian', 'plugins', 'missing-main');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify({ id: 'missing-main', name: 'Missing Main', version: '1.0.0' }, null, 2),
      'utf-8',
    );

    const result = await scanObsidianVaultPlugins(vaultRoot);

    expect(result.plugins).toEqual([]);
    expect(result.skipped).toEqual([
      { dirName: 'missing-main', reason: 'Missing plugin file: main.js' },
    ]);
    expect(result.skipped[0].reason).not.toContain(vaultRoot);
  });

  it('rejects importing into a symlinked MindOS .mindos/plugins directory outside mindRoot', async () => {
    writeVaultPlugin(
      'import-me',
      `const { Plugin } = require('obsidian'); module.exports = class ImportMe extends Plugin {};`,
    );
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-target-outside-'));
    fs.mkdirSync(path.join(mindRoot, '.mindos'), { recursive: true });
    fs.symlinkSync(outsideRoot, path.join(mindRoot, '.mindos', 'plugins'), 'dir');

    try {
      await expect(importObsidianPlugin({
        vaultRoot,
        pluginId: 'import-me',
        targetMindRoot: mindRoot,
      })).rejects.toThrow(/escapes/i);
      expect(fs.existsSync(path.join(outsideRoot, 'import-me', 'manifest.json'))).toBe(false);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
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

  it('rejects unsafe Obsidian config folder overrides', async () => {
    await expect(scanObsidianVaultPlugins(vaultRoot, { configDir: '../outside' })).rejects.toThrow(/config folder escapes/i);
    await expect(importObsidianPlugin({
      vaultRoot,
      pluginId: 'escape-config',
      targetMindRoot: mindRoot,
      configDir: '/tmp/.obsidian',
    })).rejects.toThrow(/config folder must be relative/i);
  });
});
