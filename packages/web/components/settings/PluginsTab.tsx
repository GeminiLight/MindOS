'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ExternalLink,
  FolderOpen,
  Globe2,
  PanelRightOpen,
  Puzzle,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  getPluginRenderers,
  isRendererEnabled,
  loadDisabledState,
  setRendererEnabled,
} from '@/lib/renderers/registry';
import { apiFetch } from '@/lib/api';
import {
  OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT,
  readObsidianPluginHotkeysEnabled,
  setObsidianPluginHotkeysEnabled,
} from '@/lib/plugins/client';
import {
  pluginCatalogBucketMatches,
  type PluginCatalogBucket,
  type PluginCatalogCounts,
  type PluginCatalogItem,
  type PluginCatalogSource,
} from '@/lib/plugins/catalog';
import {
  notifyObsidianPluginPackagesChanged,
  PLUGINS_CHANGED_EVENT,
} from '@/lib/plugins/events';
import type {
  ObsidianCommunityCatalog,
  ObsidianCommunityCatalogItem,
  ObsidianCommunityPluginPreflight,
} from '@/lib/obsidian-compat/community-catalog';
import type {
  ObsidianCommunityUpdatePlan,
  UpdateObsidianCommunityPluginResult,
} from '@/lib/obsidian-compat/community-install';
import { Toggle } from './Primitives';
import { CommunityPluginRow } from './CommunityPluginRow';
import { ObsidianImportSection } from './ObsidianImportSection';
import { ObsidianPluginHostSection } from './ObsidianPluginHostSection';
import { PluginManagerHeader, type PluginManagerNavItem } from './PluginManagerHeader';
import { PluginSurfacesPanel, type SurfaceInventoryState } from './PluginSurfacesPanel';
import {
  applyCommunityInstallToCatalog,
  applyCommunityUpdateToCatalog,
  catalogStatusClass,
  rendererMatchLabel,
  type CatalogFilterOption,
  type CommunityInstallState,
  type CommunityPreflightState,
  type CommunityUpdatePlanState,
  type CommunityUpdateState,
  type ObsidianCommunityCatalogResponse,
  type ObsidianCommunityInstallResponse,
  type PluginCatalogResponse,
  type PluginSurfacesResponse,
} from './PluginsTabModel';
import type { PluginPanel, PluginsTabProps } from './types';

function pluginSourceBadge(source: PluginCatalogSource, copy: PluginsTabProps['t']['settings']['plugins']): string {
  if (source === 'obsidian') return copy.catalogSourceObsidian;
  if (source === 'runtime-extension') return copy.catalogSourceRuntimeExtension;
  return copy.catalogSourceMindos;
}

function pluginSourceIcon(plugin: PluginCatalogItem): string {
  if (plugin.source === 'obsidian') return 'Ob';
  if (plugin.source === 'runtime-extension') return 'Rt';
  return plugin.icon ?? 'M';
}

