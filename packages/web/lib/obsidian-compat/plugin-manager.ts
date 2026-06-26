/**
 * Obsidian Plugin Compatibility - Plugin Manager
 * Persists enabled state and orchestrates bulk plugin loading.
 */

import fs from 'fs';
import path from 'path';
import { analyzePluginCompatibility, getCompatibilityLevel, type CompatibilityLevel, type PluginCompatibilityReport } from './compatibility-report';
import {
  buildObsidianCapabilityCoverage,
  summarizeObsidianCapabilityCoverage,
  summarizeObsidianCapabilitySurfaces,
  type ObsidianCapabilityCoverage,
  type ObsidianCapabilitySurfaceSummary,
  type ObsidianCapabilitySupport,
} from './capability-matrix';
import {
  buildObsidianCapabilityGateReport,
  isObsidianCapabilityGateConfirmationRequiredError,
  type ObsidianCapabilityGateConfirmation,
  type ObsidianCapabilityGateReport,
} from './capability-gate';
import {
  mergeObsidianRuntimeCapabilityLedger,
  type ObsidianRuntimeCapabilityLedgerEntry,
} from './compatibility-preview';
import {
  assertPluginCapabilityGateAllowsEnable,
  assertPluginCapabilityGateAllowsLoad,
  buildPluginCapabilityGateReport,
} from './capability-gate-enforcement';
import {
  importObsidianPlugin,
  readImportedObsidianPluginConfig,
  scanObsidianVaultPlugins,
  type ObsidianPluginHotkey,
  type ObsidianVaultConfigOptions,
  type ScanResult,
} from './obsidian-import';
import { describeCommandAvailability, type CommandCallbackType } from './command-registry';
import type { CommandExecutionContext } from './command-registry';
import { createMarkdownEditorCommandContext, type MarkdownEditorCommandContext } from './editor-facade';
import { PluginLoader, type PluginLoaderOptions } from './loader';
import {
  OBSIDIAN_PLUGIN_STYLESHEET_MAX_BYTES,
  pluginStyleScopeSelector,
  scopePluginCss,
  type PluginStylesheetSnapshot,
} from './stylesheet-host';
import {
  resolveCanonicalPluginManagerStatePath,
  resolveCanonicalObsidianPluginDir,
  resolveInstalledObsidianPluginDir,
  resolvePluginManagerStatePathsForRead,
} from './plugin-paths';
import {
  migrateLegacyObsidianPlugin,
  planLegacyObsidianPluginMigration,
  type LegacyPluginMigrationPlan,
  type LegacyPluginMigrationResult,
} from './plugin-migration';
import {
  ObsidianRuntimeCapabilityLedgerStore,
  type ObsidianRuntimeCapabilityLedgerHistory,
} from './runtime-capability-ledger-store';
import {
  buildObsidianWorkflowAudits,
  type ObsidianWorkflowAudit,
} from './workflow-audit';
import {
  ObsidianWorkflowProbeStore,
  runObsidianWorkflowProbe,
  runObsidianWorkflowProbes,
  type ObsidianWorkflowProbeHistory,
  type ObsidianWorkflowProbeId,
  type ObsidianWorkflowProbeResult,
} from './workflow-probes';
import type { ObsidianSecretStorageSummary } from './secret-storage';
import type { ClickableToken, PluginManifest, TFile } from './types';
import type { EditorExtensionSummary, PluginMarkdownCodeBlockSnapshot, PluginMarkdownPostProcessorSnapshot, PluginMenuSnapshot, PluginModalSnapshot, PluginNoticeSnapshot, PluginViewSnapshot, RegisteredViewExtension, WorkspaceOpenRequest } from './runtime';
import { Menu } from './shims/obsidian';
import { resolveExistingSafe } from '@/lib/core/security';
import { ErrorCodes, MindOSError } from '@/lib/errors';

interface PluginManagerState {
  enabled: Record<string, boolean>;
  capabilityConfirmations?: Record<string, ObsidianCapabilityGateConfirmation>;
}

export interface PluginManagerOptions extends PluginLoaderOptions {
  workflowProbeStore?: ObsidianWorkflowProbeStore;
}

export interface ManagedPluginPackageLocation {
  relativePath: string;
  rootRelativePath: string;
  legacy: boolean;
  migrationAvailable: boolean;
}

export interface ManagedPlugin {
  id: string;
  name: string;
  version: string;
  manifest: PluginManifest;
  enabled: boolean;
  loaded: boolean;
  compatibility: PluginCompatibilityReport;
  compatibilityLevel: CompatibilityLevel;
  coverage: ObsidianCapabilityCoverage[];
  coverageSummary: Record<ObsidianCapabilitySupport, number>;
  surfaceSummary: ObsidianCapabilitySurfaceSummary[];
  capabilityGate: ObsidianCapabilityGateReport;
  capabilityLedger: ObsidianRuntimeCapabilityLedgerEntry[];
  capabilityLedgerHistory: ObsidianRuntimeCapabilityLedgerHistory;
  workflowProbeHistory: ObsidianWorkflowProbeHistory;
  workflowAudits: ObsidianWorkflowAudit[];
  packageLocation?: ManagedPluginPackageLocation;
  runtime: PluginRuntimeSummary;
  lastError?: string;
}

export interface PluginEnableOptions {
  confirmCapabilityGate?: boolean;
}

export interface LoadEnabledResult {
  loaded: string[];
  failed: string[];
  skipped: string[];
}

export interface PluginWorkspaceOpenRequest {
  linktext: string;
  sourcePath: string;
  targetPath?: string;
}

export interface PluginActionResult {
  workspaceOpenRequests: PluginWorkspaceOpenRequest[];
  modalSnapshots: PluginModalSnapshot[];
  menuSnapshots: PluginMenuSnapshot[];
  noticeSnapshots?: PluginNoticeSnapshot[];
  editorUpdates?: PluginEditorUpdate[];
}

export interface PluginEditorCommandContext {
  sourcePath: string;
  selectionStart?: number;
  selectionEnd?: number;
  cursorOffset?: number;
  clickableToken?: ClickableToken | null;
}

export interface PluginEditorMenuContext extends PluginEditorCommandContext {
  tagText?: string;
}

export interface PluginEditorUpdate {
  sourcePath: string;
  changed: boolean;
}

export interface PluginDataFileSummary {
  exists: boolean;
  bytes: number;
  updatedAt?: string;
  validJson?: boolean;
}

export type PluginSecretStorageSummary = ObsidianSecretStorageSummary;

export interface PluginCommunityOriginSummary {
  source: 'obsidian-community';
  repo: string;
  githubUrl?: string;
  installedAt?: string;
  updatedAt?: string;
  previousVersion?: string;
  manifestUrl?: string;
  mainUrl?: string;
  stylesUrl?: string;
  compatibilityLevel?: CompatibilityLevel;
  validJson: boolean;
  error?: string;
}

