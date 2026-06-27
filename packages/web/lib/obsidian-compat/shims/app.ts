/**
 * Obsidian Plugin Compatibility - App Shim
 * Central app adapter that plugins interact with
 */

import { Vault } from './vault';
import { MetadataCacheShim } from './metadata-cache';
import { FileManagerShim } from './file-manager';
import { CommandRegistry } from '../command-registry';
import { Events, type EventCallback, type EventRef } from '../events';
import { ObsidianRuntimeHost } from '../runtime';
import type { App, Command, Editor, IFileManager, IMetadataCache, MarkdownView, SecretStorage, TFile, Workspace, WorkspaceLeaf } from '../types';
import type { CommandExecutionContext } from '../command-registry';
import { ObsidianSecretStorage, type ObsidianSecretStorageBackend, type ObsidianSecretStorageSummary } from '../secret-storage';
import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from '@/lib/core/security';
import {
  resolveCanonicalPluginLocalStoragePath,
  resolvePluginLocalStoragePathsForRead,
} from '../plugin-paths';

/**
 * Minimal WorkspaceLeaf implementation. It records state but does not mount
 * Obsidian views into MindOS layout in Phase 1.
 */
class WorkspaceLeafShim implements WorkspaceLeaf {
  private viewState: { type: string; state?: unknown } = { type: 'empty' };

  constructor(
    private readonly app: AppShim,
    private readonly host: ObsidianRuntimeHost,
  ) {}

  getViewState(): { type: string; state?: unknown } {
    return this.viewState;
  }

  async setViewState(state: { type: string; state?: unknown }): Promise<void> {
    this.viewState = state;
  }

  async openFile(file: TFile, openState?: unknown): Promise<void> {
    await this.app.workspace.openLinkText(file.path, '', openState);
  }

  detach(): void {
    this.host.warn({
      code: 'workspace-leaf-detach-recorded-only',
      message: 'WorkspaceLeaf.detach() is recorded as a no-op in MindOS Phase 1.',
    });
  }
}

class ReadonlyMarkdownEditorShim implements Editor {
  constructor(
    private readonly file: TFile,
    private readonly content: string,
  ) {}

  getValue(): string {
    return this.content;
  }

  setValue(_value: string): void {
    this.warnReadonly();
  }

  getSelection(): string {
    return '';
  }

  replaceSelection(_replacement: string): void {
    this.warnReadonly();
  }

  getCursor(_which?: 'from' | 'to' | 'anchor' | 'head'): { line: number; ch: number } {
    return { line: 0, ch: 0 };
  }

  setCursor(pos: { line: number; ch: number }): void;
  setCursor(line: number, ch?: number): void;
  setCursor(_posOrLine: { line: number; ch: number } | number, _ch?: number): void {
    this.warnReadonly();
  }

  setSelection(_anchor: { line: number; ch: number }, _head?: { line: number; ch: number }): void {
    this.warnReadonly();
  }

  lineCount(): number {
    return this.lines().length;
  }

  getLine(line: number): string {
    return this.lines()[line] ?? '';
  }

  setLine(_line: number, _text: string): void {
    this.warnReadonly();
  }

  getRange(from: { line: number; ch: number }, to: { line: number; ch: number }): string {
    const start = this.positionToOffset(from);
    const end = this.positionToOffset(to);
    return this.content.slice(Math.min(start, end), Math.max(start, end));
  }

  replaceRange(_replacement: string, _from: { line: number; ch: number }, _to?: { line: number; ch: number }): void {
    this.warnReadonly();
  }

  private warnReadonly(): void {
    throw new Error(`Active MarkdownView editor for "${this.file.path}" is read-only outside editor command execution.`);
  }

  private lines(): string[] {
    return this.content.split('\n');
  }

  private positionToOffset(position: { line: number; ch: number }): number {
    const lines = this.lines();
    const line = Math.max(0, Math.min(Math.trunc(position.line), lines.length - 1));
    let offset = 0;
    for (let index = 0; index < line; index += 1) {
      offset += (lines[index]?.length ?? 0) + 1;
    }
    const ch = Math.max(0, Math.min(Math.trunc(position.ch), lines[line]?.length ?? 0));
    return offset + ch;
  }
}

/**
 * Minimal Workspace implementation.
 */
class WorkspaceShim extends Events implements Workspace {
  activeLeaf: WorkspaceLeaf;
  activeEditor: MarkdownView | null = null;
  layoutReady = true;
  private readonly leaves: WorkspaceLeaf[] = [];
  private readonly leftLeaves: WorkspaceLeaf[] = [];
  private readonly rightLeaves: WorkspaceLeaf[] = [];
  private activeFile: TFile | null = null;

