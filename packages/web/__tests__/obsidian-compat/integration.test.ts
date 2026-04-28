import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginLoader } from '@/lib/obsidian-compat/loader';

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

describe('obsidian compat integration', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-integration-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('awaits async plugin onload before returning from loadPlugin', async () => {
    writePlugin(
      'async-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class AsyncPlugin extends Plugin {
          async onload() {
            await new Promise((resolve) => setTimeout(resolve, 10));
            await this.saveData({ ready: true });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('async-plugin');
    const data = await loaded.instance.loadData();

    expect(data).toEqual({ ready: true });
  });

  it('injects the expected obsidian exports into plugin modules', async () => {
    writePlugin(
      'exports-plugin',
      `
        const obsidian = require('obsidian');
        module.exports = class ExportsPlugin extends obsidian.Plugin {
          onload() {
            this.exportCheck = {
              hasPlugin: typeof obsidian.Plugin === 'function',
              hasComponent: typeof obsidian.Component === 'function',
              hasEvents: typeof obsidian.Events === 'function',
              hasNotice: typeof obsidian.Notice === 'function',
              hasModal: typeof obsidian.Modal === 'function',
              hasPluginSettingTab: typeof obsidian.PluginSettingTab === 'function',
              hasSetting: typeof obsidian.Setting === 'function',
              hasTFile: typeof obsidian.TFile === 'function'
            };
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('exports-plugin');

    expect((loaded.instance as any).exportCheck).toEqual({
      hasPlugin: true,
      hasComponent: true,
      hasEvents: true,
      hasNotice: true,
      hasModal: true,
      hasPluginSettingTab: true,
      hasSetting: true,
      hasTFile: true,
    });
  });

  it('extracts frontmatter tags and links through metadata cache', async () => {
    fs.mkdirSync(path.join(mindRoot, 'notes'), { recursive: true });
    fs.writeFileSync(
      path.join(mindRoot, 'notes', 'sample.md'),
      `---\ntitle: Sample\ncategory: docs\n---\n\n# Hello\nA #tag with a [[Target Note]] link and [external](https://example.com).\n`,
      'utf-8',
    );
    fs.writeFileSync(path.join(mindRoot, 'notes', 'Target Note.md'), '# Target', 'utf-8');

    const loader = new PluginLoader(mindRoot);
    const app = loader.getApp();
    const file = app.vault.getFileByPath('notes/sample.md');

    const cache = app.metadataCache.getFileCache(file!);

    expect(cache?.frontmatter).toEqual({ title: 'Sample', category: 'docs' });
    expect(cache?.tags?.map((item) => item.tag)).toContain('#tag');
    expect(cache?.links?.map((item) => item.link)).toContain('Target Note');
  });

  it('resolves link targets and strips md extension when requested', async () => {
    fs.mkdirSync(path.join(mindRoot, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'notes', 'Target Note.md'), '# Target', 'utf-8');

    const loader = new PluginLoader(mindRoot);
    const app = loader.getApp();
    const file = app.vault.getFileByPath('notes/Target Note.md');

    const resolved = app.metadataCache.getFirstLinkpathDest('Target Note', 'notes/source.md');

    expect(resolved?.path).toBe('notes/Target Note.md');
    expect(app.metadataCache.fileToLinktext(file!, 'notes/source.md', true)).toBe('notes/Target Note');
  });

  it('lets plugins register setting tabs with collected setting items', async () => {
    writePlugin(
      'settings-plugin',
      `
        const { Plugin, PluginSettingTab, Setting } = require('obsidian');
        class ExampleTab extends PluginSettingTab {
          constructor(app, plugin) {
            super(app);
            this.plugin = plugin;
          }
          display() {
            new Setting(this)
              .setName('API Key')
              .setDesc('Stored locally')
              .addText((text) => text.setValue('token').onChange(() => {}));
          }
        }
        module.exports = class SettingsPlugin extends Plugin {
          onload() {
            const tab = new ExampleTab(this.app, this);
            tab.display();
            this.addSettingTab(tab);
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('settings-plugin');
    const tabs = (loaded.instance as any).settingTabs;

    expect(tabs).toHaveLength(1);
    expect(tabs[0].items[0]).toMatchObject({
      name: 'API Key',
      desc: 'Stored locally',
      kind: 'text',
      value: 'token',
    });
  });
});
