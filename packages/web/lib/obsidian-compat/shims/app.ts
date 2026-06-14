/**
 * Obsidian Plugin Compatibility - App Shim
 * Central app adapter that plugins interact with
 */

import { Vault } from './vault';
import { MetadataCacheShim } from './metadata-cache';
import { FileManagerShim } from './file-manager';
import { CommandRegistry } from '../command-registry';
import { Events } from '../events';
import { ObsidianRuntimeHost } from '../runtime';
import type { App, Command, Editor, IFileManager, IMetadataCache, MarkdownView, TFile, Workspace, WorkspaceLeaf } from '../types';
import type { CommandExecutionContext } from '../command-registry';
import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from '@/lib/core/security';

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
  private readonly leaves: WorkspaceLeaf[] = [];
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

  getLeavesOfType(viewType: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.getViewState().type === viewType);
  }

  iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => any): void {
    for (const leaf of this.leaves) {
      callback(leaf);
    }
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => any): void {
    this.iterateRootLeaves(callback);
  }
}

/**
 * App shim: central adapter that provides vault, metadata, workspace to plugins.
 */
export class AppShim implements App {
  vault: Vault;
  metadataCache: IMetadataCache;
  fileManager: IFileManager;
  workspace: Workspace;
  plugins: { plugins: Record<string, unknown>; enabledPlugins: Set<string> };

  private commandRegistry: CommandRegistry;
  private runtimeHost: ObsidianRuntimeHost;

  constructor(private mindRoot: string, runtimeHost = new ObsidianRuntimeHost()) {
    this.runtimeHost = runtimeHost;
    this.vault = new Vault(mindRoot);
    this.metadataCache = new MetadataCacheShim(mindRoot, this.vault);
    this.fileManager = new FileManagerShim(this);
    this.workspace = new WorkspaceShim(this, this.runtimeHost);
    this.commandRegistry = new CommandRegistry();
    this.plugins = { plugins: {}, enabledPlugins: new Set() };
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

  registerCommand(pluginId: string, command: Command): Command {
    return this.commandRegistry.register(pluginId, command);
  }

  unregisterCommand(pluginId: string, commandId: string): void {
    this.commandRegistry.unregister(pluginId, commandId);
  }

  unregisterAllCommands(pluginId: string): void {
    this.commandRegistry.unregisterAll(pluginId);
  }

  getCommands() {
    return this.commandRegistry.list();
  }

  executeCommand(fullId: string, context?: CommandExecutionContext): Promise<void> {
    const command = this.commandRegistry.get(fullId);
    if (!command) {
      return this.commandRegistry.execute(fullId, context);
    }
    return this.runtimeHost.runWithPluginContext(command.pluginId, () => this.commandRegistry.execute(fullId, context));
  }

  getRuntimeHost(): ObsidianRuntimeHost {
    return this.runtimeHost;
  }

  readFileContentSync(file: TFile): string {
    try {
      return fs.readFileSync(resolveExistingSafe(this.mindRoot, file.path), 'utf-8');
    } catch {
      return '';
    }
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
    return resolveExistingSafe(this.mindRoot, '.plugins/.local-storage.json');
  }

  private readLocalStorageStore(): Record<string, unknown> {
    const filePath = this.getLocalStoragePath();
    if (!fs.existsSync(filePath)) {
      return {};
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

  private writeLocalStorageStore(store: Record<string, unknown>): void {
    const filePath = this.getLocalStoragePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  }
}