  constructor(
    private readonly app: AppShim,
    private readonly host: ObsidianRuntimeHost,
  ) {
    super();
    this.activeLeaf = new WorkspaceLeafShim(app, host);
    this.leaves.push(this.activeLeaf);
  }

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  override on(name: string, callback: EventCallback, ctx?: unknown): EventRef {
    const ref = super.on(name, callback, ctx);
    const pluginId = this.host.getCurrentPluginId();
    if (pluginId) {
      ref.ownerPluginId = pluginId;
      this.host.recordRuntimeCapability(pluginId, 'Workspace.on', 'registered', `Plugin registered workspace event "${name}".`);
    }
    return ref;
  }

  triggerForPlugin(pluginId: string, name: string, ...args: unknown[]): unknown[] {
    return this.triggerWhere(name, (ref) => ref.ownerPluginId === pluginId, ...args);
  }

  setActiveFile(file: TFile | null): void {
    const previous = this.activeFile;
    this.activeFile = file;
    this.activeEditor = file ? {
      file,
      editor: new ReadonlyMarkdownEditorShim(file, this.app.readFileContentSync(file)),
      getViewType: () => 'markdown',
    } : null;
    this.activeLeaf.setViewState(file
      ? { type: 'markdown', state: { file: { path: file.path, name: file.name, basename: file.basename, extension: file.extension } } }
      : { type: 'empty' },
    );
    if (previous?.path !== file?.path) {
      this.trigger('file-open', file);
      this.trigger('active-leaf-change', this.activeLeaf);
      this.trigger('layout-change');
    }
  }

  getActiveViewOfType<T>(type: abstract new (...args: any[]) => T): T | null {
    if (!this.activeEditor) {
      return null;
    }
    const typeName = typeof type === 'function' ? type.name : '';
    if (typeName === 'MarkdownView' || typeName === 'ItemView') {
      return this.activeEditor as T;
    }
    return null;
  }

  onLayoutReady(callback: () => void): void {
    callback();
  }

  async openLinkText(linktext: string, sourcePath: string, openState?: unknown): Promise<void> {
    this.host.recordWorkspaceOpen({ linktext, sourcePath, openState });
  }

  getLeaf(newLeaf?: boolean | 'split' | 'tab' | 'window'): WorkspaceLeaf {
    if (newLeaf) {
      const leaf = new WorkspaceLeafShim(this.app, this.host);
      this.leaves.push(leaf);
      return leaf;
    }
    return this.activeLeaf;
  }

  getUnpinnedLeaf(): WorkspaceLeaf {
    return this.getLeaf();
  }

  splitActiveLeaf(): WorkspaceLeaf {
    return this.getLeaf(true);
  }

  getLeftLeaf(split?: boolean): WorkspaceLeaf | null {
    return this.getSidebarLeaf(this.leftLeaves, split);
  }

  getRightLeaf(split?: boolean): WorkspaceLeaf | null {
    return this.getSidebarLeaf(this.rightLeaves, split);
  }

  getLeavesOfType(viewType: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.getViewState().type === viewType);
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const viewType = leaf.getViewState().type;
    this.host.recordRuntimeCapability(
      this.host.getCurrentPluginId(),
      'Workspace.revealLeaf',
      'called',
      `Plugin requested reveal for workspace leaf "${viewType}".`,
    );
  }

  iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => any): void {
    for (const leaf of this.leaves) {
      callback(leaf);
    }
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => any): void {
    this.iterateRootLeaves(callback);
  }

  iterateCodeMirrors(callback: (codeMirror: { getOption(key: string): unknown; setOption(key: string, value: unknown): void }) => any): void {
    void callback;
    this.host.warn({
      code: 'workspace-codemirror-iteration-recorded-only',
      message: 'Workspace.iterateCodeMirrors() is recorded as a no-op until MindOS exposes a browser editor plugin host.',
    });
  }

  registerHoverLinkSource(source: string, options: unknown): void {
    void options;
    this.host.warn({
      code: 'workspace-hover-link-source-recorded-only',
      message: `Workspace.registerHoverLinkSource("${source}") is recorded as a no-op in MindOS Phase 1.`,
    });
  }

  getLayout(): unknown {
    return {
      main: {
        type: 'split',
        children: [],
      },
      active: this.activeLeaf.getViewState().type,
    };
  }

  async changeLayout(layout: unknown): Promise<void> {
    void layout;
    this.host.warn({
      code: 'workspace-change-layout-recorded-only',
      message: 'Workspace.changeLayout() is recorded as a no-op in MindOS Phase 1.',
    });
  }

  private getSidebarLeaf(collection: WorkspaceLeaf[], split?: boolean): WorkspaceLeaf {
    if (split || collection.length === 0) {
      const leaf = new WorkspaceLeafShim(this.app, this.host);
      collection.push(leaf);
      this.leaves.push(leaf);
      return leaf;
    }
    return collection[0]!;
  }
}

