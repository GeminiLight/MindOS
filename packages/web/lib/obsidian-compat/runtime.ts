import { Events } from './events';
import type { CodeBlockProcessor, MarkdownPostProcessor, ViewCreator, WorkspaceLeaf } from './types';
import { createObsidianElement } from './shims/dom';
import {
  collectElementText,
  createMarkdownPostProcessorContext,
  getElementChildren,
  seedMarkdownPreviewElement,
} from './shims/markdown-renderer';
import { ErrorCodes, MindOSError } from '@/lib/errors';

export interface RegisteredMarkdownPostProcessor {
  id: string;
  pluginId: string;
  processor: MarkdownPostProcessor;
}

export interface RegisteredMarkdownCodeBlockProcessor {
  id: string;
  pluginId: string;
  language: string;
  processor: CodeBlockProcessor;
}

export interface RegisteredView {
  pluginId: string;
  type: string;
  creator: ViewCreator;
}

export interface RegisteredViewExtension {
  pluginId: string;
  extensions: string[];
  viewType: string;
}

export interface RegisteredRibbonIcon {
  pluginId: string;
  icon: string;
  title: string;
  element: HTMLElement;
  callback: (evt: MouseEvent) => unknown;
}

export interface RegisteredStatusBarItem {
  pluginId: string;
  element: HTMLElement;
}

export type EditorExtensionKind = 'array' | 'function' | 'object' | 'primitive' | 'nullish';
export type EditorExtensionMountStatus = 'catalog-only';

export const EDITOR_EXTENSION_CAPABILITY_GATE = 'browser-editor-extension-host';
export const EDITOR_EXTENSION_MOUNT_REASON = 'CodeMirror extensions are browser-side executable objects. MindOS catalogs this registration until a per-plugin editor sandbox, permission prompt, and unload cleanup path exist.';
export const EDITOR_SUGGEST_CAPABILITY_GATE = 'browser-editor-suggest-host';
export const EDITOR_SUGGEST_MOUNT_REASON = 'EditorSuggest registrations depend on live editor cursor/context hooks. MindOS catalogs them until a per-plugin editor suggest host and explicit activation path exist.';
export const PLUGIN_INTERACTION_TTL_MS = 5 * 60 * 1000;

export type BrowserEditorSandboxTarget = 'codemirror-extension' | 'editor-suggest';
export type BrowserEditorSandboxStatus = 'requires-browser-sandbox';

export interface BrowserEditorSandboxPlan {
  phase: 'p3a-browser-editor-sandbox';
  target: BrowserEditorSandboxTarget;
  host: 'browser-codemirror-sandbox';
  status: BrowserEditorSandboxStatus;
  transferable: boolean;
  permissionGate: typeof EDITOR_EXTENSION_CAPABILITY_GATE | typeof EDITOR_SUGGEST_CAPABILITY_GATE;
  canAutoMount: false;
  cleanupRequired: true;
  requiredPermissions: Array<'editor.read' | 'editor.write' | 'editor.selection' | 'editor.decorations' | 'editor.suggest'>;
  requirements: string[];
  reasons: string[];
}

export interface EditorExtensionSummary {
  kind: EditorExtensionKind;
  valueType: string;
  serializable: boolean;
  count?: number;
  constructorName?: string;
  keys?: string[];
  mountStatus: EditorExtensionMountStatus;
  capabilityGate: typeof EDITOR_EXTENSION_CAPABILITY_GATE;
  mountReason: string;
  autoMount: false;
  sandbox: BrowserEditorSandboxPlan;
}

export interface RegisteredEditorExtension {
  id: string;
  pluginId: string;
  extension: unknown;
  summary: EditorExtensionSummary;
}

export type EditorSuggestMountStatus = 'catalog-only';

export interface EditorSuggestSummary {
  constructorName: string;
  hasOnTrigger: boolean;
  hasGetSuggestions: boolean;
  hasRenderSuggestion: boolean;
  hasSelectSuggestion: boolean;
  mountStatus: EditorSuggestMountStatus;
  capabilityGate: typeof EDITOR_SUGGEST_CAPABILITY_GATE;
  mountReason: string;
  autoMount: false;
  sandbox: BrowserEditorSandboxPlan;
}

export interface RegisteredEditorSuggest {
  id: string;
  pluginId: string;
  suggest: unknown;
  summary: EditorSuggestSummary;
}

export interface WorkspaceOpenRequest {
  linktext: string;
  sourcePath: string;
  openState?: unknown;
}

export type PluginModalKind = 'modal' | 'suggest';

