import {
  FileText,
  KeyRound,
  ListChecks,
  PanelRightOpen,
  Puzzle,
  Search,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type {
  ObsidianCapabilityCoverage,
  ObsidianCapabilitySurfaceSummary,
  ObsidianCapabilitySupport,
} from '@/lib/obsidian-compat/capability-matrix';
import type { ObsidianCapabilityGateReport } from '@/lib/obsidian-compat/capability-gate';
import type {
  ObsidianRuntimeCapabilityLedgerEntry,
  ObsidianRuntimeCapabilityLedgerPhase,
  ObsidianSurfaceCatalogStatus,
} from '@/lib/obsidian-compat/compatibility-preview';
import {
  buildObsidianSurfaceLedgerProjection,
  type ObsidianSurfaceLedgerProjection,
} from '@/lib/obsidian-compat/surface-decision';
import type {
  ObsidianRuntimeCapabilityLedgerHistory,
} from '@/lib/obsidian-compat/runtime-capability-ledger-store';
import type {
  ObsidianWorkflowAudit,
  ObsidianWorkflowAuditStatus,
} from '@/lib/obsidian-compat/workflow-audit';
import type {
  ObsidianWorkflowProbeHistory,
  ObsidianWorkflowProbeResult,
} from '@/lib/obsidian-compat/workflow-probes';
import { getObsidianImportSupport } from '@/lib/obsidian-compat/import-policy';
import type { PluginActionResult } from '@/lib/plugins/client';

export type CompatibilityLevel = 'compatible' | 'partial' | 'blocked';

export interface ObsidianCommand {
  id: string;
  fullId: string;
  name: string;
  executable?: boolean;
  requiresEditor?: boolean;
  callbackType?: 'callback' | 'check-callback' | 'editor-callback' | 'editor-check-callback' | 'none';
  availabilityReason?: string;
}

export interface ObsidianPluginRuntime {
  commands: number;
  commandList: ObsidianCommand[];
  settingTabs: number;
  markdownPostProcessors: number;
  markdownCodeBlockProcessors: number;
  markdownCodeBlockLanguages?: string[];
  views: number;
  viewList?: Array<{ type: string }>;
  viewExtensions: number;
  viewExtensionList?: Array<{ viewType: string; extensions: string[] }>;
  ribbonIcons: number;
  ribbonIconList?: Array<{ icon: string; title: string }>;
  statusBarItems: number;
  statusBarItemList?: Array<{ text: string }>;
  dataFile?: {
    exists: boolean;
    bytes: number;
    updatedAt?: string;
    validJson?: boolean;
  };
  secretStorage?: {
    backend: string;
    encrypted: boolean;
    path?: string;
    keyPath?: string;
    pluginId: string;
    secrets: number;
  };
  communityOrigin?: {
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
  };
  styleSheets: number;
  styleSheetList?: Array<{ path: string; bytes: number }>;
  editorExtensions: number;
  editorExtensionList?: Array<{
    id: string;
    kind: string;
    valueType: string;
    serializable: boolean;
    count?: number;
    constructorName?: string;
    keys?: string[];
    mountStatus?: string;
    capabilityGate?: string;
    mountReason?: string;
    autoMount?: boolean;
    sandbox?: {
      phase?: string;
      target?: string;
      host?: string;
      status?: string;
      transferable?: boolean;
      permissionGate?: string;
      canAutoMount?: boolean;
      cleanupRequired?: boolean;
      requiredPermissions?: string[];
      requirements?: string[];
      reasons?: string[];
    };
  }>;
  capabilityLedger?: ObsidianRuntimeCapabilityLedgerEntry[];
  warnings: string[];
}

export interface ObsidianPluginStatus {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  compatibilityLevel: CompatibilityLevel;
  compatibility: {
    supportedApis: string[];
    partialApis: string[];
    unsupportedApis?: string[];
    blockers: string[];
  };
  coverage?: ObsidianCapabilityCoverage[];
  coverageSummary?: Record<ObsidianCapabilitySupport, number>;
  surfaceSummary?: ObsidianCapabilitySurfaceSummary[];
  capabilityGate?: ObsidianCapabilityGateReport;
  capabilityLedger?: ObsidianRuntimeCapabilityLedgerEntry[];
  capabilityLedgerHistory?: ObsidianRuntimeCapabilityLedgerHistory;
  workflowProbeHistory?: ObsidianWorkflowProbeHistory;
  workflowAudits?: ObsidianWorkflowAudit[];
  packageLocation?: {
    relativePath: string;
    rootRelativePath: string;
    legacy: boolean;
    migrationAvailable: boolean;
  };
  runtime: ObsidianPluginRuntime;
  lastError?: string;
}

export interface ObsidianPluginLoadResult {
  loaded: string[];
  failed: string[];
  skipped: string[];
}

export interface ObsidianPluginsResponse {
  ok: boolean;
  result?: ObsidianPluginLoadResult | PluginActionResult | ObsidianWorkflowProbeResult | ObsidianWorkflowProbeResult[];
  plugins: ObsidianPluginStatus[];
  capabilityGate?: ObsidianCapabilityGateReport;
}

export interface ObsidianSettingItem {
  name?: string;
  desc?: string;
  kind?: 'text' | 'toggle' | 'dropdown' | 'button';
  value?: unknown;
  placeholder?: string;
  disabled?: boolean;
  cta?: boolean;
  buttonText?: string;
  options?: Array<{ value: string; label: string }>;
  canChange: boolean;
  canClick: boolean;
}

export interface ObsidianDeclarativeSettingControl {
  type: string;
  key?: string;
  defaultValue?: unknown;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number | 'any';
  rows?: number;
  includeRoot?: boolean;
  hasValidate: boolean;
  hasFilter: boolean;
  disabledState: 'enabled' | 'disabled' | 'dynamic';
}

export interface ObsidianDeclarativeSettingItem {
  path: number[];
  kind: 'control' | 'action' | 'render' | 'empty' | 'group' | 'list' | 'page' | 'unknown';
  type?: string;
  name?: string;
  heading?: string;
  desc?: string;
  aliases?: string[];
  searchableState: 'searchable' | 'hidden' | 'dynamic';
  visibleState: 'visible' | 'hidden' | 'dynamic';
  control?: ObsidianDeclarativeSettingControl;
  value?: unknown;
  displayValue?: string;
  status?: 'warning' | null | 'dynamic';
  childCount?: number;
  children?: ObsidianDeclarativeSettingItem[];
  capabilities: {
    canChange: boolean;
    canRunAction: boolean;
    canAddListItem?: boolean;
    canDeleteListItem?: boolean;
    canReorderListItems?: boolean;
    canPreviewRender?: boolean;
    canPreviewPage?: boolean;
    hasCustomRender: boolean;
    hasCustomPage: boolean;
    hasListMutation: boolean;
  };
  warnings: string[];
}

export interface ObsidianDeclarativeSettingPreviewNode {
  tag: string;
  text?: string;
  children?: ObsidianDeclarativeSettingPreviewNode[];
}

export interface ObsidianDeclarativeSettingPreview {
  kind: 'render' | 'page';
  path: number[];
  label: string;
  text?: string;
  nodes?: ObsidianDeclarativeSettingPreviewNode[];
  pageItems?: ObsidianDeclarativeSettingItem[];
  cleanupCalled?: boolean;
  warnings: string[];
}

export interface ObsidianPluginSettings {
  id: string;
  name: string;
  version: string;
  settingTabs: Array<{
    error?: string;
    items: ObsidianSettingItem[];
  }>;
  declarativeSettingTabs?: Array<{
    error?: string;
    items: ObsidianDeclarativeSettingItem[];
  }>;
}

export interface ObsidianPluginSettingsResponse {
  ok: boolean;
  loadResult?: ObsidianPluginLoadResult;
  plugins: ObsidianPluginSettings[];
  status?: ObsidianPluginStatus[];
  preview?: ObsidianDeclarativeSettingPreview;
}

export type PluginLifecycleAction = 'enable' | 'disable' | 'load' | 'load-enabled' | 'execute-command' | 'run-workflow-probe' | 'uninstall' | 'migrate-legacy';
export type SettingAction = 'set-value' | 'click-button' | 'list-add' | 'list-delete' | 'list-reorder' | 'preview-render' | 'preview-page';
export type SurfaceRouteState = 'mounted' | 'catalog' | 'diagnostic';
export type SurfaceRouteTarget = 'command-center' | 'plugin-entries' | 'plugin-views';

export interface SurfaceRoute {
  label: string;
  value: string;
  state: SurfaceRouteState;
  icon: LucideIcon;
  target?: SurfaceRouteTarget;
  actionLabel?: string;
}

export interface SurfaceLedgerProjectionView {
  surface: ObsidianCapabilitySurfaceSummary['surface'];
  label: string;
  apiCount: number;
  support: string;
  apiPreview: string;
  routes: string[];
  projection: ObsidianSurfaceLedgerProjection;
}

export function runtimeSummary(plugin: ObsidianPluginStatus): string {
  const parts = [
    plugin.runtime.commands ? `${plugin.runtime.commands} command${plugin.runtime.commands === 1 ? '' : 's'}` : '',
    plugin.runtime.settingTabs ? `${plugin.runtime.settingTabs} setting tab${plugin.runtime.settingTabs === 1 ? '' : 's'}` : '',
    plugin.runtime.markdownCodeBlockProcessors ? `${plugin.runtime.markdownCodeBlockProcessors} code block processor${plugin.runtime.markdownCodeBlockProcessors === 1 ? '' : 's'}` : '',
    plugin.runtime.markdownPostProcessors ? `${plugin.runtime.markdownPostProcessors} post processor${plugin.runtime.markdownPostProcessors === 1 ? '' : 's'}` : '',
    plugin.runtime.views ? `${plugin.runtime.views} view${plugin.runtime.views === 1 ? '' : 's'}` : '',
    plugin.runtime.viewExtensions ? `${plugin.runtime.viewExtensions} view extension mapping${plugin.runtime.viewExtensions === 1 ? '' : 's'}` : '',
    plugin.runtime.ribbonIcons ? `${plugin.runtime.ribbonIcons} action${plugin.runtime.ribbonIcons === 1 ? '' : 's'}` : '',
    plugin.runtime.statusBarItems ? `${plugin.runtime.statusBarItems} status item${plugin.runtime.statusBarItems === 1 ? '' : 's'}` : '',
    plugin.runtime.communityOrigin ? plugin.runtime.communityOrigin.validJson === false ? 'invalid community source' : 'community source' : '',
    plugin.runtime.dataFile?.exists ? plugin.runtime.dataFile.validJson === false ? 'invalid data file' : 'stored data' : '',
    plugin.runtime.secretStorage?.secrets ? `${plugin.runtime.secretStorage.secrets} encrypted secret${plugin.runtime.secretStorage.secrets === 1 ? '' : 's'}` : '',
    plugin.runtime.styleSheets ? `${plugin.runtime.styleSheets} stylesheet${plugin.runtime.styleSheets === 1 ? '' : 's'}` : '',
    plugin.runtime.editorExtensions ? `${plugin.runtime.editorExtensions} editor extension${plugin.runtime.editorExtensions === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : 'No runtime registrations yet';
}

export function capabilityLedgerSummary(plugin: ObsidianPluginStatus): string {
  const ledger = plugin.capabilityLedger ?? plugin.runtime.capabilityLedger ?? [];
  if (ledger.length === 0) return 'No capability ledger yet';
  const counts = ledger.reduce<Record<ObsidianRuntimeCapabilityLedgerPhase, number>>((summary, entry) => {
    summary[entry.phase] += 1;
    return summary;
  }, { predicted: 0, registered: 0, called: 0, blocked: 0 });
  return [
    counts.predicted ? `${counts.predicted} predicted` : '',
    counts.registered ? `${counts.registered} registered` : '',
    counts.called ? `${counts.called} called` : '',
    counts.blocked ? `${counts.blocked} blocked` : '',
  ].filter(Boolean).join(' / ');
}

export function capabilityLedgerHistorySummary(plugin: ObsidianPluginStatus): string {
  const history = plugin.capabilityLedgerHistory;
  if (!history || history.total === 0) return 'No historical events yet';
  const parts = [
    history.summary.registered ? `${history.summary.registered} registered` : '',
    history.summary.called ? `${history.summary.called} called` : '',
    history.summary.blocked ? `${history.summary.blocked} blocked` : '',
  ].filter(Boolean);
  return parts.length > 0 ? `${history.total} historical · ${parts.join(' / ')}` : `${history.total} historical`;
}

export function surfaceLedgerProjections(plugin: ObsidianPluginStatus): SurfaceLedgerProjectionView[] {
  const ledger = plugin.capabilityLedger ?? plugin.runtime.capabilityLedger ?? [];
  return (plugin.surfaceSummary ?? []).map((summary) => {
    const label = surfaceLabel(summary.surface);
    return {
      surface: summary.surface,
      label,
      apiCount: summary.apiCount,
      support: compactSurfaceSupport(summary.supportSummary),
      apiPreview: surfaceApiPreview(summary.apis),
      routes: summary.routes,
      projection: buildObsidianSurfaceLedgerProjection({
        surface: summary.surface,
        label,
        status: surfaceCatalogStatusFromSupport(summary.surface, summary.supportSummary),
        ledger,
      }),
    };
  });
}

export function workflowAuditStatusLabel(status: ObsidianWorkflowAuditStatus): string {
  if (status === 'observed') return 'observed';
  if (status === 'partial') return 'partial';
  if (status === 'blocked') return 'blocked';
  if (status === 'native-replacement') return 'native';
  return 'not observed';
}

function surfaceLabel(surface: ObsidianCapabilitySurfaceSummary['surface']): string {
  return {
    commands: 'Commands',
    settings: 'Settings',
    views: 'Views',
    document: 'Document',
    network: 'Network',
    secret: 'Secrets',
    editor: 'Editor',
    vault: 'Vault',
    metadata: 'Metadata',
    workspace: 'Workspace',
    entries: 'Entries',
    styles: 'Styles',
    core: 'Core runtime',
    unsupported: 'Blocked capability',
  }[surface];
}

function compactSurfaceSupport(summary: Record<ObsidianCapabilitySupport, number>): string {
  const parts = [
    summary.full ? `${summary.full} full` : '',
    summary.limited ? `${summary.limited} limited` : '',
    summary['snapshot-only'] ? `${summary['snapshot-only']} snapshot` : '',
    summary['catalog-only'] ? `${summary['catalog-only']} catalog` : '',
    summary['request-only'] ? `${summary['request-only']} request` : '',
    summary.unsupported ? `${summary.unsupported} unsupported` : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function surfaceApiPreview(apis: string[]): string {
  const firstApis = apis.slice(0, 3).join(', ');
  const remaining = apis.length - 3;
  return remaining > 0 ? `${firstApis}, +${remaining}` : firstApis;
}

function surfaceCatalogStatusFromSupport(
  surface: ObsidianCapabilitySurfaceSummary['surface'],
  summary: Record<ObsidianCapabilitySupport, number>,
): ObsidianSurfaceCatalogStatus {
  if (surface === 'unsupported' || summary.unsupported > 0) return 'blocked';
  if (surface === 'editor') return 'native-gated';
  if (summary['snapshot-only'] > 0) return 'preview-only';
  if (summary['catalog-only'] > 0 && summary.full === 0 && summary.limited === 0 && summary['request-only'] === 0) {
    return 'catalog-only';
  }
  if (summary['request-only'] > 0 && summary.full === 0 && summary.limited === 0 && summary['catalog-only'] === 0) {
    return 'request-only';
  }
  if (summary.limited > 0 || summary['catalog-only'] > 0 || summary['request-only'] > 0) {
    return 'limited';
  }
  return 'ready';
}

export function workflowAuditProbeSummary(audit: ObsidianWorkflowAudit): string {
  if (!audit.lastProbedAt || !audit.lastProbeStatus) return '';
  const date = audit.lastProbedAt.slice(0, 19).replace('T', ' ');
  return `Last probe ${audit.lastProbeStatus} · ${date}`;
}

export function workflowAuditStatusClass(status: ObsidianWorkflowAuditStatus): string {
  if (status === 'observed') return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  if (status === 'partial') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (status === 'blocked') return 'border-error/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-error';
  if (status === 'native-replacement') return 'border-border bg-background text-foreground';
  return 'border-border bg-background text-muted-foreground';
}

export function compatibilityNote(plugin: ObsidianPluginStatus): string {
  const support = getObsidianImportSupport(plugin);
  if (support.kind !== 'ready') return support.reason;
  return plugin.compatibility.supportedApis.length > 0
    ? `Supported APIs: ${plugin.compatibility.supportedApis.slice(0, 4).join(', ')}`
    : 'No Obsidian API usage detected';
}

export function isLoadResult(value: unknown): value is ObsidianPluginLoadResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as ObsidianPluginLoadResult;
  return Array.isArray(record.loaded)
    && Array.isArray(record.failed)
    && Array.isArray(record.skipped);
}

export function isPluginActionResult(value: unknown): value is PluginActionResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as PluginActionResult;
  return Array.isArray(record.workspaceOpenRequests)
    || Array.isArray(record.modalSnapshots)
    || Array.isArray(record.menuSnapshots)
    || Array.isArray(record.noticeSnapshots)
    || Array.isArray(record.editorUpdates);
}

function normalizeFileExtension(value: string): string {
  return value.trim().replace(/^\.+/, '').toLowerCase();
}

function formatFileExtensions(extensions: string[]): string {
  return Array.from(new Set(extensions.map(normalizeFileExtension).filter(Boolean)))
    .map((extension) => `.${extension}`)
    .join(', ');
}

function viewExtensionsForType(
  mappings: Array<{ viewType: string; extensions: string[] }> | undefined,
  viewType: string,
): string[] {
  const extensions = new Set<string>();
  for (const mapping of mappings ?? []) {
    if (mapping.viewType !== viewType) continue;
    for (const extension of mapping.extensions) {
      const normalized = normalizeFileExtension(extension);
      if (normalized) extensions.add(normalized);
    }
  }
  return Array.from(extensions).sort();
}

function formatViewExtensionMappings(mappings: Array<{ viewType: string; extensions: string[] }>): string {
  return mappings
    .map((mapping) => {
      const extensions = formatFileExtensions(mapping.extensions);
      return extensions ? `${extensions} -> ${mapping.viewType}` : mapping.viewType;
    })
    .filter(Boolean)
    .join('; ');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function formatCommunityOriginValue(origin: NonNullable<ObsidianPluginRuntime['communityOrigin']>): string {
  if (origin.validJson === false) {
    return origin.error ? `obsidian-community.json · invalid metadata: ${origin.error}` : 'obsidian-community.json · invalid metadata';
  }
  const installed = origin.installedAt ? ` · installed ${origin.installedAt.slice(0, 10)}` : '';
  const updated = origin.updatedAt ? ` · updated ${origin.updatedAt.slice(0, 10)}` : '';
  const previous = origin.previousVersion ? ` · previous ${origin.previousVersion}` : '';
  return `Obsidian Community · ${origin.repo}${installed}${updated}${previous}`;
}

export function surfaceRouting(plugin: ObsidianPluginStatus): SurfaceRoute[] {
  const routes: SurfaceRoute[] = [];
  const viewExtensionList = plugin.runtime.viewExtensionList ?? [];
  const registeredViewTypes = new Set((plugin.runtime.viewList ?? []).map((item) => item.type));

  if (plugin.runtime.commands > 0) {
    const executableCommands = plugin.runtime.commandList.filter((command) => command.executable !== false).length;
    const editorCommands = plugin.runtime.commandList.filter((command) => command.requiresEditor === true).length;
    if (executableCommands > 0) {
      routes.push({
        label: 'Commands',
        value: editorCommands > 0
          ? `Command Center / Actions (${executableCommands} executable, ${editorCommands} editor catalog)`
          : 'Command Center / Actions',
        state: 'mounted',
        icon: Search,
        target: 'command-center',
        actionLabel: 'Open Command Center',
      });
    } else {
      routes.push({
        label: 'Commands',
        value: editorCommands > 0 ? 'Editor command catalog only' : 'Recorded command catalog only',
        state: 'catalog',
        icon: Terminal,
        target: 'plugin-entries',
        actionLabel: 'Open entries',
      });
    }
  }
  if (plugin.runtime.settingTabs > 0) {
    routes.push({
      label: 'Settings',
      value: 'This plugin detail',
      state: 'mounted',
      icon: SlidersHorizontal,
    });
  }
  if (plugin.runtime.ribbonIcons > 0) {
    routes.push({
      label: 'Ribbon actions',
      value: 'Plugin Entries actions',
      state: 'mounted',
      icon: Puzzle,
      target: 'plugin-entries',
      actionLabel: 'Open entries',
    });
  }
  if (plugin.runtime.statusBarItems > 0) {
    routes.push({
      label: 'Status items',
      value: 'Plugin Entries status',
      state: 'mounted',
      icon: ListChecks,
      target: 'plugin-entries',
      actionLabel: 'Open entries',
    });
  }
  if (plugin.runtime.communityOrigin) {
    routes.push({
      label: 'Source',
      value: formatCommunityOriginValue(plugin.runtime.communityOrigin),
      state: plugin.runtime.communityOrigin.validJson === false ? 'diagnostic' : 'mounted',
      icon: Puzzle,
    });
  }
  if (plugin.runtime.dataFile?.exists) {
    const validJson = plugin.runtime.dataFile.validJson !== false;
    routes.push({
      label: 'Storage',
      value: `data.json · ${formatBytes(plugin.runtime.dataFile.bytes)} · ${validJson ? 'valid JSON' : 'invalid JSON'}`,
      state: validJson ? 'mounted' : 'diagnostic',
      icon: FileText,
    });
  }
  if (plugin.runtime.secretStorage?.secrets) {
    routes.push({
      label: 'Secrets',
      value: `SecretStorage · ${plugin.runtime.secretStorage.secrets} encrypted ref${plugin.runtime.secretStorage.secrets === 1 ? '' : 's'}`,
      state: plugin.runtime.secretStorage.encrypted ? 'mounted' : 'diagnostic',
      icon: KeyRound,
    });
  }
  if (plugin.runtime.views > 0) {
    const viewTypes = plugin.runtime.viewList
      ?.map((item) => {
        const extensions = formatFileExtensions(viewExtensionsForType(viewExtensionList, item.type));
        return extensions ? `${item.type} (${extensions})` : item.type;
      })
      .filter(Boolean)
      .join(', ');
    routes.push({
      label: 'Views',
      value: viewTypes ? `Plugin View host: ${viewTypes}` : 'Plugin View host',
      state: 'mounted',
      icon: PanelRightOpen,
      target: 'plugin-views',
      actionLabel: 'Open view host',
    });
  }
  const orphanViewExtensions = viewExtensionList.filter((mapping) => !registeredViewTypes.has(mapping.viewType));
  if (orphanViewExtensions.length > 0) {
    const mappings = formatViewExtensionMappings(orphanViewExtensions);
    routes.push({
      label: 'View files',
      value: mappings ? `Recorded mapping: ${mappings}` : 'Recorded mapping only',
      state: 'diagnostic',
      icon: PanelRightOpen,
      target: 'plugin-entries',
      actionLabel: 'Open entries',
    });
  }
  if (plugin.runtime.markdownCodeBlockProcessors > 0) {
    const languages = plugin.runtime.markdownCodeBlockLanguages?.filter(Boolean).join(', ');
    routes.push({
      label: 'Markdown code',
      value: languages ? `Document render snapshots: ${languages}` : 'Document render snapshots',
      state: 'mounted',
      icon: FileText,
    });
  }
  if (plugin.runtime.markdownPostProcessors > 0) {
    routes.push({
      label: 'Markdown post',
      value: 'Document post-process snapshots',
      state: 'mounted',
      icon: FileText,
    });
  }
  if (plugin.runtime.styleSheets > 0) {
    const stylePaths = plugin.runtime.styleSheetList?.map((item) => item.path).filter(Boolean).join(', ');
    const styleMounted = plugin.loaded && plugin.compatibilityLevel !== 'blocked';
    routes.push({
      label: 'Styles',
      value: stylePaths ? `Scoped stylesheet host: ${stylePaths}` : 'Scoped stylesheet host',
      state: styleMounted ? 'mounted' : 'catalog',
      icon: FileText,
      target: plugin.runtime.views > 0 ? 'plugin-views' : 'plugin-entries',
      actionLabel: plugin.runtime.views > 0 ? 'Open view host' : 'Open entries',
    });
  }
  if (plugin.runtime.editorExtensions > 0) {
    const kinds = plugin.runtime.editorExtensionList
      ?.map((item) => item.constructorName || item.kind || item.valueType)
      .filter(Boolean)
      .join(', ');
    const gatedCount = plugin.runtime.editorExtensionList
      ?.filter((item) => item.mountStatus === 'catalog-only')
      .length ?? 0;
    routes.push({
      label: 'Editor',
      value: kinds
        ? `Extension catalog: ${kinds}; browser editor gate required (${gatedCount}/${plugin.runtime.editorExtensions} catalog-only)`
        : 'Extension catalog / browser editor gate required',
      state: 'catalog',
      icon: Terminal,
      target: 'plugin-entries',
      actionLabel: 'Open entries',
    });
  }

  return routes;
}
