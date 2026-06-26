'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Loader2,
  Play,
  Power,
  RefreshCw,
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
  pluginEditorCommandContextForPathname,
  submitPluginModalText,
  toastPluginActionNotices,
  type PluginEditorCommandContext,
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
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { SettingCard, Toggle } from './Primitives';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import PluginActionMenuDialog from '@/components/plugins/PluginActionMenuDialog';
import PluginActionModalDialog from '@/components/plugins/PluginActionModalDialog';
import {
  capabilityGateEnableMessage,
  capabilityGateRevokeMessage,
} from './ObsidianCapabilityGatePanel';
import {
  compatibilityNote,
  isLoadResult,
  isPluginActionResult,
  surfaceLedgerProjections,
  surfaceRouting,
  type ObsidianPluginLoadResult,
  type ObsidianPluginSettings,
  type ObsidianPluginSettingsResponse,
  type ObsidianPluginStatus,
  type ObsidianPluginsResponse,
  type PluginLifecycleAction,
  type SettingAction,
  type SurfaceRouteTarget,
} from './ObsidianPluginHostModel';
import {
  compatibilityPostureStatusClass,
} from './ObsidianCompatibilityPostureModel';
import { ObsidianPluginHostDetails } from './ObsidianPluginHostDetails';
import {
  buildObsidianPluginInventory,
  type ObsidianPostureFilter,
} from './ObsidianPluginHostInventoryModel';
import { ObsidianPluginHostInventoryFilters } from './ObsidianPluginHostInventoryFilters';
import {
  declarativePreviewKey,
  type DeclarativeActionTarget,
  type DeclarativeListMutationTarget,
  type DeclarativePreviewTarget,
} from './ObsidianPluginHostSettingsControls';
import type { ObsidianDeclarativeSettingPreview } from './ObsidianPluginHostModel';

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