export interface RegisteredPluginModal {
  id: string;
  pluginId?: string;
  kind: PluginModalKind;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  placeholder?: string;
  getSuggestions?: (query: string) => unknown[] | Promise<unknown[]>;
  renderSuggestion?: (value: unknown, el: HTMLElement) => void;
  chooseSuggestion?: (value: unknown) => unknown;
  close?: () => void;
  suggestionInteractionId?: string;
  suggestionInteractionExpiresAt?: number;
  suggestionValues?: unknown[];
}

export interface PluginModalSnapshot {
  id: string;
  pluginId?: string;
  kind: PluginModalKind;
  title: string;
  text: string;
  placeholder?: string;
  suggestions?: Array<{ index: number; label: string }>;
  interactionId?: string;
  suggestionError?: string;
}

export interface RegisteredPluginMenuItem {
  title: string;
  icon?: string;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  callback?: (evt?: MouseEvent) => unknown;
}

export interface RegisteredPluginMenu {
  id: string;
  pluginId?: string;
  source: 'mouse' | 'position';
  items: RegisteredPluginMenuItem[];
  interactionId?: string;
  interactionExpiresAt?: number;
}

export interface PluginMenuSnapshot {
  id: string;
  pluginId?: string;
  source: 'mouse' | 'position';
  interactionId?: string;
  items: Array<Omit<RegisteredPluginMenuItem, 'callback'> & { index: number; canRun?: boolean }>;
}

export type PluginNoticeLevel = 'info' | 'success' | 'error';

export interface RegisteredPluginNotice {
  id: string;
  pluginId?: string;
  message: string;
  timeout?: number;
  level: PluginNoticeLevel;
}

export interface PluginNoticeSnapshot {
  id: string;
  pluginId?: string;
  message: string;
  timeout?: number;
  level: PluginNoticeLevel;
}

export interface RuntimeWarning {
  pluginId?: string;
  code: string;
  message: string;
}

export interface PluginViewSnapshot {
  pluginId: string;
  viewType: string;
  resolvedViewType: string;
  displayText: string;
  className: string;
  text: string;
  sourcePath?: string;
  file?: {
    path: string;
    name: string;
    basename: string;
    extension: string;
  };
}

export interface PluginMarkdownCodeBlockSnapshot {
  processorId: string;
  pluginId: string;
  language: string;
  text: string;
}

export interface PluginMarkdownPostProcessorSnapshot {
  processorId: string;
  pluginId: string;
  text: string;
}

/**
 * Request-local plugin host state. It records registrations that MindOS can
 * expose or diagnose without pretending to implement the full Obsidian UI.
 */
export class ObsidianRuntimeHost extends Events {
  private markdownPostProcessors: RegisteredMarkdownPostProcessor[] = [];
  private markdownPostProcessorSeq = 0;
  private markdownCodeBlockProcessors: RegisteredMarkdownCodeBlockProcessor[] = [];
  private markdownCodeBlockProcessorSeq = 0;
  private views: RegisteredView[] = [];
  private viewExtensions: RegisteredViewExtension[] = [];
  private ribbonIcons: RegisteredRibbonIcon[] = [];
  private statusBarItems: RegisteredStatusBarItem[] = [];
  private editorExtensions: RegisteredEditorExtension[] = [];
  private editorExtensionSeq = 0;
  private editorSuggests: RegisteredEditorSuggest[] = [];
  private editorSuggestSeq = 0;
  private workspaceOpenRequests: WorkspaceOpenRequest[] = [];
  private modalSeq = 0;
  private modals: RegisteredPluginModal[] = [];
  private menuSeq = 0;
  private menus: RegisteredPluginMenu[] = [];
  private noticeSeq = 0;
  private notices: RegisteredPluginNotice[] = [];
  private pluginContextStack: string[] = [];
  private warnings: RuntimeWarning[] = [];

  registerMarkdownPostProcessor(pluginId: string, processor: MarkdownPostProcessor): void {
    this.markdownPostProcessorSeq += 1;
    this.markdownPostProcessors.push({
      id: `${pluginId}:post:${this.markdownPostProcessorSeq}`,
      pluginId,
      processor,
    });
  }

  registerMarkdownCodeBlockProcessor(pluginId: string, language: string, processor: CodeBlockProcessor): void {
    this.markdownCodeBlockProcessorSeq += 1;
    this.markdownCodeBlockProcessors.push({
      id: `${pluginId}:${language}:${this.markdownCodeBlockProcessorSeq}`,
      pluginId,
      language,
      processor,
    });
  }

