'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Compass,
  Download,
  ExternalLink,
  PackageCheck,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import type {
  ObsidianCommunityCatalog,
  ObsidianCommunityCatalogItem,
  ObsidianCommunityPluginPreflight,
} from '@/lib/obsidian-compat/community-catalog';
import type { PluginCatalogCounts, PluginCatalogItem } from '@/lib/plugins/catalog';
import { notifyObsidianPluginPackagesChanged } from '@/lib/plugins/events';
import {
  applyCommunityInstallToCatalog,
  communityPreflightClass,
  communityPreflightSupport,
  communityPreflightSupportClass,
  communityPreflightSupportLevel,
  communityPreflightSurfaceClass,
  communityPreflightSurfaces,
  communityStatusClass,
  type CommunityInstallState,
  type CommunityPreflightState,
  type ObsidianCommunityCatalogResponse,
  type ObsidianCommunityInstallResponse,
  type PluginCatalogResponse,
  type PluginsCopy,
} from '@/components/settings/PluginsTabModel';

interface LocalCatalogState {
  loading: boolean;
  plugins: PluginCatalogItem[];
  counts: PluginCatalogCounts | null;
  error?: string;
}

interface CommunityCatalogCacheInfo {
  state: 'fresh' | 'refreshed' | 'stale';
  fetchedAt: string;
  ttlMs: number;
}

type MarketFilter = 'all' | 'available' | 'installed' | 'issues';

const COMMUNITY_CATALOG_LIMIT = 80;
const MARKET_INITIAL_VISIBLE_COUNT = 24;
const MARKET_VISIBLE_INCREMENT = 24;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function marketFilterMatches(filter: MarketFilter, plugin: ObsidianCommunityCatalogItem): boolean {
  if (filter === 'available') return !plugin.installed && plugin.installStatus === 'available';
  if (filter === 'installed') return plugin.installed;
  if (filter === 'issues') return plugin.installStatus === 'blocked' || plugin.installStatus === 'error';
  return true;
}

