import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';
import { MetadataCacheShim } from '@/lib/obsidian-compat/shims/metadata-cache';

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
      packageLocation: {
        relativePath: '.plugins/alpha-plugin',
        rootRelativePath: '.plugins',
        legacy: true,
        migrationAvailable: true,
      },
      coverageSummary: {
        full: expect.any(Number),
      },
    });
  });

  it('migrates legacy plugin packages into the canonical MindOS plugin directory', async () => {
    writePlugin('migrate-plugin', `const { Plugin } = require('obsidian'); module.exports = class MigratePlugin extends Plugin {};`);
    fs.writeFileSync(
      path.join(mindRoot, '.plugins', 'migrate-plugin', 'data.json'),
      JSON.stringify({ value: 1 }, null, 2),
      'utf-8',
    );
    fs.mkdirSync(path.join(mindRoot, '.plugins', 'migrate-plugin', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.plugins', 'migrate-plugin', 'nested', 'extra.txt'), 'extra', 'utf-8');
    fs.symlinkSync(
      path.join(mindRoot, '.plugins', 'migrate-plugin', 'data.json'),
      path.join(mindRoot, '.plugins', 'migrate-plugin', 'linked-data.json'),
    );

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('migrate-plugin');

    const plan = manager.previewLegacyMigration('migrate-plugin');
    expect(plan).toMatchObject({
      pluginId: 'migrate-plugin',
      canMigrate: true,
      sourceRelativePath: '.plugins/migrate-plugin',
      targetRelativePath: '.mindos/plugins/migrate-plugin',
      skipped: [{ path: 'linked-data.json', reason: 'symlink skipped' }],
    });
    expect(plan.files).toEqual(expect.arrayContaining(['manifest.json', 'main.js', 'data.json', 'nested/extra.txt']));

    const result = await manager.migrateLegacyPlugin('migrate-plugin');

    expect(result.migrated).toBe(true);
    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'migrate-plugin'))).toBe(false);
    expect(fs.existsSync(path.join(mindRoot, '.mindos', 'plugins', 'migrate-plugin', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(mindRoot, '.mindos', 'plugins', 'migrate-plugin', 'nested', 'extra.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mindRoot, '.mindos', 'plugins', 'migrate-plugin', 'linked-data.json'))).toBe(false);
    const state = JSON.parse(fs.readFileSync(path.join(mindRoot, '.mindos', 'plugins', '.plugin-manager.json'), 'utf-8'));
    expect(state.enabled).toEqual({ 'migrate-plugin': true });
    expect(manager.list()[0]).toMatchObject({
      id: 'migrate-plugin',
      enabled: true,
      packageLocation: {
        relativePath: '.mindos/plugins/migrate-plugin',
        rootRelativePath: '.mindos/plugins',
        legacy: false,
        migrationAvailable: false,
      },
    });
  });

  it('refuses legacy migration when the canonical plugin package already exists', async () => {
    writePlugin('conflict-plugin', `const { Plugin } = require('obsidian'); module.exports = class ConflictPlugin extends Plugin {};`);
    const canonicalDir = path.join(mindRoot, '.mindos', 'plugins', 'conflict-plugin');
    fs.mkdirSync(canonicalDir, { recursive: true });
    fs.writeFileSync(
      path.join(canonicalDir, 'manifest.json'),
      JSON.stringify({ id: 'conflict-plugin', name: 'conflict-plugin', version: '2.0.0' }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(path.join(canonicalDir, 'main.js'), 'module.exports = {};', 'utf-8');

    const manager = new PluginManager(mindRoot);
    await manager.discover();

    expect(manager.previewLegacyMigration('conflict-plugin')).toMatchObject({
      canMigrate: false,
      conflictReason: 'Canonical plugin package already exists: .mindos/plugins/conflict-plugin',
    });
    await expect(manager.migrateLegacyPlugin('conflict-plugin')).rejects.toThrow(/already exists/);
    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'conflict-plugin', 'manifest.json'))).toBe(true);
  });

  it('surfaces Obsidian Community origin metadata for installed packages', async () => {
    writePlugin('quickadd', `const { Plugin } = require('obsidian'); module.exports = class QuickAddPlugin extends Plugin {};`);
    fs.writeFileSync(
      path.join(mindRoot, '.plugins', 'quickadd', 'obsidian-community.json'),
      JSON.stringify({
        source: 'obsidian-community',
        pluginId: 'quickadd',
        repo: 'chhoumann/quickadd',
        githubUrl: 'https://github.com/chhoumann/quickadd',
        installedAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-15T00:00:00.000Z',
        previousVersion: '1.0.0',
        compatibilityLevel: 'compatible',
      }, null, 2),
      'utf-8',
    );

    const manager = new PluginManager(mindRoot);
    const plugins = await manager.discover();

    expect(plugins[0].runtime.communityOrigin).toMatchObject({
      source: 'obsidian-community',
      repo: 'chhoumann/quickadd',
      githubUrl: 'https://github.com/chhoumann/quickadd',
      installedAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
      previousVersion: '1.0.0',
      compatibilityLevel: 'compatible',
      validJson: true,
    });
  });

  it('does not build the global metadata index while discovering plugin lifecycle state', async () => {
    fs.writeFileSync(path.join(mindRoot, 'note-a.md'), '[[note-b]]'.repeat(100), 'utf-8');
    fs.writeFileSync(path.join(mindRoot, 'note-b.md'), '# Note B', 'utf-8');
    writePlugin('alpha-plugin', `const { Plugin } = require('obsidian'); module.exports = class AlphaPlugin extends Plugin {};`);
    const buildGlobalIndex = vi.spyOn(MetadataCacheShim.prototype, 'buildGlobalIndex');

    try {
      const manager = new PluginManager(mindRoot);
      const plugins = await manager.discover();

      expect(plugins).toHaveLength(1);
      expect(buildGlobalIndex).not.toHaveBeenCalled();
    } finally {
      buildGlobalIndex.mockRestore();
    }
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

  it('requires explicit capability confirmation before enabling network-capable plugins', async () => {
    writePlugin(
      'network-plugin',
      `
        const { Plugin, requestUrl } = require('obsidian');
        module.exports = class NetworkPlugin extends Plugin {
          onload() {
            requestUrl('https://example.com/api');
          }
        };
      `,
    );

    const manager = new PluginManager(mindRoot);
    await manager.discover();

    await expect(manager.enable('network-plugin')).rejects.toThrow(/requires capability confirmation/i);
    expect(manager.list()[0]).toMatchObject({
      id: 'network-plugin',
      enabled: false,
      capabilityGate: {
        status: 'review',
        requiresConfirmation: true,
        confirmed: false,
      },
    });

    await manager.enable('network-plugin', { confirmCapabilityGate: true });
    const state = JSON.parse(fs.readFileSync(path.join(mindRoot, '.mindos', 'plugins', '.plugin-manager.json'), 'utf-8'));
    expect(state.enabled).toEqual({ 'network-plugin': true });
    expect(state.capabilityConfirmations['network-plugin']).toMatchObject({
      fingerprint: expect.any(String),
      confirmedAt: expect.any(String),
      surfaces: ['network'],
    });
    expect(manager.list()[0]).toMatchObject({
      enabled: true,
      capabilityGate: {
        status: 'limited',
        requiresConfirmation: true,
        confirmed: true,
      },
    });

    const second = new PluginManager(mindRoot);
    await second.discover();
    await second.disable('network-plugin');
    await expect(second.enable('network-plugin')).resolves.toBeUndefined();
  });

  it('does not reuse a stale capability confirmation after plugin capabilities change', async () => {
    writePlugin(
      'changing-plugin',
      `
        const { Plugin, requestUrl } = require('obsidian');
        module.exports = class ChangingPlugin extends Plugin {
          onload() {
            requestUrl('https://example.com/api');
          }
        };
      `,
    );

    const first = new PluginManager(mindRoot);
    await first.discover();
    await first.enable('changing-plugin', { confirmCapabilityGate: true });

    fs.writeFileSync(
      path.join(mindRoot, '.plugins', 'changing-plugin', 'main.js'),
      `
        const { Plugin, requestUrl } = require('obsidian');
        module.exports = class ChangingPlugin extends Plugin {
          async onload() {
            requestUrl('https://example.com/api');
            const file = this.app.vault.getFileByPath('notes/today.md');
            if (file) await this.app.vault.modify(file, 'changed');
          }
        };
      `,
      'utf-8',
    );

    const second = new PluginManager(mindRoot);
    const plugins = await second.discover();
    expect(plugins[0]).toMatchObject({
      enabled: false,
      capabilityGate: {
        status: 'review',
        requiresConfirmation: true,
        confirmed: false,
      },
    });

    await expect(second.load('changing-plugin')).rejects.toThrow(/requires capability confirmation/i);
    await expect(second.enable('changing-plugin', { confirmCapabilityGate: true })).resolves.toBeUndefined();
  });

  it('rejects newly enabling blocked plugins even with capability confirmation', async () => {
    writePlugin(
      'blocked-plugin',
      `const fs = require('fs'); const { Plugin } = require('obsidian'); module.exports = class BlockedPlugin extends Plugin {};`,
    );

    const manager = new PluginManager(mindRoot);
    await manager.discover();

    await expect(manager.enable('blocked-plugin', { confirmCapabilityGate: true })).rejects.toThrow(/unsupported runtime module: fs/i);
    expect(manager.list()[0]).toMatchObject({
      enabled: false,
      compatibilityLevel: 'blocked',
      capabilityGate: {
        status: 'blocked',
        blocked: true,
      },
    });
  });

  it('does not discover or persist state through a symlinked .plugins directory outside mindRoot', async () => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-manager-outside-'));
    fs.rmSync(path.join(mindRoot, '.plugins'), { recursive: true, force: true });
    fs.mkdirSync(path.join(outsideRoot, 'external-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(outsideRoot, 'external-plugin', 'manifest.json'),
      JSON.stringify({ id: 'external-plugin', name: 'external-plugin', version: '1.0.0' }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(outsideRoot, 'external-plugin', 'main.js'),
      `const { Plugin } = require('obsidian'); module.exports = class ExternalPlugin extends Plugin {};`,
      'utf-8',
    );
    fs.symlinkSync(outsideRoot, path.join(mindRoot, '.plugins'), 'dir');

    try {
      const manager = new PluginManager(mindRoot);
      await expect(manager.discover()).resolves.toEqual([]);
      await expect(manager.importFromObsidianVault(mindRoot, 'external-plugin')).rejects.toThrow(/escapes|not found/i);
      expect(fs.existsSync(path.join(outsideRoot, '.plugin-manager.json'))).toBe(false);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
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
    const enabled = plugins.find((item) => item.id === 'enabled-plugin');
    expect(enabled).toMatchObject({ enabled: true, loaded: true });
    expect(enabled?.runtime.capabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'addCommand',
        phase: 'registered',
        source: 'runtime-ledger',
      }),
    ]));
    expect(enabled?.capabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'addCommand',
        phase: 'predicted',
        source: 'static-analysis',
      }),
      expect.objectContaining({
        capability: 'addCommand',
        phase: 'registered',
        source: 'runtime-ledger',
      }),
    ]));
    await manager.executeCommand(enabled?.runtime.commandList[0]?.fullId ?? '');
    const afterCommand = manager.list().find((item) => item.id === 'enabled-plugin');
    expect(afterCommand?.runtime.capabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'addCommand',
        phase: 'called',
        source: 'runtime-ledger',
      }),
    ]));
    expect(afterCommand?.capabilityLedgerHistory).toMatchObject({
      total: expect.any(Number),
      summary: expect.objectContaining({
        registered: expect.any(Number),
        called: expect.any(Number),
      }),
    });
    expect(plugins.find((item) => item.id === 'disabled-plugin')).toMatchObject({ enabled: false, loaded: false });
  });

  it('keeps runtime capability history after plugin unload and manager restart', async () => {
    writePlugin('quickadd', `
      const { Plugin } = require('obsidian');
      module.exports = class QuickAddPlugin extends Plugin {
        onload() {
          this.addCommand({ id: 'capture', name: 'Capture', callback: () => {} });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd');
    await manager.loadEnabledPlugins();
    const loaded = manager.list().find((item) => item.id === 'quickadd');
    expect(loaded?.runtime.capabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'addCommand', phase: 'registered' }),
    ]));
    expect(loaded?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'partial',
      }),
    ]);

    await manager.disable('quickadd');

    const restarted = new PluginManager(mindRoot);
    await restarted.discover();
    const persisted = restarted.list().find((item) => item.id === 'quickadd');

    expect(persisted?.runtime.capabilityLedger).toEqual([]);
    expect(persisted?.capabilityLedgerHistory).toMatchObject({
      total: 1,
      summary: expect.objectContaining({ registered: 1 }),
    });
    expect(persisted?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'partial',
        source: 'runtime-ledger',
      }),
    ]);
  });

  it('loads plugins that use supported native-compatible runtime modules', async () => {
    writePlugin('safe-native-plugin', `
      const { Plugin } = require('obsidian');
      const path = require('path');
      const crypto = require('crypto');
      const { Buffer } = require('buffer');
      const { EventEmitter } = require('events');
      const { URL } = require('node:url');
      const util = require('util');
      const assert = require('assert');
      module.exports = class SafeNativePlugin extends Plugin {
        onload() {
          const emitter = new EventEmitter();
          const digest = crypto.createHash('sha256').update(path.basename('notes/example.md')).digest('hex');
          const payload = Buffer.from(new URL('https://example.com/notes/example.md').pathname).toString('utf8');
          assert.ok(payload.includes(path.basename('notes/example.md')));
          emitter.emit('ready', payload);
          this.addCommand({ id: 'digest', name: util.format('%s:%s', 'digest', digest.slice(0, 6)), callback: () => digest });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('safe-native-plugin');
    const result = await manager.loadEnabledPlugins();

    expect(result.loaded).toEqual(['safe-native-plugin']);
    const plugin = manager.list().find((item) => item.id === 'safe-native-plugin');
    expect(plugin?.compatibilityLevel).toBe('partial');
    expect(plugin?.compatibility.supportedModules).toEqual(expect.arrayContaining([
      'path',
      'crypto',
      'buffer',
      'events',
      'node:url',
      'util',
      'assert',
    ]));
    expect(plugin?.loaded).toBe(true);
  });

  it('captures plugin load errors or skips blocked plugins without aborting the whole load pass', async () => {
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
    await expect(manager.enable('bad-plugin')).rejects.toThrow(/unsupported runtime module: electron/i);
    const result = await manager.loadEnabledPlugins();

    expect(result.loaded).toContain('good-plugin');
    expect(result.skipped).toEqual([]);

    const bad = manager.list().find((item) => item.id === 'bad-plugin');
    expect(bad?.compatibilityLevel).toBe('blocked');
    expect(bad?.compatibility?.nodeModules).toContain('electron');
    expect(bad?.lastError).toMatch(/unsupported runtime module: electron/i);
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

  it('uninstalls the MindOS plugin copy and clears enabled runtime state', async () => {
    writePlugin(
      'remove-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class RemovePlugin extends Plugin {
          async onload() {
            await this.app.secretStorage.setSecret('api-key', 'remove-me-secret');
            this.addCommand({ id: 'run', name: 'Run', callback: () => {} });
          }
        };
      `,
    );

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('remove-plugin');
    await manager.loadEnabledPlugins();
    expect(manager.getLoader().getLoadedPlugins().map((loaded) => loaded.manifest.id)).toEqual(['remove-plugin']);
    expect(manager.list().find((item) => item.id === 'remove-plugin')?.runtime.secretStorage).toMatchObject({
      pluginId: 'remove-plugin',
      secrets: 1,
      encrypted: true,
    });
    expect(fs.readFileSync(path.join(mindRoot, '.mindos', 'plugins', '.secret-storage.json'), 'utf-8')).not.toContain('remove-me-secret');

    await manager.uninstall('remove-plugin');

    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'remove-plugin'))).toBe(false);
    expect(fs.readFileSync(path.join(mindRoot, '.mindos', 'plugins', '.secret-storage.json'), 'utf-8')).not.toContain('remove-plugin');
    expect(manager.list().find((item) => item.id === 'remove-plugin')).toBeUndefined();
    expect(manager.getLoader().getLoadedPlugins()).toEqual([]);
    const state = JSON.parse(fs.readFileSync(path.join(mindRoot, '.mindos', 'plugins', '.plugin-manager.json'), 'utf-8'));
    expect(state.enabled).toEqual({});

    const fresh = new PluginManager(mindRoot);
    await expect(fresh.discover()).resolves.toEqual([]);
  });

  it('does not discover or uninstall through a symlinked plugin directory outside mindRoot', async () => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-uninstall-outside-'));
    try {
      const pluginsDir = path.join(mindRoot, '.plugins');
      const outsidePluginDir = path.join(outsideRoot, 'linked-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(outsidePluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(outsidePluginDir, 'manifest.json'),
        JSON.stringify({ id: 'linked-plugin', name: 'linked-plugin', version: '1.0.0' }, null, 2),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(outsidePluginDir, 'main.js'),
        `const { Plugin } = require('obsidian'); module.exports = class LinkedPlugin extends Plugin {};`,
        'utf-8',
      );
      fs.symlinkSync(outsidePluginDir, path.join(pluginsDir, 'linked-plugin'), 'dir');

      const manager = new PluginManager(mindRoot);
      const discovered = await manager.discover();
      expect(discovered.map((plugin) => plugin.id)).toEqual([]);

      await expect(manager.uninstall('linked-plugin')).rejects.toThrow(/unknown plugin/i);
      expect(fs.existsSync(path.join(outsidePluginDir, 'manifest.json'))).toBe(true);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
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