  registerView(pluginId: string, type: string, creator: ViewCreator): void {
    this.views.push({ pluginId, type, creator });
    this.warn({
      pluginId,
      code: 'view-registered-without-native-host',
      message: `Plugin registered view "${type}", which MindOS opens through the Plugin View host instead of a native Obsidian workspace pane.`,
    });
  }

  registerViewExtensions(pluginId: string, extensions: string[], viewType: string): void {
    const normalizedExtensions = Array.from(new Set(extensions.map(normalizeViewExtension).filter(Boolean)));
    const normalizedViewType = viewType.trim();
    if (normalizedExtensions.length === 0 || !normalizedViewType) {
      this.warn({
        pluginId,
        code: 'file-extension-registration-ignored',
        message: 'Plugin attempted to register file extensions without a valid extension list or view type.',
      });
      return;
    }

    this.viewExtensions.push({
      pluginId,
      extensions: normalizedExtensions,
      viewType: normalizedViewType,
    });
    this.warn({
      pluginId,
      code: 'file-extension-registration-recorded-only',
      message: `Plugin registered file extensions ${normalizedExtensions.join(', ')} for view "${normalizedViewType}". MindOS records this mapping in the Plugin View host; automatic file-opening takeover is not mounted yet.`,
    });
  }

  registerRibbonIcon(
    pluginId: string,
    icon: string,
    title: string,
    element: HTMLElement,
    callback: (evt: MouseEvent) => unknown,
  ): void {
    this.ribbonIcons.push({ pluginId, icon, title, element, callback });
  }

  registerStatusBarItem(pluginId: string, element: HTMLElement): void {
    this.statusBarItems.push({ pluginId, element });
  }

  registerEditorExtension(pluginId: string, extension: unknown): void {
    this.editorExtensionSeq += 1;
    this.editorExtensions.push({
      id: `${pluginId}:editor:${this.editorExtensionSeq}`,
      pluginId,
      extension,
      summary: summarizeEditorExtension(extension),
    });
    this.warn({
      pluginId,
      code: 'editor-extension-recorded-only',
      message: 'Plugin registered a CodeMirror editor extension. MindOS records it in the editor extension catalog; mounting requires a browser-side capability gate.',
    });
  }

  registerEditorSuggest(pluginId: string, suggest: unknown): void {
    this.editorSuggestSeq += 1;
    this.editorSuggests.push({
      id: `${pluginId}:editor-suggest:${this.editorSuggestSeq}`,
      pluginId,
      suggest,
      summary: summarizeEditorSuggest(suggest),
    });
    this.warn({
      pluginId,
      code: 'editor-suggest-recorded-only',
      message: 'Plugin registered an Obsidian EditorSuggest. MindOS records it in the editor suggest catalog; mounting requires a browser-side capability gate.',
    });
  }

  recordWorkspaceOpen(request: WorkspaceOpenRequest): void {
    this.workspaceOpenRequests.push(request);
    this.trigger('workspace-open-link', request);
  }

  recordModalOpen(input: Omit<RegisteredPluginModal, 'id' | 'pluginId'> & { pluginId?: string }): RegisteredPluginModal {
    this.modalSeq += 1;
    const modal: RegisteredPluginModal = {
      id: `${input.pluginId ?? this.getCurrentPluginId() ?? 'unknown'}:modal:${this.modalSeq}`,
      pluginId: input.pluginId ?? this.getCurrentPluginId(),
      kind: input.kind,
      titleEl: input.titleEl,
      contentEl: input.contentEl,
      placeholder: input.placeholder,
      getSuggestions: input.getSuggestions,
      renderSuggestion: input.renderSuggestion,
      chooseSuggestion: input.chooseSuggestion,
      close: input.close,
    };
    this.modals.push(modal);
    this.warn({
      pluginId: modal.pluginId,
      code: modal.kind === 'suggest' ? 'suggest-modal-continuation-limited' : 'modal-snapshot-only',
      message: modal.kind === 'suggest'
        ? 'Plugin opened an Obsidian SuggestModal. MindOS shows a safe text snapshot and can continue through explicit suggestion choices.'
        : 'Plugin opened an Obsidian modal. MindOS shows a safe text snapshot; arbitrary modal DOM callbacks are not mounted yet.',
    });
    return modal;
  }