export interface PluginRuntimeContext {
  editor?: PluginEditorCommandContext;
}

export interface PluginViewContext {
  sourcePath?: string;
}

interface EditorExecutionSession {
  file: TFile;
  initialContent: string;
  commandContext: MarkdownEditorCommandContext;
}

export interface PluginRuntimeSummary {
  commands: number;
  commandList: Array<{
    id: string;
    fullId: string;
    name: string;
    executable: boolean;
    requiresEditor: boolean;
    callbackType: CommandCallbackType;
    availabilityReason?: string;
    hotkeys: Array<{ modifiers: string[]; key: string }>;
    hotkeySources: { default: number; obsidianImport: number };
  }>;
  settingTabs: number;
  markdownPostProcessors: number;
  markdownCodeBlockProcessors: number;
  markdownCodeBlockLanguages: string[];
  views: number;
  viewList: Array<{ type: string }>;
  viewExtensions: number;
  viewExtensionList: Array<Pick<RegisteredViewExtension, 'extensions' | 'viewType'>>;
  ribbonIcons: number;
  ribbonIconList: Array<{ icon: string; title: string }>;
  statusBarItems: number;
  statusBarItemList: Array<{ text: string }>;
  dataFile: PluginDataFileSummary;
  secretStorage: PluginSecretStorageSummary;
  communityOrigin?: PluginCommunityOriginSummary;
  styleSheets: number;
  styleSheetList: Array<{ path: string; bytes: number }>;
  editorExtensions: number;
  editorExtensionList: Array<{ id: string } & EditorExtensionSummary>;
  capabilityLedger: ObsidianRuntimeCapabilityLedgerEntry[];
  warnings: string[];
}

export interface ManagedPluginMarkdownCodeBlockSnapshot extends PluginMarkdownCodeBlockSnapshot {
  pluginName: string;
  error?: string;
}

export interface ManagedPluginMarkdownPostProcessorSnapshot extends PluginMarkdownPostProcessorSnapshot {
  pluginName: string;
  error?: string;
}

const EMPTY_STATE: PluginManagerState = { enabled: {} };

export class PluginManager {
  private readonly loader: PluginLoader;
  private readonly runtimeCapabilityLedgerStore: ObsidianRuntimeCapabilityLedgerStore;
  private readonly workflowProbeStore: ObsidianWorkflowProbeStore;
  private plugins = new Map<string, ManagedPlugin>();
  private state: PluginManagerState = EMPTY_STATE;
  private modalEditorSessions = new Map<string, EditorExecutionSession>();
  private menuEditorSessions = new Map<string, EditorExecutionSession>();

  constructor(private mindRoot: string, options: PluginManagerOptions = {}) {
    const { runtimeCapabilityLedgerStore, workflowProbeStore, ...loaderOptions } = options;
    this.runtimeCapabilityLedgerStore = runtimeCapabilityLedgerStore ?? new ObsidianRuntimeCapabilityLedgerStore(mindRoot);
    this.workflowProbeStore = workflowProbeStore ?? new ObsidianWorkflowProbeStore(mindRoot);
    this.loader = new PluginLoader(mindRoot, {
      ...loaderOptions,
      runtimeCapabilityLedgerStore: this.runtimeCapabilityLedgerStore,
    });
  }

  async discover(): Promise<ManagedPlugin[]> {
    this.state = this.readState();
    const manifests = this.loader.discoverPlugins();

    this.plugins.clear();
    for (const manifest of manifests) {
      this.plugins.set(manifest.id, this.toManagedPlugin(manifest, this.state));
    }

    return this.list();
  }

  async unloadUnavailablePlugins(): Promise<void> {
    for (const loaded of this.loader.getLoadedPlugins()) {
      const plugin = this.plugins.get(loaded.manifest.id);
      if (!plugin || !plugin.enabled || plugin.compatibilityLevel === 'blocked') {
        await this.loader.unloadPlugin(loaded.manifest.id);
      }
    }
  }

