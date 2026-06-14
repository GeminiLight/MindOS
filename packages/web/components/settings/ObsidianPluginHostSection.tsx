'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { encodePath } from '@/lib/utils';
import { getObsidianImportSupport, type ObsidianImportSupportKind } from '@/lib/obsidian-compat/import-policy';
import {
  choosePluginMenuItem,
  choosePluginModalSuggestion,
  firstPluginActionMenuSnapshot,
  firstPluginActionModalSnapshot,
  firstPluginActionTargetPath,
  toastPluginActionNotices,
  type PluginActionResult,
  type PluginMenuSnapshot,
  type PluginModalSnapshot,
  type PluginModalSuggestionChoice,
} from '@/lib/plugins/client';
import {
  notifyPluginsChanged,
  OBSIDIAN_PLUGIN_PACKAGES_CHANGED_EVENT,
} from '@/lib/plugins/events';
import { openTab } from '@/lib/workspace-tabs';
import { notifyFilesChanged } from '@/lib/files-changed';
import { Input, Select, Toggle } from './Primitives';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import PluginActionMenuDialog from '@/components/plugins/PluginActionMenuDialog';
import PluginActionModalDialog from '@/components/plugins/PluginActionModalDialog';
import {
  compatibilityNote,
  isLoadResult,
  isPluginActionResult,
  runtimeSummary,
  surfaceRouting,
  type ObsidianPluginLoadResult,
  type ObsidianPluginSettings,
  type ObsidianPluginSettingsResponse,
  type ObsidianPluginStatus,
  type ObsidianPluginsResponse,
  type ObsidianSettingItem,
  type PluginLifecycleAction,
  type SettingAction,
  type SurfaceRoute,
  type SurfaceRouteState,
  type SurfaceRouteTarget,
} from './ObsidianPluginHostModel';

interface ObsidianPluginHostSectionProps {
  onOpenPluginEntries?: () => void;
  onOpenCommandCenter?: () => void;
  onOpenPluginViews?: () => void;
  focusPluginId?: string | null;
  onFocusedPlugin?: (pluginId: string) => void;
}

const SUPPORT_META: Record<ObsidianImportSupportKind, { icon: typeof CheckCircle2; tone: string; bg: string }> = {
  ready: {
    icon: CheckCircle2,
    tone: 'var(--success)',
    bg: 'color-mix(in srgb, var(--success) 12%, transparent)',
  },
  limited: {
    icon: AlertTriangle,
    tone: 'var(--amber)',
    bg: 'var(--amber-subtle)',
  },
  review: {
    icon: AlertTriangle,
    tone: 'var(--amber)',
    bg: 'var(--amber-subtle)',
  },
  blocked: {
    icon: CircleSlash,
    tone: 'var(--error)',
    bg: 'color-mix(in srgb, var(--error) 12%, transparent)',
  },
};

function surfaceRouteStateLabel(state: SurfaceRouteState): string {
  if (state === 'mounted') return 'Mounted';
  if (state === 'catalog') return 'Catalog';
  return 'Recorded';
}

function surfaceRouteStateClass(state: SurfaceRouteState): string {
  if (state === 'mounted') {
    return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  }
  if (state === 'catalog') {
    return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  }
  return 'border-border bg-muted/60 text-muted-foreground';
}