export function PluginsTab({
  pluginStates,
  setPluginStates,
  t,
  mindRoot,
  initialPanel,
  onOpenPluginEntries,
  onOpenCommandCenter,
  onOpenPluginViews,
}: PluginsTabProps) {
  const renderers = getPluginRenderers();
  const copy = t.settings.plugins;
  const [panel, setPanel] = useState<PluginPanel>('installed');
  const [catalogFilter, setCatalogFilter] = useState<PluginCatalogBucket>('all');
  const [catalogCounts, setCatalogCounts] = useState<PluginCatalogCounts | null>(null);
  const [catalogPlugins, setCatalogPlugins] = useState<PluginCatalogItem[]>([]);
  const [focusedObsidianPluginId, setFocusedObsidianPluginId] = useState<string | null>(null);
  const [communityInput, setCommunityInput] = useState('');
  const [communityQuery, setCommunityQuery] = useState('');
  const [communityCatalog, setCommunityCatalog] = useState<ObsidianCommunityCatalog | null>(null);
  const [communitySkipped, setCommunitySkipped] = useState<Array<{ index: number; reason: string }>>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [communityPreflights, setCommunityPreflights] = useState<Record<string, CommunityPreflightState>>({});
  const [communityInstalls, setCommunityInstalls] = useState<Record<string, CommunityInstallState>>({});
  const [communityUpdatePlans, setCommunityUpdatePlans] = useState<Record<string, CommunityUpdatePlanState>>({});
  const [communityUpdates, setCommunityUpdates] = useState<Record<string, CommunityUpdateState>>({});
  const [obsidianHotkeysEnabled, setObsidianHotkeysEnabledState] = useState(false);
  const [surfaceInventory, setSurfaceInventory] = useState<SurfaceInventoryState>({
    loading: false,
    loaded: false,
    surfaces: [],
  });
  const communityLoadSeqRef = useRef(0);

  useEffect(() => {
    if (!initialPanel) return;
    setPanel(initialPanel);
  }, [initialPanel]);

  const changePanel = useCallback((nextPanel: PluginPanel) => {
    setPanel(nextPanel);
    if (typeof window === 'undefined' || window.location.pathname !== '/settings') return;

    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'plugins');
    if (nextPanel === 'installed') {
      url.searchParams.delete('panel');
    } else {
      url.searchParams.set('panel', nextPanel);
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    loadDisabledState();
    setPluginStates(Object.fromEntries(
      getPluginRenderers().map((renderer) => [renderer.id, isRendererEnabled(renderer.id)]),
    ));
  }, [setPluginStates]);

  useEffect(() => {
    const sync = () => setObsidianHotkeysEnabledState(readObsidianPluginHotkeysEnabled());
    sync();
    window.addEventListener(OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshCatalog = async () => {
      try {
        const data = await apiFetch<PluginCatalogResponse>('/api/plugins/catalog', { cache: 'no-store' });
        if (!cancelled) {
          setCatalogCounts(data.counts ?? null);
          setCatalogPlugins(Array.isArray(data.plugins) ? data.plugins : []);
        }
      } catch {
        if (!cancelled) {
          setCatalogCounts(null);
          setCatalogPlugins([]);
        }
      }
    };

    void refreshCatalog();
    window.addEventListener(PLUGINS_CHANGED_EVENT, refreshCatalog);
    return () => {
      cancelled = true;
      window.removeEventListener(PLUGINS_CHANGED_EVENT, refreshCatalog);
    };
  }, []);

  const loadCommunityCatalog = useCallback(async (query: string) => {
    const requestSeq = communityLoadSeqRef.current + 1;
    communityLoadSeqRef.current = requestSeq;
    setCommunityLoading(true);
    setCommunityError(null);

    const params = new URLSearchParams();
    params.set('limit', '80');
    if (query.trim()) params.set('q', query.trim());

    try {
      const data = await apiFetch<ObsidianCommunityCatalogResponse>(
        `/api/obsidian/community-catalog?${params.toString()}`,
        { cache: 'no-store' },
      );
      if (communityLoadSeqRef.current !== requestSeq) return;
      setCommunityCatalog(data.catalog ?? null);
      setCommunitySkipped(Array.isArray(data.skipped) ? data.skipped : []);
      setCommunityPreflights({});
      setCommunityInstalls({});
      setCommunityUpdatePlans({});
      setCommunityUpdates({});
      setCommunityLoaded(true);
    } catch (err) {
      if (communityLoadSeqRef.current !== requestSeq) return;
      setCommunityCatalog(null);
      setCommunitySkipped([]);
      setCommunityInstalls({});
      setCommunityUpdatePlans({});
      setCommunityUpdates({});
      setCommunityLoaded(true);
      setCommunityError(err instanceof Error ? err.message : copy.communityLoadFailed);
    } finally {
      if (communityLoadSeqRef.current === requestSeq) {
        setCommunityLoading(false);
      }
    }
  }, [copy.communityLoadFailed]);

  const refreshSurfaceInventory = useCallback(async () => {
    setSurfaceInventory((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const data = await apiFetch<PluginSurfacesResponse>('/api/plugins/surfaces', { cache: 'no-store' });
      setSurfaceInventory({
        loading: false,
        loaded: true,
        surfaces: Array.isArray(data.surfaces) ? data.surfaces : [],
      });
    } catch (err) {
      setSurfaceInventory({
        loading: false,
        loaded: true,
        surfaces: [],
        error: err instanceof Error ? err.message : copy.surfaceInventoryLoadFailed,
      });
    }
  }, [copy.surfaceInventoryLoadFailed]);

  useEffect(() => {
    if (panel !== 'surfaces') return;
    void refreshSurfaceInventory();
    window.addEventListener(PLUGINS_CHANGED_EVENT, refreshSurfaceInventory);
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, refreshSurfaceInventory);
  }, [panel, refreshSurfaceInventory]);

  const checkCommunityPreflight = useCallback(async (plugin: ObsidianCommunityCatalogItem) => {
    setCommunityPreflights((current) => ({
      ...current,
      [plugin.id]: { loading: true },
    }));
    setCommunityUpdatePlans((current) => {
      if (!current[plugin.id]) return current;
      const next = { ...current };
      delete next[plugin.id];
      return next;
    });
    setCommunityUpdates((current) => {
      if (!current[plugin.id]) return current;
      const next = { ...current };
      delete next[plugin.id];
      return next;
    });

    const params = new URLSearchParams();
    params.set('repo', plugin.repo);
    params.set('pluginId', plugin.id);

    try {
      const result = await apiFetch<ObsidianCommunityPluginPreflight>(
        `/api/obsidian/community-catalog/preflight?${params.toString()}`,
        { cache: 'no-store' },
      );
      setCommunityPreflights((current) => ({
        ...current,
        [plugin.id]: { loading: false, result },
      }));
    } catch (err) {
      setCommunityPreflights((current) => ({
        ...current,
        [plugin.id]: {
          loading: false,
          error: err instanceof Error ? err.message : copy.communityPreflightFailed,
        },
      }));
    }
  }, [copy.communityPreflightFailed]);

  const previewCommunityUpdatePlan = useCallback(async (plugin: ObsidianCommunityCatalogItem) => {
    setCommunityUpdatePlans((current) => ({
      ...current,
      [plugin.id]: { loading: true },
    }));

    const params = new URLSearchParams();
    params.set('repo', plugin.repo);
    params.set('pluginId', plugin.id);

    try {
      const result = await apiFetch<ObsidianCommunityUpdatePlan>(
        `/api/obsidian/community-catalog/update-plan?${params.toString()}`,
        { cache: 'no-store' },
      );
      setCommunityUpdatePlans((current) => ({
        ...current,
        [plugin.id]: { loading: false, result },
      }));
    } catch (err) {
      setCommunityUpdatePlans((current) => ({
        ...current,
        [plugin.id]: {
          loading: false,
          error: err instanceof Error ? err.message : copy.communityUpdatePreviewFailed,
        },
      }));
    }
  }, [copy.communityUpdatePreviewFailed]);

  const markCommunityPluginUpdated = useCallback((
    pluginId: string,
    version: string,
  ) => {
    setCommunityCatalog((current) => applyCommunityUpdateToCatalog(current, pluginId, version));
  }, []);

  const applyCommunityUpdate = useCallback(async (
    plugin: ObsidianCommunityCatalogItem,
    plan: ObsidianCommunityUpdatePlan,
  ) => {
    const confirmed = window.confirm(copy.communityUpdateApplyConfirm(plugin.name, plan.version.remote));
    if (!confirmed) return;

    setCommunityUpdates((current) => ({
      ...current,
      [plugin.id]: { loading: true },
    }));

    try {
      const result = await apiFetch<UpdateObsidianCommunityPluginResult>(
        '/api/obsidian/community-catalog/update',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repo: plugin.repo,
            pluginId: plugin.id,
            confirm: true,
            expectedRemoteVersion: plan.version.remote,
            expectedPackageDigest: plan.packageDigest.package,
          }),
        },
      );
      markCommunityPluginUpdated(plugin.id, result.updated.version);
      setCommunityPreflights((current) => ({
        ...current,
        [plugin.id]: { loading: false, result: result.preflight },
      }));
      setCommunityUpdatePlans((current) => {
        const next = { ...current };
        delete next[plugin.id];
        return next;
      });
      setCommunityUpdates((current) => ({
        ...current,
        [plugin.id]: { loading: false, version: result.updated.version },
      }));
      notifyObsidianPluginPackagesChanged();
    } catch (err) {
      setCommunityUpdates((current) => ({
        ...current,
        [plugin.id]: {
          loading: false,
          error: err instanceof Error ? err.message : copy.communityUpdateApplyFailed,
        },
      }));
    }
  }, [copy, markCommunityPluginUpdated]);

  const markCommunityPluginInstalled = useCallback((
    pluginId: string,
    preflight: ObsidianCommunityPluginPreflight,
  ) => {
    setCommunityCatalog((current) => applyCommunityInstallToCatalog(current, pluginId, preflight));
  }, []);

  const installCommunityPlugin = useCallback(async (plugin: ObsidianCommunityCatalogItem) => {
    const preflight = communityPreflights[plugin.id]?.result;
    const confirmed = window.confirm(
      preflight?.support?.kind === 'review'
        ? copy.communityInstallConfirmReview(plugin.name, preflight.support.reason)
        : copy.communityInstallConfirm(plugin.name),
    );
    if (!confirmed) return;

    setCommunityInstalls((current) => ({
      ...current,
      [plugin.id]: { loading: true },
    }));

    try {
      const result = await apiFetch<ObsidianCommunityInstallResponse>(
        '/api/obsidian/community-catalog/install',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repo: plugin.repo,
            pluginId: plugin.id,
            confirm: true,
          }),
        },
      );
      markCommunityPluginInstalled(plugin.id, result.preflight);
      setCommunityPreflights((current) => ({
        ...current,
        [plugin.id]: { loading: false, result: result.preflight },
      }));
      setCommunityInstalls((current) => ({
        ...current,
        [plugin.id]: {
          loading: false,
          installedVersion: result.preflight.package.manifest.version,
        },
      }));
      notifyObsidianPluginPackagesChanged();
    } catch (err) {
      setCommunityInstalls((current) => ({
        ...current,
        [plugin.id]: {
          loading: false,
          error: err instanceof Error ? err.message : copy.communityInstallFailed,
        },
      }));
    }
  }, [communityPreflights, copy, markCommunityPluginInstalled]);

  useEffect(() => {
    if (panel !== 'community' || communityLoaded) return;
    void loadCommunityCatalog('');
  }, [communityLoaded, loadCommunityCatalog, panel]);

  const rendererStats = useMemo(() => {
    const core = renderers.filter((renderer) => renderer.core).length;
    const optional = renderers.length - core;
    const enabled = renderers.filter((renderer) => (
      renderer.core || (pluginStates[renderer.id] ?? isRendererEnabled(renderer.id))
    )).length;
    return { core, optional, enabled, total: renderers.length };
  }, [pluginStates, renderers]);

  const managerStats = {
    total: catalogCounts?.total ?? rendererStats.total,
    obsidian: catalogCounts?.bySource.obsidian ?? 0,
    surfaces: catalogCounts?.surfaces.total ?? rendererStats.total,
  };
  const catalogBucketCounts = {
    all: catalogCounts?.buckets?.all ?? managerStats.total,
    mindos: catalogCounts?.buckets?.mindos
      ?? ((catalogCounts?.bySource['mindos-renderer'] ?? rendererStats.total) + (catalogCounts?.bySource['runtime-extension'] ?? 0)),
    obsidian: catalogCounts?.buckets?.obsidian ?? catalogCounts?.bySource.obsidian ?? 0,
    disabled: catalogCounts?.buckets?.disabled ?? catalogCounts?.disabled ?? 0,
    problem: catalogCounts?.buckets?.problem ?? (catalogCounts?.blocked ?? 0) + (catalogCounts?.errors ?? 0),
  };
  const catalogProblemCount = catalogBucketCounts.problem;
  const catalogFilters: CatalogFilterOption[] = [
    {
      id: 'all',
      label: copy.catalogAllFilter,
      description: copy.catalogAllFilterDesc,
      count: catalogBucketCounts.all,
      icon: Puzzle,
    },
    {
      id: 'mindos',
      label: copy.catalogMindosFilter,
      description: copy.catalogMindosFilterDesc,
      count: catalogBucketCounts.mindos,
      icon: Puzzle,
    },
    {
      id: 'obsidian',
      label: copy.catalogObsidianFilter,
      description: copy.catalogObsidianFilterDesc,
      count: catalogBucketCounts.obsidian,
      icon: FolderOpen,
    },
    {
      id: 'disabled',
      label: copy.catalogDisabledFilter,
      description: copy.catalogDisabledFilterDesc,
      count: catalogBucketCounts.disabled,
      icon: Circle,
    },
    {
      id: 'problem',
      label: copy.catalogProblemFilter,
      description: copy.catalogProblemFilterDesc,
      count: catalogProblemCount,
      icon: AlertTriangle,
    },
  ];
  const activeCatalogFilter = catalogFilters.find((item) => item.id === catalogFilter) ?? catalogFilters[0];
  const filteredCatalogPlugins = useMemo(
    () => catalogPlugins.filter((plugin) => pluginCatalogBucketMatches(catalogFilter, plugin)),
    [catalogFilter, catalogPlugins],
  );
  const rendererCatalogById = useMemo(() => new Map(
    catalogPlugins
      .filter((plugin) => plugin.source === 'mindos-renderer')
      .map((plugin) => [plugin.id, plugin]),
  ), [catalogPlugins]);

  const openObsidianPluginInHost = useCallback((pluginId: string) => {
    setFocusedObsidianPluginId(pluginId);
    changePanel('installed');
  }, [changePanel]);

  const setObsidianHotkeysEnabled = useCallback((enabled: boolean) => {
    setObsidianHotkeysEnabledState(enabled);
    setObsidianPluginHotkeysEnabled(enabled);
  }, []);

  const handleFocusedObsidianPlugin = useCallback((pluginId: string) => {
    setFocusedObsidianPluginId((current) => (current === pluginId ? null : current));
  }, []);

  const panels: PluginManagerNavItem[] = [
    { id: 'installed', label: copy.installedTab, icon: Puzzle, count: managerStats.total },
    { id: 'community', label: copy.communityTab, icon: Globe2, count: communityCatalog?.counts.total },
    { id: 'import', label: copy.importTab, icon: FolderOpen },
    { id: 'surfaces', label: copy.surfacesTab, icon: PanelRightOpen },
  ];

  return (
    <div className="space-y-5">
      <PluginManagerHeader
        copy={copy}
        panel={panel}
        panels={panels}
        onPanelChange={changePanel}
      />

      {panel === 'installed' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-border/60 bg-card/65 p-4 shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{copy.catalogInventoryTitle}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.catalogInventoryDesc}</p>
              </div>
              {catalogProblemCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-error/25 bg-error/10 px-2 py-1 font-mono text-2xs text-error">
                  <AlertTriangle size={11} />
                  {copy.catalogProblemMetric(catalogProblemCount)}
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {catalogFilters.map((item) => {
                const Icon = item.icon;
                const active = item.id === catalogFilter;
                const problem = item.id === 'problem' && item.count > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-plugin-catalog-filter={item.id}
                    aria-pressed={active}
                    onClick={() => setCatalogFilter(item.id)}
                    title={item.description}
                    className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? 'border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                        : 'border-border bg-card/45 text-muted-foreground hover:bg-muted/45 hover:text-foreground'
                    }`}
                  >
                    <Icon size={13} className={problem ? 'text-error' : active ? 'text-[var(--amber)]' : 'text-muted-foreground'} />
                    <span>{item.label}</span>
                    <span className={`font-mono tabular-nums ${
                      problem ? 'text-error' : active ? 'text-[var(--amber-text)]' : 'text-muted-foreground'
                    }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {catalogFilter !== 'all' && (
              <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background/55">
                <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{copy.catalogFilteredTitle(activeCatalogFilter.label)}</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">{copy.catalogFilteredDesc}</p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{filteredCatalogPlugins.length}</span>
                </div>
                {filteredCatalogPlugins.length === 0 ? (
                  <div className="px-4 py-5 text-sm text-muted-foreground">{copy.catalogNoMatches}</div>
                ) : (
                  <div>
                    {filteredCatalogPlugins.map((plugin, index) => (
                      <div
                        key={`${plugin.source}:${plugin.id}`}
                        className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${
                          index === 0 ? '' : 'border-t border-border/70'
                        }`}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-xs font-semibold text-muted-foreground">
                            {pluginSourceIcon(plugin)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{plugin.name}</span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                                {pluginSourceBadge(plugin.source, copy)}
                              </span>
                              <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${catalogStatusClass(plugin.status)}`}>
                                {copy.catalogStatus(plugin.status)}
                              </span>
                            </div>
                            {(plugin.lastError || plugin.compatibility?.reason || plugin.description) && (
                              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                                {plugin.lastError || plugin.compatibility?.reason || plugin.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex w-fit shrink-0 flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-2xs text-muted-foreground">
                            <CheckCircle2 size={11} className={plugin.surfaces.available > 0 ? 'text-success' : 'text-muted-foreground'} />
                            {copy.surfaceCountBadge(plugin.surfaces.total)}
                          </span>
                          {plugin.source === 'obsidian' && (
                            <button
                              type="button"
                              data-plugin-catalog-open-host={plugin.id}
                              aria-label={`${copy.openAction} ${plugin.name}`}
                              onClick={() => openObsidianPluginInHost(plugin.id)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <ExternalLink size={11} />
                              {copy.openAction}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{copy.mindosRenderersTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{copy.mindosRenderersDesc}</p>
              </div>
              {rendererStats.optional > 0 && (
                <span className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-2xs text-muted-foreground">
                  {rendererStats.optional} {copy.optionalMetric}
                </span>
              )}
            </div>

            {renderers.length === 0 ? (
              <div className="rounded-xl border border-border bg-card/45 px-4 py-8 text-center text-sm text-muted-foreground">
                {copy.noPlugins}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card/55">
                {renderers.map((renderer, index) => {
                  const isCore = !!renderer.core;
                  const catalogItem = rendererCatalogById.get(renderer.id);
                  const enabled = isCore ? true : (catalogItem?.enabled ?? pluginStates[renderer.id] ?? isRendererEnabled(renderer.id));
                  const surfaceCount = catalogItem?.surfaces.total;
                  return (
                    <div
                      key={renderer.id}
                      className={`flex flex-col gap-3 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                        index === 0 ? '' : 'border-t border-border/70'
                      } ${enabled ? 'bg-card/40' : 'bg-muted/20 opacity-65'}`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-xl leading-none">
                          {renderer.icon}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{renderer.name}</span>
                            {isCore && (
                              <span className="rounded bg-[var(--amber-subtle)] px-1.5 py-0.5 font-mono text-2xs text-[var(--amber-text)]">
                                {copy.coreBadge}
                              </span>
                            )}
                            {renderer.builtin && !isCore && (
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                                {copy.builtinBadge}
                              </span>
                            )}
                            {typeof surfaceCount === 'number' && (
                              <span className="rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                                {copy.surfaceCountBadge(surfaceCount)}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{renderer.description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="flex min-w-0 max-w-full flex-wrap items-center gap-1 font-mono text-2xs text-muted-foreground/70">
                              <span>{copy.matchHint}:</span>
                              <code className="max-w-full break-all rounded bg-muted px-1 py-0.5">{rendererMatchLabel(renderer.match)}</code>
                            </span>
                            {renderer.tags.map(tag => (
                              <span key={tag} className="rounded bg-muted/60 px-1.5 py-0.5 text-2xs text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                        <span className="text-xs text-muted-foreground">{enabled ? copy.enabled : copy.disabled}</span>
                        {isCore ? (
                          <Toggle checked={true} disabled title={copy.coreHint} />
                        ) : (
                          <Toggle
                            checked={enabled}
                            onChange={(next) => {
                              setRendererEnabled(renderer.id, next);
                              setPluginStates(s => ({ ...s, [renderer.id]: next }));
                            }}
                            title={enabled ? copy.enabled : copy.disabled}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <ObsidianPluginHostSection
            onOpenPluginEntries={onOpenPluginEntries}
            onOpenCommandCenter={onOpenCommandCenter}
            onOpenPluginViews={onOpenPluginViews}
            focusPluginId={focusedObsidianPluginId}
            onFocusedPlugin={handleFocusedObsidianPlugin}
          />
        </div>
      )}

      {panel === 'community' && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-card/65 p-4 shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{copy.communityTitle}</h3>
                  <span className="rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 py-0.5 font-mono text-2xs text-[var(--amber-text)]">
                    {copy.communityReadOnlyBadge}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{copy.communityDesc}</p>
              </div>

              <form
                className="flex w-full min-w-0 flex-col gap-2 sm:flex-row lg:max-w-md"
                onSubmit={(event) => {
                  event.preventDefault();
                  const nextQuery = communityInput.trim();
                  setCommunityQuery(nextQuery);
                  void loadCommunityCatalog(nextQuery);
                }}
              >
                <div className="relative min-w-0 flex-1">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    data-obsidian-community-search
                    value={communityInput}
                    onChange={(event) => setCommunityInput(event.target.value)}
                    placeholder={copy.communitySearchPlaceholder}
                    className="h-9 w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <button
                  type="submit"
                  data-obsidian-community-search-submit
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Search size={13} />
                  {copy.communitySearchAction}
                </button>
                <button
                  type="button"
                  onClick={() => void loadCommunityCatalog(communityQuery)}
                  disabled={communityLoading}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw size={13} className={communityLoading ? 'animate-spin' : ''} />
                  {copy.communityRefreshAction}
                </button>
              </form>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
              {[
                { label: copy.communityTotalMetric, value: communityCatalog?.counts.total ?? 0, icon: Globe2 },
                { label: copy.communityReturnedMetric, value: communityCatalog?.counts.returned ?? 0, icon: Search },
                { label: copy.communityInstalledMetric, value: communityCatalog?.counts.installed ?? 0, icon: CheckCircle2 },
                { label: copy.communityProblemMetric, value: (communityCatalog?.counts.blocked ?? 0) + (communityCatalog?.counts.errors ?? 0), icon: AlertTriangle },
              ].map((metric) => {
                const Icon = metric.icon;
                return (
                  <span
                    key={metric.label}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-2xs text-muted-foreground"
                  >
                    <Icon size={11} />
                    <span>{metric.label}</span>
                    <span className="font-mono font-semibold tabular-nums text-foreground">{metric.value}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {communityError && (
            <div className="rounded-xl border border-error/25 bg-error/10 px-4 py-3 text-sm text-error">
              {copy.communityLoadFailed}: {communityError}
            </div>
          )}

          {communitySkipped.length > 0 && !communityError && (
            <div className="rounded-xl border border-border bg-muted/35 px-4 py-2 text-xs text-muted-foreground">
              {copy.communitySkippedNotice(communitySkipped.length)}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-card/55">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{copy.communityOfficialSource}</p>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {communityQuery ? copy.communityQueryLabel(communityQuery) : copy.communityDefaultQueryLabel}
                </p>
              </div>
              {communityLoading && (
                <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <RefreshCw size={11} className="animate-spin" />
                  {copy.communityLoading}
                </span>
              )}
            </div>

            {!communityLoading && !communityError && (!communityCatalog || communityCatalog.plugins.length === 0) ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">{copy.communityNoResults}</div>
            ) : (
              <div>
                {(communityCatalog?.plugins ?? []).map((plugin, index) => (
                  <CommunityPluginRow
                    key={plugin.id}
                    copy={copy}
                    plugin={plugin}
                    index={index}
                    preflight={communityPreflights[plugin.id]}
                    install={communityInstalls[plugin.id]}
                    updatePlan={communityUpdatePlans[plugin.id]}
                    update={communityUpdates[plugin.id]}
                    onCheckPreflight={checkCommunityPreflight}
                    onPreviewUpdatePlan={previewCommunityUpdatePlan}
                    onApplyUpdate={applyCommunityUpdate}
                    onInstall={installCommunityPlugin}
                    onOpenHost={openObsidianPluginInHost}
                    onOpenImportPanel={() => changePanel('import')}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {panel === 'import' && (
        <section>
          <ObsidianImportSection initialExpanded />
        </section>
      )}

      {panel === 'surfaces' && (
        <PluginSurfacesPanel
          copy={copy}
          surfaceInventory={surfaceInventory}
          onRefreshSurfaceInventory={refreshSurfaceInventory}
          obsidianHotkeysEnabled={obsidianHotkeysEnabled}
          onObsidianHotkeysEnabledChange={setObsidianHotkeysEnabled}
          onOpenPluginEntries={onOpenPluginEntries}
          onOpenCommandCenter={onOpenCommandCenter}
          onOpenPluginViews={onOpenPluginViews}
        />
      )}
    </div>
  );
}
