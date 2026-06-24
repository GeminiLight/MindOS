/**
 * Obsidian Plugin Compatibility - Types
 * Minimal type definitions for Obsidian Plugin API Shim
 * Target API: 1.7.2 common subset
 */

// ============ Plugin Manifest ============

export type PluginFundingUrl = string | Record<string, string>;

export interface PluginManifest {
  /** Unique plugin identifier (alphanumeric + dash) */
  id: string;
  /** Human-readable plugin name */
  name: string;
  /** Plugin version (semver) */
  version: string;
  /** Minimum Obsidian app version required by an imported Obsidian plugin */
  minAppVersion?: string;
  /** Minimum MindOS version required */
  minMindOsVersion?: string;
  /** Plugin description */
  description?: string;
  /** Plugin author(s) */
  author?: string;
  /** Author URL */
  authorUrl?: string;
  /** Funding URL or named funding URLs */
  fundingUrl?: PluginFundingUrl;
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

export interface Stat {
  type: 'file' | 'folder';
  ctime: number;
  mtime: number;
  size: number;
}

export interface ListedFiles {
  files: string[];
  folders: string[];
}

export interface DataWriteOptions {
  ctime?: number;
  mtime?: number;
}

export interface DataAdapter {
  getName(): string;
  exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>;
  stat(normalizedPath: string): Promise<Stat | null>;
  list(normalizedPath: string): Promise<ListedFiles>;
  read(normalizedPath: string): Promise<string>;
  readBinary(normalizedPath: string): Promise<ArrayBuffer>;
  write(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>;
  writeBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>;
  append(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>;
  appendBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>;
  process(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string>;
  getResourcePath(normalizedPath: string): string;
  mkdir(normalizedPath: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
  rmdir(normalizedPath: string, recursive?: boolean): Promise<void>;
  rename(normalizedPath: string, normalizedNewPath: string): Promise<void>;
  copy(normalizedPath: string, normalizedNewPath: string): Promise<void>;
  trashSystem(normalizedPath: string): Promise<boolean>;
  trashLocal(normalizedPath: string): Promise<void>;
}

// ============ Metadata ============

export interface Loc {
  line: number;
  col: number;
  offset: number;
}

export interface Pos {
  start: Loc;
  end: Loc;
}

export interface CacheItem {
  position: Pos;
}

export interface Reference {
  link: string;
  original: string;
  displayText?: string;
}

export type ReferenceCache = Reference & CacheItem;
export type LinkCache = ReferenceCache;
export type EmbedCache = ReferenceCache;

export interface TagCache extends CacheItem {
  tag: string;
}

export interface HeadingCache extends CacheItem {
  heading: string;
  level: number;
}

export interface SectionCache extends CacheItem {
  id?: string;
  type: 'blockquote' | 'callout' | 'code' | 'element' | 'footnoteDefinition' | 'heading' | 'html' | 'list' | 'paragraph' | 'table' | 'text' | 'thematicBreak' | 'yaml' | string;
}

export interface ListItemCache extends CacheItem {
  id?: string;
  task?: string;
  parent: number;
}

export interface BlockCache extends CacheItem {
  id: string;
}

export interface FrontmatterLinkCache extends Reference {
  key: string;
}

export interface CachedMetadata {
  frontmatter?: Record<string, unknown>;
  frontmatterPosition?: Pos;
  frontmatterLinks?: FrontmatterLinkCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  links?: LinkCache[];
  embeds?: EmbedCache[];
  sections?: SectionCache[];
  listItems?: ListItemCache[];
  blocks?: Record<string, BlockCache>;
}

// ============ Commands ============

export interface EditorPosition {
  line: number;
  ch: number;
}

export interface Editor {
  getValue(): string;
  setValue(value: string): void;
  getSelection(): string;
  replaceSelection(replacement: string): void;
  getCursor(which?: 'from' | 'to' | 'anchor' | 'head'): EditorPosition;
  setCursor(pos: EditorPosition): void;
  setCursor(line: number, ch?: number): void;
  setSelection(anchor: EditorPosition, head?: EditorPosition): void;
  lineCount(): number;
  getLine(line: number): string;
  setLine(line: number, text: string): void;
  getRange(from: EditorPosition, to: EditorPosition): string;
  replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void;
}

export interface MarkdownView {
  file: TFile;
  editor: Editor;
  getViewType(): string;
}

export interface Command {
  id: string;
  name: string;
  callback?: () => any;
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: Editor, view: MarkdownView) => any;
  editorCheckCallback?: (checking: boolean, editor: Editor, view: MarkdownView) => boolean | void;
  hotkeys?: Hotkey[];
}

export interface Hotkey {
  modifiers: string[];
  key: string;
}

// ============ Events ============

export type EventRefLike = {
  name?: string;
  callback?: EventCallback;
  ctx?: unknown;
  off: () => void;
};
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
  addChild<T extends IComponent>(child: T): T;
  removeChild<T extends IComponent>(child: T): T;
  register(callback: () => void): void;
  registerEvent(ref: EventRefLike): void;
  registerDomEvent(el: EventTarget, type: string, callback: EventListener, options?: boolean | AddEventListenerOptions): void;
  registerInterval(id: number): number;
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
  registerHoverLinkSource(source: string, options: unknown): void;
  registerEditorExtension(extension: unknown): void;
  registerEditorSuggest(editorSuggest: unknown): void;
  registerMarkdownCodeBlockProcessor(language: string, processor: CodeBlockProcessor): void;
  registerMarkdownPostProcessor(processor: MarkdownPostProcessor): void;
}

export interface IVault extends Events {
  adapter: DataAdapter;
  configDir: string;
  getName(): string;
  getConfig(key: string): unknown;
  setConfig(key: string, value: unknown): void;
  getAbstractFileByPath(path: string): TAbstractFile | null;
  getFileByPath(path: string): TFile | null;
  getFolderByPath(path: string): TFolder | null;
  getRoot(): TFolder;
  getMarkdownFiles(): TFile[];
  getFiles(): TFile[];
  getAllLoadedFiles(): TAbstractFile[];

  read(file: TFile): Promise<string>;
  readBinary(file: TFile): Promise<ArrayBuffer>;
  cachedRead(file: TFile): Promise<string>;
  create(path: string, data: string, options?: DataWriteOptions): Promise<TFile>;
  createBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile>;
  createFolder(path: string): Promise<TFolder>;
  modify(file: TFile, data: string, options?: DataWriteOptions): Promise<void>;
  modifyBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>;
  append(file: TFile, data: string, options?: DataWriteOptions): Promise<void>;
  appendBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>;
  process(file: TFile, fn: (data: string) => string, options?: DataWriteOptions): Promise<string>;
  getResourcePath(file: TFile): string;
  delete(file: TAbstractFile, force?: boolean): Promise<void>;
  trash(file: TAbstractFile, system: boolean): Promise<void>;
  rename(file: TAbstractFile, newPath: string): Promise<void>;
  copy(file: TFile, newPath: string): Promise<TFile>;
}

export interface IMetadataCache extends Events {
  resolvedLinks: Record<string, Record<string, number>>;
  unresolvedLinks: Record<string, Record<string, number>>;

  getFileCache(file: TFile): CachedMetadata | null;
  getCache(path: string): CachedMetadata | null;
  getCachedFiles(): string[];
  getTags(): Record<string, number>;
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension?: boolean): string;
}

export interface IFileManager {
  processFrontMatter(
    file: TFile,
    fn: (frontmatter: Record<string, unknown>) => void | Promise<void>,
    options?: DataWriteOptions,
  ): Promise<void>;
  generateMarkdownLink(file: TFile, sourcePath: string, subpath?: string, alias?: string): string;
  getNewFileParent(sourcePath: string, newFilePath?: string): TFolder;
  renameFile(file: TAbstractFile, newPath: string): Promise<void>;
  promptForDeletion(file: TAbstractFile): Promise<boolean>;
  trashFile(file: TAbstractFile): Promise<void>;
  getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string>;
}

export interface App {
  vault: IVault;
  metadataCache: IMetadataCache;
  fileManager: IFileManager;
  workspace: Workspace;
  secretStorage: SecretStorage;
  commands: {
    commands: Record<string, Command>;
    listCommands(): Command[];
    findCommand(id: string): Command | undefined;
    removeCommand(id: string): void;
    executeCommandById(id: string): Promise<void>;
  };
  customCss: {
    getSnippetPath(snippet: string): string;
    setCssEnabledStatus(snippet: string, enabled: boolean): void;
    readSnippets(): void;
  };
  plugins?: {
    plugins: Record<string, unknown>;
    enabledPlugins: Set<string>;
    getPlugin?: (pluginId: string) => unknown;
    enablePlugin?: (pluginId: string) => Promise<void>;
    disablePlugin?: (pluginId: string) => Promise<void>;
  };