function SurfaceRouteCard({
  route,
  onOpenRoute,
}: {
  route: SurfaceRoute;
  onOpenRoute: (target: SurfaceRouteTarget) => void;
}) {
  const Icon = route.icon;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
          <Icon size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground">{route.label}</span>
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs ${surfaceRouteStateClass(route.state)}`}>
              {surfaceRouteStateLabel(route.state)}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{route.value}</p>
        </div>
      </div>
      {route.target && (
        <button
          type="button"
          onClick={() => onOpenRoute(route.target!)}
          className="ml-8 inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink size={11} />
          {route.actionLabel ?? 'Open'}
        </button>
      )}
    </div>
  );
}

function settingValueAsString(value: unknown): string {
  return value == null ? '' : String(value);
}

function notifyPluginSurfacesChanged() {
  notifyPluginsChanged();
}

function SettingControl({
  item,
  busy,
  onAction,
}: {
  item: ObsidianSettingItem;
  busy: boolean;
  onAction: (action: SettingAction, value?: unknown) => void;
}) {
  const [draft, setDraft] = useState(settingValueAsString(item.value));

  useEffect(() => {
    setDraft(settingValueAsString(item.value));
  }, [item.value]);

  if (item.kind === 'toggle') {
    return (
      <Toggle
        size="sm"
        checked={item.value === true}
        disabled={!item.canChange || item.disabled || busy}
        title={item.value === true ? 'Disable setting' : 'Enable setting'}
        onChange={(next) => onAction('set-value', next)}
      />
    );
  }

  if (item.kind === 'dropdown') {
    return (
      <Select
        size="sm"
        value={settingValueAsString(item.value)}
        disabled={!item.canChange || item.disabled || busy}
        onChange={(event) => onAction('set-value', event.target.value)}
        className="min-w-32"
      >
        {(item.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    );
  }

  if (item.kind === 'button') {
    return (
      <button
        type="button"
        disabled={!item.canClick || item.disabled || busy}
        onClick={() => onAction('click-button')}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          item.cta
            ? 'bg-[var(--amber)] text-[var(--amber-foreground)]'
            : 'border border-border bg-background text-foreground hover:bg-muted/60'
        }`}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
        {item.buttonText ?? 'Run'}
      </button>
    );
  }

  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAction('set-value', draft);
      }}
    >
      <Input
        value={draft}
        disabled={!item.canChange || item.disabled || busy}
        placeholder={item.placeholder}
        onChange={(event) => setDraft(event.target.value)}
        className="h-8 min-w-32 py-1.5 text-xs"
      />
      <button
        type="submit"
        disabled={!item.canChange || item.disabled || busy || draft === settingValueAsString(item.value)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
        Apply
      </button>
    </form>
  );
}

