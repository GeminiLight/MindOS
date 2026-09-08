import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { Compartment, StateEffect, type Extension } from '@codemirror/state';
import { Component } from '../component';
import { Events, type EventRef } from '../events';
import { debounce } from '../debounce';
import { createObsidianElement } from '../shims/dom';
import { EditorExtensionRegistry } from './editor-extensions';
import { LiveMarkdownEditor } from './live-editor';
import { editorInfoField, editorEditorField, editorLivePreviewField } from './editor-context';
import { browserHostBaseStyles } from './base-styles';
import { BrowserVault, BrowserTAbstractFile, BrowserTFile, BrowserTFolder, type BrowserVaultController } from './vault';
import { BrowserMetadataCache } from './metadata-cache';
import { BrowserSettingsLifecycle } from './settings-lifecycle';
export { createBrowserVault } from './vault';
export { BrowserMetadataCache } from './metadata-cache';
import { BrowserMarkdownRenderer, BrowserMarkdownRenderChild, type BrowserMarkdownPostProcessor, type BrowserCodeBlockProcessor } from './markdown-renderer';
import {
  BrowserItemView, BrowserModal, BrowserPluginSettingTab, BrowserSetting, BrowserToggleComponent, BrowserTextComponent,
  installBrowserDomApi,
} from './dom-api';

type Manifest = { id: string; name: string; version: string; minAppVersion?: string };
type Command = {
  id: string; name: string; callback?: () => unknown;
  checkCallback?: (checking: boolean) => unknown;
  editorCallback?: (editor: LiveMarkdownEditor, view: BrowserMarkdownView) => unknown;
  editorCheckCallback?: (checking: boolean, editor: LiveMarkdownEditor, view: BrowserMarkdownView) => unknown;
};
type PluginConstructor = new (app: BrowserApp, manifest: Manifest) => BrowserPlugin;
type ViewFactory = (leaf: BrowserLeaf) => BrowserItemView;
type RegisteredView = { owner: BrowserPlugin; factory: ViewFactory };
const appHosts = new WeakMap<BrowserApp, BrowserPluginHost>();

class BrowserMarkdownView {
  readonly currentMode = { sourceMode: true };
  readonly file: { path: string; basename: string; extension: string };
  constructor(readonly editor: LiveMarkdownEditor, path: string, file?: BrowserTFile) {
    this.file = file ?? { path, basename: path.split('/').pop()!.replace(/\.md$/i, ''), extension: 'md' };
  }
  getViewType(): string { return 'markdown'; }
  getMode(): string { return 'source'; }
}

class BrowserLeaf {
  view: BrowserItemView | BrowserMarkdownView | null = null;
  owner: BrowserPlugin | null = null;
  constructor(readonly app: BrowserApp) {}
  async setViewState(state: { type: string }): Promise<void> {
    await appHosts.get(this.app)!.openView(this, state.type);
  }
}