  isDarkMode(): boolean;
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
  removeLocalStorage(key: string): void;
  registerCommand(pluginId: string, command: Command): Command;
  unregisterCommand(pluginId: string, commandId: string): void;
}

export interface SecretStorage {
  setSecret(id: string, secret: string): Promise<void>;
  getSecret(id: string): Promise<string | null>;
  listSecrets(): Promise<string[]>;
}

export interface Workspace {
  getActiveFile(): TFile | null;
  getActiveViewOfType<T>(type: abstract new (...args: any[]) => T): T | null;
  activeLeaf?: WorkspaceLeaf | null;
  activeEditor?: MarkdownView | null;
  layoutReady?: boolean;
  onLayoutReady(callback: () => void): void;
  openLinkText(linktext: string, sourcePath: string, openState?: unknown): Promise<void>;
  getLeaf(newLeaf?: boolean | 'split' | 'tab' | 'window'): WorkspaceLeaf;
  getLeftLeaf(split?: boolean): WorkspaceLeaf | null;
  getRightLeaf(split?: boolean): WorkspaceLeaf | null;
  getLeavesOfType(viewType: string): WorkspaceLeaf[];
  iterateCodeMirrors(callback: (codeMirror: { getOption(key: string): unknown; setOption(key: string, value: unknown): void }) => any): void;
  iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => any): void;
  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => any): void;
  registerHoverLinkSource?: (source: string, options: unknown) => void;
  getLayout?: () => unknown;
  changeLayout?: (layout: unknown) => Promise<void>;
}