/**
 * App shim: central adapter that provides vault, metadata, workspace to plugins.
 */
export interface AppShimOptions {
  secretStorageBackend?: ObsidianSecretStorageBackend;
}

export class AppShim implements App {
  vault: Vault;
  metadataCache: IMetadataCache;
  fileManager: IFileManager;
  secretStorage: SecretStorage;
  workspace: Workspace;
  commands: App['commands'];
  customCss: App['customCss'];
  plugins: NonNullable<App['plugins']>;
  internalPlugins: { plugins: Record<string, unknown>; getPluginById: (pluginId: string) => unknown };
  foldManager: { load: () => unknown; save: () => void };
  dragManager: {
    draggable: unknown;
    onDragStart: (_evt: unknown, data: unknown) => void;
    updateHover: () => void;
    setAction: () => void;
  };

  private commandRegistry: CommandRegistry;
  private runtimeHost: ObsidianRuntimeHost;

  constructor(private mindRoot: string, runtimeHost = new ObsidianRuntimeHost(), options: AppShimOptions = {}) {
    this.runtimeHost = runtimeHost;
    this.vault = new Vault(mindRoot, this.runtimeHost);
    this.metadataCache = new MetadataCacheShim(mindRoot, this.vault, this.runtimeHost);
    this.fileManager = new FileManagerShim(this);
    this.secretStorage = new ObsidianSecretStorage(
      mindRoot,
      () => this.runtimeHost.getCurrentPluginId(),
      (warning) => this.runtimeHost.warn(warning),
      options.secretStorageBackend,
    );
    this.workspace = new WorkspaceShim(this, this.runtimeHost);
    this.commandRegistry = new CommandRegistry();
    this.commands = this.createCommandsShim();
    this.customCss = this.createCustomCssShim();
    this.plugins = {
      plugins: {},
      enabledPlugins: new Set(),
      getPlugin: (pluginId: string) => this.plugins.plugins[pluginId] ?? null,
      enablePlugin: async (pluginId: string) => {
        this.plugins.enabledPlugins.add(pluginId);
      },
      disablePlugin: async (pluginId: string) => {
        this.plugins.enabledPlugins.delete(pluginId);
      },
    };
    this.internalPlugins = {
      plugins: {},
      getPluginById: (pluginId: string) => this.internalPlugins.plugins[pluginId] ?? null,
    };
    this.foldManager = {
      load: () => null,
      save: () => {},
    };
    this.dragManager = {
      draggable: null,
      onDragStart: (_evt: unknown, data: unknown) => {
        this.dragManager.draggable = data;
      },
      updateHover: () => {},
      setAction: () => {},
    };
  }

  isDarkMode(): boolean {
    // TODO: detect MindOS theme
    return false;
  }

  loadLocalStorage(key: string): unknown {
    return this.readLocalStorageStore()[key] ?? null;
  }

  saveLocalStorage(key: string, data: unknown): void {
    const store = this.readLocalStorageStore();
    store[key] = data;
    this.writeLocalStorageStore(store);
  }

  removeLocalStorage(key: string): void {
    const store = this.readLocalStorageStore();
    delete store[key];
    this.writeLocalStorageStore(store);
  }

  registerCommand(pluginId: string, command: Command): Command {
    const registered = this.commandRegistry.register(pluginId, command);
    this.runtimeHost.recordRuntimeCapability(pluginId, 'addCommand', 'registered', `Plugin registered command "${registered.id}".`);
    return registered;
  }

  unregisterCommand(pluginId: string, commandId: string): void {
    this.commandRegistry.unregister(pluginId, commandId);
    this.runtimeHost.recordRuntimeCapability(pluginId, 'removeCommand', 'called', `Plugin removed command "${commandId}".`);
  }

  unregisterAllCommands(pluginId: string): void {
    this.commandRegistry.unregisterAll(pluginId);
  }

  getCommands() {
    return this.commandRegistry.list();
  }

  async executeCommand(fullId: string, context?: CommandExecutionContext): Promise<void> {
    const command = this.commandRegistry.get(fullId);
    if (!command) {
      return this.commandRegistry.execute(fullId, context);
    }
    await this.runtimeHost.runWithPluginContext(command.pluginId, () => this.commandRegistry.execute(fullId, context));
    this.runtimeHost.recordRuntimeCapability(command.pluginId, 'addCommand', 'called', `Plugin command "${command.id}" executed.`);
  }