class BrowserApp {
  readonly vault?: BrowserVault;
  readonly workspace: Events & {
    readonly layoutReady: boolean;
    onLayoutReady: (callback: () => unknown) => void;
    iterateAllLeaves: (callback: (leaf: BrowserLeaf) => unknown) => void;
    getActiveViewOfType: (type: typeof BrowserMarkdownView) => BrowserMarkdownView | null;
    getActiveFile: () => BrowserMarkdownView['file'];
    getMostRecentLeaf: () => BrowserLeaf;
    getLeavesOfType: (type: string) => BrowserLeaf[];
    getRightLeaf: () => BrowserLeaf;
    revealLeaf: (leaf: BrowserLeaf) => void;
    updateOptions: () => void;
  };
  readonly metadataCache: { getFileCache: (file: { path: string }) => unknown } | BrowserMetadataCache;
  constructor(host: BrowserPluginHost, vault?: BrowserVaultController) {
    appHosts.set(this, host);
    this.workspace = Object.assign(new Events(), {
      onLayoutReady: (callback: () => unknown) => {
        if (!host.isLayoutReady) throw new Error('Browser workspace is not ready or has been closed.');
        callback();
      },
      iterateAllLeaves: (callback: (leaf: BrowserLeaf) => unknown) => {
        if (!host.isLayoutReady) throw new Error('Browser workspace is not ready or has been closed.');
        // Iterate a snapshot: callbacks may open or close a leaf themselves.
        for (const leaf of [...host.leaves]) callback(leaf);
      },
      getActiveViewOfType: (type: typeof BrowserMarkdownView) => host.markdownView instanceof type ? host.markdownView : null,
      getActiveFile: () => host.markdownView.file,
      getMostRecentLeaf: () => host.editorLeaf,
      getLeavesOfType: (type: string) => host.leaves.filter(leaf => leaf.view?.getViewType() === type),
      getRightLeaf: () => host.createLeaf(),
      revealLeaf: (leaf: BrowserLeaf) => {
        if (leaf.view instanceof BrowserItemView) leaf.view.containerEl.hidden = false;
      },
      updateOptions: () => host.extensions.refresh(),
    }) as BrowserApp['workspace'];
    Object.defineProperty(this.workspace, 'layoutReady', { enumerable: true, get: () => host.isLayoutReady });
    this.vault = vault?.vault;
    this.metadataCache = vault ? new BrowserMetadataCache(vault) : { getFileCache: (file: { path: string }) => {
      if (file.path !== host.markdownView.file.path) return null;
      const state = host.editor.cm.state;
      const tree = ensureSyntaxTree(state, state.doc.length, 100);
      if (!tree) throw new Error('Markdown metadata is not ready for this document.');
      const sections = [];
      for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        sections.push({
          type: /^(FencedCode|CodeBlock)$/.test(node.name) ? 'code' : node.name.toLowerCase(),
          position: {
            start: { ...host.editor.offsetToPos(node.from), offset: node.from },
            end: { ...host.editor.offsetToPos(node.to), offset: node.to },
          },
        });
      }
      return { sections };
    } };
  }
}

class BrowserPlugin extends Component {
  private revoked = false;
  constructor(readonly app: BrowserApp, readonly manifest: Manifest) {
    super();
    this.host.adopt(this);
  }
  private get host(): BrowserPluginHost { return appHosts.get(this.app)!; }
  assertActive(): void { if (this.revoked) throw new Error('Plugin has been unloaded.'); }
  revoke(): void { this.revoked = true; }
  override registerEvent(ref: EventRef): void {
    if (this.revoked) ref.off();
    this.assertActive();
    super.registerEvent(ref);
  }
  override registerInterval(id: number): number {
    if (this.revoked) clearInterval(id);
    this.assertActive();
    return super.registerInterval(id);
  }
  override registerDomEvent(el: EventTarget, type: string, callback: EventListener, options?: boolean | AddEventListenerOptions): void {
    // Component.registerDomEvent installs the listener before registering its cleanup.
    // Guard before either step so late asynchronous work cannot install orphan listeners.
    this.assertActive();
    super.registerDomEvent(el, type, callback, options);
  }
  addCommand(command: Command): Command {
    this.assertActive(); this.host.registerCommand(this, command); return command;
  }
  registerEditorExtension(extension: Extension): void {
    this.assertActive(); this.host.extensions.register(this.manifest.id, extension);
  }
  registerMarkdownPostProcessor(processor: BrowserMarkdownPostProcessor, sortOrder?: number): BrowserMarkdownPostProcessor {
    this.assertActive(); if (sortOrder !== undefined) processor.sortOrder = sortOrder;
    return this.host.markdown.registerPostProcessor(this, processor);
  }
  registerMarkdownCodeBlockProcessor(language: string, processor: BrowserCodeBlockProcessor, sortOrder?: number): BrowserCodeBlockProcessor {
    this.assertActive(); if (sortOrder !== undefined) processor.sortOrder = sortOrder;
    return this.host.markdown.registerCodeBlock(this, language, processor);
  }
  registerView(type: string, factory: ViewFactory): void {
    this.assertActive(); this.host.registerView(this, type, factory);
  }
  addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    this.assertActive();
    const button = createObsidianElement('button');
    button.setAttribute('type', 'button'); button.setText(title); button.title = title;
    button.setAttribute('aria-label', title); button.setAttribute('data-icon', icon);
    this.registerDomEvent(button, 'click', callback as EventListener);
    this.host.addElement(this, button);
    return button;
  }
  addSettingTab(tab: BrowserPluginSettingTab): void {
    this.assertActive(); this.host.registerSettingTab(this, tab);
  }
  async loadData(): Promise<unknown> { this.assertActive(); return this.host.getPluginData(this.manifest.id); }
  async saveData(data: unknown): Promise<void> {
    this.assertActive(); this.host.savePluginData(this.manifest.id, data);
  }
}