export interface WorkspaceLeaf {
  getViewState(): { type: string; state?: unknown };
  setViewState(state: { type: string; state?: unknown }): Promise<void>;
  openFile(file: TFile, openState?: unknown): Promise<void>;
  detach(): void;
}

export interface PluginSettingTab extends IComponent {
  app: App;
  containerEl: HTMLElement;
  items?: PluginSettingItem[];
  settingItems?: SettingDefinitionItem[];

  getSettingDefinitions(): SettingDefinitionItem[];
  update(): void;
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): void | Promise<void>;
  refreshDomState(): void;
  display(): void;
}

export type SettingKind = 'text' | 'toggle' | 'dropdown' | 'button';

export type DeclarativeSettingControlType =
  | 'toggle'
  | 'dropdown'
  | 'text'
  | 'textarea'
  | 'number'
  | 'file'
  | 'folder'
  | 'slider'
  | 'color'
  | string;

export interface SettingControlBase<V = unknown, K extends string = string> {
  key: K;
  defaultValue?: V;
  validate?: (value: V) => string | void | Promise<string | void>;
  disabled?: boolean | (() => boolean);
}

export interface SettingControl<K extends string = string> extends SettingControlBase<unknown, K> {
  type: DeclarativeSettingControlType;
  placeholder?: string;
  options?: Record<string, string> | Array<{ value: string; label: string } | string>;
  min?: number;
  max?: number;
  step?: number | 'any';
  rows?: number;
  includeRoot?: boolean;
  filter?: (...args: unknown[]) => boolean;
}