  recordMenuOpen(input: Omit<RegisteredPluginMenu, 'id' | 'pluginId'> & { pluginId?: string }): RegisteredPluginMenu {
    this.menuSeq += 1;
    const menu: RegisteredPluginMenu = {
      id: `${input.pluginId ?? this.getCurrentPluginId() ?? 'unknown'}:menu:${this.menuSeq}`,
      pluginId: input.pluginId ?? this.getCurrentPluginId(),
      source: input.source,
      items: input.items.map((item) => ({
        title: item.title,
        icon: item.icon,
        checked: item.checked === true,
        disabled: item.disabled === true,
        separator: item.separator === true,
        callback: typeof item.callback === 'function' ? item.callback : undefined,
      })),
    };
    if (menu.items.some((item) => typeof item.callback === 'function' && item.disabled !== true && item.separator !== true)) {
      const interaction = createInteractionToken();
      menu.interactionId = interaction.id;
      menu.interactionExpiresAt = interaction.expiresAt;
    }
    this.menus.push(menu);
    this.warn({
      pluginId: menu.pluginId,
      code: menu.interactionId ? 'menu-continuation-limited' : 'menu-snapshot-only',
      message: menu.interactionId
        ? 'Plugin opened an Obsidian menu. MindOS shows a safe item snapshot and can continue through explicit menu item choices.'
        : 'Plugin opened an Obsidian menu. MindOS shows a safe item snapshot; no executable menu callbacks were recorded.',
    });
    return menu;
  }

  recordNotice(input: {
    pluginId?: string;
    message: string;
    timeout?: number;
    level?: PluginNoticeLevel;
  }): RegisteredPluginNotice {
    this.noticeSeq += 1;
    const pluginId = input.pluginId ?? this.getCurrentPluginId();
    const notice: RegisteredPluginNotice = {
      id: `${pluginId ?? 'unknown'}:notice:${this.noticeSeq}`,
      pluginId,
      message: input.message,
      ...(typeof input.timeout === 'number' && Number.isFinite(input.timeout) ? { timeout: input.timeout } : {}),
      level: input.level ?? inferPluginNoticeLevel(input.message),
    };
    this.notices.push(notice);
    return notice;
  }

  async runWithPluginContext<T>(pluginId: string, callback: () => Promise<T> | T): Promise<T> {
    this.pluginContextStack.push(pluginId);
    const previousHost = activeRuntimeHost;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeRuntimeHost = this;
    try {
      return await callback();
    } finally {
      activeRuntimeHost = previousHost;
      this.pluginContextStack.pop();
    }
  }

  getCurrentPluginId(): string | undefined {
    return this.pluginContextStack[this.pluginContextStack.length - 1];
  }

  warn(warning: RuntimeWarning): void {
    this.warnings.push(warning);
    this.trigger('warning', warning);
  }

  unregisterPlugin(pluginId: string): void {
    this.markdownPostProcessors = this.markdownPostProcessors.filter((item) => item.pluginId !== pluginId);
    this.markdownCodeBlockProcessors = this.markdownCodeBlockProcessors.filter((item) => item.pluginId !== pluginId);
    this.views = this.views.filter((item) => item.pluginId !== pluginId);
    this.viewExtensions = this.viewExtensions.filter((item) => item.pluginId !== pluginId);
    this.ribbonIcons = this.ribbonIcons.filter((item) => item.pluginId !== pluginId);
    this.statusBarItems = this.statusBarItems.filter((item) => item.pluginId !== pluginId);
    this.editorExtensions = this.editorExtensions.filter((item) => item.pluginId !== pluginId);
    this.editorSuggests = this.editorSuggests.filter((item) => item.pluginId !== pluginId);
    this.modals = this.modals.filter((item) => item.pluginId !== pluginId);
    this.menus = this.menus.filter((item) => item.pluginId !== pluginId);
    this.notices = this.notices.filter((item) => item.pluginId !== pluginId);
    this.warnings = this.warnings.filter((item) => item.pluginId !== pluginId);
  }

  getMarkdownPostProcessors(): RegisteredMarkdownPostProcessor[] {
    return [...this.markdownPostProcessors];
  }

  getMarkdownCodeBlockProcessors(): RegisteredMarkdownCodeBlockProcessor[] {
    return [...this.markdownCodeBlockProcessors];
  }

  async renderMarkdownCodeBlock(registrationId: string, source: string): Promise<PluginMarkdownCodeBlockSnapshot> {
    const registration = this.markdownCodeBlockProcessors.find((item) => item.id === registrationId);
    if (!registration) {
      throw new Error(`Unknown markdown code block processor: ${registrationId}`);
    }

    const element = createObsidianElement('div');
    await Promise.resolve(registration.processor(source, element, createMarkdownPostProcessorContext()));

    return {
      processorId: registration.id,
      pluginId: registration.pluginId,
      language: registration.language,
      text: collectElementText(element),
    };
  }