/**
 * Browser DOM + CM6 lifecycle foundation. Only instantiated in disposable isolated frames.
 * It owns one live editor plus an optional approved Vault snapshot, not a Node
 * bridge or I/O broker. The owner must authorize/populate snapshots before use.
 * No raw plugin source is evaluated here. The caller must supply an isolated module loader.
 */
export class BrowserPluginHost {
  readonly editor: LiveMarkdownEditor;
  readonly markdownView: BrowserMarkdownView;
  readonly editorLeaf: BrowserLeaf;
  readonly app: BrowserApp;
  readonly extensions = new EditorExtensionRegistry();
  readonly markdown = new BrowserMarkdownRenderer();
  readonly leaves: BrowserLeaf[] = [];
  readonly api;
  private plugins = new Map<string, BrowserPlugin>();
  private commands = new Map<string, { owner: BrowserPlugin; command: Command }>();
  private views = new Map<string, RegisteredView>();
  private settings: BrowserSettingsLifecycle<BrowserPlugin>;
  private elements = new Map<BrowserPlugin, Set<HTMLElement>>();
  private data = new Map<string, unknown>();
  private destroyed = false;
  private detachEditor: () => void;
  private baseStyle: HTMLElement;
  private lifecycleTimeoutMs: number;
  #vaultController?: BrowserVaultController;
  #container: HTMLElement;
  #editorContext = new Compartment();
  get isLayoutReady(): boolean { return !this.destroyed && this.leaves.includes(this.editorLeaf); }

