import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resetObsidianPluginRuntimeServicesForTests,
  withObsidianPluginRuntime,
} from '@/lib/obsidian-compat/runtime-service';

let mindRoot: string;

function writePlugin(pluginId: string, mainJs: string) {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }, null, 2),
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

describe('ObsidianPluginRuntimeService', () => {
  beforeEach(() => {
    resetObsidianPluginRuntimeServicesForTests();
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-runtime-service-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    resetObsidianPluginRuntimeServicesForTests();
  });

  it('keeps enabled plugins loaded across runtime operations without rerunning onload', async () => {
    writePlugin(
      'sticky-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class StickyPlugin extends Plugin {
          async onload() {
            const data = await this.loadData() || { count: 0 };
            data.count = (data.count || 0) + 1;
            await this.saveData(data);
            this.addStatusBarItem().setText('loaded ' + data.count);
          }
        };
      `,
    );
    enablePlugin('sticky-plugin');

    await withObsidianPluginRuntime(mindRoot, (manager) => manager.loadEnabledPlugins());
    await withObsidianPluginRuntime(mindRoot, (manager) => manager.loadEnabledPlugins());

    const data = JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', 'sticky-plugin', 'data.json'), 'utf-8'));
    const status = await withObsidianPluginRuntime(mindRoot, (manager) => manager.list()[0]);

    expect(data).toEqual({ count: 1 });
    expect(status?.loaded).toBe(true);
    expect(status?.runtime.statusBarItemList).toEqual([{ text: 'loaded 1' }]);
  });

  it('serializes concurrent runtime operations for the same mindRoot', async () => {
    writePlugin(
      'queued-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class QueuedPlugin extends Plugin {
          async onload() {
            const data = await this.loadData() || { count: 0 };
            await new Promise((resolve) => setTimeout(resolve, 10));
            data.count = (data.count || 0) + 1;
            await this.saveData(data);
          }
        };
      `,
    );
    enablePlugin('queued-plugin');

    await Promise.all([
      withObsidianPluginRuntime(mindRoot, (manager) => manager.loadEnabledPlugins()),
      withObsidianPluginRuntime(mindRoot, (manager) => manager.loadEnabledPlugins()),
    ]);

    const data = JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', 'queued-plugin', 'data.json'), 'utf-8'));
    expect(data).toEqual({ count: 1 });
  });

  it('unloads plugins that are no longer enabled before the next operation', async () => {
    writePlugin(
      'toggle-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class TogglePlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'run', name: 'Run', callback: () => {} });
            this.addStatusBarItem().setText('enabled');
          }
        };
      `,
    );
    enablePlugin('toggle-plugin');

    await withObsidianPluginRuntime(mindRoot, (manager) => manager.loadEnabledPlugins());
    enablePlugin();
    const status = await withObsidianPluginRuntime(mindRoot, (manager) => manager.list()[0]);

    expect(status?.enabled).toBe(false);
    expect(status?.loaded).toBe(false);
    expect(status?.runtime.commands).toBe(0);
    expect(status?.runtime.statusBarItems).toBe(0);
  });
});