  async renderMarkdownPostProcessor(
    registrationId: string,
    markdown: string,
    sourcePath = '',
  ): Promise<PluginMarkdownPostProcessorSnapshot> {
    const registration = this.markdownPostProcessors.find((item) => item.id === registrationId);
    if (!registration) {
      throw new Error(`Unknown markdown post processor: ${registrationId}`);
    }

    const element = createObsidianElement('div');
    seedMarkdownPreviewElement(element, markdown);
    const initialChildren = getElementChildren(element).length;
    const beforeText = collectElementText(element);

    await Promise.resolve(registration.processor(element, createMarkdownPostProcessorContext(sourcePath)));

    const children = getElementChildren(element);
    const appendedText = children.slice(initialChildren).map(collectElementText).filter(Boolean).join('\n').trim();
    const afterText = collectElementText(element);

    return {
      processorId: registration.id,
      pluginId: registration.pluginId,
      text: appendedText || (afterText !== beforeText ? afterText : ''),
    };
  }

  getViews(): RegisteredView[] {
    return [...this.views];
  }

  getViewExtensions(): RegisteredViewExtension[] {
    return this.viewExtensions.map((item) => ({
      pluginId: item.pluginId,
      extensions: [...item.extensions],
      viewType: item.viewType,
    }));
  }

  async renderView(pluginId: string, viewType: string, leaf?: WorkspaceLeaf): Promise<PluginViewSnapshot> {
    const registration = this.views.find((item) => item.pluginId === pluginId && item.type === viewType);
    if (!registration) {
      throw new Error(`Unknown plugin view: ${pluginId}/${viewType}`);
    }

    const view = await registration.creator(leaf);
    const viewRecord = asViewRecord(view);

    if (viewRecord && leaf && !viewRecord.leaf) {
      viewRecord.leaf = leaf;
    }
    if (viewRecord && typeof viewRecord.onOpen === 'function') {
      await viewRecord.onOpen();
    }

    return {
      pluginId,
      viewType,
      resolvedViewType: callStringMethod(viewRecord, 'getViewType') || viewType,
      displayText: callStringMethod(viewRecord, 'getDisplayText') || viewType,
      className: viewRecord?.constructor?.name ?? 'PluginView',
      text: collectElementText(viewRecord?.contentEl) || collectElementText(viewRecord?.containerEl),
    };
  }

  getRibbonIcons(): RegisteredRibbonIcon[] {
    return [...this.ribbonIcons];
  }

  async executeRibbonIcon(pluginId: string, index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid ribbon action index: ${index}`);
    }

    const ribbon = this.ribbonIcons.filter((item) => item.pluginId === pluginId)[index];
    if (!ribbon) {
      throw new Error(`Unknown ribbon action: ${pluginId}#${index}`);
    }