  constructor(options: { editor: EditorView; container: HTMLElement; filePath: string; lifecycleTimeoutMs?: number;
    /** Ownership transfers to this host; destroy revokes its read facet. */
    vault?: BrowserVaultController }) {
    options = { ...options };
    this.#container = options.container;
    const file = options.vault?.vault.getFileByPath(options.filePath);
    if (options.vault && !file) throw new Error('The active editor file is outside the approved Vault snapshot.');
    installBrowserDomApi();
    this.lifecycleTimeoutMs = options.lifecycleTimeoutMs ?? 5000;
    if (!Number.isInteger(this.lifecycleTimeoutMs) || this.lifecycleTimeoutMs < 1 || this.lifecycleTimeoutMs > 30_000) {
      throw new Error('Lifecycle timeout must be between 1 and 30000 milliseconds.');
    }
    this.settings = new BrowserSettingsLifecycle((owner, element) => this.addElement(owner, element),
      (action, label, onTimeout) => this.lifecycle(action, label, onTimeout));
    this.baseStyle = createObsidianElement('style');
    this.baseStyle.textContent = browserHostBaseStyles;
    options.container.setAttribute('data-obsidian-browser-host', '');
    options.container.appendChild(this.baseStyle);
    this.editor = new LiveMarkdownEditor(options.editor);
    this.markdownView = new BrowserMarkdownView(this.editor, options.filePath, file ?? undefined);
    this.app = new BrowserApp(this, options.vault);
    options.editor.dispatch({ effects: StateEffect.appendConfig.of(this.#editorContext.of([
      editorInfoField.init(() => Object.freeze({ app: this.app, editor: this.editor, file: this.markdownView.file })),
      editorEditorField.init(() => options.editor), editorLivePreviewField,
    ])) });
    // TypeScript private is only a compile-time constraint. Keep the owner
    // controller in a real private field, never in plugin-reachable options.
    this.#vaultController = options.vault;
    this.editorLeaf = new BrowserLeaf(this.app);
    this.editorLeaf.view = this.markdownView;
    this.leaves.push(this.editorLeaf);
    this.detachEditor = this.extensions.attach(options.editor);
    const icons = new Map<string, string>();
    const renderMarkdown = async (source: string, target: HTMLElement, sourcePath: string, component: Component) => {
      if (!(component instanceof Component)) throw new Error('Markdown rendering requires a lifecycle component.');
      await this.markdown.render(source, target, sourcePath, component);
    };
    const app = this.app;
    this.api = {
      Component, Events, debounce, Plugin: BrowserPlugin, MarkdownView: BrowserMarkdownView, MarkdownRenderChild: BrowserMarkdownRenderChild,
      editorInfoField, editorEditorField, editorLivePreviewField, editorViewField: editorInfoField,
      MarkdownRenderer: class extends BrowserMarkdownRenderChild {
        static renderMarkdown = renderMarkdown;
        static async render(ownerApp: BrowserApp, source: string, target: HTMLElement, sourcePath: string, component: Component) {
          if (ownerApp !== app) throw new Error('Markdown app does not belong to this plugin host.');
          await renderMarkdown(source, target, sourcePath, component);
        }
      },
      Vault: BrowserVault, TAbstractFile: BrowserTAbstractFile, TFile: BrowserTFile, TFolder: BrowserTFolder,
      ItemView: BrowserItemView, Modal: BrowserModal, PluginSettingTab: BrowserPluginSettingTab,
      Setting: BrowserSetting, ToggleComponent: BrowserToggleComponent, TextComponent: BrowserTextComponent,
      Platform: { isDesktop: true, isDesktopApp: false, isMobile: false, isMobileApp: false },
      addIcon: (id: string, svg: string) => { icons.set(id, svg); },
      getIcon: (id: string) => {
        const svg = icons.get(id);
        return svg ? document.importNode(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, true) : null;
      },
      Notice: class {
        noticeEl = createObsidianElement('div');
        constructor(message: string, timeout = 4000) {
          this.noticeEl.setText(String(message));
          this.noticeEl.setAttribute('role', 'status');
          options.container.appendChild(this.noticeEl);
          if (timeout > 0) setTimeout(() => this.hide(), timeout);
        }
        hide(): void { this.noticeEl.remove(); }
        setMessage(message: string): this { this.noticeEl.setText(message); return this; }
      },
    };
  }

  adopt(plugin: BrowserPlugin): void {
    if (this.destroyed) throw new Error('Browser plugin host is destroyed.');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.manifest.id)) throw new Error('Invalid plugin id.');
    if (this.plugins.has(plugin.manifest.id)) throw new Error('Plugin is already loaded.');
    this.plugins.set(plugin.manifest.id, plugin);
  }

  async load(manifest: Manifest, Constructor: PluginConstructor, assets: { styles?: string } = {}): Promise<void> {
    if (this.destroyed) throw new Error('Browser plugin host is destroyed.');
    if (this.plugins.has(manifest.id)) throw new Error('Plugin is already loaded.');
    if (!(Constructor?.prototype instanceof BrowserPlugin)) throw new Error('Plugin must extend obsidian.Plugin.');
    let instance: BrowserPlugin | undefined;
    try {
      instance = new Constructor(this.app, Object.freeze({ ...manifest }));
      if (assets.styles) {
        const style = createObsidianElement('style');
        style.setAttribute('data-obsidian-plugin', manifest.id);
        style.textContent = assets.styles;
        this.addElement(instance, style);
      }
      const loading = instance;
      await this.lifecycle(() => loading.load(), 'Plugin startup');
      loading.assertActive();
    } catch (error) {
      // A revoked instance may finish after the user has already reloaded this id.
      // Cleanup is scoped to the actual instance, not just the plugin id.
      if (!instance || this.plugins.get(manifest.id) === instance) {
        try { await this.unload(manifest.id); } catch { /* Preserve the original startup failure. */ }
      }
      throw error;
    }
  }

  async unload(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    plugin.revoke();
    const errors: unknown[] = [];
    // Revoke UI/command/extension entry points even if user onunload subsequently throws.
    this.plugins.delete(id);
    try { this.extensions.remove(id); } catch (error) { errors.push(error); }
    for (const [key, entry] of this.commands) if (entry.owner === plugin) this.commands.delete(key);
    for (const [key, entry] of this.views) if (entry.owner === plugin) this.views.delete(key);
    this.elements.get(plugin)?.forEach(el => el.remove());
    this.elements.delete(plugin);
    const settingsCleanup = this.settings.remove(plugin);
    void settingsCleanup.catch(() => {});
    // Retire id-keyed registrations before the first await: a new instance can
    // adopt the same id while Markdown cleanup is still in progress.
    try { await this.markdown.removeOwner(plugin); } catch (error) { errors.push(error); }
    for (const leaf of this.leaves.filter(leaf => leaf.owner === plugin)) {
      this.leaves.splice(this.leaves.indexOf(leaf), 1);
      if (leaf.view instanceof BrowserItemView) {
        leaf.view.containerEl.remove();
        const view = leaf.view;
        try { await this.lifecycle(() => view.unload(), 'View cleanup'); } catch (error) { errors.push(error); }
      }
    }
    try { await settingsCleanup; } catch (error) { errors.push(error); }
    try { await this.lifecycle(() => plugin.unload(), 'Plugin cleanup'); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Plugin cleanup failed.');
  }

  registerCommand(owner: BrowserPlugin, command: Command): void {
    if (!command.id || !command.name) throw new Error('Command id and name are required.');
    const id = `${owner.manifest.id}:${command.id}`;
    if (this.commands.has(id)) throw new Error('Command id is already registered.');
    this.commands.set(id, { owner, command });
  }
  getCommands(): { id: string; name: string }[] {
    return Array.from(this.commands, ([id, { command }]) => ({ id, name: command.name }));
  }
  async runCommand(id: string): Promise<boolean> {
    const entry = this.commands.get(id);
    if (!entry) return false;
    entry.owner.assertActive();
    const { command } = entry;
    if (command.editorCheckCallback) {
      if (!await command.editorCheckCallback(true, this.editor, this.markdownView)) return false;
      entry.owner.assertActive();
      await command.editorCheckCallback(false, this.editor, this.markdownView);
    } else if (command.editorCallback) await command.editorCallback(this.editor, this.markdownView);
    else if (command.checkCallback) {
      if (!await command.checkCallback(true)) return false;
      entry.owner.assertActive();
      await command.checkCallback(false);
    } else if (command.callback) await command.callback();
    else return false;
    return true;
  }
  registerView(owner: BrowserPlugin, type: string, factory: ViewFactory): void {
    if (this.views.has(type)) throw new Error('View type is already registered.');
    this.views.set(type, { owner, factory });
  }
  createLeaf(): BrowserLeaf { const leaf = new BrowserLeaf(this.app); this.leaves.push(leaf); return leaf; }
  async openView(leaf: BrowserLeaf, type: string): Promise<void> {
    const entry = this.views.get(type);
    if (!entry) throw new Error(`Browser view is unavailable: ${type}`);
    entry.owner.assertActive();
    if (leaf.view instanceof BrowserItemView) {
      const previous = leaf.view;
      await this.lifecycle(() => previous.unload(), 'Previous view cleanup');
    }
    entry.owner.assertActive();
    leaf.owner = entry.owner;
    const view = entry.factory(leaf);
    view.containerEl.setAttribute('data-type', type);
    leaf.view = view;
    this.addElement(entry.owner, view.containerEl);
    await this.lifecycle(() => view.load(), 'View startup');
  }
  addElement(owner: BrowserPlugin, element: HTMLElement): void {
    owner.assertActive();
    const elements = this.elements.get(owner) ?? new Set();
    elements.add(element); this.elements.set(owner, elements);
    this.#container.appendChild(element);
  }
  registerSettingTab(owner: BrowserPlugin, tab: BrowserPluginSettingTab): void {
    this.settings.register(owner, tab);
  }
  async showSettings(id: string, container = this.#container): Promise<number> {
    const owner = this.plugins.get(id);
    if (!owner) throw new Error('Plugin is not loaded.');
    return this.settings.show(owner, container);
  }
  hideSettings(id: string): Promise<void> {
    const owner = this.plugins.get(id);
    return owner ? this.settings.hide(owner) : Promise.resolve();
  }
  getPluginData(id: string): unknown { return structuredClone(this.data.get(id) ?? null); }
  async renderMarkdown(source: string, element: HTMLElement, sourcePath = this.markdownView.file.path): Promise<void> {
    if (this.destroyed) throw new Error('Browser plugin host is destroyed.');
    await this.markdown.render(source, element, sourcePath);
  }
  savePluginData(id: string, data: unknown): void {
    // Session-local JSON only. Disk persistence requires the still-pending permission broker.
    const json = JSON.stringify(data);
    if (!json || json.length > 1_000_000) throw new Error('Plugin settings exceed the session data limit.');
    this.data.set(id, JSON.parse(json));
  }
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    const results = await Promise.allSettled([this.markdown.destroy(), ...Array.from(this.plugins.keys(), id => this.unload(id))]);
    if (this.app.metadataCache instanceof BrowserMetadataCache) this.app.metadataCache.dispose();
    this.#vaultController?.close(); this.#vaultController = undefined;
    this.detachEditor(); this.extensions.destroy(); this.data.clear(); this.baseStyle.remove();
    this.editor.cm.dispatch({ effects: this.#editorContext.reconfigure([]) });
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Host cleanup failed.');
  }

  private async lifecycle(action: () => unknown, label: string, onTimeout?: () => void): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(action),
        new Promise((_, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(new Error(`${label} timed out.`)); }, this.lifecycleTimeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
}