  getRuntimeHost(): ObsidianRuntimeHost {
    return this.runtimeHost;
  }

  getSecretStorageSummary(pluginId: string): ObsidianSecretStorageSummary {
    return (this.secretStorage as ObsidianSecretStorage).getSummary(pluginId);
  }

  removePluginSecrets(pluginId: string): Promise<number> {
    return (this.secretStorage as ObsidianSecretStorage).removePluginSecrets(pluginId);
  }

  readFileContentSync(file: TFile): string {
    try {
      return fs.readFileSync(resolveExistingSafe(this.mindRoot, file.path), 'utf-8');
    } catch {
      return '';
    }
  }

  private createCommandsShim(): App['commands'] {
    const commandRegistry = this.commandRegistry;
    return {
      get commands() {
        return Object.fromEntries(commandRegistry.list().map((command) => [command.fullId, command]));
      },
      listCommands: () => commandRegistry.list(),
      findCommand: (id: string) => this.findCommand(id),
      removeCommand: (id: string) => {
        this.removeCommandById(id);
      },
      executeCommandById: async (id: string) => {
        const command = this.findCommand(id);
        if (!command) {
          throw new Error(`Command not found: ${id}`);
        }
        await this.executeCommand(command.fullId);
      },
    };
  }

  private findCommand(id: string) {
    return this.commandRegistry.list().find((command) => command.fullId === id || command.id === id);
  }

  private removeCommandById(id: string): void {
    const normalizedId = String(id ?? '').trim();
    if (!normalizedId) {
      return;
    }

    const currentPluginId = this.runtimeHost.getCurrentPluginId();
    const command = this.findCommandForRemoval(normalizedId, currentPluginId);
    if (command) {
      this.commandRegistry.unregister(command.pluginId, command.id);
      return;
    }

    if (currentPluginId) {
      this.commandRegistry.unregister(currentPluginId, this.commandIdForCurrentPlugin(normalizedId, currentPluginId));
    }
  }

  private commandIdForCurrentPlugin(id: string, pluginId: string): string {
    const mindosFullIdPrefix = `obsidian:${pluginId}:`;
    if (id.startsWith(mindosFullIdPrefix)) {
      return id.slice(mindosFullIdPrefix.length);
    }

    const obsidianPluginIdPrefix = `${pluginId}:`;
    if (id.startsWith(obsidianPluginIdPrefix)) {
      return id.slice(obsidianPluginIdPrefix.length);
    }

    return id;
  }

  private findCommandForRemoval(id: string, pluginId?: string) {
    const commands = this.commandRegistry.list();
    const matchingCurrentPlugin = pluginId
      ? commands.find((command) =>
        command.pluginId === pluginId
        && (
          command.fullId === id
          || command.id === id
          || `${command.pluginId}:${command.id}` === id
        ),
      )
      : undefined;

    return matchingCurrentPlugin
      ?? commands.find((command) =>
        command.fullId === id
        || `${command.pluginId}:${command.id}` === id
        || command.id === id,
      );
  }

  private createCustomCssShim(): App['customCss'] {
    return {
      getSnippetPath: (snippet: string) => {
        const normalized = String(snippet || 'snippet')
          .replace(/\\/g, '/')
          .split('/')
          .filter(Boolean)
          .join('-')
          .replace(/\.css$/i, '');
        return `.mindos/snippets/${normalized || 'snippet'}.css`;
      },
      setCssEnabledStatus: (snippet: string, enabled: boolean) => {
        this.runtimeHost.warn({
          code: 'custom-css-status-recorded-only',
          message: `Custom CSS snippet "${snippet}" was ${enabled ? 'enabled' : 'disabled'} in the compatibility host; MindOS records this without mutating Obsidian CSS settings.`,
        });
      },
      readSnippets: () => {
        this.runtimeHost.warn({
          code: 'custom-css-read-snippets-recorded-only',
          message: 'Custom CSS snippet reload was recorded as a no-op in the MindOS compatibility host.',
        });
      },
    };
  }

  async withActiveFile<T>(file: TFile | null, callback: () => Promise<T> | T): Promise<T> {
    const workspace = this.workspace as WorkspaceShim;
    const previous = workspace.getActiveFile();
    workspace.setActiveFile(file);
    try {
      return await callback();
    } finally {
      workspace.setActiveFile(previous);
    }
  }

  private getLocalStoragePath(): string {
    return resolveCanonicalPluginLocalStoragePath(this.mindRoot);
  }

  private readLocalStorageStore(): Record<string, unknown> {
    for (const filePath of resolvePluginLocalStoragePathsForRead(this.mindRoot)) {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private writeLocalStorageStore(store: Record<string, unknown>): void {
    const filePath = this.getLocalStoragePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  }
}