  list(context: PluginRuntimeContext = {}): ManagedPlugin[] {
    const commandContext = this.commandExecutionContextFor(context.editor);
    for (const plugin of this.plugins.values()) {
      this.applyRuntimeState(plugin, commandContext);
    }
    return Array.from(this.plugins.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async enable(pluginId: string, options: PluginEnableOptions = {}): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    this.assertCapabilityGateAllowsEnable(plugin, options);
    plugin.enabled = true;
    plugin.lastError = undefined;
    this.writeState();
  }

  async disable(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    if (plugin.loaded) {
      await this.loader.unloadPlugin(pluginId);
    }
    this.forgetEditorSessionsForPlugin(pluginId);
    plugin.enabled = false;
    plugin.loaded = false;
    plugin.lastError = undefined;
    this.writeState();
  }

  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    const loaded = this.loader.getLoadedPlugins().some((loadedPlugin) => loadedPlugin.manifest.id === pluginId);
    if (loaded || plugin.loaded) {
      await this.loader.unloadPlugin(pluginId);
    }

    this.forgetEditorSessionsForPlugin(pluginId);
    const pluginLocation = resolveInstalledObsidianPluginDir(this.mindRoot, pluginId);
    if (!pluginLocation) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }
    fs.rmSync(pluginLocation.pluginDir, { recursive: true, force: true });
    await this.loader.getApp().removePluginSecrets(pluginId);
    this.plugins.delete(pluginId);
    this.writeState();
  }

  async prepareForPackageUpdate(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    const loaded = this.loader.getLoadedPlugins().some((loadedPlugin) => loadedPlugin.manifest.id === pluginId);
    if (loaded || plugin.loaded) {
      await this.loader.unloadPlugin(pluginId);
    }
    this.forgetEditorSessionsForPlugin(pluginId);
    plugin.loaded = false;
    this.applyRuntimeState(plugin);
  }

  async load(pluginId: string, options: PluginEnableOptions = {}): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    if (plugin.compatibilityLevel === 'blocked') {
      plugin.loaded = false;
      plugin.lastError = plugin.compatibility.blockers[0] ?? 'Plugin is blocked by compatibility report.';
      this.recordCapabilityGateLedgerEvent(plugin, 'load', plugin.lastError);
      throw new Error(plugin.lastError);
    }
    if (!plugin.enabled) {
      this.assertCapabilityGateAllowsEnable(plugin, options);
      plugin.enabled = true;
    } else {
      this.assertCapabilityGateAllowsLoad(plugin);
    }

    try {
      await this.loader.loadPlugin(plugin.id);
      plugin.loaded = true;
      plugin.lastError = undefined;
      this.applyRuntimeState(plugin);
    } catch (error) {
      plugin.loaded = false;
      plugin.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.writeState();
    }
  }

  async loadEnabledPlugins(): Promise<LoadEnabledResult> {
    const result: LoadEnabledResult = { loaded: [], failed: [], skipped: [] };

    for (const plugin of this.list()) {
      if (!plugin.enabled) {
        continue;
      }
      if (plugin.compatibilityLevel === 'blocked') {
        plugin.loaded = false;
        plugin.lastError = plugin.compatibility.blockers[0] ?? 'Plugin is blocked by compatibility report.';
        result.skipped.push(plugin.id);
        continue;
      }
      if (plugin.capabilityGate.requiresConfirmation && !plugin.capabilityGate.confirmed) {
        plugin.loaded = false;
        plugin.lastError = 'Obsidian plugin enable requires capability confirmation.';
        result.skipped.push(plugin.id);
        continue;
      }

      try {
        await this.loader.loadPlugin(plugin.id);
        plugin.loaded = true;
        plugin.lastError = undefined;
        this.applyRuntimeState(plugin);
        result.loaded.push(plugin.id);
      } catch (error) {
        plugin.loaded = false;
        plugin.lastError = error instanceof Error ? error.message : String(error);
        result.failed.push(plugin.id);
      }
    }

    this.writeState();
    return result;
  }

  getLoader(): PluginLoader {
    return this.loader;
  }

  async executeCommand(fullCommandId: string, context: PluginRuntimeContext = {}): Promise<PluginActionResult> {
    await this.loadEnabledPlugins();
    const host = this.loader.getApp().getRuntimeHost();
    const requestOffset = host.getWorkspaceOpenRequests().length;
    const modalOffset = host.getModalSnapshotCount();
    const menuOffset = host.getMenuSnapshotCount();
    const noticeOffset = host.getNoticeSnapshotCount();
    const editorSession = await this.editorExecutionSessionFor(context.editor);
    const app = this.loader.getApp();

    if (editorSession) {
      await app.withActiveFile(editorSession.file, async () => {
        await app.executeCommand(fullCommandId, editorSession.commandContext);
      });
      const changed = editorSession.commandContext.editor.getValue() !== editorSession.initialContent;
      if (changed) {
        await app.vault.modify(editorSession.file, editorSession.commandContext.editor.getValue());
      }
      this.rememberEditorSessionForModals(modalOffset, {
        ...editorSession,
        initialContent: editorSession.commandContext.editor.getValue(),
      });
      this.rememberEditorSessionForMenus(menuOffset, {
        ...editorSession,
        initialContent: editorSession.commandContext.editor.getValue(),
      });
      return this.actionResultSince(requestOffset, modalOffset, menuOffset, noticeOffset, changed ? [{
        sourcePath: editorSession.file.path,
        changed,
      }] : []);
    }

    await app.executeCommand(fullCommandId);
    return this.actionResultSince(requestOffset, modalOffset, menuOffset, noticeOffset);
  }

  async executeRibbonIcon(pluginId: string, index: number): Promise<PluginActionResult> {
    await this.loadEnabledPlugins();
    const host = this.loader.getApp().getRuntimeHost();
    const requestOffset = host.getWorkspaceOpenRequests().length;
    const modalOffset = host.getModalSnapshotCount();
    const menuOffset = host.getMenuSnapshotCount();
    const noticeOffset = host.getNoticeSnapshotCount();
    await host.executeRibbonIcon(pluginId, index);
    return this.actionResultSince(requestOffset, modalOffset, menuOffset, noticeOffset);
  }

  async chooseModalSuggestion(modalId: string, suggestionIndex: number, interactionId: string): Promise<PluginActionResult> {
    await this.loadEnabledPlugins();
    const host = this.loader.getApp().getRuntimeHost();
    const requestOffset = host.getWorkspaceOpenRequests().length;
    const modalOffset = host.getModalSnapshotCount();
    const menuOffset = host.getMenuSnapshotCount();
    const noticeOffset = host.getNoticeSnapshotCount();
    const editorSession = this.modalEditorSessions.get(modalId);

    if (editorSession) {
      await this.loader.getApp().withActiveFile(editorSession.file, () => (
        host.chooseModalSuggestion(modalId, suggestionIndex, interactionId)
      ));
    } else {
      await host.chooseModalSuggestion(modalId, suggestionIndex, interactionId);
    }

    const editorUpdates = editorSession ? await this.flushEditorSession(editorSession) : [];
    const result = await this.actionResultSince(requestOffset, modalOffset, menuOffset, noticeOffset, editorUpdates);
    host.dismissModal(modalId);
    this.modalEditorSessions.delete(modalId);
    return result;
  }

  async submitModalText(modalId: string, text: string, interactionId: string): Promise<PluginActionResult> {
    await this.loadEnabledPlugins();
    const host = this.loader.getApp().getRuntimeHost();
    const requestOffset = host.getWorkspaceOpenRequests().length;
    const modalOffset = host.getModalSnapshotCount();
    const menuOffset = host.getMenuSnapshotCount();
    const noticeOffset = host.getNoticeSnapshotCount();
    const editorSession = this.modalEditorSessions.get(modalId);

    if (editorSession) {
      await this.loader.getApp().withActiveFile(editorSession.file, () => (
        host.submitModalText(modalId, text, interactionId)
      ));
    } else {
      await host.submitModalText(modalId, text, interactionId);
    }

    const editorUpdates = editorSession ? await this.flushEditorSession(editorSession) : [];
    const result = await this.actionResultSince(requestOffset, modalOffset, menuOffset, noticeOffset, editorUpdates);
    host.dismissModal(modalId);
    this.modalEditorSessions.delete(modalId);
    return result;
  }

  async chooseMenuItem(menuId: string, itemIndex: number, interactionId: string): Promise<PluginActionResult> {
    await this.loadEnabledPlugins();
    const host = this.loader.getApp().getRuntimeHost();
    const requestOffset = host.getWorkspaceOpenRequests().length;
    const modalOffset = host.getModalSnapshotCount();
    const menuOffset = host.getMenuSnapshotCount();
    const noticeOffset = host.getNoticeSnapshotCount();
    const editorSession = this.menuEditorSessions.get(menuId);

    if (editorSession) {
      await this.loader.getApp().withActiveFile(editorSession.file, () => (
        host.chooseMenuItem(menuId, itemIndex, interactionId)
      ));
    } else {
      await host.chooseMenuItem(menuId, itemIndex, interactionId);
    }

    const editorUpdates = editorSession ? await this.flushEditorSession(editorSession) : [];
    const result = await this.actionResultSince(requestOffset, modalOffset, menuOffset, noticeOffset, editorUpdates);
    host.dismissMenu(menuId);
    this.menuEditorSessions.delete(menuId);
    return result;
  }

  async triggerEditorMenu(pluginId: string, context: PluginEditorMenuContext): Promise<PluginActionResult> {
    await this.loadEnabledPlugins();
    this.requirePlugin(pluginId);
    const host = this.loader.getApp().getRuntimeHost();
    const requestOffset = host.getWorkspaceOpenRequests().length;
    const modalOffset = host.getModalSnapshotCount();
    const menuOffset = host.getMenuSnapshotCount();
    const noticeOffset = host.getNoticeSnapshotCount();
    const editorSession = await this.editorExecutionSessionFor({
      ...context,
      clickableToken: context.clickableToken ?? clickableTokenForEditorMenu(context),
    });

    if (!editorSession) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Editor menu source file not found or not Markdown: ${context.sourcePath}`);
    }

    const app = this.loader.getApp();
    const menu = new Menu();

    await app.withActiveFile(editorSession.file, async () => {
      await host.runWithPluginContext(pluginId, async () => {
        const workspace = app.workspace as typeof app.workspace & {
          triggerForPlugin?: (targetPluginId: string, name: string, ...args: unknown[]) => unknown[];
        };
        const results = typeof workspace.triggerForPlugin === 'function'
          ? workspace.triggerForPlugin(pluginId, 'editor-menu', menu, editorSession.commandContext.editor, editorSession.commandContext.view)
          : workspace.trigger('editor-menu', menu, editorSession.commandContext.editor, editorSession.commandContext.view);
        await Promise.all(results.map((result) => Promise.resolve(result)));
        host.recordRuntimeCapability(
          pluginId,
          'Workspace.editor-menu',
          'called',
          context.tagText
            ? `Triggered workspace editor-menu for "${context.sourcePath}" at tag "${context.tagText}".`
            : `Triggered workspace editor-menu for "${context.sourcePath}".`,
        );
        host.recordMenuOpen({
          pluginId,
          source: 'workspace-editor-menu',
          items: menu.items.map((item) => ({
            title: item.title,
            icon: item.icon,
            section: item.section,
            checked: item.checked,
            disabled: item.disabled,
            separator: item.separator,
            callback: item.callback,
          })),
        });
      });
    });

    const changed = editorSession.commandContext.editor.getValue() !== editorSession.initialContent;
    if (changed) {
      await app.vault.modify(editorSession.file, editorSession.commandContext.editor.getValue());
    }
    this.rememberEditorSessionForMenus(menuOffset, {
      ...editorSession,
      initialContent: editorSession.commandContext.editor.getValue(),
    });
    return this.actionResultSince(requestOffset, modalOffset, menuOffset, noticeOffset, changed ? [{
      sourcePath: editorSession.file.path,
      changed,
    }] : []);
  }

  async renderView(pluginId: string, viewType: string, context: PluginViewContext = {}): Promise<PluginViewSnapshot> {
    await this.loadEnabledPlugins();
    const app = this.loader.getApp();
    const leaf = app.workspace.getLeaf(true);
    const activeFile = this.activeFileForSourcePath(context.sourcePath);
    const viewState = {
      pluginId,
      ...(activeFile ? {
        sourcePath: activeFile.path,
        file: this.serializableFile(activeFile),
      } : {}),
    };

    await leaf.setViewState({ type: viewType, state: viewState });
    const snapshot = await app.withActiveFile(activeFile, () => app.getRuntimeHost().renderView(pluginId, viewType, leaf));
    return {
      ...snapshot,
      ...(activeFile ? {
        sourcePath: activeFile.path,
        file: this.serializableFile(activeFile),
      } : {}),
    };
  }

  readScopedStyleSheet(pluginId: string): PluginStylesheetSnapshot {
    const plugin = this.requirePlugin(pluginId);
    this.applyRuntimeState(plugin);

    if (plugin.compatibilityLevel === 'blocked') {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, plugin.compatibility.blockers[0] ?? `Plugin is blocked: ${pluginId}`);
    }
    if (!plugin.enabled) {
      throw new MindOSError(ErrorCodes.PERMISSION_DENIED, `Plugin stylesheet is only available for enabled plugins: ${pluginId}`);
    }
    if (!plugin.loaded) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, plugin.lastError ?? `Plugin is not loaded: ${pluginId}`);
    }

    const styleSheet = this.readStyleSheetFile(plugin.id);
    if (!styleSheet) {
      throw new MindOSError(ErrorCodes.FILE_NOT_FOUND, `Plugin stylesheet not found: ${pluginId}`);
    }

    const scopeSelector = pluginStyleScopeSelector(plugin.id);
    return {
      pluginId: plugin.id,
      path: 'styles.css',
      bytes: styleSheet.bytes,
      css: styleSheet.css,
      scopedCss: scopePluginCss(styleSheet.css, scopeSelector),
      scopeSelector,
    };
  }

  async renderMarkdownCodeBlock(language: string, source: string): Promise<ManagedPluginMarkdownCodeBlockSnapshot[]> {
    await this.loadEnabledPlugins();
    const app = this.loader.getApp();
    const host = app.getRuntimeHost();
    const processors = host.getMarkdownCodeBlockProcessors().filter((item) => (
      item.language.toLowerCase() === language.toLowerCase()
    ));
    const snapshots: ManagedPluginMarkdownCodeBlockSnapshot[] = [];

    for (const processor of processors) {
      const plugin = this.plugins.get(processor.pluginId);
      try {
        const snapshot = await host.renderMarkdownCodeBlock(processor.id, source);
        snapshots.push({
          ...snapshot,
          pluginName: plugin?.name ?? processor.pluginId,
        });
      } catch (error) {
        snapshots.push({
          processorId: processor.id,
          pluginId: processor.pluginId,
          pluginName: plugin?.name ?? processor.pluginId,
          language: processor.language,
          text: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return snapshots;
  }

  async renderMarkdownPostProcessors(markdown: string, sourcePath = ''): Promise<ManagedPluginMarkdownPostProcessorSnapshot[]> {
    await this.loadEnabledPlugins();
    const app = this.loader.getApp();
    const host = app.getRuntimeHost();
    const processors = host.getMarkdownPostProcessors();
    const snapshots: ManagedPluginMarkdownPostProcessorSnapshot[] = [];

    for (const processor of processors) {
      const plugin = this.plugins.get(processor.pluginId);
      try {
        const snapshot = await host.renderMarkdownPostProcessor(processor.id, markdown, sourcePath);
        snapshots.push({
          ...snapshot,
          pluginName: plugin?.name ?? processor.pluginId,
        });
      } catch (error) {
        snapshots.push({
          processorId: processor.id,
          pluginId: processor.pluginId,
          pluginName: plugin?.name ?? processor.pluginId,
          text: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return snapshots;
  }

  async runWorkflowProbe(pluginId: string, probeId?: ObsidianWorkflowProbeId): Promise<ObsidianWorkflowProbeResult> {
    await this.loadEnabledPlugins();
    const result = await runObsidianWorkflowProbe({
      mindRoot: this.mindRoot,
      host: this,
      pluginId,
      ...(probeId ? { probeId } : {}),
      now: () => new Date(this.workflowProbeStore.timestamp()),
    });
    const persisted = this.workflowProbeStore.append(result);
    const plugin = this.plugins.get(pluginId);
    if (plugin) this.applyRuntimeState(plugin);
    return persisted;
  }

  async runWorkflowProbes(pluginId: string): Promise<ObsidianWorkflowProbeResult[]> {
    await this.loadEnabledPlugins();
    const results = await runObsidianWorkflowProbes({
      mindRoot: this.mindRoot,
      host: this,
      pluginId,
      now: () => new Date(this.workflowProbeStore.timestamp()),
    });
    const persisted = results.map((result) => this.workflowProbeStore.append(result));
    const plugin = this.plugins.get(pluginId);
    if (plugin) this.applyRuntimeState(plugin);
    return persisted;
  }

  async scanObsidianVault(vaultRoot: string, options: ObsidianVaultConfigOptions = {}): Promise<ScanResult> {
    return scanObsidianVaultPlugins(vaultRoot, options);
  }

  async importFromObsidianVault(vaultRoot: string, pluginId: string, options: ObsidianVaultConfigOptions = {}): Promise<void> {
    await importObsidianPlugin({
      vaultRoot,
      pluginId,
      targetMindRoot: this.mindRoot,
      configDir: options.configDir,
    });
  }

  previewLegacyMigration(pluginId: string): LegacyPluginMigrationPlan {
    return planLegacyObsidianPluginMigration(this.mindRoot, pluginId);
  }

  async migrateLegacyPlugin(pluginId: string): Promise<LegacyPluginMigrationResult> {
    const plugin = this.requirePlugin(pluginId);
    const loaded = this.loader.getLoadedPlugins().some((loadedPlugin) => loadedPlugin.manifest.id === pluginId);
    if (loaded || plugin.loaded) {
      await this.loader.unloadPlugin(pluginId);
    }
    this.forgetEditorSessionsForPlugin(pluginId);
    plugin.loaded = false;

    const result = migrateLegacyObsidianPlugin(this.mindRoot, pluginId);
    this.writeState();
    await this.discover();
    return result;
  }

  private toManagedPlugin(manifest: PluginManifest, state: PluginManagerState): ManagedPlugin {
    const loaded = this.loader.getLoadedPlugins().some((plugin) => plugin.manifest.id === manifest.id);
    let code = '';
    try {
      const pluginLocation = resolveInstalledObsidianPluginDir(this.mindRoot, manifest.id);
      const mainPath = pluginLocation ? path.join(pluginLocation.pluginDir, 'main.js') : '';
      code = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf-8') : '';
    } catch {
      code = '';
    }
    const compatibility = analyzePluginCompatibility(code, manifest);
    const coverage = buildObsidianCapabilityCoverage(compatibility);
    const compatibilityLevel = getCompatibilityLevel(compatibility);
    const capabilityGate = buildObsidianCapabilityGateReport({
      manifest,
      compatibility,
      compatibilityLevel,
      coverage,
      confirmation: state.capabilityConfirmations?.[manifest.id],
    });
    const enabled = state.enabled[manifest.id] === true
      && !capabilityGate.blocked
      && (!capabilityGate.requiresConfirmation || capabilityGate.confirmed);

    const runtime = this.runtimeSummaryFor(manifest.id);
    const capabilityLedgerHistory = this.runtimeCapabilityLedgerStore.read(manifest.id);
    const workflowProbeHistory = this.workflowProbeStore.read(manifest.id);
    const capabilityLedger = mergeObsidianRuntimeCapabilityLedger({
      pluginId: manifest.id,
      coverage,
      unsupportedModules: compatibility.unsupportedModules,
      capabilityGate,
      runtimeEntries: runtime.capabilityLedger,
    });

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      enabled,
      loaded,
      compatibility,
      compatibilityLevel,
      coverage,
      coverageSummary: summarizeObsidianCapabilityCoverage(coverage),
      surfaceSummary: summarizeObsidianCapabilitySurfaces(coverage),
      capabilityGate,
      capabilityLedger,
      capabilityLedgerHistory,
      workflowProbeHistory,
      workflowAudits: buildObsidianWorkflowAudits({
        pluginId: manifest.id,
        pluginName: manifest.name,
        coverage,
        capabilityGate,
        runtimeEntries: runtime.capabilityLedger,
        history: capabilityLedgerHistory,
        workflowProbeHistory,
      }),
      packageLocation: this.packageLocationFor(manifest.id),
      runtime,
    };
  }

  private applyRuntimeState(plugin: ManagedPlugin, commandContext?: CommandExecutionContext): void {
    plugin.loaded = this.loader.getLoadedPlugins().some((loaded) => loaded.manifest.id === plugin.id);
    plugin.runtime = this.runtimeSummaryFor(plugin.id, commandContext);
    plugin.capabilityLedger = mergeObsidianRuntimeCapabilityLedger({
      pluginId: plugin.id,
      coverage: plugin.coverage,
      unsupportedModules: plugin.compatibility.unsupportedModules,
      capabilityGate: plugin.capabilityGate,
      runtimeEntries: plugin.runtime.capabilityLedger,
    });
    plugin.capabilityLedgerHistory = this.runtimeCapabilityLedgerStore.read(plugin.id);
    plugin.workflowProbeHistory = this.workflowProbeStore.read(plugin.id);
    plugin.workflowAudits = buildObsidianWorkflowAudits({
      pluginId: plugin.id,
      pluginName: plugin.name,
      coverage: plugin.coverage,
      capabilityGate: plugin.capabilityGate,
      runtimeEntries: plugin.runtime.capabilityLedger,
      history: plugin.capabilityLedgerHistory,
      workflowProbeHistory: plugin.workflowProbeHistory,
    });
  }

  private async actionResultSince(
    requestOffset: number,
    modalOffset: number,
    menuOffset: number,
    noticeOffset: number,
    editorUpdates: PluginEditorUpdate[] = [],
  ): Promise<PluginActionResult> {
    const requests = this.loader.getApp().getRuntimeHost().getWorkspaceOpenRequests().slice(requestOffset);
    const host = this.loader.getApp().getRuntimeHost();
    const noticeSnapshots = host.renderNoticeSnapshotsSince(noticeOffset);
    const result: PluginActionResult = {
      workspaceOpenRequests: requests.map((request) => this.toWorkspaceOpenRequest(request)),
      modalSnapshots: await host.renderModalSnapshotsSince(modalOffset),
      menuSnapshots: host.renderMenuSnapshotsSince(menuOffset),
    };
    if (noticeSnapshots.length > 0) result.noticeSnapshots = noticeSnapshots;
    if (editorUpdates.length > 0) result.editorUpdates = editorUpdates;
    return result;
  }

  private rememberEditorSessionForModals(modalOffset: number, editorSession: EditorExecutionSession): void {
    const host = this.loader.getApp().getRuntimeHost();
    for (const modalId of host.getModalIdsSince(modalOffset)) {
      this.modalEditorSessions.set(modalId, editorSession);
    }
  }

  private rememberEditorSessionForMenus(menuOffset: number, editorSession: EditorExecutionSession): void {
    const host = this.loader.getApp().getRuntimeHost();
    for (const menuId of host.getMenuIdsSince(menuOffset)) {
      this.menuEditorSessions.set(menuId, editorSession);
    }
  }

  private async flushEditorSession(editorSession: EditorExecutionSession): Promise<PluginEditorUpdate[]> {
    const nextContent = editorSession.commandContext.editor.getValue();
    const changed = nextContent !== editorSession.initialContent;
    if (!changed) return [];
    await this.loader.getApp().vault.modify(editorSession.file, nextContent);
    return [{
      sourcePath: editorSession.file.path,
      changed,
    }];
  }

  private forgetEditorSessionsForPlugin(pluginId: string): void {
    for (const modalId of this.modalEditorSessions.keys()) {
      if (modalId.startsWith(`${pluginId}:modal:`)) {
        this.modalEditorSessions.delete(modalId);
      }
    }
    for (const menuId of this.menuEditorSessions.keys()) {
      if (menuId.startsWith(`${pluginId}:menu:`)) {
        this.menuEditorSessions.delete(menuId);
      }
    }
  }

  private toWorkspaceOpenRequest(request: WorkspaceOpenRequest): PluginWorkspaceOpenRequest {
    return {
      linktext: request.linktext,
      sourcePath: request.sourcePath,
      targetPath: this.resolveWorkspaceOpenTarget(request),
    };
  }

  private resolveWorkspaceOpenTarget(request: WorkspaceOpenRequest): string | undefined {
    const linktext = normalizeWorkspaceLink(request.linktext);
    if (!linktext) return undefined;

    const sourceDir = path.posix.dirname(normalizeWorkspaceLink(request.sourcePath));
    const relativeCandidates = sourceDir && sourceDir !== '.'
      ? [`${sourceDir}/${linktext}`, `${sourceDir}/${linktext}.md`]
      : [];
    const candidates = [
      ...relativeCandidates,
      linktext,
      `${linktext}.md`,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeWorkspaceLink(candidate);
      if (!normalized) continue;
      try {
        const resolvedPath = resolveExistingSafe(this.mindRoot, normalized);
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
          return normalized;
        }
      } catch {
        // Ignore unsafe or missing candidates.
      }
    }

    return undefined;
  }

  private runtimeSummaryFor(pluginId: string, commandContext?: CommandExecutionContext): PluginRuntimeSummary {
    const app = this.loader.getApp();
    const host = app.getRuntimeHost();
    const loaded = this.loader.getLoadedPlugins().find((plugin) => plugin.manifest.id === pluginId);

    const commands = app.getCommands().filter((command) => command.pluginId === pluginId);
    const importedHotkeys = importedCommandHotkeysFor(readImportedObsidianPluginConfig(this.mindRoot, pluginId));
    const markdownCodeBlockProcessors = host.getMarkdownCodeBlockProcessors().filter((item) => item.pluginId === pluginId);
    const views = host.getViews().filter((item) => item.pluginId === pluginId);
    const viewExtensions = host.getViewExtensions().filter((item) => item.pluginId === pluginId);
    const ribbonIcons = host.getRibbonIcons().filter((item) => item.pluginId === pluginId);
    const statusBarItems = host.getStatusBarItems().filter((item) => item.pluginId === pluginId);
    const styleSheetList = this.styleSheetSummaryFor(pluginId);
    const editorExtensions = host.getEditorExtensions().filter((item) => item.pluginId === pluginId);

    return {
      commands: commands.length,
      commandList: commands.map((command) => {
        const availability = describeCommandAvailability(command, commandContext);
        return {
          id: command.id,
          fullId: command.fullId,
          name: command.name,
          executable: availability.executable,
          requiresEditor: availability.requiresEditor,
          callbackType: availability.callbackType,
          availabilityReason: availability.reason,
          ...commandHotkeySummary(pluginId, command.id, command.fullId, summarizeCommandHotkeys(command.hotkeys), importedHotkeys),
        };
      }),
      settingTabs: loaded?.instance.settingTabs.length ?? 0,
      markdownPostProcessors: host.getMarkdownPostProcessors().filter((item) => item.pluginId === pluginId).length,
      markdownCodeBlockProcessors: markdownCodeBlockProcessors.length,
      markdownCodeBlockLanguages: markdownCodeBlockProcessors.map((item) => item.language),
      views: views.length,
      viewList: views.map((item) => ({ type: item.type })),
      viewExtensions: viewExtensions.length,
      viewExtensionList: viewExtensions.map((item) => ({ extensions: item.extensions, viewType: item.viewType })),
      ribbonIcons: ribbonIcons.length,
      ribbonIconList: ribbonIcons.map((item) => ({ icon: item.icon, title: item.title })),
      statusBarItems: statusBarItems.length,
      statusBarItemList: statusBarItems.map((item) => ({ text: item.element.textContent ?? '' })),
      dataFile: this.dataFileSummaryFor(pluginId),
      secretStorage: this.loader.getApp().getSecretStorageSummary(pluginId),
      communityOrigin: this.communityOriginSummaryFor(pluginId),
      styleSheets: styleSheetList.length,
      styleSheetList,
      editorExtensions: editorExtensions.length,
      editorExtensionList: editorExtensions.map((item) => ({
        id: item.id,
        ...item.summary,
      })),
      capabilityLedger: host.getRuntimeCapabilityLedger(pluginId),
      warnings: host.getWarnings().filter((item) => item.pluginId === pluginId).map((item) => item.message),
    };
  }

  private styleSheetSummaryFor(pluginId: string): Array<{ path: string; bytes: number }> {
    try {
      const pluginLocation = resolveInstalledObsidianPluginDir(this.mindRoot, pluginId);
      const stylePath = pluginLocation ? path.join(pluginLocation.pluginDir, 'styles.css') : '';
      if (!fs.existsSync(stylePath)) return [];
      const stat = fs.statSync(stylePath);
      if (!stat.isFile()) return [];
      return [{ path: 'styles.css', bytes: stat.size }];
    } catch {
      return [];
    }
  }

  private readStyleSheetFile(pluginId: string): { bytes: number; css: string } | null {
    let stylePath = '';
    try {
      const pluginLocation = resolveInstalledObsidianPluginDir(this.mindRoot, pluginId);
      stylePath = pluginLocation ? path.join(pluginLocation.pluginDir, 'styles.css') : '';
    } catch {
      return null;
    }

    if (!fs.existsSync(stylePath)) return null;
    const stat = fs.statSync(stylePath);
    if (!stat.isFile()) return null;
    if (stat.size > OBSIDIAN_PLUGIN_STYLESHEET_MAX_BYTES) {
      throw new MindOSError(
        ErrorCodes.INVALID_REQUEST,
        `Plugin stylesheet is too large: ${stat.size} bytes; max ${OBSIDIAN_PLUGIN_STYLESHEET_MAX_BYTES} bytes`,
      );
    }

    return {
      bytes: stat.size,
      css: fs.readFileSync(stylePath, 'utf-8'),
    };
  }

  private packageLocationFor(pluginId: string): ManagedPluginPackageLocation | undefined {
    const location = resolveInstalledObsidianPluginDir(this.mindRoot, pluginId);
    if (!location) return undefined;

    let canonicalExists = false;
    try {
      const canonical = resolveCanonicalObsidianPluginDir(this.mindRoot, pluginId);
      canonicalExists = fs.existsSync(canonical.pluginDir) && fs.statSync(canonical.pluginDir).isDirectory();
    } catch {
      canonicalExists = false;
    }

    return {
      relativePath: location.pluginRelativePath,
      rootRelativePath: location.relativePath,
      legacy: location.legacy,
      migrationAvailable: location.legacy && !canonicalExists,
    };
  }

  private dataFileSummaryFor(pluginId: string): PluginDataFileSummary {
    try {
      const pluginLocation = resolveInstalledObsidianPluginDir(this.mindRoot, pluginId);
      const dataPath = pluginLocation ? path.join(pluginLocation.pluginDir, 'data.json') : '';
      if (!fs.existsSync(dataPath)) return { exists: false, bytes: 0 };
      const stat = fs.statSync(dataPath);
      if (!stat.isFile()) return { exists: false, bytes: 0 };
      let validJson = true;
      try {
        JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      } catch {
        validJson = false;
      }
      return {
        exists: true,
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        validJson,
      };
    } catch {
      return { exists: false, bytes: 0 };
    }
  }

  private communityOriginSummaryFor(pluginId: string): PluginCommunityOriginSummary | undefined {
    let originPath = '';
    try {
      const pluginLocation = resolveInstalledObsidianPluginDir(this.mindRoot, pluginId);
      originPath = pluginLocation ? path.join(pluginLocation.pluginDir, 'obsidian-community.json') : '';
    } catch {
      return undefined;
    }

    if (!fs.existsSync(originPath)) return undefined;
    const stat = fs.statSync(originPath);
    if (!stat.isFile()) return undefined;

    try {
      const parsed = JSON.parse(fs.readFileSync(originPath, 'utf-8')) as Record<string, unknown>;
      const repo = typeof parsed.repo === 'string' ? parsed.repo.trim() : '';
      return {
        source: 'obsidian-community',
        repo: repo || '(unknown repo)',
        ...(typeof parsed.githubUrl === 'string' ? { githubUrl: parsed.githubUrl } : {}),
        ...(typeof parsed.installedAt === 'string' ? { installedAt: parsed.installedAt } : {}),
        ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
        ...(typeof parsed.previousVersion === 'string' ? { previousVersion: parsed.previousVersion } : {}),
        ...(typeof parsed.manifestUrl === 'string' ? { manifestUrl: parsed.manifestUrl } : {}),
        ...(typeof parsed.mainUrl === 'string' ? { mainUrl: parsed.mainUrl } : {}),
        ...(typeof parsed.stylesUrl === 'string' ? { stylesUrl: parsed.stylesUrl } : {}),
        ...(isCompatibilityLevel(parsed.compatibilityLevel) ? { compatibilityLevel: parsed.compatibilityLevel } : {}),
        validJson: true,
      };
    } catch (error) {
      return {
        source: 'obsidian-community',
        repo: '(invalid metadata)',
        validJson: false,
        error: error instanceof Error ? error.message : 'Invalid obsidian-community.json',
      };
    }
  }

  private commandExecutionContextFor(editorContext: PluginEditorCommandContext | undefined): CommandExecutionContext | undefined {
    const session = this.readEditorSession(editorContext);
    return session?.commandContext;
  }

  private async editorExecutionSessionFor(editorContext: PluginEditorCommandContext | undefined): Promise<EditorExecutionSession | null> {
    return this.readEditorSession(editorContext);
  }

  private readEditorSession(editorContext: PluginEditorCommandContext | undefined): EditorExecutionSession | null {
    if (!editorContext?.sourcePath) return null;
    const app = this.loader.getApp();
    const file = app.vault.getFileByPath(editorContext.sourcePath);
    if (!file || file.extension !== 'md') return null;

    const initialContent = fs.readFileSync(resolveExistingSafe(this.mindRoot, file.path), 'utf-8');
    return {
      file,
      initialContent,
      commandContext: createMarkdownEditorCommandContext(file, {
        content: initialContent,
        selectionStart: editorContext.selectionStart,
        selectionEnd: editorContext.selectionEnd,
        cursorOffset: editorContext.cursorOffset,
        clickableToken: editorContext.clickableToken,
      }),
    };
  }

  private activeFileForSourcePath(sourcePath: string | undefined): TFile | null {
    const normalizedSourcePath = sourcePath?.trim();
    if (!normalizedSourcePath) return null;
    const file = this.loader.getApp().vault.getFileByPath(normalizedSourcePath);
    if (!file) {
      throw new Error(`Plugin view source file not found: ${normalizedSourcePath}`);
    }
    return file;
  }

  private serializableFile(file: TFile): { path: string; name: string; basename: string; extension: string } {
    return {
      path: file.path,
      name: file.name,
      basename: file.basename,
      extension: file.extension,
    };
  }

  private requirePlugin(pluginId: string): ManagedPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }
    return plugin;
  }

  private refreshCapabilityGate(plugin: ManagedPlugin): ObsidianCapabilityGateReport {
    const gate = buildPluginCapabilityGateReport(plugin, this.state);
    plugin.capabilityGate = gate;
    return gate;
  }

  private assertCapabilityGateAllowsEnable(plugin: ManagedPlugin, options: PluginEnableOptions): void {
    try {
      const result = assertPluginCapabilityGateAllowsEnable(plugin, this.state, options);
      this.state = {
        ...this.state,
        ...result.confirmationStore,
      };
      plugin.capabilityGate = result.report;
    } catch (error) {
      this.recordCapabilityGateLedgerEvent(plugin, 'enable', error);
      plugin.lastError = error instanceof MindOSError
        ? error.message
        : 'Obsidian plugin enable requires capability confirmation.';
      throw error;
    }
  }

  private assertCapabilityGateAllowsLoad(plugin: ManagedPlugin): void {
    try {
      plugin.capabilityGate = assertPluginCapabilityGateAllowsLoad(plugin, this.state);
    } catch (error) {
      this.recordCapabilityGateLedgerEvent(plugin, 'load', error);
      plugin.lastError = error instanceof MindOSError
        ? error.message
        : 'Obsidian plugin enable requires capability confirmation.';
      throw error;
    }
  }

  private recordCapabilityGateLedgerEvent(plugin: ManagedPlugin, action: 'enable' | 'load', error: unknown): void {
    const report = isObsidianCapabilityGateConfirmationRequiredError(error)
      ? error.report
      : this.refreshCapabilityGate(plugin);
    const gatedItems = report.items.filter((item) => (
      item.decision === 'blocked' || item.decision === 'requires-confirmation'
    ));
    const reasons = report.blockedReasons.length > 0
      ? report.blockedReasons
      : report.confirmReasons.length > 0
        ? report.confirmReasons
        : [error instanceof Error ? error.message : String(error)];

    for (const [index, reason] of reasons.entries()) {
      const item = gatedItems[index] ?? gatedItems[0];
      try {
        this.runtimeCapabilityLedgerStore.append({
          pluginId: plugin.id,
          capability: `capability-gate:${action}`,
          surface: item?.surface ?? 'unsupported',
          support: item?.decision === 'blocked' ? 'unsupported' : 'limited',
          phase: 'blocked',
          source: 'runtime-ledger',
          evidence: item?.decision === 'requires-confirmation'
            ? `Capability gate requires review before ${action}: ${reason}`
            : `Capability gate blocked ${action}: ${reason}`,
        });
      } catch {
        // Ledger writes must not change the enable/load decision.
      }
    }
  }

  private readState(): PluginManagerState {
    const enabled: Record<string, boolean> = {};
    const capabilityConfirmations: Record<string, ObsidianCapabilityGateConfirmation> = {};
    for (const stateFilePath of resolvePluginManagerStatePathsForRead(this.mindRoot)) {
      if (!fs.existsSync(stateFilePath)) {
        continue;
      }
      try {
        const raw = fs.readFileSync(stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PluginManagerState>;
        Object.assign(enabled, parsed.enabled ?? {});
        Object.assign(capabilityConfirmations, normalizeCapabilityConfirmations(parsed.capabilityConfirmations));
      } catch {
        // Ignore malformed state files and keep any already-read state.
      }
    }
    return {
      ...EMPTY_STATE,
      enabled,
      ...(Object.keys(capabilityConfirmations).length > 0 ? { capabilityConfirmations } : {}),
    };
  }

  private writeState(): void {
    const enabled: Record<string, boolean> = {};
    const capabilityConfirmations: Record<string, ObsidianCapabilityGateConfirmation> = {};
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) {
        enabled[plugin.id] = true;
      }
      const confirmation = this.state.capabilityConfirmations?.[plugin.id];
      if (confirmation) {
        const gate = buildObsidianCapabilityGateReport({
          manifest: plugin.manifest,
          compatibility: plugin.compatibility,
          compatibilityLevel: plugin.compatibilityLevel,
          coverage: plugin.coverage,
          confirmation,
        });
        if (gate.confirmed) {
          capabilityConfirmations[plugin.id] = confirmation;
          plugin.capabilityGate = gate;
        }
      }
    }
    this.state = {
      enabled,
      ...(Object.keys(capabilityConfirmations).length > 0 ? { capabilityConfirmations } : {}),
    };

    try {
      const stateFilePath = resolveCanonicalPluginManagerStatePath(this.mindRoot);
      fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
      fs.writeFileSync(stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[obsidian-compat] Failed to write plugin state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function normalizeCapabilityConfirmations(value: unknown): Record<string, ObsidianCapabilityGateConfirmation> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, ObsidianCapabilityGateConfirmation> = {};
  for (const [pluginId, rawConfirmation] of Object.entries(value as Record<string, unknown>)) {
    if (!rawConfirmation || typeof rawConfirmation !== 'object') continue;
    const record = rawConfirmation as Record<string, unknown>;
    if (typeof record.confirmedAt !== 'string' || typeof record.fingerprint !== 'string') continue;
    result[pluginId] = {
      confirmedAt: record.confirmedAt,
      fingerprint: record.fingerprint,
      surfaces: Array.isArray(record.surfaces)
        ? record.surfaces.filter((surface): surface is ObsidianCapabilityGateConfirmation['surfaces'][number] => typeof surface === 'string')
        : [],
    };
  }
  return result;
}

function isCompatibilityLevel(value: unknown): value is CompatibilityLevel {
  return value === 'compatible' || value === 'partial' || value === 'blocked';
}

function clickableTokenForEditorMenu(context: PluginEditorMenuContext): ClickableToken | null {
  const tagText = context.tagText?.trim();
  if (!tagText) return null;
  const normalizedTag = tagText.startsWith('#') ? tagText : `#${tagText}`;
  return {
    type: 'tag',
    text: normalizedTag,
  };
}

