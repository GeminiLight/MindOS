import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
              hasTFile: typeof obsidian.TFile === 'function',
              hasNormalizePath: typeof obsidian.normalizePath === 'function',
              hasRequestUrl: typeof obsidian.requestUrl === 'function',
              hasPlatform: typeof obsidian.Platform === 'object',
              hasItemView: typeof obsidian.ItemView === 'function',
              hasMarkdownRenderChild: typeof obsidian.MarkdownRenderChild === 'function',
              hasMarkdownRenderer: typeof obsidian.MarkdownRenderer?.renderMarkdown === 'function',
              hasFuzzySuggestModal: typeof obsidian.FuzzySuggestModal === 'function',
              hasFileSystemAdapter: typeof obsidian.FileSystemAdapter === 'function',
              hasDebounce: typeof obsidian.debounce === 'function',
              hasParseYaml: typeof obsidian.parseYaml === 'function',
              hasStringifyYaml: typeof obsidian.stringifyYaml === 'function',
              hasSetIcon: typeof obsidian.setIcon === 'function',
              hasAddIcon: typeof obsidian.addIcon === 'function',
              hasGetIcon: typeof obsidian.getIcon === 'function',
              hasSetTooltip: typeof obsidian.setTooltip === 'function',
              hasVaultAdapter: typeof this.app.vault.adapter?.read === 'function',
              hasFileManager: typeof this.app.fileManager?.processFrontMatter === 'function',
              hasWorkspaceActiveView: typeof this.app.workspace.getActiveViewOfType === 'function'
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
      hasNormalizePath: true,
      hasRequestUrl: true,
      hasPlatform: true,
      hasItemView: true,
      hasMarkdownRenderChild: true,
      hasMarkdownRenderer: true,
      hasFuzzySuggestModal: true,
      hasFileSystemAdapter: true,
      hasDebounce: true,
      hasParseYaml: true,
      hasStringifyYaml: true,
      hasSetIcon: true,
      hasAddIcon: true,
      hasGetIcon: true,
      hasSetTooltip: true,
      hasVaultAdapter: true,
      hasFileManager: true,
      hasWorkspaceActiveView: true,
    });
  });

  it('supports common utility exports without opening native adapter access', async () => {
    vi.useFakeTimers();
    writePlugin(
      'utility-plugin',
      `
        const { Plugin, Modal, FileSystemAdapter, debounce, parseYaml, stringifyYaml, addIcon, getIcon, setIcon, setTooltip } = require('obsidian');
        module.exports = class UtilityPlugin extends Plugin {
          onload() {
            const modal = new Modal(this.app);
            const button = modal.contentEl.createEl('button');
            addIcon('mindos-test', '<svg><path /></svg>');
            setIcon(button, 'mindos-test', 16);
            setTooltip(button, 'Run action');
            let calls = 0;
            const debounced = debounce((value) => {
              calls += value;
            }, 25);
            debounced(1);
            debounced(1);
            this.utilityCheck = {
              adapterIsNative: this.app.vault.adapter instanceof FileSystemAdapter,
              parsed: parseYaml('title: Hello\\ncount: 2\\n'),
              yaml: stringifyYaml({ ready: true }).trim(),
              icon: getIcon('mindos-test'),
              iconAttr: button.getAttribute('data-obsidian-icon'),
              iconSize: button.getAttribute('data-obsidian-icon-size'),
              tooltip: button.getAttribute('title'),
              callsBeforeTimer: calls,
              readCalls: () => calls,
              cancel: debounced.cancel,
            };
          }
        };
      `,
    );

    try {
      const loader = new PluginLoader(mindRoot);
      const loaded = await loader.loadPlugin('utility-plugin');
      const check = (loaded.instance as any).utilityCheck;

      expect(check.adapterIsNative).toBe(false);
      expect(check.parsed).toEqual({ title: 'Hello', count: 2 });
      expect(check.yaml).toContain('ready: true');
      expect(check.icon).toBe('<svg><path /></svg>');
      expect(check.iconAttr).toBe('mindos-test');
      expect(check.iconSize).toBe('16');
      expect(check.tooltip).toBe('Run action');
      expect(check.callsBeforeTimer).toBe(0);

      vi.advanceTimersByTime(24);
      expect(check.readCalls()).toBe(0);
      vi.advanceTimersByTime(1);
      expect(check.readCalls()).toBe(1);
      expect(typeof check.cancel).toBe('function');
    } finally {
      vi.useRealTimers();
    }
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

  it('persists app local storage under the plugin private directory', () => {
    const loader = new PluginLoader(mindRoot);
    const app = loader.getApp();

    app.saveLocalStorage('tasks-view-state', { filter: 'today' });

    const secondLoader = new PluginLoader(mindRoot);
    expect(secondLoader.getApp().loadLocalStorage('tasks-view-state')).toEqual({ filter: 'today' });
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

  it('collects settings from Obsidian-style new Setting(containerEl) and avoids duplicate display items', async () => {
    writePlugin(
      'container-settings-plugin',
      `
        const { Plugin, PluginSettingTab, Setting } = require('obsidian');
        class ExampleTab extends PluginSettingTab {
          constructor(app, plugin) {
            super(app, plugin);
            this.plugin = plugin;
          }
          display() {
            const { containerEl } = this;
            containerEl.empty();
            containerEl.createEl('h2', { text: 'Example' });
            new Setting(containerEl)
              .setName('Homepage path')
              .setDesc('Path to your homepage note')
              .addText((text) => text.setPlaceholder('Home.md').setValue('Home.md').onChange(() => {}));
            new Setting(containerEl)
              .setName('Run')
              .addButton((button) => button.setButtonText('Run now').setCta());
          }
        }
        module.exports = class ContainerSettingsPlugin extends Plugin {
          onload() {
            const tab = new ExampleTab(this.app, this);
            tab.display();
            tab.display();
            this.addSettingTab(tab);
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('container-settings-plugin');
    const tabs = (loaded.instance as any).settingTabs;

    expect(tabs).toHaveLength(1);
    expect(tabs[0].items).toHaveLength(2);
    expect(tabs[0].items[0]).toMatchObject({
      name: 'Homepage path',
      kind: 'text',
      value: 'Home.md',
      placeholder: 'Home.md',
    });
    expect(tabs[0].items[1]).toMatchObject({ name: 'Run', kind: 'button', cta: true });
  });
});
