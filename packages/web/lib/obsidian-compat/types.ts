/**
 * Obsidian Plugin Compatibility - Types
 * Minimal type definitions for Obsidian Plugin API Shim
 * Target API: 1.7.2 common subset
 */

// ============ Plugin Manifest ============

export interface PluginManifest {
  /** Unique plugin identifier (alphanumeric + dash) */
  id: string;
  /** Human-readable plugin name */
  name: string;
  /** Plugin version (semver) */
  version: string;
  /** Minimum MindOS version required */
  minMindOsVersion?: string;
  /** Plugin description */
  description?: string;
  /** Plugin author(s) */
  author?: string;
  /** Author URL */
  authorUrl?: string;
  /** Funding URL */
  fundingUrl?: string;
  /** Is this a desktop-only plugin (requires Electron/Node.js APIs) */
  isDesktopOnly?: boolean;
}

// ============ File System Objects ============

export interface TAbstractFile {
  vault: IVault;
  path: string;
  name: string;
  parent: TFolder | null;
}

export interface TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };
}

export interface TFolder extends TAbstractFile {
  children: TAbstractFile[];
  isRoot(): boolean;
}

// ============ Metadata ============

export interface CachedMetadata {
  frontmatter?: Record<string, unknown>;
  tags?: Array<{ tag: string; position?: unknown }>;
  headings?: Array<{ heading: string; level: number; position?: unknown }>;
  links?: Array<{ link: string; original: string; position?: unknown }>;
}

// ============ Commands ============

export interface Command {
  id: string;
  name: string;
  callback?: () => any;
  checkCallback?: (checking: boolean) => boolean | void;
  hotkeys?: Hotkey[];
}

export interface Hotkey {
  modifiers: string[];
  key: string;
}

// ============ Events ============

export type EventRefLike = { off: () => void };
export type EventCallback = (...args: any[]) => any;

// ============ UI & Modals ============

export interface NoticeOptions {
  timeout?: number;
}

export interface ModalOptions {
  /** Optional parent element container */
  containerEl?: HTMLElement;
}

export interface SettingItem {
  key: string;
  name: string;
  desc?: string;
  value?: unknown;
  onChange?: (value: unknown) => void;
}

// ============ Shim Core Classes ============

export interface IComponent {
  load(): Promise<void>;
  unload(): Promise<void>;
  onload(): Promise<void> | void;
  onunload(): Promise<void> | void;
  addChild(child: IComponent): void;
  removeChild(child: IComponent): void;
  register(callback: () => void): void;
  registerEvent(ref: EventRefLike): void;
}

export interface IPlugin extends IComponent {
  app: App;
  manifest: PluginManifest;

  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;

  addCommand(command: Command): Command;
  removeCommand(commandId: string): void;
  addSettingTab(tab: PluginSettingTab): void;
  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement;
  addStatusBarItem(): HTMLElement;

  registerView(type: string, creator: ViewCreator): void;
  registerExtensions(extensions: string[], viewType: string): void;
  registerMarkdownCodeBlockProcessor(language: string, processor: CodeBlockProcessor): void;
  registerMarkdownPostProcessor(processor: MarkdownPostProcessor): void;
}

export interface IVault extends Events {
  getAbstractFileByPath(path: string): TAbstractFile | null;
  getFileByPath(path: string): TFile | null;
  getFolderByPath(path: string): TFolder | null;
  getMarkdownFiles(): TFile[];
  getFiles(): TFile[];
  getAllLoadedFiles(): TAbstractFile[];

  read(file: TFile): Promise<string>;
  cachedRead(file: TFile): Promise<string>;
  create(path: string, data: string): Promise<TFile>;
  modify(file: TFile, data: string): Promise<void>;
  append(file: TFile, data: string): Promise<void>;
  delete(file: TAbstractFile): Promise<void>;
  rename(file: TAbstractFile, newPath: string): Promise<void>;
  copy(file: TFile, newPath: string): Promise<TFile>;
}

export interface IMetadataCache extends Events {
  resolvedLinks: Record<string, Record<string, number>>;
  unresolvedLinks: Record<string, Record<string, number>>;

  getFileCache(file: TFile): CachedMetadata | null;
  getCache(path: string): CachedMetadata | null;
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension?: boolean): string;
}

export interface App {
  vault: IVault;
  metadataCache: IMetadataCache;
  workspace: Workspace;

  isDarkMode(): boolean;
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
  registerCommand(pluginId: string, command: Command): Command;
  unregisterCommand(pluginId: string, commandId: string): void;
}

export interface Workspace {
  getActiveFile(): TFile | null;
  openLinkText(linktext: string, sourcePath: string): Promise<void>;
}

export interface PluginSettingTab extends IComponent {
  app: App;
  containerEl: HTMLElement;
  items?: PluginSettingItem[];

  display(): void;
}

export type SettingKind = 'text' | 'toggle' | 'dropdown' | 'button';

export interface PluginSettingItem {
  name?: string;
  desc?: string;
  kind?: SettingKind;
  value?: unknown;
  buttonText?: string;
  options?: Array<{ value: string; label: string }>;
  onChange?: (value: unknown) => void;
  onClick?: () => void;
}

export interface Events {
  on(name: string, callback: EventCallback): EventRefLike;
  off(name: string, callback: EventCallback): void;
  offref(ref: EventRefLike): void;
  trigger(name: string, ...args: any[]): void;
}

// ============ Advanced (Not in Phase 1) ============

export type ViewCreator = () => unknown;
export type CodeBlockProcessor = (source: string, el: HTMLElement, ctx: unknown) => void;
export type MarkdownPostProcessor = (el: HTMLElement, ctx: unknown) => void;
