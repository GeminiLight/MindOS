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
              hasEditorSuggest: typeof obsidian.EditorSuggest === 'function',
              hasScope: typeof obsidian.Scope === 'function',
              hasFileSystemAdapter: typeof obsidian.FileSystemAdapter === 'function',
              hasDebounce: typeof obsidian.debounce === 'function',
              hasParseYaml: typeof obsidian.parseYaml === 'function',
              hasStringifyYaml: typeof obsidian.stringifyYaml === 'function',
              hasHtmlToMarkdown: typeof obsidian.htmlToMarkdown === 'function',
              hasPrepareSimpleSearch: typeof obsidian.prepareSimpleSearch === 'function',
              hasRenderMatches: typeof obsidian.renderMatches === 'function',
              hasSetIcon: typeof obsidian.setIcon === 'function',
              hasAddIcon: typeof obsidian.addIcon === 'function',
              hasGetIcon: typeof obsidian.getIcon === 'function',
              hasGetIconIds: typeof obsidian.getIconIds === 'function',
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
      hasEditorSuggest: true,
      hasScope: true,
      hasFileSystemAdapter: true,
      hasDebounce: true,
      hasParseYaml: true,
      hasStringifyYaml: true,
      hasHtmlToMarkdown: true,
      hasPrepareSimpleSearch: true,
      hasRenderMatches: true,
      hasSetIcon: true,
      hasAddIcon: true,
      hasGetIcon: true,
      hasGetIconIds: true,
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
        const { Plugin, Modal, FileSystemAdapter, Scope, debounce, parseYaml, stringifyYaml, htmlToMarkdown, addIcon, getIcon, getIconIds, setIcon, setTooltip, moment, prepareSimpleSearch, renderMatches } = require('obsidian');
        module.exports = class UtilityPlugin extends Plugin {
          onload() {
            const modal = new Modal(this.app);
            const button = modal.contentEl.createEl('button');
            const matchEl = document.createEl('div');
            const stubHtml = document.createEl('div');
            stubHtml.createEl('strong', { text: 'Plain fallback' });
            const fragmentLike = { childNodes: [{ outerHTML: '<strong>Fragment</strong>' }, { textContent: ' text' }] };
            const simpleSearchResult = prepareSimpleSearch('theme')('minimal theme settings');
            renderMatches(matchEl, 'minimal theme settings', simpleSearchResult.matches);
            const scope = new Scope();
            const registration = scope.register(['Mod'], 'k', () => {});
            scope.unregister(registration);
            const themeMarker = document.createEl('div', { cls: 'minimal-theme theme-dark' });
            document.body.appendChild(themeMarker);
            document.body.setCssProps({ 'text-normal': '#222', '--background-primary': '#fff' });
            document.body.setCssStyles({ color: 'red', 'font-size': '16px' });
            const removedCssProp = document.body.style.removeProperty('--background-primary');
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
              htmlMarkdown: htmlToMarkdown('<h1>Title</h1><p><strong>Bold</strong> <a href="https://example.com">Link</a></p>'),
              stubMarkdown: htmlToMarkdown(stubHtml),
              fragmentMarkdown: htmlToMarkdown(fragmentLike),
              icon: getIcon('mindos-test'),
              iconIds: getIconIds(),
              iconAttr: button.getAttribute('data-obsidian-icon'),
              iconSize: button.getAttribute('data-obsidian-icon-size'),
              tooltip: button.getAttribute('title'),
              previousLocale: moment.locale(),
              nextLocale: moment.locale('zh-cn'),
              currentLocale: moment.locale(),
              localeData: moment.localeData().longDateFormat('L'),
              simpleSearchScore: simpleSearchResult.score,
              renderedMatchText: Array.from(matchEl.children).map((child) => child.textContent).join('') || matchEl.textContent,
              renderedHighlight: matchEl.querySelector('.suggestion-highlight')?.textContent,
              scopeKeysAfterUnregister: scope.keys.length,
              classLookupCount: document.getElementsByClassName('minimal-theme').length,
              compoundClassLookupCount: document.getElementsByClassName('minimal-theme theme-dark').length,
              queryLookupMatches: document.querySelector('.minimal-theme') === themeMarker,
              cssProp: document.body.style.getPropertyValue('--text-normal'),
              removedCssProp,
              removedCssPropAfter: document.body.style.getPropertyValue('--background-primary'),
              cssStyle: document.body.style.color,
              cssHyphenStyle: document.body.style.getPropertyValue('font-size'),
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
      expect(check.htmlMarkdown).toBe('# Title\n\n**Bold** [Link](https://example.com)');
      expect(check.stubMarkdown).toBe('Plain fallback');
      expect(check.fragmentMarkdown).toBe('**Fragment** text');
      expect(check.icon).toBe('<svg><path /></svg>');
      expect(check.iconIds).toEqual(expect.arrayContaining(['mindos-test', 'settings']));
      expect(check.iconAttr).toBe('mindos-test');
      expect(check.iconSize).toBe('16');
      expect(check.tooltip).toBe('Run action');
      expect(check.previousLocale).toBe('en');
      expect(check.nextLocale).toBe('zh-cn');
      expect(check.currentLocale).toBe('zh-cn');
      expect(check.localeData).toBe('YYYY-MM-DD');
      expect(check.simpleSearchScore).toBeGreaterThan(0);
      expect(check.renderedMatchText).toBe('minimal theme settings');
      expect(check.renderedHighlight).toBe('theme');
      expect(check.scopeKeysAfterUnregister).toBe(0);
      expect(check.classLookupCount).toBe(1);
      expect(check.compoundClassLookupCount).toBe(1);
      expect(check.queryLookupMatches).toBe(true);
      expect(check.cssProp).toBe('#222');
      expect(check.removedCssProp).toBe('#fff');
      expect(check.removedCssPropAfter).toBe('');
      expect(check.cssStyle).toBe('red');
      expect(check.cssHyphenStyle).toBe('16px');
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

  it('records EditorSuggest registrations as catalog-only editor capabilities', async () => {
    writePlugin(
      'editor-suggest-plugin',
      `
        const { Plugin, EditorSuggest } = require('obsidian');
        class ExampleSuggest extends EditorSuggest {
          onTrigger(cursor, editor, file) {
            return { start: cursor, end: cursor, query: 'mind' };
          }
          getSuggestions(context) {
            return ['MindOS'];
          }
          renderSuggestion(value, el) {
            el.setText(value);
          }
          selectSuggestion(value, evt) {
            this.selected = value;
          }
        }
        module.exports = class EditorSuggestPlugin extends Plugin {
          onload() {
            this.suggest = new ExampleSuggest(this.app);
            this.registerEditorSuggest(this.suggest);
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('editor-suggest-plugin');

    const host = loader.getApp().getRuntimeHost();
    expect(host.getEditorSuggests()).toEqual([
      expect.objectContaining({
        pluginId: 'editor-suggest-plugin',
        summary: expect.objectContaining({
          constructorName: 'ExampleSuggest',
          hasOnTrigger: true,
          hasGetSuggestions: true,
          hasRenderSuggestion: true,
          hasSelectSuggestion: true,
          mountStatus: 'catalog-only',
          autoMount: false,
          sandbox: expect.objectContaining({
            phase: 'p3a-browser-editor-sandbox',
            target: 'editor-suggest',
            host: 'browser-codemirror-sandbox',
            status: 'requires-browser-sandbox',
            transferable: false,
            permissionGate: 'browser-editor-suggest-host',
            canAutoMount: false,
            cleanupRequired: true,
            requiredPermissions: ['editor.read', 'editor.selection', 'editor.suggest'],
            requirements: expect.arrayContaining([
              'per-plugin browser editor sandbox',
              'explicit user permission gate',
              'deterministic unload cleanup for extensions, keymaps, suggestions, and decorations',
            ]),
          }),
        }),
      }),
    ]);
    expect(host.getWarnings()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pluginId: 'editor-suggest-plugin',
        code: 'editor-suggest-recorded-only',
      }),
    ]));
  });

  it('exposes registered commands through the Obsidian app.commands facade', async () => {
    writePlugin(
      'commands-facade-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class CommandsFacadePlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'hello', name: 'Hello command', callback: () => {} });
            this.addCommand({ id: 'prefixed', name: 'Prefixed command', callback: () => {} });
            this.addCommand({ id: 'full', name: 'Full command', callback: () => {} });
            this.addCommand({ id: 'keep', name: 'Keep command', callback: () => {} });
            this.app.commands.removeCommand('hello');
            this.app.commands.removeCommand('commands-facade-plugin:prefixed');
            this.app.commands.removeCommand('obsidian:commands-facade-plugin:full');
            this.commandCheck = {
              names: this.app.commands.listCommands().map((command) => command.name),
              ids: Object.keys(this.app.commands.commands),
              found: this.app.commands.findCommand('hello')?.name,
              removedPrefixed: this.app.commands.findCommand('prefixed')?.name,
              removedFull: this.app.commands.findCommand('full')?.name,
              kept: this.app.commands.findCommand('keep')?.name,
            };
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('commands-facade-plugin');

    expect((loaded.instance as any).commandCheck).toEqual({
      names: ['Keep command'],
      ids: ['obsidian:commands-facade-plugin:keep'],
      found: undefined,
      removedPrefixed: undefined,
      removedFull: undefined,
      kept: 'Keep command',
    });
  });

  it('records plugin hover link source registrations without requiring an Obsidian pane host', async () => {
    writePlugin(
      'hover-link-source-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class HoverLinkSourcePlugin extends Plugin {
          onload() {
            this.registerHoverLinkSource('hover-link-source-plugin', {
              display: 'Hover link source plugin',
              defaultMod: true,
            });
            this.hoverLinkSourceRegistered = true;
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('hover-link-source-plugin');

    expect((loaded.instance as any).hoverLinkSourceRegistered).toBe(true);
    expect(loader.getApp().getRuntimeHost().getWarnings()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'workspace-hover-link-source-recorded-only',
      }),
    ]));
  });

  it('provides safe custom CSS and CodeMirror compatibility globals', async () => {
    writePlugin(
      'style-compat-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class StyleCompatPlugin extends Plugin {
          onload() {
            window.CodeMirror.defineMode('ad-note', () => ({ token: () => null }));
            CodeMirrorAdapter.commands.save = () => 'saved';
            const style = activeDocument.head.createEl('style', { attr: { id: 'style-compat' } });
            style.sheet.insertRule('.callout { color: red; }', 0);
            activeDocument.head.appendChild(style);
            this.app.customCss.setCssEnabledStatus('admonitions', true);
            this.app.customCss.readSnippets();
            this.app.workspace.iterateCodeMirrors(() => {
              this.iteratedCodeMirrors = true;
            });
            style.detach();
            this.styleCheck = {
              snippetPath: this.app.customCss.getSnippetPath('admonitions'),
              modeRegistered: Boolean(window.CodeMirror.modes['ad-note']),
              adapterCommand: typeof CodeMirrorAdapter.commands.save,
              cssRules: style.sheet.cssRules.length,
              detached: activeDocument.head.querySelector('#style-compat') === null,
              iteratedCodeMirrors: this.iteratedCodeMirrors === true,
            };
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('style-compat-plugin');

    expect((loaded.instance as any).styleCheck).toEqual({
      snippetPath: '.mindos/snippets/admonitions.css',
      modeRegistered: true,
      adapterCommand: 'function',
      cssRules: 1,
      detached: true,
      iteratedCodeMirrors: false,
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
