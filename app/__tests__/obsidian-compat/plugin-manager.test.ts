import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';

let mindRoot: string;

const writePlugin = (pluginId: string, mainJs: string) => {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
};

describe('PluginManager', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-manager-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('discovers plugins and marks them disabled by default', async () => {
    writePlugin('alpha-plugin', `const { Plugin } = require('obsidian'); module.exports = class AlphaPlugin extends Plugin {};`);

    const manager = new PluginManager(mindRoot);
    const plugins = await manager.discover();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      id: 'alpha-plugin',
      enabled: false,
      loaded: false,
      compatibilityLevel: 'compatible',
    });
  });

  it('persists enabled state across manager instances', async () => {
    writePlugin('persist-plugin', `const { Plugin } = require('obsidian'); module.exports = class PersistPlugin extends Plugin {};`);

    const first = new PluginManager(mindRoot);
    await first.discover();
    await first.enable('persist-plugin');

    const second = new PluginManager(mindRoot);
    const plugins = await second.discover();

    expect(plugins[0]).toMatchObject({ id: 'persist-plugin', enabled: true });
  });

  it('loads only enabled plugins', async () => {
    writePlugin('enabled-plugin', `
      const { Plugin } = require('obsidian');
      module.exports = class EnabledPlugin extends Plugin {
        onload() {
          this.addCommand({ id: 'enabled', name: 'Enabled', callback: () => {} });
        }
      };
    `);
    writePlugin('disabled-plugin', `const { Plugin } = require('obsidian'); module.exports = class DisabledPlugin extends Plugin {};`);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('enabled-plugin');
    const result = await manager.loadEnabledPlugins();

    expect(result.loaded).toEqual(['enabled-plugin']);
    expect(result.failed).toEqual([]);

    const plugins = manager.list();
    expect(plugins.find((item) => item.id === 'enabled-plugin')).toMatchObject({ enabled: true, loaded: true });
    expect(plugins.find((item) => item.id === 'disabled-plugin')).toMatchObject({ enabled: false, loaded: false });
  });

  it('captures plugin load errors without aborting the whole load pass', async () => {
    writePlugin('good-plugin', `const { Plugin } = require('obsidian'); module.exports = class GoodPlugin extends Plugin {};`);
    writePlugin('bad-plugin', `
      const { Plugin } = require('obsidian');
      const electron = require('electron');
      module.exports = class BadPlugin extends Plugin {
        onload() {
          throw new Error('boom');
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('good-plugin');
    await manager.enable('bad-plugin');
    const result = await manager.loadEnabledPlugins();

    expect(result.loaded).toContain('good-plugin');
    expect(result.failed).toContain('bad-plugin');

    const bad = manager.list().find((item) => item.id === 'bad-plugin');
    expect(bad?.compatibilityLevel).toBe('blocked');
    expect(bad?.compatibility?.nodeModules).toContain('electron');
    expect(bad?.lastError).toMatch(/Unsupported module: electron|boom/);
  });

  it('disables and unloads a loaded plugin', async () => {
    writePlugin('toggle-plugin', `const { Plugin } = require('obsidian'); module.exports = class TogglePlugin extends Plugin {};`);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('toggle-plugin');
    await manager.loadEnabledPlugins();
    await manager.disable('toggle-plugin');

    const plugin = manager.list().find((item) => item.id === 'toggle-plugin');
    expect(plugin).toMatchObject({ enabled: false, loaded: false });
  });

  it('scans an external Obsidian vault and imports a selected plugin into the manager root', async () => {
    const sourceVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-import-source-'));
    try {
      const sourcePluginDir = path.join(sourceVault, '.obsidian', 'plugins', 'ported-plugin');
      fs.mkdirSync(sourcePluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(sourcePluginDir, 'manifest.json'),
        JSON.stringify({ id: 'ported-plugin', name: 'ported-plugin', version: '1.0.0' }, null, 2),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(sourcePluginDir, 'main.js'),
        `const { Plugin } = require('obsidian'); module.exports = class PortedPlugin extends Plugin {};`,
        'utf-8',
      );

      const manager = new PluginManager(mindRoot);
      const scanned = await manager.scanObsidianVault(sourceVault);
      expect(scanned.plugins[0]).toMatchObject({ id: 'ported-plugin', compatibilityLevel: 'compatible' });

      await manager.importFromObsidianVault(sourceVault, 'ported-plugin');
      const plugins = await manager.discover();
      expect(plugins.find((item) => item.id === 'ported-plugin')).toBeTruthy();
    } finally {
      fs.rmSync(sourceVault, { recursive: true, force: true });
    }
  });
});
