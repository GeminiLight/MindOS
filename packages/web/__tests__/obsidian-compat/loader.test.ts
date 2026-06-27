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

const writeCanonicalPlugin = (pluginId: string, manifest: object, mainJs: string) => {
  const pluginDir = path.join(mindRoot, '.mindos', 'plugins', pluginId);
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

  it('skips plugins whose directory name does not match manifest id', () => {
    writePlugin(
      'renamed-plugin-dir',
      { id: 'manifest-plugin-id', name: 'Renamed Plugin', version: '1.0.0' },
      "module.exports = class {}",
    );

    const loader = new PluginLoader(mindRoot);
    const plugins = loader.discoverPlugins();

    expect(plugins).toEqual([]);
  });

  it('ignores hidden MindOS control entries in the plugin root', () => {
    writeCanonicalPlugin(
      'visible-plugin',
      { id: 'visible-plugin', name: 'Visible Plugin', version: '1.0.0' },
      "module.exports = class {}",
    );
    fs.mkdirSync(path.join(mindRoot, '.mindos', 'plugins', '.runtime-capability-ledger'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.mindos', 'plugins', '.plugin-manager.json'), '{"enabled":{}}', 'utf-8');

    const loader = new PluginLoader(mindRoot);
    const plugins = loader.discoverPlugins();

    expect(plugins.map((plugin) => plugin.id)).toEqual(['visible-plugin']);
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

  it('prefers the canonical .mindos/plugins package over a legacy .plugins package with the same id', async () => {
    writePlugin(
      'duplicate-plugin',
      { id: 'duplicate-plugin', name: 'Legacy Plugin', version: '1.0.0' },
      `
        const { Plugin } = require('obsidian');
        module.exports = class LegacyPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'legacy', name: 'Legacy', callback: () => {} });
          }
        };
      `,
    );
    writeCanonicalPlugin(
      'duplicate-plugin',
      { id: 'duplicate-plugin', name: 'Canonical Plugin', version: '2.0.0' },
      `
        const { Plugin } = require('obsidian');
        module.exports = class CanonicalPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'canonical', name: 'Canonical', callback: () => {} });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const plugins = loader.discoverPlugins();
    const loaded = await loader.loadPlugin('duplicate-plugin');

    expect(plugins).toEqual([
      expect.objectContaining({ id: 'duplicate-plugin', name: 'Canonical Plugin', version: '2.0.0' }),
    ]);
    expect(loaded.pluginDir).toBe(path.join(mindRoot, '.mindos', 'plugins', 'duplicate-plugin'));
    expect(loader.getApp().getCommands().map((command) => command.id)).toEqual(['canonical']);
  });

  it('provides Obsidian-like globals for bundled community plugins', async () => {
    writePlugin(
      'global-plugin',
      { id: 'global-plugin', name: 'Global Plugin', version: '1.0.0' },
      `
        const { moment, Plugin, View, Vault } = require('obsidian');
        localStorage.setItem('language', 'zh-cn');
        const language = window.localStorage.getItem('language');
        const topLevelLanguage = localStorage.getItem('language');
        const selfLanguage = self.localStorage.getItem('language');
        const globalLanguage = globalThis.localStorage.getItem('language');
        globalThis.localStorage.setItem('numeric', 42);
        self.localStorage.setItem('temporary', 'remove-me');
        activeWindow.localStorage.removeItem('temporary');
        const topLevelEl = document.createEl('div', { text: language || 'en' });
        const lookupEl = document.createEl('div', { text: 'lookup-ready', attr: { id: 'calendar-root' } });
        const textNode = document.createTextNode('calendar-text-node');
        const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        lookupEl.setAttribute('data-ready', 'yes');
        lookupEl.removeAttribute('data-ready');
        document.body.insertBefore(textNode, lookupEl);
        document.body.appendChild(lookupEl);
        document.body.appendChild(svgNode);
        moment.updateLocale('en-us', { week: { dow: 1 } });
        const calendarDate = moment('2026-06-15T10:20:30')
          .clone()
          .startOf('week')
          .add(1, 'day')
          .set({ hour: 8, minute: 5, second: 3 });
        const weekdayDate = moment('2026-06-15').weekday(2);
        const literalDate = moment('2026-06-15').format('[mindos-periodic-daily]-YYYY-MM-DD');
        class GlobalView extends View {}
        module.exports = class GlobalPlugin extends Plugin {
          onload() {
            if (window.app !== this.app || app !== this.app || activeWindow.app !== this.app || globalThis.app !== this.app) {
              throw new Error('missing app globals');
            }
            if (topLevelLanguage !== 'zh-cn' || selfLanguage !== 'zh-cn' || globalLanguage !== 'zh-cn') {
              throw new Error('missing localStorage globals');
            }
            if (localStorage.getItem('numeric') !== '42' || localStorage.getItem('temporary') !== null) {
              throw new Error('localStorage did not preserve browser semantics');
            }
            if (!(new GlobalView(this.app.workspace.getLeaf()) instanceof View)) {
              throw new Error('missing View export');
            }
            if (moment.locale() !== 'en-us' || moment.localeData().weekdaysShort()[0] !== 'Sun' || moment().localeData().monthsShort()[0] !== 'Jan') {
              throw new Error('missing moment locale helpers');
            }
            if (moment.localeData()._week.dow !== 1 || calendarDate.format('YYYY-MM-DD HH:mm:ss') !== '2026-06-16 08:05:03' || calendarDate.get('hour') !== 8) {
              throw new Error('missing chainable moment date helpers');
            }
            if (moment.weekdaysShort(true)[0] !== 'Mon' || moment.weekdays()[0] !== 'Sunday') {
              throw new Error('missing static moment weekday helpers');
            }
            if (!moment().calendar().startsWith('Today')) {
              throw new Error('missing moment calendar helper');
            }
            if (weekdayDate.format('YYYY-MM-DD') !== '2026-06-17') {
              throw new Error('missing moment weekday helper');
            }
            if (moment('2026-06-21').isoWeekday() !== 7) {
              throw new Error('missing moment isoWeekday helper');
            }
            if (literalDate !== 'mindos-periodic-daily-2026-06-15') {
              throw new Error('missing moment literal format helper');
            }
            if (document.getElementById('calendar-root').textContent !== 'lookup-ready') {
              throw new Error('missing document.getElementById helper');
            }
            if (lookupEl.hasAttribute('data-ready') || lookupEl.getAttribute('data-ready') !== null) {
              throw new Error('missing document removeAttribute helper');
            }
            if (lookupEl.parentNode !== document.body || textNode.nextSibling !== lookupEl || lookupEl.previousSibling !== textNode) {
              throw new Error('missing document parent/sibling helpers');
            }
            if (document.body.childNodes[0].textContent !== 'calendar-text-node' || svgNode.tagName.toLowerCase() !== 'svg') {
              throw new Error('missing document text/svg insertion helpers');
            }
            Vault.recurseChildren(this.app.vault.getRoot(), () => {});
            this.addCommand({ id: 'globals', name: topLevelEl.textContent || 'Globals', callback: () => {} });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('global-plugin');

    expect(loader.getApp().getCommands()[0]?.fullId).toBe('obsidian:global-plugin:globals');
    expect(loader.getApp().loadLocalStorage('language')).toBe('zh-cn');
    expect(loader.getApp().loadLocalStorage('numeric')).toBe('42');
    expect(loader.getApp().loadLocalStorage('temporary')).toBeNull();
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

  it('cleans partial registrations when onload fails after registering surfaces', async () => {
    writePlugin(
      'partial-plugin',
      { id: 'partial-plugin', name: 'Partial Plugin', version: '1.0.0' },
      `
        const { Plugin } = require('obsidian');
        module.exports = class PartialPlugin extends Plugin {
          onload() {
            localStorage.setItem('__mindosPartialPluginCleanupCount', '0');
            this.register(() => {
              const count = Number(localStorage.getItem('__mindosPartialPluginCleanupCount') || '0');
              localStorage.setItem('__mindosPartialPluginCleanupCount', String(count + 1));
            });
            this.addCommand({ id: 'partial', name: 'Partial', callback: () => {} });
            this.addRibbonIcon('sparkles', 'Partial ribbon', () => {});
            this.addStatusBarItem().setText('Partial status');
            this.registerView('partial-view', () => ({}));
            this.registerExtensions(['partial'], 'partial-view');
            this.registerMarkdownCodeBlockProcessor('partial', () => {});
            this.registerMarkdownPostProcessor(() => {});
            this.registerEditorExtension({ name: 'partial-extension' });
            throw new Error('boom after registration');
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);

    await expect(loader.loadPlugin('partial-plugin')).rejects.toThrow(/boom after registration/);

    const app = loader.getApp();
    const host = app.getRuntimeHost();
    expect(app.loadLocalStorage('__mindosPartialPluginCleanupCount')).toBe('1');
    expect((globalThis as { __mindosPartialPluginCleanupCount?: number }).__mindosPartialPluginCleanupCount).toBeUndefined();
    expect(loader.getLoadedPlugins()).toHaveLength(0);
    expect(app.getCommands()).toHaveLength(0);
    expect(app.plugins.plugins['partial-plugin']).toBeUndefined();
    expect(app.plugins.enabledPlugins.has('partial-plugin')).toBe(false);
    expect(host.getRibbonIcons()).toHaveLength(0);
    expect(host.getStatusBarItems()).toHaveLength(0);
    expect(host.getViews()).toHaveLength(0);
    expect(host.getViewExtensions()).toHaveLength(0);
    expect(host.getMarkdownCodeBlockProcessors()).toHaveLength(0);
    expect(host.getMarkdownPostProcessors()).toHaveLength(0);
    expect(host.getEditorExtensions()).toHaveLength(0);
    expect(host.getWarnings().filter((warning) => warning.pluginId === 'partial-plugin')).toHaveLength(0);
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
