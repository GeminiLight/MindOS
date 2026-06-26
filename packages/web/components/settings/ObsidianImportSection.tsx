'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  ListChecks,
  Loader2,
  Search,
  ShieldCheck,
  XCircle,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import {
  getObsidianImportSupport,
  type ObsidianImportSupport,
  type ObsidianImportSupportKind,
} from '@/lib/obsidian-compat/import-policy';
import type {
  ObsidianCommunitySurfacePreview,
  ObsidianCommunitySurfacePreviewState,
} from '@/lib/obsidian-compat/community-support';
import type { ObsidianCapabilitySupport } from '@/lib/obsidian-compat/capability-matrix';
import type {
  ObsidianCompatibilityPreview,
  ObsidianRuntimeCapabilityLedgerPhase,
  ObsidianSurfaceCatalogStatus,
  ObsidianWorkflowOutcomeStatus,
} from '@/lib/obsidian-compat/compatibility-preview';
import { notifyObsidianPluginPackagesChanged } from '@/lib/plugins/events';
import {
  readObsidianLinterProfilePreference,
  saveObsidianLinterProfilePreference,
} from '@/lib/stores/obsidian-linter-profile-store';
import type { ImportedObsidianLinterProfile } from '@/lib/obsidian-compat/linter-settings-profile';

interface ScannedPlugin {
  id: string;
  manifest: { id: string; name: string; version: string; description?: string };
  compatibilityLevel: 'compatible' | 'partial' | 'blocked';
  compatibility: {
    obsidianApis: string[];
    nodeModules: string[];
    supportedApis: string[];
    partialApis: string[];
    unsupportedApis?: string[];
    blockers: string[];
  };
  hasStyles: boolean;
  hasData: boolean;
  importable?: boolean;
  support?: ObsidianImportSupport;
  surfacePreview?: ObsidianCommunitySurfacePreview[];
  coverageSummary?: Record<ObsidianCapabilitySupport, number>;
  compatibilityPreview?: ObsidianCompatibilityPreview;
  migrationPlan?: {
    copiedFiles: string[];
    sourceVaultUnchanged: boolean;
    enableAfterImport: boolean;
    defaultSelected: boolean;
  };
  obsidianConfig?: {
    enabledInObsidian: boolean;
    hasEnabledList?: boolean;
    hotkeyCount: number;
    hotkeys: Array<{ commandId: string; hotkeys: Array<{ modifiers: string[]; key: string }> }>;
  };
}

interface SkippedPlugin {
  dirName: string;
  reason: string;
}

interface CompatReport {
  ok: boolean;
  vaultRoot: string;
  configDir?: string;
  sourcePluginsPath?: string;
  summary: {
    total: number;
    compatible: number;
    partial: number;
    blocked: number;
    importable?: number;
    selectedByDefault?: number;
    enabledInObsidian?: number;
    hotkeys?: number;
    hasEnabledList?: boolean;
    pluginsDirFound?: boolean;
    support?: Record<ObsidianImportSupportKind, number>;
  };
  migration?: {
    defaultSelectionPolicy: string;
    sourceVaultUnchanged: boolean;
    sourcePluginsPath?: string;
    writesTo: string;
    writesConfig: string;
    enableAfterImport: boolean;
  };
  plugins: ScannedPlugin[];
  skipped: SkippedPlugin[];
}

type ScanState = 'idle' | 'scanning' | 'done' | 'error';
type ImportState = 'idle' | 'importing' | 'done';

interface ImportResult {
  id: string;
  ok: boolean;
  copiedFiles?: string[];
  linterProfile?: ImportedObsidianLinterProfile;
  error?: string;
}

const LEVEL_CONFIG: Record<ObsidianImportSupportKind, {
  icon: LucideIcon;
  badgeClass: string;
  selectedClass: string;
  iconClass: string;
}> = {
  ready: {
    icon: CheckCircle2,
    badgeClass: 'border-success/25 bg-success/10 text-success',
    selectedClass: 'bg-success/10',
    iconClass: 'text-success',
  },
  limited: {
    icon: AlertTriangle,
    badgeClass: 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]',
    selectedClass: 'bg-[var(--amber-subtle)]',
    iconClass: 'text-[var(--amber)]',
  },
  review: {
    icon: AlertTriangle,
    badgeClass: 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]',
    selectedClass: 'bg-[var(--amber-subtle)]',
    iconClass: 'text-[var(--amber)]',
  },
  blocked: {
    icon: XCircle,
    badgeClass: 'border-error/25 bg-error/10 text-error',
    selectedClass: 'bg-error/10',
    iconClass: 'text-error',
  },
};