    await this.runWithPluginContext(pluginId, () => ribbon.callback(createSyntheticMouseEvent()));
  }

  getStatusBarItems(): RegisteredStatusBarItem[] {
    return [...this.statusBarItems];
  }

  getEditorExtensions(): RegisteredEditorExtension[] {
    return [...this.editorExtensions];
  }

  getEditorSuggests(): RegisteredEditorSuggest[] {
    return [...this.editorSuggests];
  }

  getWorkspaceOpenRequests(): WorkspaceOpenRequest[] {
    return [...this.workspaceOpenRequests];
  }

  getModalSnapshotCount(): number {
    return this.modals.length;
  }

  getModalIdsSince(offset: number): string[] {
    return this.modals.slice(Math.max(0, offset)).map((modal) => modal.id);
  }

  async renderModalSnapshotsSince(offset: number): Promise<PluginModalSnapshot[]> {
    const modals = this.modals.slice(Math.max(0, offset));
    return Promise.all(modals.map((modal) => this.renderModalSnapshot(modal)));
  }

  async chooseModalSuggestion(modalId: string, suggestionIndex: number, interactionId: string): Promise<void> {
    if (!Number.isInteger(suggestionIndex) || suggestionIndex < 0 || suggestionIndex >= 8) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Invalid suggestion index: ${suggestionIndex}`);
    }
    if (!interactionId.trim()) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing suggestion interaction id');
    }

    const modal = this.modals.find((item) => item.id === modalId);
    if (!modal) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Unknown plugin modal: ${modalId}`);
    }
    if (modal.kind !== 'suggest' || !modal.getSuggestions || !modal.chooseSuggestion) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Plugin modal is not an interactive SuggestModal: ${modalId}`);
    }
    if (isExpiredInteraction(modal.suggestionInteractionId, modal.suggestionInteractionExpiresAt)) {
      modal.suggestionInteractionId = undefined;
      modal.suggestionInteractionExpiresAt = undefined;
      modal.suggestionValues = [];
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Expired plugin modal interaction: ${modalId}`);
    }
    if (modal.suggestionInteractionId !== interactionId) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Expired plugin modal interaction: ${modalId}`);
    }
    if (!modal.suggestionValues || suggestionIndex >= modal.suggestionValues.length) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Unknown suggestion index ${suggestionIndex} for ${modalId}`);
    }

    const value = modal.suggestionValues[suggestionIndex];
    modal.suggestionInteractionId = undefined;
    modal.suggestionInteractionExpiresAt = undefined;
    modal.suggestionValues = [];
    await this.runWithPluginContext(modal.pluginId ?? 'unknown', () => modal.chooseSuggestion!(value));
    modal.close?.();
  }

  dismissModal(modalId: string): void {
    this.modals = this.modals.filter((modal) => modal.id !== modalId);
  }

  getMenuSnapshotCount(): number {
    return this.menus.length;
  }

  renderMenuSnapshotsSince(offset: number): PluginMenuSnapshot[] {
    return this.menus.slice(Math.max(0, offset)).map((menu) => this.renderMenuSnapshot(menu));
  }

  getMenuIdsSince(offset: number): string[] {
    return this.menus.slice(Math.max(0, offset)).map((menu) => menu.id);
  }

  async chooseMenuItem(menuId: string, itemIndex: number, interactionId: string): Promise<void> {
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= 40) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Invalid menu item index: ${itemIndex}`);
    }
    if (!interactionId.trim()) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing menu interaction id');
    }

    const menu = this.menus.find((item) => item.id === menuId);
    if (!menu) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Unknown plugin menu: ${menuId}`);
    }
    if (isExpiredInteraction(menu.interactionId, menu.interactionExpiresAt)) {
      menu.interactionId = undefined;
      menu.interactionExpiresAt = undefined;
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Expired plugin menu interaction: ${menuId}`);
    }
    if (menu.interactionId !== interactionId) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Expired plugin menu interaction: ${menuId}`);
    }

    const item = menu.items[itemIndex];
    if (!item || item.disabled === true || item.separator === true || typeof item.callback !== 'function') {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Plugin menu item is not executable: ${menuId}#${itemIndex}`);
    }

    menu.interactionId = undefined;
    menu.interactionExpiresAt = undefined;
    await this.runWithPluginContext(menu.pluginId ?? 'unknown', () => item.callback!(createSyntheticMouseEvent()));
  }

  dismissMenu(menuId: string): void {
    this.menus = this.menus.filter((menu) => menu.id !== menuId);
  }

  getNoticeSnapshotCount(): number {
    return this.notices.length;
  }

  renderNoticeSnapshotsSince(offset: number): PluginNoticeSnapshot[] {
    return this.notices.slice(Math.max(0, offset)).map((notice) => ({
      id: notice.id,
      pluginId: notice.pluginId,
      message: clampText(notice.message, 500),
      timeout: notice.timeout,
      level: notice.level,
    }));
  }

  getWarnings(): RuntimeWarning[] {
    return [...this.warnings];
  }

  private async renderModalSnapshot(modal: RegisteredPluginModal): Promise<PluginModalSnapshot> {
    const suggestions = modal.kind === 'suggest' ? await renderSuggestionSnapshots(modal) : undefined;
    return {
      id: modal.id,
      pluginId: modal.pluginId,
      kind: modal.kind,
      title: clampText(collectElementText(modal.titleEl) || (modal.kind === 'suggest' ? 'Suggestion modal' : 'Modal'), 200),
      text: clampText(collectElementText(modal.contentEl), 4000),
      placeholder: modal.placeholder ? clampText(modal.placeholder, 200) : undefined,
      suggestions: suggestions?.items,
      interactionId: suggestions?.interactionId,
      suggestionError: suggestions?.error,
    };
  }

  private renderMenuSnapshot(menu: RegisteredPluginMenu): PluginMenuSnapshot {
    if (isExpiredInteraction(menu.interactionId, menu.interactionExpiresAt)) {
      menu.interactionId = undefined;
      menu.interactionExpiresAt = undefined;
    }

    return {
      id: menu.id,
      pluginId: menu.pluginId,
      source: menu.source,
      interactionId: menu.interactionId,
      items: menu.items.slice(0, 40).map((item, index) => ({
        index,
        title: clampText(item.title, 200),
        icon: item.icon ? clampText(item.icon, 120) : undefined,
        checked: item.checked === true,
        disabled: item.disabled === true,
        separator: item.separator === true,
        canRun: typeof item.callback === 'function' && item.disabled !== true && item.separator !== true,
      })),
    };
  }
}