export default function PluginMarketContent() {
  const { t } = useLocale();
  const copy = t.settings.plugins;
  const [localCatalog, setLocalCatalog] = useState<LocalCatalogState>({
    loading: false,
    plugins: [],
    counts: null,
  });
  const [localCatalogRequested, setLocalCatalogRequested] = useState(false);
  const [communityInput, setCommunityInput] = useState('');
  const [communityQuery, setCommunityQuery] = useState('');
  const [communityCatalog, setCommunityCatalog] = useState<ObsidianCommunityCatalog | null>(null);
  const [communityCache, setCommunityCache] = useState<CommunityCatalogCacheInfo | null>(null);
  const [communitySkipped, setCommunitySkipped] = useState<Array<{ index: number; reason: string }>>([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityPreflights, setCommunityPreflights] = useState<Record<string, CommunityPreflightState>>({});
  const [communityInstalls, setCommunityInstalls] = useState<Record<string, CommunityInstallState>>({});
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [visibleCount, setVisibleCount] = useState(MARKET_INITIAL_VISIBLE_COUNT);
  const localCatalogAbortRef = useRef<AbortController | null>(null);
  const communityCatalogAbortRef = useRef<AbortController | null>(null);
  const communityCatalogCacheRef = useRef(new Map<string, ObsidianCommunityCatalogResponse>());
  const communityCatalogInFlightKeyRef = useRef<string | null>(null);
  const communityLoadSeqRef = useRef(0);
  const communityPreflightsRef = useRef<Record<string, CommunityPreflightState>>({});
  const communityPreflightAbortRefs = useRef(new Map<string, AbortController>());

  const loadLocalCatalog = useCallback(async () => {
    setLocalCatalogRequested(true);
    localCatalogAbortRef.current?.abort();
    const controller = new AbortController();
    localCatalogAbortRef.current = controller;
    setLocalCatalog((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const data = await apiFetch<PluginCatalogResponse>('/api/plugins/catalog', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (localCatalogAbortRef.current !== controller) return;
      setLocalCatalog({
        loading: false,
        plugins: Array.isArray(data.plugins) ? data.plugins : [],
        counts: data.counts ?? null,
      });
    } catch (err) {
      if (isAbortError(err) || localCatalogAbortRef.current !== controller) return;
      setLocalCatalog({
        loading: false,
        plugins: [],
        counts: null,
        error: err instanceof Error ? err.message : copy.marketLocalLoadFailed,
      });
    } finally {
      if (localCatalogAbortRef.current === controller) {
        localCatalogAbortRef.current = null;
      }
    }
  }, [copy.marketLocalLoadFailed]);

  const loadCommunityCatalog = useCallback(async (query: string, options: { force?: boolean } = {}) => {
    const normalizedQuery = query.trim();
    const cacheKey = `${COMMUNITY_CATALOG_LIMIT}:${normalizedQuery}`;
    if (!options.force) {
      const cached = communityCatalogCacheRef.current.get(cacheKey);
      if (cached) {
        setCommunityCatalog(cached.catalog ?? null);
        setCommunityCache(cached.cache ?? null);
        setCommunitySkipped(Array.isArray(cached.skipped) ? cached.skipped : []);
        setCommunityError(null);
        setCommunityLoading(false);
        return;
      }
      if (communityCatalogInFlightKeyRef.current === cacheKey) return;
    } else {
      communityCatalogCacheRef.current.delete(cacheKey);
    }

    const requestSeq = communityLoadSeqRef.current + 1;
    communityLoadSeqRef.current = requestSeq;
    communityCatalogAbortRef.current?.abort();
    const controller = new AbortController();
    communityCatalogAbortRef.current = controller;
    communityCatalogInFlightKeyRef.current = cacheKey;
    setCommunityLoading(true);
    setCommunityError(null);

    const params = new URLSearchParams();
    params.set('limit', String(COMMUNITY_CATALOG_LIMIT));
    if (normalizedQuery) params.set('q', normalizedQuery);
    if (options.force) params.set('refresh', '1');

    try {
      const data = await apiFetch<ObsidianCommunityCatalogResponse>(
        `/api/obsidian/community-catalog?${params.toString()}`,
        { cache: 'no-store', signal: controller.signal },
      );
      if (communityLoadSeqRef.current !== requestSeq || communityCatalogAbortRef.current !== controller) return;
      communityCatalogCacheRef.current.set(cacheKey, data);
      setCommunityCatalog(data.catalog ?? null);
      setCommunityCache(data.cache ?? null);
      setCommunitySkipped(Array.isArray(data.skipped) ? data.skipped : []);
    } catch (err) {
      if (isAbortError(err) || communityLoadSeqRef.current !== requestSeq || communityCatalogAbortRef.current !== controller) return;
      setCommunityCatalog(null);
      setCommunityCache(null);
      setCommunitySkipped([]);
      setCommunityError(err instanceof Error ? err.message : copy.communityLoadFailed);
    } finally {
      if (communityLoadSeqRef.current === requestSeq && communityCatalogAbortRef.current === controller) {
        setCommunityLoading(false);
        communityCatalogAbortRef.current = null;
      }
      if (communityCatalogInFlightKeyRef.current === cacheKey) {
        communityCatalogInFlightKeyRef.current = null;
      }
    }
  }, [copy.communityLoadFailed]);

  useEffect(() => {
    void loadCommunityCatalog('');
  }, [loadCommunityCatalog]);

  useEffect(() => {
    communityPreflightsRef.current = communityPreflights;
  }, [communityPreflights]);

  useEffect(() => () => {
    localCatalogAbortRef.current?.abort();
    communityCatalogAbortRef.current?.abort();
    communityPreflightAbortRefs.current.forEach((controller) => controller.abort());
    communityPreflightAbortRefs.current.clear();
  }, []);

  const checkCommunityPreflight = useCallback(async (plugin: ObsidianCommunityCatalogItem) => {
    const current = communityPreflightsRef.current[plugin.id];
    if (current?.loading || current?.result || communityPreflightAbortRefs.current.has(plugin.id)) return;

    const controller = new AbortController();
    communityPreflightAbortRefs.current.set(plugin.id, controller);
    setCommunityPreflights((current) => ({
      ...current,
      [plugin.id]: { loading: true },
    }));

    const params = new URLSearchParams();
    params.set('repo', plugin.repo);
    params.set('pluginId', plugin.id);

    try {
      const result = await apiFetch<ObsidianCommunityPluginPreflight>(
        `/api/obsidian/community-catalog/preflight?${params.toString()}`,
        { cache: 'no-store', signal: controller.signal },
      );
      setCommunityPreflights((current) => ({
        ...current,
        [plugin.id]: { loading: false, result },
      }));
    } catch (err) {
      if (isAbortError(err)) return;
      setCommunityPreflights((current) => ({
        ...current,
        [plugin.id]: {
          loading: false,
          error: err instanceof Error ? err.message : copy.communityPreflightFailed,
        },
      }));
    } finally {
      communityPreflightAbortRefs.current.delete(plugin.id);
    }
  }, [copy.communityPreflightFailed]);

  const installCommunityPlugin = useCallback(async (
    plugin: ObsidianCommunityCatalogItem,
    preflight?: ObsidianCommunityPluginPreflight,
  ) => {
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
      setCommunityCatalog((current) => applyCommunityInstallToCatalog(current, plugin.id, result.preflight));
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
      void loadLocalCatalog();
    } catch (err) {
      setCommunityInstalls((current) => ({
        ...current,
        [plugin.id]: {
          loading: false,
          error: err instanceof Error ? err.message : copy.communityInstallFailed,
        },
      }));
    }
  }, [copy, loadLocalCatalog]);

  const localPreview = useMemo(
    () => localCatalog.plugins
      .filter((plugin) => plugin.source === 'obsidian' || plugin.status === 'blocked' || plugin.status === 'error')
      .slice(0, 4),
    [localCatalog.plugins],
  );
  const communityPlugins = communityCatalog?.plugins ?? [];
  const filteredCommunityPlugins = useMemo(
    () => communityPlugins.filter((plugin) => marketFilterMatches(marketFilter, plugin)),
    [communityPlugins, marketFilter],
  );
  const visibleCommunityPlugins = useMemo(
    () => filteredCommunityPlugins.slice(0, visibleCount),
    [filteredCommunityPlugins, visibleCount],
  );
  const hasMoreCommunityPlugins = visibleCommunityPlugins.length < filteredCommunityPlugins.length;
  const issueCount = (communityCatalog?.counts.blocked ?? 0) + (communityCatalog?.counts.errors ?? 0);
  const marketMetrics = useMemo(() => [
    {
      label: copy.communityTotalMetric,
      value: communityCatalog ? communityCatalog.counts.total : '-',
      icon: Compass,
    },
    {
      label: copy.communityReturnedMetric,
      value: communityCatalog ? communityCatalog.counts.returned : '-',
      icon: Search,
    },
    {
      label: copy.communityInstalledMetric,
      value: communityCatalog ? communityCatalog.counts.installed : '-',
      icon: PackageCheck,
    },
    {
      label: copy.communityProblemMetric,
      value: communityCatalog ? issueCount : '-',
      icon: AlertTriangle,
    },
  ], [communityCatalog, copy, issueCount]);
  const marketFilters = useMemo(() => [
    { id: 'all' as const, label: copy.marketFilterAll, count: communityPlugins.length },
    {
      id: 'available' as const,
      label: copy.marketFilterAvailable,
      count: communityPlugins.filter((plugin) => !plugin.installed && plugin.installStatus === 'available').length,
    },
    {
      id: 'installed' as const,
      label: copy.marketFilterInstalled,
      count: communityPlugins.filter((plugin) => plugin.installed).length,
    },
    {
      id: 'issues' as const,
      label: copy.marketFilterIssues,
      count: communityPlugins.filter((plugin) => plugin.installStatus === 'blocked' || plugin.installStatus === 'error').length,
    },
  ], [communityPlugins, copy]);

  useEffect(() => {
    setVisibleCount(MARKET_INITIAL_VISIBLE_COUNT);
  }, [communityQuery, marketFilter, communityCatalog]);

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-[72rem] px-4 py-6 md:px-6 md:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/explore"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={14} />
            {copy.marketBackToExplore}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/settings?tab=plugins&panel=import"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download size={13} />
              {copy.marketImportAction}
            </Link>
            <Link
              href="/settings?tab=plugins"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2.5 text-xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings size={13} />
              {copy.marketManageAction}
            </Link>
          </div>
        </div>

        <header className="mb-5">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber)]">
                <Puzzle size={16} />
              </span>
              <span className="rounded-md border border-border bg-card/60 px-2 py-1 font-mono text-2xs text-muted-foreground">
                {copy.marketSourceBadge}
              </span>
              <span className="rounded-md border border-success/25 bg-success/10 px-2 py-1 font-mono text-2xs text-success">
                {copy.communityReadOnlyBadge}
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-normal text-foreground md:text-4xl">
              {copy.marketTitle}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {copy.marketSubtitle}
            </p>
          </div>
        </header>

        <section className="mb-4 rounded-lg border border-border bg-card/45 p-3 md:p-4">
          <form
            className="flex flex-col gap-2 md:flex-row md:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              const nextQuery = communityInput.trim();
              setCommunityQuery(nextQuery);
              void loadCommunityCatalog(nextQuery);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label={copy.communitySearchPlaceholder}
                data-plugin-market-search
                value={communityInput}
                onChange={(event) => setCommunityInput(event.target.value)}
                placeholder={copy.communitySearchPlaceholder}
                className="h-10 w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {(communityInput || communityQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setCommunityInput('');
                    setCommunityQuery('');
                    void loadCommunityCatalog('');
                  }}
                  disabled={communityLoading}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={13} />
                  {copy.marketClearSearch}
                </button>
              )}
              <button
                type="submit"
                data-plugin-market-search-submit
                disabled={communityLoading}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Search size={13} />
                {copy.communitySearchAction}
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextQuery = communityInput.trim();
                  setCommunityQuery(nextQuery);
                  void loadCommunityCatalog(nextQuery, { force: true });
                }}
                disabled={communityLoading}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RefreshCw size={13} className={communityLoading ? 'animate-spin' : ''} />
                {copy.communityRefreshAction}
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <span className="text-2xs font-medium uppercase text-muted-foreground">{copy.marketFilterTitle}</span>
            {marketFilters.map((filter) => {
              const active = marketFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  data-plugin-market-filter={filter.id}
                  aria-pressed={active}
                  onClick={() => setMarketFilter(filter.id)}
                  className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? 'border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className="font-mono tabular-nums opacity-80">{filter.count}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          aria-busy={communityLoading}
          aria-live="polite"
          className="overflow-hidden rounded-lg border border-border bg-card/55"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{copy.communityOfficialSource}</h2>
                <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                  {communityQuery ? copy.communityQueryLabel(communityQuery) : copy.communityDefaultQueryLabel}
                </span>
                {communityCache && (
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${
                    communityCache.state === 'stale'
                      ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                      : 'border-success/25 bg-success/10 text-success'
                  }`}
                  >
                    {copy.marketCacheState(communityCache.state)}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {copy.marketResultNote}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {communityCatalog && marketMetrics.map((metric) => {
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
              {!communityLoading && filteredCommunityPlugins.length > 0 && (
                <span className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 font-mono text-2xs text-muted-foreground">
                  {copy.marketShowingCount(visibleCommunityPlugins.length, filteredCommunityPlugins.length)}
                </span>
              )}
              {communityLoading && (
                <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <RefreshCw size={11} className="animate-spin" />
                  {copy.communityLoading}
                </span>
              )}
            </div>
          </div>

          {communityError && (
            <div
              role="alert"
              className="flex flex-col gap-2 border-b border-error/20 bg-error/10 px-4 py-3 text-sm text-error sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{copy.communityLoadFailed}: {communityError}</span>
              <button
                type="button"
                onClick={() => void loadCommunityCatalog(communityQuery, { force: true })}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-error/25 bg-background px-2.5 text-2xs font-medium text-error transition-colors hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
              >
                <RefreshCw size={11} />
                {copy.marketRetryAction}
              </button>
            </div>
          )}

          {communitySkipped.length > 0 && !communityError && (
            <div className="border-b border-border/70 bg-muted/35 px-4 py-2 text-xs text-muted-foreground">
              {copy.communitySkippedNotice(communitySkipped.length)}
            </div>
          )}

          {communityLoading && communityPlugins.length === 0 ? (
            <MarketSkeletonRows />
          ) : !communityError && filteredCommunityPlugins.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="text-sm font-medium text-foreground">{copy.communityNoResults}</div>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                {copy.marketEmptyHint}
              </p>
            </div>
          ) : (
            <div>
              {visibleCommunityPlugins.map((plugin, index) => (
                <MarketPluginRow
                  key={plugin.id}
                  copy={copy}
                  plugin={plugin}
                  index={index}
                  preflight={communityPreflights[plugin.id]}
                  install={communityInstalls[plugin.id]}
                  onCheckPreflight={checkCommunityPreflight}
                  onInstall={installCommunityPlugin}
                />
              ))}
              {!communityLoading && hasMoreCommunityPlugins && (
                <div className="border-t border-border/70 px-4 py-3 text-center">
                  <button
                    type="button"
                    data-plugin-market-show-more
                    onClick={() => setVisibleCount((count) => count + MARKET_VISIBLE_INCREMENT)}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {copy.marketShowMore(Math.min(MARKET_VISIBLE_INCREMENT, filteredCommunityPlugins.length - visibleCommunityPlugins.length))}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        <LocalSnapshot
          copy={copy}
          requested={localCatalogRequested}
          loading={localCatalog.loading}
          counts={localCatalog.counts}
          plugins={localPreview}
          error={localCatalog.error}
          onRefresh={loadLocalCatalog}
        />
      </div>
    </main>
  );
}

function MarketSkeletonRows() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between ${
            index === 0 ? '' : 'border-t border-border/70'
          }`}
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-44 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-60 max-w-full animate-pulse rounded bg-muted/80" />
              <div className="h-2.5 w-full max-w-2xl animate-pulse rounded bg-muted/70" />
            </div>
          </div>
          <div className="flex gap-2">
            <span className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
            <span className="h-8 w-16 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

const LocalSnapshot = memo(function LocalSnapshot({
  copy,
  requested,
  loading,
  counts,
  plugins,
  error,
  onRefresh,
}: {
  copy: PluginsCopy;
  requested: boolean;
  loading: boolean;
  counts: PluginCatalogCounts | null;
  plugins: PluginCatalogItem[];
  error?: string;
  onRefresh: () => void;
}) {
  return (
    <aside className="mt-4 rounded-lg border border-border/80 bg-muted/25 px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <PackageCheck size={14} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{copy.marketLocalTitle}</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
              {requested ? copy.marketLocalDesc : copy.marketLocalDeferred}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {counts && (
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-border bg-background px-2 py-1 text-2xs text-muted-foreground">
                {copy.pluginsMetric} <span className="font-mono font-semibold tabular-nums text-foreground">{counts.total}</span>
              </span>
              <span className="rounded-md border border-border bg-background px-2 py-1 text-2xs text-muted-foreground">
                {copy.obsidianMetric} <span className="font-mono font-semibold tabular-nums text-[var(--amber-text)]">{counts.bySource.obsidian}</span>
              </span>
              <span className="rounded-md border border-border bg-background px-2 py-1 text-2xs text-muted-foreground">
                {copy.surfacesMetric} <span className="font-mono font-semibold tabular-nums text-foreground">{counts.surfaces.total}</span>
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {requested ? copy.surfaceInventoryRefresh : copy.marketLocalLoadAction}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-error/25 bg-error/10 px-3 py-2 text-2xs text-error">
          {copy.marketLocalLoadFailed}: {error}
        </p>
      )}
      {!error && requested && !loading && (
        <div className="mt-3 space-y-1.5">
          {plugins.length === 0 ? (
            <p className="rounded-md border border-border/70 bg-background/55 px-3 py-2 text-2xs text-muted-foreground">
              {copy.marketLocalEmpty}
            </p>
          ) : (
          plugins.map((plugin) => (
            <div
              key={`${plugin.source}:${plugin.id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/55 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{plugin.name}</p>
                <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">{plugin.id}</p>
              </div>
              <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                {copy.catalogStatus(plugin.status)}
              </span>
            </div>
          ))
        )}
        </div>
      )}
    </aside>
  );
});

const MarketPluginRow = memo(function MarketPluginRow({
  copy,
  plugin,
  index,
  preflight,
  install,
  onCheckPreflight,
  onInstall,
}: {
  copy: PluginsCopy;
  plugin: ObsidianCommunityCatalogItem;
  index: number;
  preflight?: CommunityPreflightState;
  install?: CommunityInstallState;
  onCheckPreflight: (plugin: ObsidianCommunityCatalogItem) => void | Promise<void>;
  onInstall: (
    plugin: ObsidianCommunityCatalogItem,
    preflight?: ObsidianCommunityPluginPreflight,
  ) => void | Promise<void>;
}) {
  const support = preflight?.result ? communityPreflightSupport(preflight.result) : null;
  const supportLevel = preflight?.result ? communityPreflightSupportLevel(preflight.result) : null;
  const surfaces = preflight?.result ? communityPreflightSurfaces(preflight.result) : [];
  const preflightBlocker = preflight?.result?.installBlockedReasons?.[0];
  const preflightSummary = preflightBlocker ?? support?.reason ?? copy.communityPreflightNoBlockers;
  const canInstall = !plugin.installed && preflight?.result?.installable === true;

  return (
    <article className={`px-4 py-4 ${index === 0 ? '' : 'border-t border-border/70'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background font-mono text-xs font-semibold text-[var(--amber-text)]">
            Ob
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{plugin.name}</h3>
              <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${communityStatusClass(plugin.installStatus)}`}>
                {copy.communityInstallStatus(plugin.installStatus)}
              </span>
              {supportLevel && (
                <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${communityPreflightSupportClass(supportLevel)}`}>
                  {copy.communityPreflightSupportLevel(supportLevel)}
                </span>
              )}
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              {plugin.author} · {plugin.repo}
            </p>
            {plugin.description && (
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{plugin.description}</p>
            )}
            {plugin.installedLastError && (
              <p className="mt-2 text-2xs text-error">{plugin.installedLastError}</p>
            )}
          </div>
        </div>

        <div className="grid w-full shrink-0 grid-cols-1 gap-2 sm:w-auto sm:grid-cols-none sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <button
            type="button"
            data-plugin-market-preflight={plugin.id}
            onClick={() => void onCheckPreflight(plugin)}
            disabled={preflight?.loading || Boolean(preflight?.result)}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            {preflight?.loading ? (
              <RefreshCw size={11} className="animate-spin" />
            ) : (
              <ShieldCheck size={11} />
            )}
            {preflight?.loading
              ? copy.communityPreflightChecking
              : preflight?.result
                ? copy.marketCheckedAction
                : copy.marketCheckAction}
          </button>
          {plugin.installed ? (
            <Link
              href="/settings?tab=plugins"
              data-plugin-market-manage={plugin.id}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              <Settings size={11} />
              {copy.communityManageAction}
            </Link>
          ) : canInstall ? (
            <button
              type="button"
              data-plugin-market-install={plugin.id}
              onClick={() => void onInstall(plugin, preflight?.result)}
              disabled={install?.loading}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2.5 text-2xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              {install?.loading ? (
                <RefreshCw size={11} className="animate-spin" />
              ) : (
                <Download size={11} />
              )}
              {install?.loading ? copy.communityInstallInstalling : copy.communityInstallAction}
            </button>
          ) : null}
          {plugin.githubUrl && (
            <a
              href={plugin.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              <ExternalLink size={11} />
              {copy.communityGithubAction}
            </a>
          )}
        </div>
      </div>

      {install?.installedVersion && (
        <div role="status" className="mt-3 rounded-md border border-success/25 bg-success/10 px-3 py-2 text-2xs leading-relaxed text-success">
          {copy.communityInstallSucceeded(install.installedVersion)}
        </div>
      )}

      {install?.error && (
        <div role="alert" className="mt-3 rounded-md border border-error/25 bg-error/10 px-3 py-2 text-2xs text-error">
          {copy.communityInstallFailed}: {install.error}
        </div>
      )}

      {preflight?.result && (
        <div className={`mt-3 rounded-md border px-3 py-2 ${communityPreflightClass(preflight.result)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck size={12} />
              {copy.communityPreflightStatus(preflight.result.compatibility.level, preflight.result.installable)}
            </span>
            <span className="font-mono text-2xs opacity-80">
              {copy.communityPreflightAssets(preflight.result.package.manifest.version, preflight.result.package.assets.stylesCss)}
            </span>
          </div>
          <p className="mt-1 text-2xs leading-relaxed opacity-90">
            {preflightSummary}
          </p>
          {support && supportLevel && (
            <details className="mt-2 border-t border-current/15 pt-2">
              <summary className="cursor-pointer select-none text-2xs font-medium opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {copy.marketDetailsAction}
              </summary>
              <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-2xs font-medium uppercase opacity-80">
                  <Sparkles size={11} />
                  {copy.communityPreflightRecommendationTitle}
                </span>
                <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${communityPreflightSupportClass(supportLevel)}`}>
                  {copy.communityPreflightRecommendation(supportLevel)}
                </span>
              </div>
              <p className="mt-1 text-2xs leading-relaxed opacity-90">
                {copy.communityPreflightRecommendationNote(supportLevel)}
              </p>
              {support.reason && (
                <p className="mt-1 text-2xs leading-relaxed opacity-90">
                  <span className="font-medium">{copy.communityPreflightSupportReasonLabel}</span>{' '}
                  {support.reason}
                </p>
              )}
              {surfaces.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {surfaces.map((surface) => (
                    <span
                      key={surface.id}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs ${communityPreflightSurfaceClass(surface.state)}`}
                    >
                      <span className="font-medium">{copy.communityPreflightSurfaceLabel(surface.id)}</span>
                      <span className="font-mono opacity-75">{copy.communityPreflightSurfaceState(surface.state)}</span>
                      <span className="font-mono opacity-60">{copy.communityPreflightSurfaceDetail(surface.id, surface.count)}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-2xs leading-relaxed opacity-75">
                  {copy.communityPreflightSurfaceEmpty}
                </p>
              )}
              </div>
            </details>
          )}
        </div>
      )}

      {preflight?.error && (
        <div role="alert" className="mt-3 rounded-md border border-error/25 bg-error/10 px-3 py-2 text-2xs text-error">
          {copy.communityPreflightFailed}: {preflight.error}
        </div>
      )}
    </article>
  );
});