function notifyPluginSurfacesChanged() {
  notifyPluginsChanged();
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
  const [postureFilter, setPostureFilter] = useState<ObsidianPostureFilter>('all');
  const [lastResult, setLastResult] = useState<ObsidianPluginLoadResult | null>(null);
  const [settingsByPlugin, setSettingsByPlugin] = useState<Record<string, ObsidianPluginSettings>>({});
  const [settingsBusyKey, setSettingsBusyKey] = useState<string | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [pluginModal, setPluginModal] = useState<PluginModalSnapshot | null>(null);
  const [pluginMenu, setPluginMenu] = useState<PluginMenuSnapshot | null>(null);
  const [enableTarget, setEnableTarget] = useState<ObsidianPluginStatus | null>(null);
  const [revokeApprovalTarget, setRevokeApprovalTarget] = useState<ObsidianPluginStatus | null>(null);
  const [choosingSuggestionIndex, setChoosingSuggestionIndex] = useState<number | null>(null);
  const [submittingModalText, setSubmittingModalText] = useState(false);
  const [modalChoiceError, setModalChoiceError] = useState<string | null>(null);
  const [choosingMenuItemIndex, setChoosingMenuItemIndex] = useState<number | null>(null);
  const [menuChoiceError, setMenuChoiceError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ObsidianPluginStatus | null>(null);
  const [migrateTarget, setMigrateTarget] = useState<ObsidianPluginStatus | null>(null);
  const [declarativeActionTarget, setDeclarativeActionTarget] = useState<DeclarativeActionTarget | null>(null);
  const [declarativeListMutationTarget, setDeclarativeListMutationTarget] = useState<DeclarativeListMutationTarget | null>(null);
  const [declarativePreviewTarget, setDeclarativePreviewTarget] = useState<DeclarativePreviewTarget | null>(null);
  const [declarativePreviews, setDeclarativePreviews] = useState<Record<string, ObsidianDeclarativeSettingPreview>>({});
  const [highlightedPluginId, setHighlightedPluginId] = useState<string | null>(null);
  const pluginRowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const router = useRouter();
  const pathname = usePathname();
  const smoothPush = useSmoothRouterPush();
  const pluginEditorContext = useMemo(() => pluginEditorCommandContextForPathname(pathname), [pathname]);

  const counts = useMemo(() => ({
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    loaded: plugins.filter((plugin) => plugin.loaded).length,
    blocked: plugins.filter((plugin) => plugin.compatibilityLevel === 'blocked').length,
  }), [plugins]);
  const inventory = useMemo(
    () => buildObsidianPluginInventory(plugins, postureFilter),
    [plugins, postureFilter],
  );

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
      smoothPush(`/view/${encodePath(targetPath)}`);
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
  }, [router, smoothPush]);

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

  const submitModalText = useCallback(async (modal: PluginModalSnapshot, text: string) => {
    setSubmittingModalText(true);
    setModalChoiceError(null);
    try {
      if (!modal.interactionId) {
        throw new Error('Plugin modal interaction expired. Run the command again.');
      }
      const result = await submitPluginModalText(modal.id, text, modal.interactionId);
      handlePluginActionResult(result);
    } catch (error) {
      setModalChoiceError(error instanceof Error ? error.message : 'Failed to submit plugin modal text');
    } finally {
      setSubmittingModalText(false);
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

  const runAction = useCallback(async (
    action: PluginLifecycleAction,
    options: {
      pluginId?: string;
      commandId?: string;
      probeId?: string;
      editorContext?: PluginEditorCommandContext;
      confirmCapabilityGate?: boolean;
    } = {},
  ) => {
    const key = `${action}:${options.probeId ?? options.pluginId ?? options.commandId ?? 'all'}`;
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
      } else if (action === 'run-workflow-probe') {
        setLastResult(null);
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
        setDeclarativePreviews((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${options.pluginId}:`))));
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
      if (action === 'migrate-legacy') {
        notifyPluginSurfacesChanged();
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

  const confirmMigratePlugin = useCallback(async () => {
    if (!migrateTarget) return;
    const pluginId = migrateTarget.id;
    setMigrateTarget(null);
    await runAction('migrate-legacy', { pluginId });
  }, [migrateTarget, runAction]);

  const requestTogglePlugin = useCallback((plugin: ObsidianPluginStatus) => {
    if (plugin.enabled) {
      void runAction('disable', { pluginId: plugin.id });
      return;
    }
    if (plugin.capabilityGate?.requiresConfirmation && !plugin.capabilityGate.confirmed) {
      setEnableTarget(plugin);
      return;
    }
    void runAction('enable', { pluginId: plugin.id });
  }, [runAction]);

  const confirmEnablePlugin = useCallback(async () => {
    if (!enableTarget) return;
    const pluginId = enableTarget.id;
    setEnableTarget(null);
    await runAction('enable', { pluginId, confirmCapabilityGate: true });
  }, [enableTarget, runAction]);

  const confirmRevokeApproval = useCallback(async () => {
    if (!revokeApprovalTarget) return;
    const pluginId = revokeApprovalTarget.id;
    setRevokeApprovalTarget(null);
    await runAction('revoke-capability-approval', { pluginId });
  }, [revokeApprovalTarget, runAction]);

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

  const runDeclarativeSettingAction = useCallback(async (
    pluginId: string,
    tabIndex: number,
    path: number[],
    value: unknown,
  ) => {
    const key = `settings:${pluginId}:${tabIndex}:declarative:${path.join('.')}`;
    setSettingsBusyKey(key);
    setSettingsErrors((prev) => ({ ...prev, [pluginId]: '' }));
    try {
      const data = await apiFetch<ObsidianPluginSettingsResponse>('/api/obsidian-plugins/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-value',
          source: 'declarative',
          pluginId,
          tabIndex,
          path,
          value,
        }),
      });
      applySettingsResponse(data);
    } catch (err) {
      setSettingsErrors((prev) => ({ ...prev, [pluginId]: err instanceof Error ? err.message : 'Failed to update declarative plugin settings.' }));
    } finally {
      setSettingsBusyKey(null);
    }
  }, [applySettingsResponse]);

  const runDeclarativeConfirmedAction = useCallback(async (target: DeclarativeActionTarget) => {
    const key = `settings:${target.pluginId}:${target.tabIndex}:declarative-action:${target.path.join('.')}`;
    setSettingsBusyKey(key);
    setSettingsErrors((prev) => ({ ...prev, [target.pluginId]: '' }));
    try {
      const data = await apiFetch<ObsidianPluginSettingsResponse>('/api/obsidian-plugins/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'click-button',
          source: 'declarative',
          pluginId: target.pluginId,
          tabIndex: target.tabIndex,
          path: target.path,
          confirmAction: true,
        }),
      });
      applySettingsResponse(data);
    } catch (err) {
      setSettingsErrors((prev) => ({ ...prev, [target.pluginId]: err instanceof Error ? err.message : 'Failed to run declarative plugin action.' }));
    } finally {
      setSettingsBusyKey(null);
    }
  }, [applySettingsResponse]);

  const confirmDeclarativeAction = useCallback(async () => {
    if (!declarativeActionTarget) return;
    const target = declarativeActionTarget;
    setDeclarativeActionTarget(null);
    await runDeclarativeConfirmedAction(target);
  }, [declarativeActionTarget, runDeclarativeConfirmedAction]);

  const runDeclarativeListMutation = useCallback(async (target: DeclarativeListMutationTarget) => {
    const indexSuffix = target.listItemIndex === undefined ? '' : `:${target.listItemIndex}${target.newIndex === undefined ? '' : `:${target.newIndex}`}`;
    const key = `settings:${target.pluginId}:${target.tabIndex}:declarative-list:${target.action}:${target.path.join('.')}${indexSuffix}`;
    setSettingsBusyKey(key);
    setSettingsErrors((prev) => ({ ...prev, [target.pluginId]: '' }));
    try {
      const data = await apiFetch<ObsidianPluginSettingsResponse>('/api/obsidian-plugins/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: target.action,
          source: 'declarative',
          pluginId: target.pluginId,
          tabIndex: target.tabIndex,
          path: target.path,
          ...(target.listItemIndex === undefined ? {} : { listItemIndex: target.listItemIndex }),
          ...(target.newIndex === undefined ? {} : { newIndex: target.newIndex }),
          confirmAction: true,
        }),
      });
      applySettingsResponse(data);
    } catch (err) {
      setSettingsErrors((prev) => ({ ...prev, [target.pluginId]: err instanceof Error ? err.message : 'Failed to run declarative list mutation.' }));
    } finally {
      setSettingsBusyKey(null);
    }
  }, [applySettingsResponse]);

  const confirmDeclarativeListMutation = useCallback(async () => {
    if (!declarativeListMutationTarget) return;
    const target = declarativeListMutationTarget;
    setDeclarativeListMutationTarget(null);
    await runDeclarativeListMutation(target);
  }, [declarativeListMutationTarget, runDeclarativeListMutation]);

  const runDeclarativePreview = useCallback(async (target: DeclarativePreviewTarget) => {
    const key = `settings:${target.pluginId}:${target.tabIndex}:declarative-preview:${target.path.join('.')}`;
    setSettingsBusyKey(key);
    setSettingsErrors((prev) => ({ ...prev, [target.pluginId]: '' }));
    try {
      const data = await apiFetch<ObsidianPluginSettingsResponse>('/api/obsidian-plugins/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: target.action,
          source: 'declarative',
          pluginId: target.pluginId,
          tabIndex: target.tabIndex,
          path: target.path,
          confirmAction: true,
        }),
      });
      applySettingsResponse(data);
      if (data.preview) {
        setDeclarativePreviews((prev) => ({
          ...prev,
          [declarativePreviewKey(target.pluginId, target.tabIndex, target.path)]: data.preview!,
        }));
      }
    } catch (err) {
      setSettingsErrors((prev) => ({ ...prev, [target.pluginId]: err instanceof Error ? err.message : 'Failed to preview declarative setting.' }));
    } finally {
      setSettingsBusyKey(null);
    }
  }, [applySettingsResponse]);

  const confirmDeclarativePreview = useCallback(async () => {
    if (!declarativePreviewTarget) return;
    const target = declarativePreviewTarget;
    setDeclarativePreviewTarget(null);
    await runDeclarativePreview(target);
  }, [declarativePreviewTarget, runDeclarativePreview]);

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
      <SettingCard
        icon={<Terminal size={15} />}
        title="Obsidian plugin host"
        description="Enable imported lightweight plugins, load their commands, and inspect compatibility limits."
        actions={(
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
        )}
        bodyClassName="space-y-3"
      >

      <div className="space-y-3">
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
        {plugins.length > 0 && (
          <ObsidianPluginHostInventoryFilters
            inventory={inventory}
            onChange={setPostureFilter}
          />
        )}

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
        ) : inventory.visibleCount === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No imported plugins match this compatibility posture.</p>
            <button
              type="button"
              onClick={() => setPostureFilter('all')}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Show all
            </button>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-border/60">
            {inventory.items.map(({ plugin, posture }) => {
              const support = getObsidianImportSupport(plugin);
              const supportMeta = SUPPORT_META[support.kind];
              const LevelIcon = supportMeta.icon;
              const isExpanded = expanded.has(plugin.id);
              const toggleKey = `${plugin.enabled ? 'disable' : 'enable'}:${plugin.id}`;
              const loadKey = `load:${plugin.id}`;
              const removeKey = `uninstall:${plugin.id}`;
              const migrateKey = `migrate-legacy:${plugin.id}`;
              const surfaceRoutes = surfaceRouting(plugin);
              const surfaceLedgerChecks = surfaceLedgerProjections(plugin);
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
                  data-obsidian-posture={posture.status}
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
                          <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${compatibilityPostureStatusClass(posture.status)}`}>
                            {posture.label}
                          </span>
                          {plugin.loaded && (
                            <span className="rounded bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-1.5 py-0.5 font-mono text-2xs text-[var(--success)]">
                              loaded
                            </span>
                          )}
                          {plugin.packageLocation?.legacy && (
                            <span className="rounded bg-[var(--amber-subtle)] px-1.5 py-0.5 font-mono text-2xs text-[var(--amber-text)]">
                              legacy path
                            </span>
                          )}
                          {plugin.capabilityGate?.requiresConfirmation && !plugin.capabilityGate.confirmed && (
                            <span className="rounded bg-[var(--amber-subtle)] px-1.5 py-0.5 font-mono text-2xs text-[var(--amber-text)]">
                              review gate
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
                        disabled={plugin.compatibilityLevel === 'blocked' || plugin.capabilityGate?.blocked === true || busyKey !== null}
                        title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                        onChange={() => requestTogglePlugin(plugin)}
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
                      {plugin.packageLocation?.migrationAvailable && (
                        <button
                          type="button"
                          onClick={() => setMigrateTarget(plugin)}
                          disabled={busyKey !== null}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title="Move this package into .mindos/plugins"
                        >
                          {busyKey === migrateKey ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          Migrate
                        </button>
                      )}
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
                    <ObsidianPluginHostDetails
                      plugin={plugin}
                      posture={posture}
                      busyKey={busyKey}
                      settingsBusyKey={settingsBusyKey}
                      settingsErrors={settingsErrors}
                      settingsByPlugin={settingsByPlugin}
                      declarativePreviews={declarativePreviews}
                      pluginEditorContext={pluginEditorContext ?? null}
                      surfaceRoutes={surfaceRoutes}
                      surfaceLedgerChecks={surfaceLedgerChecks}
                      onOpenRoute={openRoute}
                      onRequestRevokeApproval={setRevokeApprovalTarget}
                      onRunAction={(action, options) => { void runAction(action, options); }}
                      onLoadSettings={(pluginId) => { void loadSettings(pluginId); }}
                      onRunSettingAction={(pluginId, tabIndex, itemIndex, settingAction, value) => {
                        void runSettingAction(pluginId, tabIndex, itemIndex, settingAction, value);
                      }}
                      onRunDeclarativeSettingAction={(pluginId, tabIndex, path, value) => {
                        void runDeclarativeSettingAction(pluginId, tabIndex, path, value);
                      }}
                      onRunDeclarativeAction={setDeclarativeActionTarget}
                      onRunDeclarativeListMutation={setDeclarativeListMutationTarget}
                      onPreviewDeclarative={setDeclarativePreviewTarget}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </SettingCard>
      <PluginActionModalDialog
        modal={pluginModal}
        onChooseSuggestion={(modal, suggestion) => void chooseModalSuggestion(modal, suggestion)}
        onSubmitText={(modal, text) => void submitModalText(modal, text)}
        choosingSuggestionIndex={choosingSuggestionIndex}
        submittingText={submittingModalText}
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
        open={enableTarget !== null}
        title={enableTarget ? `Enable ${enableTarget.name}?` : 'Enable Obsidian plugin?'}
        message={enableTarget ? capabilityGateEnableMessage(enableTarget) : 'This plugin requires capability confirmation before it can be enabled.'}
        confirmLabel="Enable"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmEnablePlugin(); }}
        onCancel={() => setEnableTarget(null)}
        variant="default"
      />
      <ConfirmDialog
        open={removeTarget !== null}
        title={removeTarget ? `Remove ${removeTarget.name}?` : 'Remove imported plugin?'}
        message="This deletes only the MindOS plugin package copy. The source Obsidian vault and its plugin files are not changed."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmRemovePlugin(); }}
        onCancel={() => setRemoveTarget(null)}
        variant="destructive"
      />
      <ConfirmDialog
        open={revokeApprovalTarget !== null}
        title={revokeApprovalTarget ? `Revoke approval for ${revokeApprovalTarget.name}?` : 'Revoke capability approval?'}
        message={revokeApprovalTarget ? capabilityGateRevokeMessage(revokeApprovalTarget) : 'This clears the current capability approval and requires review before gated capabilities can be enabled again.'}
        confirmLabel="Revoke approval"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmRevokeApproval(); }}
        onCancel={() => setRevokeApprovalTarget(null)}
        variant="destructive"
      />
      <ConfirmDialog
        open={migrateTarget !== null}
        title={migrateTarget ? `Migrate ${migrateTarget.name}?` : 'Migrate legacy plugin?'}
        message={migrateTarget?.packageLocation
          ? `This copies ${migrateTarget.packageLocation.relativePath} into .mindos/plugins and removes the old legacy package after the copy succeeds.`
          : 'This copies the legacy plugin package into .mindos/plugins and removes the old legacy package after the copy succeeds.'}
        confirmLabel="Migrate"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmMigratePlugin(); }}
        onCancel={() => setMigrateTarget(null)}
        variant="default"
      />
      <ConfirmDialog
        open={declarativeActionTarget !== null}
        title={declarativeActionTarget ? `Run ${declarativeActionTarget.label}?` : 'Run plugin settings action?'}
        message={declarativeActionTarget
          ? `${declarativeActionTarget.pluginName} will run this declarative settings action. It can update this plugin's settings through the limited host, but it does not receive native filesystem, Electron, or custom page access.`
          : 'This runs a declarative plugin settings action through the limited host.'}
        confirmLabel="Run"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmDeclarativeAction(); }}
        onCancel={() => setDeclarativeActionTarget(null)}
        variant="default"
      />
      <ConfirmDialog
        open={declarativeListMutationTarget !== null}
        title={declarativeListMutationTarget
          ? `${declarativeListMutationTarget.action === 'list-add' ? 'Add item to' : declarativeListMutationTarget.action === 'list-delete' ? 'Delete item from' : 'Reorder'} ${declarativeListMutationTarget.label}?`
          : 'Run plugin list mutation?'}
        message={declarativeListMutationTarget
          ? `${declarativeListMutationTarget.pluginName} will run this declarative list mutation through the limited host. MindOS will roll back this plugin's settings data if the callback fails, but it does not grant native filesystem, Electron, custom page, or arbitrary DOM access.`
          : 'This runs a declarative list mutation through the limited host.'}
        confirmLabel={declarativeListMutationTarget?.action === 'list-delete' ? 'Delete' : 'Run'}
        cancelLabel="Cancel"
        onConfirm={() => { void confirmDeclarativeListMutation(); }}
        onCancel={() => setDeclarativeListMutationTarget(null)}
        variant={declarativeListMutationTarget?.action === 'list-delete' ? 'destructive' : 'default'}
      />
      <ConfirmDialog
        open={declarativePreviewTarget !== null}
        title={declarativePreviewTarget ? `Preview ${declarativePreviewTarget.label}?` : 'Preview declarative settings item?'}
        message={declarativePreviewTarget
          ? `${declarativePreviewTarget.pluginName} will run this declarative ${declarativePreviewTarget.action === 'preview-render' ? 'render' : 'page'} callback in the limited snapshot host. MindOS restores this plugin's settings data after the preview and does not mount plugin DOM, event listeners, native filesystem, or Electron access.`
          : 'This previews a declarative settings item through the limited snapshot host.'}
        confirmLabel="Preview"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmDeclarativePreview(); }}
        onCancel={() => setDeclarativePreviewTarget(null)}
        variant="default"
      />
    </>
  );
}