function normalizeWorkspaceLink(value: string): string {
  return value
    .split('#')[0]
    .split('^')[0]
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

function summarizeCommandHotkeys(hotkeys: unknown): Array<{ modifiers: string[]; key: string }> {
  if (!Array.isArray(hotkeys)) return [];
  return hotkeys
    .map((hotkey) => {
      if (!hotkey || typeof hotkey !== 'object') return null;
      const record = hotkey as { modifiers?: unknown; key?: unknown };
      if (typeof record.key !== 'string' || !record.key.trim()) return null;
      const modifiers = Array.isArray(record.modifiers)
        ? record.modifiers.filter((modifier): modifier is string => typeof modifier === 'string' && modifier.trim().length > 0)
        : [];
      return {
        modifiers,
        key: record.key.trim(),
      };
    })
    .filter((item): item is { modifiers: string[]; key: string } => item !== null);
}

function importedCommandHotkeysFor(config: ReturnType<typeof readImportedObsidianPluginConfig>): Map<string, ObsidianPluginHotkey[]> {
  const hotkeys = new Map<string, ObsidianPluginHotkey[]>();
  for (const item of config?.hotkeys ?? []) {
    hotkeys.set(item.commandId, item.hotkeys);
  }
  return hotkeys;
}

function commandHotkeySummary(
  pluginId: string,
  commandId: string,
  fullId: string,
  defaults: Array<{ modifiers: string[]; key: string }>,
  importedHotkeys: Map<string, ObsidianPluginHotkey[]>,
): { hotkeys: Array<{ modifiers: string[]; key: string }>; hotkeySources: { default: number; obsidianImport: number } } {
  const imported = [
    ...(importedHotkeys.get(`${pluginId}:${commandId}`) ?? []),
    ...(importedHotkeys.get(fullId) ?? []),
  ];
  return {
    hotkeys: dedupeHotkeys([...imported, ...defaults]),
    hotkeySources: {
      default: defaults.length,
      obsidianImport: imported.length,
    },
  };
}

function dedupeHotkeys(hotkeys: Array<{ modifiers: string[]; key: string }>): Array<{ modifiers: string[]; key: string }> {
  const seen = new Set<string>();
  const result: Array<{ modifiers: string[]; key: string }> = [];
  for (const hotkey of hotkeys) {
    const signature = `${hotkey.modifiers.map((modifier) => modifier.trim().toLowerCase()).sort().join('+')}|${hotkey.key.trim().toLowerCase()}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(hotkey);
  }
  return result;
}
