import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginLoader } from '@/lib/obsidian-compat/loader';
import { CompatError } from '@/lib/obsidian-compat/errors';

let mindRoot: string;

const writePlugin = (pluginId: string, manifest: object, mainJs: string) => {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
  return pluginDir;
};

describe('PluginLoader', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-loader-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('discovers only plugins with valid manifests', () => {
    writePlugin(
      'valid-plugin',
      { id: 'valid-plugin', name: 'Valid Plugin', version: '1.0.0' },
      "module.exports = class {}",
    );

    writePlugin(
      'invalid-plugin',
      { id: 'invalid plugin', name: 'Invalid Plugin', version: '1.0.0' },
      "module.exports = class {}",
    );

    const loader = new PluginLoader(mindRoot);
    const plugins = loader.discoverPlugins();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.id).toBe('valid-plugin');
  });

  it('loads a valid plugin and registers its command during onload', async () => {
    writePlugin(
      'hello-plugin',
      { id: 'hello-plugin', name: 'Hello Plugin', version: '1.0.0' },
      `
        const { Plugin } = require('obsidian');
        module.exports = class HelloPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'hello', name: 'Hello', callback: () => {} });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('hello-plugin');
    const commands = loader.getApp().getCommands();

    expect(loaded.manifest.id).toBe('hello-plugin');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.fullId).toBe('obsidian:hello-plugin:hello');
  });

  it('unloads a plugin and removes all its registered commands', async () => {
    writePlugin(
      'cleanup-plugin',
      { id: 'cleanup-plugin', name: 'Cleanup Plugin', version: '1.0.0' },
      `
        const { Plugin } = require('obsidian');
        module.exports = class CleanupPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'first', name: 'First', callback: () => {} });
            this.addCommand({ id: 'second', name: 'Second', callback: () => {} });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('cleanup-plugin');
    expect(loader.getApp().getCommands()).toHaveLength(2);

    await loader.unloadPlugin('cleanup-plugin');

    expect(loader.getApp().getCommands()).toHaveLength(0);
    expect(loader.getLoadedPlugins()).toHaveLength(0);
  });

  it('rejects plugins that require unsupported modules', async () => {
    writePlugin(
      'bad-plugin',
      { id: 'bad-plugin', name: 'Bad Plugin', version: '1.0.0' },
      `
        require('fs');
        const { Plugin } = require('obsidian');
        module.exports = class BadPlugin extends Plugin {};
      `,
    );

    const loader = new PluginLoader(mindRoot);

    await expect(loader.loadPlugin('bad-plugin')).rejects.toThrow(CompatError);
    await expect(loader.loadPlugin('bad-plugin')).rejects.toThrow(/Unsupported module: fs/);
  });

  it('rejects plugin ids that traverse outside the .plugins directory', async () => {
    const escapedDir = path.join(mindRoot, 'escaped-plugin');
    fs.mkdirSync(escapedDir, { recursive: true });
    fs.writeFileSync(
      path.join(escapedDir, 'manifest.json'),
      JSON.stringify({ id: 'escaped-plugin', name: 'Escaped Plugin', version: '1.0.0' }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(escapedDir, 'main.js'),
      `const { Plugin } = require('obsidian'); module.exports = class EscapedPlugin extends Plugin {};`,
      'utf-8',
    );

    const loader = new PluginLoader(mindRoot);

    await expect(loader.loadPlugin('../escaped-plugin')).rejects.toThrow();
  });
});
