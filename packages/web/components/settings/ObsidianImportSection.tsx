'use client';

import { useState, useCallback } from 'react';
import { Download, Search, CheckCircle2, AlertTriangle, XCircle, Loader2, FolderOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { getObsidianImportSupport, isObsidianPluginImportable } from '@/lib/obsidian-compat/import-policy';
import { notifyObsidianPluginPackagesChanged } from '@/lib/plugins/events';

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
  obsidianConfig?: {
    enabledInObsidian: boolean;
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
  summary: { total: number; compatible: number; partial: number; blocked: number; importable?: number };
  plugins: ScannedPlugin[];
  skipped: SkippedPlugin[];
}

type ScanState = 'idle' | 'scanning' | 'done' | 'error';
type ImportState = 'idle' | 'importing' | 'done';

const LEVEL_CONFIG = {
  ready: { icon: CheckCircle2, color: 'var(--success)', bg: 'rgba(90,141,96,0.1)' },
  limited: { icon: AlertTriangle, color: 'var(--amber)', bg: 'var(--amber-subtle)' },
  review: { icon: AlertTriangle, color: 'var(--amber)', bg: 'var(--amber-subtle)' },
  blocked: { icon: XCircle, color: 'var(--error)', label: 'Blocked', bg: 'rgba(200,80,80,0.08)' },
} as const;

export function ObsidianImportSection({
  initialExpanded = false,
}: {
  initialExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [vaultPath, setVaultPath] = useState('');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanError, setScanError] = useState('');
  const [report, setReport] = useState<CompatReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importResults, setImportResults] = useState<{ id: string; ok: boolean; error?: string }[]>([]);

  const handleScan = useCallback(async () => {
    const trimmed = vaultPath.trim();
    if (!trimmed) return;
    setScanState('scanning');
    setScanError('');
    setReport(null);
    setSelected(new Set());
    setImportState('idle');
    setImportResults([]);
    try {
      const data = await apiFetch<CompatReport>(`/api/obsidian/compat-report?vaultRoot=${encodeURIComponent(trimmed)}`);
      setReport(data);
      // Prefer the source vault's enabled list when available; otherwise choose plugins that can run through known MindOS hosts.
      const hasEnabledList = data.plugins.some(p => p.obsidianConfig?.enabledInObsidian);
      const defaultSelectedIds = new Set(data.plugins
        .filter(p => getObsidianImportSupport(p, { hasEnabledList }).defaultSelected)
        .map(p => p.id));
      setSelected(defaultSelectedIds);
      setScanState('done');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
      setScanState('error');
    }
  }, [vaultPath]);

  const handleImport = useCallback(async () => {
    if (!report || selected.size === 0) return;
    setImportState('importing');
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const pluginId of selected) {
      try {
        await apiFetch('/api/obsidian/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vaultRoot: report.vaultRoot, pluginId }),
        });
        results.push({ id: pluginId, ok: true });
      } catch (err) {
        results.push({ id: pluginId, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }
    setImportResults(results);
    setImportState('done');
    if (results.some((result) => result.ok)) {
      notifyObsidianPluginPackagesChanged();
    }
  }, [report, selected]);

  const togglePlugin = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <FolderOpen size={16} className="text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">Import from Obsidian</span>
          <p className="text-xs text-muted-foreground mt-0.5">Scan an Obsidian vault and import ready or limited plugins</p>
        </div>
        {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border">
          {/* Vault path input */}
          <div className="flex gap-2 mt-3">
            <input
              type="text"
              value={vaultPath}
              onChange={e => setVaultPath(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
              placeholder="~/obsidian-vault"
              className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              onClick={handleScan}
              disabled={!vaultPath.trim() || scanState === 'scanning'}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
            >
              {scanState === 'scanning' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              <span>Scan</span>
            </button>
          </div>

          {/* Scan error */}
          {scanState === 'error' && (
            <div className="flex items-center gap-2 text-xs text-[var(--error)] bg-[rgba(200,80,80,0.08)] rounded-lg px-3 py-2">
              <XCircle size={13} className="shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          {/* Scanning indicator */}
          {scanState === 'scanning' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
              <Loader2 size={14} className="animate-spin" />
              <span>Scanning plugins...</span>
            </div>
          )}

          {/* Results */}
          {scanState === 'done' && report && (
            <div className="space-y-3">
              {/* Summary bar */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{report.summary.total} plugins found</span>
                <span className="text-[var(--success)]">{report.summary.compatible} ready</span>
                {report.summary.partial > 0 && <span className="text-[var(--amber)]">{report.summary.partial} limited/review</span>}
                {report.summary.blocked > 0 && <span className="text-[var(--error)]">{report.summary.blocked} blocked</span>}
                {(report.summary.importable ?? report.plugins.filter(isObsidianPluginImportable).length) > 0 && (
                  <span>{report.summary.importable ?? report.plugins.filter(isObsidianPluginImportable).length} importable</span>
                )}
                {report.plugins.some(plugin => plugin.obsidianConfig?.enabledInObsidian) && (
                  <span>{report.plugins.filter(plugin => plugin.obsidianConfig?.enabledInObsidian).length} enabled in Obsidian</span>
                )}
                {report.plugins.some(plugin => (plugin.obsidianConfig?.hotkeyCount ?? 0) > 0) && (
                  <span>{report.plugins.reduce((sum, plugin) => sum + (plugin.obsidianConfig?.hotkeyCount ?? 0), 0)} hotkeys</span>
                )}
                {report.skipped.length > 0 && <span>{report.skipped.length} skipped</span>}
              </div>

              {/* Plugin list */}
              {report.plugins.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No plugins found in this vault</p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
                  {report.plugins.map(plugin => {
                    const support = getObsidianImportSupport(plugin);
                    const level = LEVEL_CONFIG[support.kind];
                    const Icon = level.icon;
                    const canSelect = plugin.importable ?? support.importable;
                    const isSelected = selected.has(plugin.id);
                    return (
                      <label
                        key={plugin.id}
                        className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${canSelect ? 'cursor-pointer hover:bg-muted/50' : 'opacity-60'}`}
                        style={{ background: isSelected ? level.bg : undefined }}
                      >
                        {canSelect && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => togglePlugin(plugin.id)}
                            className="form-check mt-0.5"
                          />
                        )}
                        {!canSelect && <Icon size={14} className="mt-0.5 shrink-0" style={{ color: level.color }} />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">{plugin.manifest.name}</span>
                            <span className="text-2xs px-1.5 py-0.5 rounded font-mono shrink-0" style={{ background: level.bg, color: level.color }}>
                              {support.label}
                            </span>
                            {plugin.obsidianConfig?.enabledInObsidian && (
                              <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                                Enabled
                              </span>
                            )}
                            {(plugin.obsidianConfig?.hotkeyCount ?? 0) > 0 && (
                              <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                                {plugin.obsidianConfig?.hotkeyCount} hotkey{plugin.obsidianConfig?.hotkeyCount === 1 ? '' : 's'}
                              </span>
                            )}
                            <span className="text-2xs text-muted-foreground/50 font-mono">{plugin.manifest.version}</span>
                          </div>
                          {plugin.manifest.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{plugin.manifest.description}</p>
                          )}
                          {plugin.compatibilityLevel === 'partial' && plugin.compatibility.partialApis.length > 0 && (
                            <p className="text-2xs text-[var(--amber)] mt-1">
                              {support.reason}
                            </p>
                          )}
                          {plugin.compatibilityLevel === 'partial' && plugin.compatibility.partialApis.length === 0 && (plugin.compatibility.unsupportedApis?.length ?? 0) > 0 && (
                            <p className="text-2xs text-[var(--amber)] mt-1">
                              {support.reason}
                            </p>
                          )}
                          {plugin.compatibilityLevel === 'blocked' && plugin.compatibility.blockers.length > 0 && (
                            <p className="text-2xs text-[var(--error)] mt-1">
                              {plugin.compatibility.blockers[0]}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Import button */}
              {(report.summary.importable ?? report.plugins.filter(isObsidianPluginImportable).length) > 0 && importState !== 'done' && (
                <button
                  onClick={handleImport}
                  disabled={selected.size === 0 || importState === 'importing'}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
                >
                  {importState === 'importing' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>{importState === 'importing' ? 'Importing...' : `Import ${selected.size} plugin${selected.size !== 1 ? 's' : ''}`}</span>
                </button>
              )}

              {/* Import results */}
              {importState === 'done' && importResults.length > 0 && (
                <div className="space-y-1.5">
                  {importResults.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      {r.ok ? (
                        <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
                      ) : (
                        <XCircle size={13} style={{ color: 'var(--error)' }} />
                      )}
                      <span className={r.ok ? 'text-foreground' : 'text-[var(--error)]'}>
                        {r.id}{r.error ? ` — ${r.error}` : ''}
                      </span>
                    </div>
                  ))}
                  <p className="text-xs text-[var(--success)] font-medium mt-2">
                    {importResults.filter(r => r.ok).length} plugin{importResults.filter(r => r.ok).length !== 1 ? 's' : ''} imported successfully
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