export interface SettingDefinitionBase {
  name: string;
  desc?: string | DocumentFragment;
  aliases?: string[];
  searchable?: boolean | (() => boolean);
  visible?: boolean | (() => boolean);
}

export interface SettingDefinitionControl<K extends string = string> extends SettingDefinitionBase {
  control: SettingControl<K>;
  action?: never;
  render?: never;
}

export interface SettingDefinitionAction extends SettingDefinitionBase {
  action: (el: HTMLElement, index: number) => void;
  disabled?: boolean | (() => boolean);
  control?: never;
  render?: never;
}

export interface SettingDefinitionRender extends SettingDefinitionBase {
  render: (el: HTMLElement) => void | (() => void);
  control?: never;
  action?: never;
}

export interface SettingDefinitionEmpty extends SettingDefinitionBase {
  control?: never;
  action?: never;
  render?: never;
}

export type SettingDefinition<K extends string = string> =
  | SettingDefinitionControl<K>
  | SettingDefinitionAction
  | SettingDefinitionRender
  | SettingDefinitionEmpty;

export interface SettingDefinitionAddItem {
  name: string;
  action: (el: HTMLElement) => void;
}

export interface SettingDefinitionGroup<K extends string = string> {
  type: 'group' | 'list';
  heading?: string;
  cls?: string;
  search?: {
    placeholder?: string;
    match: (def: SettingDefinition, query: string) => boolean;
  };
  extraButtons?: Array<(...args: unknown[]) => unknown>;
  items?: SettingGroupItem<K>[];
  visible?: boolean | (() => boolean);
}

export interface SettingDefinitionList<K extends string = string> extends SettingDefinitionGroup<K> {
  type: 'list';
  emptyState?: string | DocumentFragment;
  onReorder?: (oldIndex: number, newIndex: number) => void;
  onDelete?: (index: number) => void;
  addItem?: SettingDefinitionAddItem;
}

export interface SettingDefinitionPage<K extends string = string> {
  type: 'page';
  name: string;
  desc?: string | DocumentFragment;
  displayValue?: string | (() => string);
  status?: 'warning' | null | (() => 'warning' | null);
  items?: SettingDefinitionItem<K>[];
  page?: () => unknown;
  visible?: boolean | (() => boolean);
}

export type SettingGroupItem<K extends string = string> = SettingDefinition<K> | SettingDefinitionPage<K>;
export type SettingDefinitionItem<K extends string = string> =
  | SettingDefinition<K>
  | SettingDefinitionGroup<K>
  | SettingDefinitionList<K>
  | SettingDefinitionPage<K>;

export interface PluginSettingItem {
  name?: string;
  desc?: string;
  kind?: SettingKind;
  value?: unknown;
  placeholder?: string;
  disabled?: boolean;
  cta?: boolean;
  buttonText?: string;
  options?: Array<{ value: string; label: string }>;
  onChange?: (value: unknown) => void;
  onClick?: () => void;
}

export interface Events {
  on(name: string, callback: EventCallback, ctx?: unknown): EventRefLike;
  off(name: string, callback: EventCallback): void;
  offref(ref: EventRefLike): void;
  trigger(name: string, ...args: any[]): unknown[];
  tryTrigger(name: string, args: any[]): unknown[];
}

// ============ Advanced (Not in Phase 1) ============

export type ViewCreator = (leaf?: WorkspaceLeaf) => unknown;
export type CodeBlockProcessor = (source: string, el: HTMLElement, ctx: unknown) => void;
export type MarkdownPostProcessor = (el: HTMLElement, ctx: unknown) => void;

export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  contentType?: string;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  text: string;
  json: unknown;
}

export type RequestUrlResponsePromise = Promise<RequestUrlResponse> & {
  arrayBuffer: Promise<ArrayBuffer>;
  json: Promise<unknown>;
  text: Promise<string>;
};