const SUPPORT_ORDER: ObsidianImportSupportKind[] = ['ready', 'limited', 'review', 'blocked'];

function supportFor(plugin: ScannedPlugin, hasEnabledList: boolean): ObsidianImportSupport {
  return plugin.support ?? getObsidianImportSupport(plugin, { hasEnabledList });
}

function surfaceLabel(surface: ObsidianCommunitySurfacePreview['id']): string {
  return {
    commands: 'Commands',
    settings: 'Settings',
    entries: 'Entries',
    views: 'Views',
    document: 'Documents',
    styles: 'Styles',
    editor: 'Editor',
    vault: 'Vault',
    network: 'Network',
    secret: 'Secrets',
  }[surface] ?? surface;
}

function surfaceStateClass(state: ObsidianCommunitySurfacePreviewState): string {
  if (state === 'mounted') return 'border-success/25 bg-success/10 text-success';
  if (state === 'limited') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (state === 'catalog') return 'border-border bg-muted text-muted-foreground';
  return 'border-error/25 bg-error/10 text-error';
}

function copiedFilesFor(plugin: ScannedPlugin): string[] {
  return plugin.migrationPlan?.copiedFiles ?? [
    'manifest.json',
    'main.js',
    ...(plugin.hasStyles ? ['styles.css'] : []),
    ...(plugin.hasData ? ['data.json'] : []),
    'obsidian-import.json',
  ];
}