export function ObsidianPluginHostSection({
  onOpenPluginEntries,
  onOpenCommandCenter,
  onOpenPluginViews,
  focusPluginId = null,
  onFocusedPlugin,
}: ObsidianPluginHostSectionProps = {}) {
  const [plugins, setPlugins] = useState<ObsidianPluginStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<ObsidianPluginLoadResult | null>(null);
  const [settingsByPlugin, setSettingsByPlugin] = useState<Record<string, ObsidianPluginSettings>>({});
  const [settingsBusyKey, setSettingsBusyKey] = useState<string | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [pluginModal, setPluginModal] = useState<PluginModalSnapshot | null>(null);
  const [pluginMenu, setPluginMenu] = useState<PluginMenuSnapshot | null>(null);
  const [choosingSuggestionIndex, setChoosingSuggestionIndex] = useState<number | null>(null);
  const [modalChoiceError, setModalChoiceError] = useState<string | null>(null);
  const [choosingMenuItemIndex, setChoosingMenuItemIndex] = useState<number | null>(null);
  const [menuChoiceError, setMenuChoiceError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ObsidianPluginStatus | null>(null);
  const [highlightedPluginId, setHighlightedPluginId] = useState<string | null>(null);
  const pluginRowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const router = useRouter();

  const counts = useMemo(() => ({
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    loaded: plugins.filter((plugin) => plugin.loaded).length,
    blocked: plugins.filter((plugin) => plugin.compatibilityLevel === 'blocked').length,
  }), [plugins]);

  const refresh = useCallback(async (loadEnabled = false) => {
    setLoading(true);
    setError('');
    try {
      const url = loadEnabled ? '/api/obsidian-plugins?loadEnabled=1' : '/api/obsidian-plugins';
      const data = await apiFetch<ObsidianPluginsResponse>(url, { cache: 'no-store' });
      setPlugins(data.plugins ?? []);
      setLastResult(isLoadResult(data.result) ? data.result : null);
      notifyPluginSurfacesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Obsidian plugins.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    const refreshPackages = () => {
      void refresh(false);
    };
    window.addEventListener(OBSIDIAN_PLUGIN_PACKAGES_CHANGED_EVENT, refreshPackages);
    return () => window.removeEventListener(OBSIDIAN_PLUGIN_PACKAGES_CHANGED_EVENT, refreshPackages);
  }, [refresh]);

  useEffect(() => {
    if (!focusPluginId || loading) return;

    const hasPlugin = plugins.some((plugin) => plugin.id === focusPluginId);
    if (!hasPlugin) {
      onFocusedPlugin?.(focusPluginId);
      return;
    }

    setExpanded((prev) => {
      if (prev.has(focusPluginId)) return prev;
      const next = new Set(prev);
      next.add(focusPluginId);
      return next;
    });
    setHighlightedPluginId(focusPluginId);

    const scrollFocusedRow = () => {
      pluginRowsRef.current[focusPluginId]?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    };

    scrollFocusedRow();
    onFocusedPlugin?.(focusPluginId);
  }, [focusPluginId, loading, onFocusedPlugin, plugins]);

  const handlePluginActionResult = useCallback((result: PluginActionResult) => {
    toastPluginActionNotices(result);
    const targetPath = firstPluginActionTargetPath(result);
    if (targetPath) {
      openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
      router.push(`/view/${encodePath(targetPath)}`);
      setPluginModal(null);
      setPluginMenu(null);
      return;
    }
    if (result.editorUpdates?.some((update) => update.changed)) {
      notifyFilesChanged(
        result.editorUpdates.flatMap((update) => update.changed && update.sourcePath ? [update.sourcePath] : []),
      );
      router.refresh();
      setPluginModal(null);
      setPluginMenu(null);
      return;
    }

    const modal = firstPluginActionModalSnapshot(result);
    if (modal) {
      setPluginModal(modal);
      setPluginMenu(null);
      return;
    }

    const menu = firstPluginActionMenuSnapshot(result);
    if (menu) {
      setPluginMenu(menu);
      setPluginModal(null);
    }
  }, [router]);

  const chooseModalSuggestion = useCallback(async (modal: PluginModalSnapshot, suggestion: PluginModalSuggestionChoice) => {
    setChoosingSuggestionIndex(suggestion.index);
    setModalChoiceError(null);
    try {
      if (!modal.interactionId) {
        throw new Error('Plugin modal interaction expired. Run the command again.');
      }
      const result = await choosePluginModalSuggestion(modal.id, suggestion.index, modal.interactionId);
      handlePluginActionResult(result);
    } catch (error) {
      setModalChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin suggestion');
    } finally {
      setChoosingSuggestionIndex(null);
    }
  }, [handlePluginActionResult]);

  const chooseMenuItem = useCallback(async (menu: PluginMenuSnapshot, item: PluginMenuSnapshot['items'][number]) => {
    setChoosingMenuItemIndex(item.index);
    setMenuChoiceError(null);
    try {
      if (!menu.interactionId) {
        throw new Error('Plugin menu interaction expired. Run the command again.');
      }
      const result = await choosePluginMenuItem(menu.id, item.index, menu.interactionId);
      handlePluginActionResult(result);
    } catch (error) {
      setMenuChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin menu item');
    } finally {
      setChoosingMenuItemIndex(null);
    }
  }, [handlePluginActionResult]);

  const runAction = useCallback(async (action: PluginLifecycleAction, options: { pluginId?: string; commandId?: string } = {}) => {
    const key = `${action}:${options.pluginId ?? options.commandId ?? 'all'}`;
    setBusyKey(key);
    setError('');
    try {
      const data = await apiFetch<ObsidianPluginsResponse>('/api/obsidian-plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...options }),
      });
      setPlugins(data.plugins ?? []);
      if (action === 'execute-command') {
        if (isPluginActionResult(data.result)) {
          handlePluginActionResult(data.result);
        }
      } else {
        setLastResult(isLoadResult(data.result) ? data.result : null);
      }
      notifyPluginSurfacesChanged();
      if ((action === 'disable' || action === 'uninstall') && options.pluginId) {
        setSettingsByPlugin((prev) => {
          const next = { ...prev };
          delete next[options.pluginId!];
          return next;
        });
      }
      if (action === 'uninstall' && options.pluginId) {
        const pluginId = options.pluginId;
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(pluginId);
          return next;
        });
        setSettingsErrors((prev) => {
          const next = { ...prev };
          delete next[pluginId];
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyKey(null);
    }
  }, [handlePluginActionResult]);

  const confirmRemovePlugin = useCallback(async () => {
    if (!removeTarget) return;
    const pluginId = removeTarget.id;
    setRemoveTarget(null);
    await runAction('uninstall', { pluginId });
  }, [removeTarget, runAction]);

  const applySettingsResponse = useCallback((data: ObsidianPluginSettingsResponse) => {
    if (data.status) {
      setPlugins(data.status);
    }
    setLastResult(data.loadResult ?? null);
    notifyPluginSurfacesChanged();
    setSettingsByPlugin((prev) => {
      const next = { ...prev };
      for (const pluginSettings of data.plugins ?? []) {
        next[pluginSettings.id] = pluginSettings;
      }
      return next;
    });
  }, []);

  const loadSettings = useCallback(async (pluginId: string) => {
    const key = `settings:${pluginId}`;
    setSettingsBusyKey(key);
    setSettingsErrors((prev) => ({ ...prev, [pluginId]: '' }));
    try {
      const data = await apiFetch<ObsidianPluginSettingsResponse>('/api/obsidian-plugins/settings', { cache: 'no-store' });
      applySettingsResponse(data);
      if (!data.plugins.some((plugin) => plugin.id === pluginId)) {
        setSettingsErrors((prev) => ({ ...prev, [pluginId]: 'No setting tab registered for this plugin.' }));
      }
    } catch (err) {
      setSettingsErrors((prev) => ({ ...prev, [pluginId]: err instanceof Error ? err.message : 'Failed to load plugin settings.' }));
    } finally {
      setSettingsBusyKey(null);
    }
  }, [applySettingsResponse]);

  const runSettingAction = useCallback(async (
    pluginId: string,
    tabIndex: number,
    itemIndex: number,
    action: SettingAction,
    value?: unknown,
  ) => {
    const key = `settings:${pluginId}:${tabIndex}:${itemIndex}`;
    setSettingsBusyKey(key);
    setSettingsErrors((prev) => ({ ...prev, [pluginId]: '' }));
    try {
      const data = await apiFetch<ObsidianPluginSettingsResponse>('/api/obsidian-plugins/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId, tabIndex, itemIndex, action, value }),
      });
      applySettingsResponse(data);
    } catch (err) {
      setSettingsErrors((prev) => ({ ...prev, [pluginId]: err instanceof Error ? err.message : 'Failed to update plugin settings.' }));
    } finally {
      setSettingsBusyKey(null);
    }
  }, [applySettingsResponse]);

  const toggleExpanded = (pluginId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pluginId)) next.delete(pluginId);
      else next.add(pluginId);
      return next;
    });
  };

  const openRoute = useCallback((target: SurfaceRouteTarget) => {
    if (target === 'command-center') {
      onOpenCommandCenter?.();
      return;
    }
    if (target === 'plugin-views') {
      onOpenPluginViews?.();
      return;
    }
    onOpenPluginEntries?.();
  }, [onOpenCommandCenter, onOpenPluginEntries, onOpenPluginViews]);

  return (
    <>
      <section className="rounded-xl border border-border bg-card/65 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border/70">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--amber-subtle)] flex items-center justify-center shrink-0">
            <Terminal size={15} className="text-[var(--amber)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Obsidian plugin host</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enable imported lightweight plugins, load their commands, and inspect compatibility limits.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refresh(false)}
            disabled={loading || busyKey !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => runAction('load-enabled')}
            disabled={loading || busyKey !== null || counts.enabled === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-1.5 text-xs font-medium text-[var(--amber-foreground)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busyKey === 'load-enabled:all' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Load enabled
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex flex-wrap gap-2 text-2xs text-muted-foreground">
          <span className="rounded bg-muted/60 px-2 py-1 font-mono">{counts.total} imported</span>
          <span className="rounded bg-muted/60 px-2 py-1 font-mono">{counts.enabled} enabled</span>
          <span className="rounded bg-muted/60 px-2 py-1 font-mono">{counts.loaded} loaded</span>
          {counts.blocked > 0 && (
            <span className="rounded px-2 py-1 font-mono text-[var(--error)] bg-[color-mix(in_srgb,var(--error)_12%,transparent)]">{counts.blocked} blocked</span>
          )}
          {lastResult && (
            <span className="rounded bg-muted/60 px-2 py-1 font-mono">
              last load: {lastResult.loaded.length} loaded · {lastResult.failed.length} failed · {lastResult.skipped.length} skipped
            </span>
          )}
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle size={13} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 size={15} className="animate-spin" />
            <span>Loading imported plugins...</span>
          </div>
        ) : error && plugins.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Could not load imported Obsidian plugins.</p>
            <button
              type="button"
              onClick={() => refresh(false)}
              disabled={busyKey !== null}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        ) : plugins.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No imported Obsidian plugins found.</p>
            <p className="mt-1 text-xs text-muted-foreground/70">Use Import from Obsidian first, then refresh this host.</p>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-border/60">
            {plugins.map((plugin) => {
              const support = getObsidianImportSupport(plugin);
              const supportMeta = SUPPORT_META[support.kind];
              const LevelIcon = supportMeta.icon;
              const isExpanded = expanded.has(plugin.id);
              const toggleKey = `${plugin.enabled ? 'disable' : 'enable'}:${plugin.id}`;
              const loadKey = `load:${plugin.id}`;
              const removeKey = `uninstall:${plugin.id}`;
              const surfaceRoutes = surfaceRouting(plugin);
              const isFocused = highlightedPluginId === plugin.id;
              return (
                <div
                  key={plugin.id}
                  ref={(node) => {
                    if (node) pluginRowsRef.current[plugin.id] = node;
                    else delete pluginRowsRef.current[plugin.id];
                  }}
                  className={`scroll-mt-4 rounded-lg py-3 transition-colors ${
                    isFocused ? 'bg-[var(--amber-subtle)]/70 ring-1 ring-[var(--amber)]/25' : ''
                  }`}
                  data-obsidian-plugin-row={plugin.id}
                  data-obsidian-plugin-focused={isFocused ? 'true' : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(plugin.id)}
                      className="min-w-0 flex flex-1 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="mt-0.5 text-muted-foreground">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{plugin.name}</span>
                          <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">{plugin.version}</span>
                          <span
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-2xs"
                            style={{ background: supportMeta.bg, color: supportMeta.tone }}
                          >
                            <LevelIcon size={10} />
                            {support.label}
                          </span>
                          {plugin.loaded && (
                            <span className="rounded bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-1.5 py-0.5 font-mono text-2xs text-[var(--success)]">
                              loaded
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">{compatibilityNote(plugin)}</span>
                        {plugin.lastError && (
                          <span className="mt-1 block text-xs text-[var(--error)]">{plugin.lastError}</span>
                        )}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      <Toggle
                        checked={plugin.enabled}
                        disabled={plugin.compatibilityLevel === 'blocked' || busyKey !== null}
                        title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                        onChange={() => runAction(plugin.enabled ? 'disable' : 'enable', { pluginId: plugin.id })}
                      />
                      <button
                        type="button"
                        onClick={() => runAction('load', { pluginId: plugin.id })}
                        disabled={!plugin.enabled || plugin.loaded || plugin.compatibilityLevel === 'blocked' || busyKey !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {busyKey === loadKey ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(plugin)}
                        disabled={busyKey !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-error/40 hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title="Remove imported plugin"
                        aria-label={`Remove imported plugin ${plugin.name}`}
                      >
                        {busyKey === removeKey ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        Remove
                      </button>
                    </div>
                  </div>

                  {busyKey === toggleKey && (
                    <div className="mt-2 pl-6 text-2xs text-muted-foreground">Saving plugin state...</div>
                  )}

                  {isExpanded && (
                    <div className="mt-3 ml-6 space-y-3 rounded-lg border border-border/60 bg-background/60 p-3">
                      <div className="text-xs text-muted-foreground">{runtimeSummary(plugin)}</div>

                      {surfaceRoutes.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Where it appears</p>
                            <p className="text-2xs text-muted-foreground/70">Manage here; use from the mounted host.</p>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {surfaceRoutes.map((route) => (
                              <SurfaceRouteCard
                                key={`${route.label}:${route.value}`}
                                route={route}
                                onOpenRoute={openRoute}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {plugin.runtime.warnings.length > 0 && (
                        <div className="space-y-1">
                          {plugin.runtime.warnings.map((warning) => (
                            <div key={warning} className="flex items-start gap-2 text-xs text-[var(--amber-text)]">
                              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                              <span>{warning}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {plugin.runtime.commandList.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Commands</p>
                          <div className="flex flex-wrap gap-1.5">
                            {plugin.runtime.commandList.map((command) => {
                              const commandKey = `execute-command:${command.fullId}`;
                              const executable = command.executable !== false;
                              const commandTitle = executable
                                ? plugin.loaded ? `Run ${command.name}` : 'Load the plugin before running commands'
                                : command.availabilityReason ?? (command.requiresEditor ? 'Requires an active editor host' : 'Command is recorded but not currently executable');
                              return (
                                <button
                                  key={command.fullId}
                                  type="button"
                                  onClick={() => {
                                    if (executable) runAction('execute-command', { commandId: command.fullId });
                                  }}
                                  disabled={!executable || !plugin.loaded || busyKey !== null}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  title={commandTitle}
                                >
                                  {busyKey === commandKey ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                                  {command.name}
                                  {!executable && (
                                    <span className="rounded border border-border/70 bg-muted/50 px-1 text-2xs text-muted-foreground">
                                      {command.requiresEditor ? 'Editor' : 'Recorded'}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="space-y-2 border-t border-border/50 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Settings</p>
                          <button
                            type="button"
                            onClick={() => loadSettings(plugin.id)}
                            disabled={!plugin.enabled || settingsBusyKey !== null}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={plugin.enabled ? 'Load plugin settings' : 'Enable the plugin before loading settings'}
                          >
                            {settingsBusyKey === `settings:${plugin.id}` ? <Loader2 size={11} className="animate-spin" /> : <SlidersHorizontal size={11} />}
                            Load settings
                          </button>
                        </div>

                        {settingsErrors[plugin.id] && (
                          <div className="flex items-start gap-2 rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/10 px-3 py-2 text-xs text-[var(--error)]">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span>{settingsErrors[plugin.id]}</span>
                          </div>
                        )}

                        {settingsByPlugin[plugin.id]?.settingTabs.map((tab, tabIndex) => (
                          <div key={`${plugin.id}-tab-${tabIndex}`} className="space-y-2 rounded-lg border border-border/50 bg-card/50 p-2.5">
                            {tab.error && (
                              <div className="flex items-start gap-2 text-xs text-[var(--error)]">
                                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                                <span>{tab.error}</span>
                              </div>
                            )}
                            {tab.items.length === 0 ? (
                              <p className="text-xs text-muted-foreground">This tab did not expose configurable items.</p>
                            ) : (
                              tab.items.map((item, itemIndex) => {
                                const itemBusy = settingsBusyKey === `settings:${plugin.id}:${tabIndex}:${itemIndex}`;
                                return (
                                  <div key={`${plugin.id}-setting-${tabIndex}-${itemIndex}`} className="flex flex-col gap-2 rounded-lg bg-background/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium text-foreground">{item.name ?? item.kind ?? 'Setting'}</p>
                                      {item.desc && <p className="mt-0.5 text-2xs text-muted-foreground">{item.desc}</p>}
                                      {!item.canChange && !item.canClick && (
                                        <p className="mt-1 text-2xs text-muted-foreground/70">Read-only in the limited runtime.</p>
                                      )}
                                    </div>
                                    <SettingControl
                                      item={item}
                                      busy={itemBusy}
                                      onAction={(settingAction, value) => runSettingAction(plugin.id, tabIndex, itemIndex, settingAction, value)}
                                    />
                                  </div>
                                );
                              })
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </section>
      <PluginActionModalDialog
        modal={pluginModal}
        onChooseSuggestion={(modal, suggestion) => void chooseModalSuggestion(modal, suggestion)}
        choosingSuggestionIndex={choosingSuggestionIndex}
        choiceError={modalChoiceError}
        onClose={() => {
          setPluginModal(null);
          setModalChoiceError(null);
        }}
      />
      <PluginActionMenuDialog
        menu={pluginMenu}
        onChooseItem={(menu, item) => void chooseMenuItem(menu, item)}
        choosingItemIndex={choosingMenuItemIndex}
        choiceError={menuChoiceError}
        onClose={() => {
          setPluginMenu(null);
          setMenuChoiceError(null);
        }}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        title={removeTarget ? `Remove ${removeTarget.name}?` : 'Remove imported plugin?'}
        message="This deletes only the MindOS .plugins copy. The source Obsidian vault and its plugin files are not changed."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmRemovePlugin(); }}
        onCancel={() => setRemoveTarget(null)}
        variant="destructive"
      />
    </>
  );
}