let activeRuntimeHost: ObsidianRuntimeHost | null = null;

export function getActiveObsidianRuntimeHost(): ObsidianRuntimeHost | null {
  return activeRuntimeHost;
}

export function inferPluginNoticeLevel(message: string): PluginNoticeLevel {
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes('error')
    || lowerMessage.includes('failed')
    || lowerMessage.includes('failure')
    || lowerMessage.includes('fail')
  ) {
    return 'error';
  }
  if (
    lowerMessage.includes('success')
    || lowerMessage.includes('saved')
    || lowerMessage.includes('complete')
    || lowerMessage.includes('completed')
  ) {
    return 'success';
  }
  return 'info';
}

function createSyntheticMouseEvent(): MouseEvent {
  if (typeof MouseEvent !== 'undefined') {
    return new MouseEvent('click');
  }
  return {
    type: 'click',
    button: 0,
    buttons: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as MouseEvent;
}

async function renderSuggestionSnapshots(modal: RegisteredPluginModal): Promise<{
  items: Array<{ index: number; label: string }>;
  interactionId?: string;
  error?: string;
}> {
  if (!modal.getSuggestions) return { items: [] };

  try {
    const values = await Promise.resolve(modal.getSuggestions(''));
    const visibleValues = values.slice(0, 8);
    const interaction = modal.chooseSuggestion ? createInteractionToken() : undefined;
    const interactionId = interaction?.id;
    modal.suggestionValues = interactionId ? visibleValues : [];
    modal.suggestionInteractionId = interactionId;
    modal.suggestionInteractionExpiresAt = interaction?.expiresAt;
    const items = visibleValues.map((value, index) => ({
      index,
      label: clampText(renderSuggestionLabel(value, modal.renderSuggestion), 300),
    }));
    return { items, interactionId };
  } catch (error) {
    modal.suggestionValues = [];
    modal.suggestionInteractionId = undefined;
    modal.suggestionInteractionExpiresAt = undefined;
    return {
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createInteractionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createInteractionToken(): { id: string; expiresAt: number } {
  return {
    id: createInteractionId(),
    expiresAt: Date.now() + PLUGIN_INTERACTION_TTL_MS,
  };
}

function isExpiredInteraction(interactionId: string | undefined, expiresAt: number | undefined): boolean {
  return typeof interactionId === 'string' && typeof expiresAt === 'number' && Date.now() >= expiresAt;
}

function renderSuggestionLabel(value: unknown, renderSuggestion?: (value: unknown, el: HTMLElement) => void): string {
  if (renderSuggestion) {
    const element = createObsidianElement('div');
    try {
      renderSuggestion(value, element);
      const text = collectElementText(element);
      if (text) return text;
    } catch {
      // Fall back to a value summary below.
    }
  }
  return formatSuggestionValue(value);
}

function formatSuggestionValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clampText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function summarizeEditorExtension(extension: unknown): EditorExtensionSummary {
  const valueType = extension === null ? 'null' : typeof extension;

  if (extension == null) {
    return withEditorExtensionGate({ kind: 'nullish', valueType, serializable: true });
  }

  if (Array.isArray(extension)) {
    return withEditorExtensionGate({
      kind: 'array',
      valueType: 'array',
      serializable: isJsonSerializable(extension),
      count: extension.length,
      constructorName: 'Array',
    });
  }

  if (typeof extension === 'function') {
    return withEditorExtensionGate({
      kind: 'function',
      valueType,
      serializable: false,
      constructorName: extension.name || 'Function',
    });
  }

  if (typeof extension === 'object') {
    return withEditorExtensionGate({
      kind: 'object',
      valueType,
      serializable: isJsonSerializable(extension),
      constructorName: getConstructorName(extension),
      keys: getSafeObjectKeys(extension),
    });
  }

  return withEditorExtensionGate({
    kind: 'primitive',
    valueType,
    serializable: isJsonSerializable(extension),
  });
}

function summarizeEditorSuggest(suggest: unknown): EditorSuggestSummary {
  const record = suggest && typeof suggest === 'object'
    ? suggest as Record<string, unknown>
    : {};

  const hasOnTrigger = typeof record.onTrigger === 'function';
  const hasGetSuggestions = typeof record.getSuggestions === 'function';
  const hasRenderSuggestion = typeof record.renderSuggestion === 'function';
  const hasSelectSuggestion = typeof record.selectSuggestion === 'function';

  return {
    constructorName: getConstructorName(record),
    hasOnTrigger,
    hasGetSuggestions,
    hasRenderSuggestion,
    hasSelectSuggestion,
    mountStatus: 'catalog-only',
    capabilityGate: EDITOR_SUGGEST_CAPABILITY_GATE,
    mountReason: EDITOR_SUGGEST_MOUNT_REASON,
    autoMount: false,
    sandbox: buildBrowserEditorSandboxPlan({
      target: 'editor-suggest',
      transferable: false,
      permissionGate: EDITOR_SUGGEST_CAPABILITY_GATE,
      requiredPermissions: ['editor.read', 'editor.selection', 'editor.suggest'],
      reasons: [
        'EditorSuggest instances keep live callbacks and cursor state inside the plugin runtime.',
        hasOnTrigger && hasGetSuggestions
          ? 'Trigger and suggestion callbacks must run through an explicit browser editor suggest bridge.'
          : 'This registration does not expose the full trigger/suggestion callback shape needed by the browser host.',
      ],
    }),
  };
}

function withEditorExtensionGate(
  summary: Omit<EditorExtensionSummary, 'mountStatus' | 'capabilityGate' | 'mountReason' | 'autoMount' | 'sandbox'>,
): EditorExtensionSummary {
  return {
    ...summary,
    mountStatus: 'catalog-only',
    capabilityGate: EDITOR_EXTENSION_CAPABILITY_GATE,
    mountReason: EDITOR_EXTENSION_MOUNT_REASON,
    autoMount: false,
    sandbox: buildBrowserEditorSandboxPlan({
      target: 'codemirror-extension',
      transferable: summary.serializable,
      permissionGate: EDITOR_EXTENSION_CAPABILITY_GATE,
      requiredPermissions: ['editor.read', 'editor.write', 'editor.selection', 'editor.decorations'],
      reasons: [
        summary.serializable
          ? 'The registration summary is serializable, but the original CodeMirror extension still cannot be mounted from the server runtime.'
          : 'The registered CodeMirror extension contains functions or prototype objects that are not safely transferable to React.',
        'MindOS must create the extension inside an isolated browser editor host and tie it to plugin unload cleanup before mounting.',
      ],
    }),
  };
}

function buildBrowserEditorSandboxPlan(input: {
  target: BrowserEditorSandboxTarget;
  transferable: boolean;
  permissionGate: BrowserEditorSandboxPlan['permissionGate'];
  requiredPermissions: BrowserEditorSandboxPlan['requiredPermissions'];
  reasons: string[];
}): BrowserEditorSandboxPlan {
  return {
    phase: 'p3a-browser-editor-sandbox',
    target: input.target,
    host: 'browser-codemirror-sandbox',
    status: 'requires-browser-sandbox',
    transferable: input.transferable,
    permissionGate: input.permissionGate,
    canAutoMount: false,
    cleanupRequired: true,
    requiredPermissions: input.requiredPermissions,
    requirements: [
      'per-plugin browser editor sandbox',
      'explicit user permission gate',
      'transaction boundary for editor reads and writes',
      'deterministic unload cleanup for extensions, keymaps, suggestions, and decorations',
    ],
    reasons: input.reasons,
  };
}

function getConstructorName(value: object): string {
  try {
    return value.constructor?.name || 'Object';
  } catch {
    return 'Object';
  }
}

function getSafeObjectKeys(value: object): string[] {
  try {
    return Object.keys(value).slice(0, 8);
  } catch {
    return [];
  }
}

function isJsonSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value == null) return true;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return true;
  if (valueType === 'number') return Number.isFinite(value);
  if (valueType !== 'object') return false;

  const record = value as object;
  if (seen.has(record)) return false;
  seen.add(record);

  if (Array.isArray(value)) {
    return value.every((item) => isJsonSerializable(item, seen));
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }

  try {
    return Object.values(value as Record<string, unknown>).every((item) => isJsonSerializable(item, seen));
  } catch {
    return false;
  }
}

function normalizeViewExtension(value: string): string {
  return value.trim().replace(/^\.+/, '').toLowerCase();
}

type ViewRecord = {
  leaf?: WorkspaceLeaf;
  onOpen?: () => Promise<void> | void;
  getViewType?: () => unknown;
  getDisplayText?: () => unknown;
  containerEl?: HTMLElement;
  contentEl?: HTMLElement;
  constructor?: { name?: string };
};

function asViewRecord(value: unknown): ViewRecord | null {
  return value && typeof value === 'object' ? value as ViewRecord : null;
}

function callStringMethod(view: ViewRecord | null, method: 'getViewType' | 'getDisplayText'): string {
  if (!view || typeof view[method] !== 'function') return '';
  try {
    const value = view[method]?.();
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}