function compactCoverageSummary(summary?: Record<ObsidianCapabilitySupport, number>): string | null {
  if (!summary) return null;
  const parts = [
    summary.full ? `${summary.full} full` : '',
    summary.limited ? `${summary.limited} limited` : '',
    summary['snapshot-only'] ? `${summary['snapshot-only']} snapshot` : '',
    summary['catalog-only'] ? `${summary['catalog-only']} catalog` : '',
    summary['request-only'] ? `${summary['request-only']} request` : '',
    summary.unsupported ? `${summary.unsupported} unsupported` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function workflowStatusLabel(status: ObsidianWorkflowOutcomeStatus): string {
  return {
    available: 'available',
    limited: 'limited',
    'preview-only': 'preview',
    'not-available': 'unavailable',
    'native-replacement': 'native',
  }[status];
}

function workflowStatusClass(status: ObsidianWorkflowOutcomeStatus): string {
  if (status === 'available') return 'text-success';
  if (status === 'not-available') return 'text-error';
  if (status === 'native-replacement') return 'text-[var(--amber-text)]';
  return 'text-muted-foreground';
}

function surfaceCatalogStatusLabel(status: ObsidianSurfaceCatalogStatus): string {
  return {
    ready: 'ready',
    limited: 'limited',
    'preview-only': 'preview',
    'catalog-only': 'catalog',
    'request-only': 'request',
    'native-gated': 'native',
    blocked: 'blocked',
  }[status];
}

function surfaceCatalogStatusClass(status: ObsidianSurfaceCatalogStatus): string {
  if (status === 'ready') return 'text-success';
  if (status === 'blocked') return 'text-error';
  if (status === 'native-gated') return 'text-[var(--amber-text)]';
  return 'text-muted-foreground';
}

function surfaceCatalogSummary(preview: ObsidianCompatibilityPreview): string | null {
  const entries = (preview.surfaceCatalog ?? [])
    .filter((entry) => entry.surface !== 'core')
    .slice(0, 4);
  if (entries.length === 0) return null;
  const hiddenCount = (preview.surfaceCatalog ?? []).filter((entry) => entry.surface !== 'core').length - entries.length;
  return [
    ...entries.map((entry) => `${entry.label} ${surfaceCatalogStatusLabel(entry.status)}`),
    hiddenCount > 0 ? `+${hiddenCount}` : '',
  ].filter(Boolean).join(' / ');
}

function settingsMappingSummary(preview: ObsidianCompatibilityPreview): string | null {
  const mapping = preview.settingsMappings.find((item) => item.id === 'obsidian-linter-profile' || item.mappedItems.length > 0)
    ?? preview.settingsMappings[0];
  if (!mapping) return null;
  const parts = [
    `${mapping.label}`,
    `${mapping.mappedItems.length} mapped`,
    mapping.ignoredItems.length > 0 ? `${mapping.ignoredItems.length} ignored` : '',
    mapping.warnings.length > 0 ? `${mapping.warnings.length} warning${mapping.warnings.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function ledgerSummary(preview: ObsidianCompatibilityPreview): string {
  const counts = preview.runtimeCapabilityLedger.reduce<Record<ObsidianRuntimeCapabilityLedgerPhase, number>>((summary, entry) => {
    summary[entry.phase] += 1;
    return summary;
  }, { predicted: 0, registered: 0, called: 0, blocked: 0 });
  return `${counts.predicted} predicted${counts.blocked > 0 ? ` / ${counts.blocked} blocked` : ''}`;
}

export function ObsidianImportSection({
  initialExpanded = false,
}: {
  initialExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [vaultPath, setVaultPath] = useState('');
  const [configDir, setConfigDir] = useState('.obsidian');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanError, setScanError] = useState('');
  const [report, setReport] = useState<CompatReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const scanSeqRef = useRef(0);

  const hasEnabledList = report?.summary.hasEnabledList
    ?? report?.plugins.some((plugin) => plugin.obsidianConfig?.hasEnabledList)
    ?? false;

  const supportCounts = useMemo(() => {
    if (!report) return { ready: 0, limited: 0, review: 0, blocked: 0 } satisfies Record<ObsidianImportSupportKind, number>;
    return report.summary.support ?? report.plugins.reduce<Record<ObsidianImportSupportKind, number>>((counts, plugin) => {
      counts[supportFor(plugin, hasEnabledList).kind] += 1;
      return counts;
    }, { ready: 0, limited: 0, review: 0, blocked: 0 });
  }, [hasEnabledList, report]);

  const selectedImportableCount = useMemo(() => {
    if (!report) return 0;
    return report.plugins.filter((plugin) => selected.has(plugin.id) && supportFor(plugin, hasEnabledList).importable).length;
  }, [hasEnabledList, report, selected]);

  const handleScan = useCallback(async () => {
    const trimmed = vaultPath.trim();
    if (!trimmed) return;

    const scanSeq = scanSeqRef.current + 1;
    scanSeqRef.current = scanSeq;
    setScanState('scanning');
    setScanError('');
    setReport(null);
    setSelected(new Set());
    setImportState('idle');
    setImportResults([]);
    try {
      const trimmedConfigDir = configDir.trim() || '.obsidian';
      const data = await apiFetch<CompatReport>(
        `/api/obsidian/compat-report?vaultRoot=${encodeURIComponent(trimmed)}&configDir=${encodeURIComponent(trimmedConfigDir)}`,
      );
      if (scanSeqRef.current !== scanSeq) return;
      const nextHasEnabledList = data.summary.hasEnabledList
        ?? data.plugins.some((plugin) => plugin.obsidianConfig?.hasEnabledList)
        ?? false;
      const defaultSelectedIds = new Set(data.plugins
        .filter((plugin) => supportFor(plugin, nextHasEnabledList).defaultSelected)
        .map((plugin) => plugin.id));
      setReport(data);
      setSelected(defaultSelectedIds);
      setScanState('done');
    } catch (err) {
      if (scanSeqRef.current !== scanSeq) return;
      setScanError(err instanceof Error ? err.message : 'Scan failed');
      setScanState('error');
    }
  }, [configDir, vaultPath]);

  const handleImport = useCallback(async () => {
    if (!report) return;
    const selectedImportableIds = report.plugins
      .filter((plugin) => selected.has(plugin.id) && supportFor(plugin, hasEnabledList).importable)
      .map((plugin) => plugin.id);
    if (selectedImportableIds.length === 0) return;
    setImportState('importing');
    const activeConfigDir = report.configDir ?? (configDir.trim() || '.obsidian');
    const results: ImportResult[] = [];
    for (const pluginId of selectedImportableIds) {
      try {
        const data = await apiFetch<{ imported?: { copiedFiles?: string[]; linterProfile?: ImportedObsidianLinterProfile } }>('/api/obsidian/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vaultRoot: report.vaultRoot, pluginId, configDir: activeConfigDir }),
        });
        if (data.imported?.linterProfile) {
          const currentProfile = readObsidianLinterProfilePreference();
          const enabledRules = { ...currentProfile.enabledRules };
          for (const ruleId of data.imported.linterProfile.mappedRules) {
            enabledRules[ruleId] = data.imported.linterProfile.profile.enabledRules[ruleId];
          }
          saveObsidianLinterProfilePreference({
            ...currentProfile,
            enabledRules,
          });
        }
        results.push({
          id: pluginId,
          ok: true,
          copiedFiles: data.imported?.copiedFiles,
          linterProfile: data.imported?.linterProfile,
        });
      } catch (err) {
        results.push({ id: pluginId, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }
    setImportResults(results);
    setImportState('done');
    if (results.some((result) => result.ok)) {
      notifyObsidianPluginPackagesChanged();
    }
  }, [configDir, hasEnabledList, report, selected]);

  const togglePlugin = (id: string) => {
    if (importState === 'importing') return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalImportable = report?.summary.importable ?? report?.plugins.filter((plugin) => supportFor(plugin, hasEnabledList).importable).length ?? 0;
  const enabledInObsidian = report?.summary.enabledInObsidian ?? report?.plugins.filter((plugin) => plugin.obsidianConfig?.enabledInObsidian).length ?? 0;
  const hotkeyCount = report?.summary.hotkeys ?? report?.plugins.reduce((sum, plugin) => sum + (plugin.obsidianConfig?.hotkeyCount ?? 0), 0) ?? 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FolderOpen size={16} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-foreground">Import from Obsidian</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Scan a local vault, review compatibility, then copy selected plugin packages into MindOS.
          </p>
        </div>
        {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 pb-4">
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_auto]">
            <div className="min-w-0">
              <label className="sr-only" htmlFor="obsidian-vault-path">Obsidian vault path</label>
              <input
                id="obsidian-vault-path"
                type="text"
                aria-label="Obsidian vault path"
                value={vaultPath}
                onChange={e => setVaultPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleScan(); }}
                placeholder="~/obsidian-vault"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="min-w-0">
              <label className="sr-only" htmlFor="obsidian-config-folder">Obsidian config folder</label>
              <input
                id="obsidian-config-folder"
                type="text"
                aria-label="Obsidian config folder"
                value={configDir}
                onChange={e => setConfigDir(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleScan(); }}
                placeholder=".obsidian"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              onClick={() => void handleScan()}
              disabled={!vaultPath.trim() || scanState === 'scanning'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--amber)] bg-[var(--amber)] px-3 py-2 text-sm font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {scanState === 'scanning' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              <span>Scan</span>
            </button>
          </div>

          {scanState === 'error' && (
            <div className="flex items-center gap-2 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-xs text-error">
              <XCircle size={13} className="shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          {scanState === 'scanning' && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              <span>Scanning plugins...</span>
            </div>
          )}

          {scanState === 'done' && report && (
            <div className="space-y-3">
              <section className="rounded-lg border border-border bg-card/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={14} className="text-[var(--amber)]" />
                      <h4 className="text-sm font-semibold text-foreground">Migration report</h4>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {report.migration?.defaultSelectionPolicy
                        ?? 'Ready and limited plugins are selected by default. Review and blocked plugins stay unchecked.'}
                    </p>
                  </div>
                  <span className="rounded-md border border-border bg-background px-2 py-1 font-mono text-2xs text-muted-foreground">
                    source unchanged
                  </span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Plugins found', value: report.summary.total },
                    { label: 'Selected now', value: selectedImportableCount },
                    { label: 'Enabled in source', value: enabledInObsidian },
                    { label: 'Hotkeys found', value: hotkeyCount },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-border/70 bg-background px-3 py-2">
                      <div className="text-2xs uppercase text-muted-foreground">{item.label}</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {SUPPORT_ORDER.map((kind) => {
                    const config = LEVEL_CONFIG[kind];
                    return (
                      <span key={kind} className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${config.badgeClass}`}>
                        {kind} {supportCounts[kind]}
                      </span>
                    );
                  })}
                  {report.skipped.length > 0 && (
                    <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                      skipped {report.skipped.length}
                    </span>
                  )}
                </div>

                <div className="mt-3 grid gap-2 text-2xs text-muted-foreground sm:grid-cols-3">
                  <div className="rounded-md border border-border/70 bg-background px-2.5 py-2">
                    Read packages from <span className="font-mono text-foreground">{report.sourcePluginsPath ?? report.migration?.sourcePluginsPath ?? `${((report.configDir ?? configDir) || '.obsidian')}/plugins`}</span>.
                  </div>
                  <div className="rounded-md border border-border/70 bg-background px-2.5 py-2">
                    Copy package files into <span className="font-mono text-foreground">{report.migration?.writesTo ?? '.mindos/plugins/<plugin-id>'}</span>.
                  </div>
                  <div className="rounded-md border border-border/70 bg-background px-2.5 py-2">
                    Write <span className="font-mono text-foreground">{report.migration?.writesConfig ?? 'obsidian-import.json'}</span>; imported plugins stay disabled until enabled from Installed.
                  </div>
                </div>
              </section>

              {report.summary.pluginsDirFound === false && (
                <div className="rounded-lg border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-3 py-2 text-xs text-[var(--amber-text)]">
                  No <span className="font-mono">{report.sourcePluginsPath ?? `${((report.configDir ?? configDir) || '.obsidian')}/plugins`}</span> directory was found at this path. Check the vault path or config folder and scan again.
                </div>
              )}

              {report.skipped.length > 0 && (
                <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <AlertTriangle size={13} className="text-[var(--amber)]" />
                    Skipped plugin folders
                  </div>
                  <div className="mt-2 space-y-1">
                    {report.skipped.slice(0, 4).map((item) => (
                      <div key={item.dirName} className="flex items-start gap-2 text-2xs text-muted-foreground">
                        <span className="shrink-0 font-mono text-foreground">{item.dirName}</span>
                        <span className="min-w-0 truncate">{item.reason}</span>
                      </div>
                    ))}
                    {report.skipped.length > 4 && (
                      <div className="text-2xs text-muted-foreground">
                        {report.skipped.length - 4} more skipped folders are hidden.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {report.plugins.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No plugins found in this vault.</p>
              ) : (
                <div className="flex max-h-[460px] flex-col gap-2 overflow-y-auto">
                  {report.plugins.map(plugin => {
                    const support = supportFor(plugin, hasEnabledList);
                    const level = LEVEL_CONFIG[support.kind];
                    const Icon = level.icon;
                    const canSelect = plugin.importable ?? support.importable;
                    const isSelected = selected.has(plugin.id);
                    const coverage = compactCoverageSummary(plugin.coverageSummary);
                    const preview = plugin.compatibilityPreview;
                    const surfaceEntries = (preview?.surfaceCatalog ?? []).filter((entry) => entry.surface !== 'core').slice(0, 4);
                    const hiddenSurfaceCount = (preview?.surfaceCatalog ?? []).filter((entry) => entry.surface !== 'core').length - surfaceEntries.length;
                    const surfaceSummary = preview ? surfaceCatalogSummary(preview) : null;
                    const mappingSummary = preview ? settingsMappingSummary(preview) : null;
                    const primaryWorkflow = preview?.workflowOutcomes[0];
                    return (
                      <label
                        key={plugin.id}
                        className={`flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2.5 transition-colors ${
                          canSelect ? 'cursor-pointer hover:bg-muted/45' : 'opacity-65'
                        } ${isSelected ? level.selectedClass : 'bg-card/45'}`}
                      >
                        {canSelect ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={importState === 'importing'}
                            onChange={() => togglePlugin(plugin.id)}
                            className="form-check mt-0.5"
                          />
                        ) : (
                          <Icon size={14} className={`mt-0.5 shrink-0 ${level.iconClass}`} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{plugin.manifest.name}</span>
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-2xs ${level.badgeClass}`}>
                              <Icon size={10} />
                              {support.label}
                            </span>
                            {plugin.obsidianConfig?.enabledInObsidian && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                                source enabled
                              </span>
                            )}
                            {(plugin.obsidianConfig?.hotkeyCount ?? 0) > 0 && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                                {plugin.obsidianConfig?.hotkeyCount} hotkey{plugin.obsidianConfig?.hotkeyCount === 1 ? '' : 's'}
                              </span>
                            )}
                            <span className="font-mono text-2xs text-muted-foreground/60">{plugin.manifest.version}</span>
                          </div>
                          {plugin.manifest.description && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{plugin.manifest.description}</p>
                          )}
                          <p className={`mt-1 text-2xs ${support.kind === 'blocked' ? 'text-error' : 'text-muted-foreground'}`}>
                            {support.reason}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(plugin.surfacePreview ?? []).slice(0, 6).map((surface) => (
                              <span
                                key={surface.id}
                                className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${surfaceStateClass(surface.state)}`}
                              >
                                {surfaceLabel(surface.id)}:{surface.state}
                              </span>
                            ))}
                            {coverage && (
                              <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                                {coverage}
                              </span>
                            )}
                          </div>
                          {preview && (
                            <div className="mt-2 space-y-1.5 border-l border-border/70 pl-2.5 text-2xs text-muted-foreground">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="font-medium text-foreground">Path</span>
                                <span className="min-w-0 break-all font-mono text-foreground">{preview.packagePath.sourcePath}</span>
                                <ArrowRight size={10} className="shrink-0 text-muted-foreground/70" />
                                <span className="min-w-0 break-all font-mono text-foreground">{preview.packagePath.targetPath}</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {surfaceSummary && (
                                  <span className="rounded border border-border bg-background px-1.5 py-0.5">
                                    Surfaces: {surfaceEntries.map((entry, index) => (
                                      <span key={entry.surface}>
                                        {index > 0 ? ' / ' : ''}
                                        {entry.label} <span className={surfaceCatalogStatusClass(entry.status)}>{surfaceCatalogStatusLabel(entry.status)}</span>
                                      </span>
                                    ))}
                                    {hiddenSurfaceCount > 0 && (
                                      <span> / +{hiddenSurfaceCount}</span>
                                    )}
                                  </span>
                                )}
                                {mappingSummary && (
                                  <span className="rounded border border-border bg-background px-1.5 py-0.5">
                                    Settings: {mappingSummary}
                                  </span>
                                )}
                                {primaryWorkflow && (
                                  <span className="rounded border border-border bg-background px-1.5 py-0.5">
                                    Workflow: {primaryWorkflow.label} <span className={workflowStatusClass(primaryWorkflow.status)}>{workflowStatusLabel(primaryWorkflow.status)}</span>
                                  </span>
                                )}
                                <span className="rounded border border-border bg-background px-1.5 py-0.5">
                                  Ledger: {ledgerSummary(preview)}
                                </span>
                              </div>
                              {preview.blockedReasons.length > 0 && (
                                <div className="text-error">
                                  Blocked: {preview.blockedReasons[0]}
                                </div>
                              )}
                              {preview.nextSteps[0] && (
                                <div>
                                  Next: {preview.nextSteps[0]}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                            <ListChecks size={11} />
                            <span>Copy {copiedFilesFor(plugin).join(', ')}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {totalImportable > 0 && importState !== 'done' && (
                <button
                  onClick={() => void handleImport()}
                  disabled={selectedImportableCount === 0 || importState === 'importing'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--amber)] bg-[var(--amber)] px-4 py-2 text-sm font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {importState === 'importing' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>{importState === 'importing' ? 'Importing...' : `Import ${selectedImportableCount} plugin${selectedImportableCount !== 1 ? 's' : ''}`}</span>
                </button>
              )}

              {importState === 'done' && importResults.length > 0 && (
                <div className="rounded-lg border border-border bg-card/60 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-success" />
                      <span className="text-sm font-medium text-foreground">
                        {importResults.filter(r => r.ok).length} imported, {importResults.filter(r => !r.ok).length} failed
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href="/settings?tab=plugins"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Manage installed
                        <ArrowRight size={11} />
                      </a>
                      <a
                        href="/settings?tab=plugins&panel=surfaces"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open surfaces
                        <ArrowRight size={11} />
                      </a>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {importResults.map(result => (
                      <div key={result.id} className="flex items-start gap-2 text-xs">
                        {result.ok ? (
                          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
                        ) : (
                          <XCircle size={13} className="mt-0.5 shrink-0 text-error" />
                        )}
                        <span className={result.ok ? 'text-muted-foreground' : 'text-error'}>
                          <span className="font-medium text-foreground">{result.id}</span>
                          {result.ok
                            ? ` copied ${result.copiedFiles?.join(', ') ?? 'plugin files'}${result.linterProfile ? `; applied Linter profile (${result.linterProfile.mappedRules.length} rules)` : ''}`
                            : ` failed: ${result.error}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
