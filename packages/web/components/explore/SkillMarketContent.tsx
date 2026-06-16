'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Compass,
  Copy,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import {
  SKILL_MARKET_DEFAULT_QUERY,
  type SkillMarketCatalog,
  type SkillMarketItem,
} from '@/lib/skill-market/catalog';
import type { Messages } from '@/lib/i18n';

interface SkillMarketSearchResponse {
  ok: boolean;
  catalog: SkillMarketCatalog;
  skipped: Array<{ index: number; reason: string }>;
  cache?: {
    state: 'fresh' | 'refreshed' | 'stale';
    fetchedAt: string;
    ttlMs: number;
  };
  upstream?: {
    query?: string;
    searchType?: string;
    durationMs?: number;
  };
}

type SkillMarketCopy = Messages['skillMarket'];
type SkillMarketFilter = 'all' | 'available' | 'installed';

const SKILL_MARKET_LIMIT = 60;
const MARKET_INITIAL_VISIBLE_COUNT = 24;
const MARKET_VISIBLE_INCREMENT = 24;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function normalizeSearchInput(input: string): string {
  const trimmed = input.trim();
  return trimmed.length >= 2 ? trimmed : SKILL_MARKET_DEFAULT_QUERY;
}

function marketFilterMatches(filter: SkillMarketFilter, skill: SkillMarketItem): boolean {
  if (filter === 'available') return !skill.installed;
  if (filter === 'installed') return skill.installed;
  return true;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export default function SkillMarketContent() {
  const { t } = useLocale();
  const copy = t.skillMarket;
  const [skillInput, setSkillInput] = useState('');
  const [skillQuery, setSkillQuery] = useState(SKILL_MARKET_DEFAULT_QUERY);
  const [catalog, setCatalog] = useState<SkillMarketCatalog | null>(null);
  const [cache, setCache] = useState<SkillMarketSearchResponse['cache'] | null>(null);
  const [skipped, setSkipped] = useState<Array<{ index: number; reason: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<SkillMarketFilter>('all');
  const [visibleCount, setVisibleCount] = useState(MARKET_INITIAL_VISIBLE_COUNT);
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const catalogCacheRef = useRef(new Map<string, SkillMarketSearchResponse>());
  const catalogInFlightKeyRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSkillCatalog = useCallback(async (query: string, options: { force?: boolean } = {}) => {
    const normalizedQuery = normalizeSearchInput(query);
    const cacheKey = `${SKILL_MARKET_LIMIT}:${normalizedQuery}`;
    if (!options.force) {
      const cached = catalogCacheRef.current.get(cacheKey);
      if (cached) {
        setCatalog(cached.catalog ?? null);
        setCache(cached.cache ?? null);
        setSkipped(Array.isArray(cached.skipped) ? cached.skipped : []);
        setError(null);
        setLoading(false);
        return;
      }
      if (catalogInFlightKeyRef.current === cacheKey) return;
    } else {
      catalogCacheRef.current.delete(cacheKey);
    }

    const requestSeq = loadSeqRef.current + 1;
    loadSeqRef.current = requestSeq;
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    catalogInFlightKeyRef.current = cacheKey;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set('limit', String(SKILL_MARKET_LIMIT));
    params.set('q', normalizedQuery);
    if (options.force) params.set('refresh', '1');

    try {
      const data = await apiFetch<SkillMarketSearchResponse>(
        `/api/skill-market/search?${params.toString()}`,
        { cache: 'no-store', signal: controller.signal },
      );
      if (loadSeqRef.current !== requestSeq || catalogAbortRef.current !== controller) return;
      catalogCacheRef.current.set(cacheKey, data);
      setCatalog(data.catalog ?? null);
      setCache(data.cache ?? null);
      setSkipped(Array.isArray(data.skipped) ? data.skipped : []);
    } catch (err) {
      if (isAbortError(err) || loadSeqRef.current !== requestSeq || catalogAbortRef.current !== controller) return;
      setCatalog(null);
      setCache(null);
      setSkipped([]);
      setError(err instanceof Error ? err.message : copy.loadFailed);
    } finally {
      if (loadSeqRef.current === requestSeq && catalogAbortRef.current === controller) {
        setLoading(false);
        catalogAbortRef.current = null;
      }
      if (catalogInFlightKeyRef.current === cacheKey) {
        catalogInFlightKeyRef.current = null;
      }
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    void loadSkillCatalog(SKILL_MARKET_DEFAULT_QUERY);
  }, [loadSkillCatalog]);

  useEffect(() => () => {
    catalogAbortRef.current?.abort();
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const skills = catalog?.skills ?? [];
  const filteredSkills = useMemo(
    () => skills.filter((skill) => marketFilterMatches(marketFilter, skill)),
    [skills, marketFilter],
  );
  const visibleSkills = useMemo(
    () => filteredSkills.slice(0, visibleCount),
    [filteredSkills, visibleCount],
  );
  const hasMoreSkills = visibleSkills.length < filteredSkills.length;
  const marketFilters = useMemo(() => [
    { id: 'all' as const, label: copy.filterAll, count: skills.length },
    { id: 'available' as const, label: copy.filterAvailable, count: skills.filter((skill) => !skill.installed).length },
    { id: 'installed' as const, label: copy.filterInstalled, count: skills.filter((skill) => skill.installed).length },
  ], [copy, skills]);
  const marketMetrics = useMemo(() => [
    { label: copy.totalMetric, value: catalog ? catalog.counts.total : '-', icon: Compass },
    { label: copy.returnedMetric, value: catalog ? catalog.counts.returned : '-', icon: Search },
    { label: copy.installedMetric, value: catalog ? catalog.counts.installed : '-', icon: PackageCheck },
    { label: copy.installableMetric, value: catalog ? catalog.counts.installable : '-', icon: Terminal },
  ], [catalog, copy]);

  useEffect(() => {
    setVisibleCount(MARKET_INITIAL_VISIBLE_COUNT);
  }, [skillQuery, marketFilter, catalog]);

  const copyInstallCommand = useCallback(async (skill: SkillMarketItem) => {
    if (!skill.installCommand) return;
    await writeClipboardText(skill.installCommand);
    setCopiedSkillId(skill.id);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedSkillId(null), 1600);
  }, []);

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="content-width px-4 py-8 md:px-6 md:py-10">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Link
              href="/explore"
              className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft size={14} />
              {copy.backToExplore}
            </Link>
            <div className="flex items-center gap-2">
              <div className="h-5 w-1 rounded-full bg-[var(--amber)]" />
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {copy.title}
              </h1>
            </div>
            <p className="mt-3 max-w-3xl pl-4 text-sm leading-relaxed text-muted-foreground">
              {copy.subtitle}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 pl-4">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-card/60 px-2 font-mono text-2xs text-muted-foreground">
                <Zap size={11} />
                {copy.sourceBadge}
              </span>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 font-mono text-2xs text-[var(--amber-text)]">
                <ShieldCheck size={11} />
                {copy.reviewBadge}
              </span>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-card/60 px-2 font-mono text-2xs text-muted-foreground">
                <Terminal size={11} />
                {copy.cliBadge}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:pt-11">
            <Link
              href="/agents?tab=skills"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2.5 text-xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PackageCheck size={13} />
              {copy.manageAction}
            </Link>
          </div>
        </header>

        <section className="mb-4 rounded-xl border border-border/60 bg-card/65 p-4 shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
          <form
            className="flex flex-col gap-2 md:flex-row md:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              const nextQuery = normalizeSearchInput(skillInput);
              setSkillQuery(nextQuery);
              void loadSkillCatalog(nextQuery);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label={copy.searchPlaceholder}
                data-skill-market-search
                value={skillInput}
                onChange={(event) => setSkillInput(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="h-10 w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {(skillInput || skillQuery !== SKILL_MARKET_DEFAULT_QUERY) && (
                <button
                  type="button"
                  onClick={() => {
                    setSkillInput('');
                    setSkillQuery(SKILL_MARKET_DEFAULT_QUERY);
                    void loadSkillCatalog(SKILL_MARKET_DEFAULT_QUERY);
                  }}
                  disabled={loading}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={13} />
                  {copy.clearSearch}
                </button>
              )}
              <button
                type="submit"
                data-skill-market-search-submit
                disabled={loading}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Search size={13} />
                {copy.searchAction}
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextQuery = normalizeSearchInput(skillInput || skillQuery);
                  setSkillQuery(nextQuery);
                  void loadSkillCatalog(nextQuery, { force: true });
                }}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                {copy.refreshAction}
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <span className="text-2xs font-medium uppercase text-muted-foreground">{copy.filterTitle}</span>
            {marketFilters.map((filter) => {
              const active = marketFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  data-skill-market-filter={filter.id}
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
          aria-busy={loading}
          aria-live="polite"
          className="overflow-hidden rounded-lg border border-border bg-card/55"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{copy.marketplaceTitle}</h2>
                <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                  {copy.sourceBadge}
                </span>
                <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                  {catalog?.defaultedQuery ? copy.defaultQueryLabel : copy.queryLabel(skillQuery)}
                </span>
                {cache && (
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${
                    cache.state === 'stale'
                      ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                      : 'border-success/25 bg-success/10 text-success'
                  }`}
                  >
                    {copy.cacheState(cache.state)}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {copy.resultNote}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {catalog && marketMetrics.map((metric) => {
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
              {!loading && filteredSkills.length > 0 && (
                <span className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 font-mono text-2xs text-muted-foreground">
                  {copy.showingCount(visibleSkills.length, filteredSkills.length)}
                </span>
              )}
              {loading && (
                <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <RefreshCw size={11} className="animate-spin" />
                  {copy.loading}
                </span>
              )}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="flex flex-col gap-2 border-b border-error/20 bg-error/10 px-4 py-3 text-sm text-error sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{copy.loadFailed}: {error}</span>
              <button
                type="button"
                onClick={() => void loadSkillCatalog(skillQuery, { force: true })}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-error/25 bg-background px-2.5 text-2xs font-medium text-error transition-colors hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
              >
                <RefreshCw size={11} />
                {copy.retryAction}
              </button>
            </div>
          )}

          {skipped.length > 0 && !error && (
            <div className="border-b border-border/70 bg-muted/35 px-4 py-2 text-xs text-muted-foreground">
              {copy.skippedNotice(skipped.length)}
            </div>
          )}

          {loading && skills.length === 0 ? (
            <MarketSkeletonRows />
          ) : !error && filteredSkills.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="text-sm font-medium text-foreground">{copy.noResults}</div>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                {copy.emptyHint}
              </p>
            </div>
          ) : (
            <div>
              {visibleSkills.map((skill, index) => (
                <MarketSkillRow
                  key={skill.id}
                  copy={copy}
                  skill={skill}
                  index={index}
                  copied={copiedSkillId === skill.id}
                  onCopyInstallCommand={copyInstallCommand}
                />
              ))}
              {!loading && hasMoreSkills && (
                <div className="border-t border-border/70 px-4 py-3 text-center">
                  <button
                    type="button"
                    data-skill-market-show-more
                    onClick={() => setVisibleCount((count) => count + MARKET_VISIBLE_INCREMENT)}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {copy.showMore(Math.min(MARKET_VISIBLE_INCREMENT, filteredSkills.length - visibleSkills.length))}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
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

const MarketSkillRow = memo(function MarketSkillRow({
  copy,
  skill,
  index,
  copied,
  onCopyInstallCommand,
}: {
  copy: SkillMarketCopy;
  skill: SkillMarketItem;
  index: number;
  copied: boolean;
  onCopyInstallCommand: (skill: SkillMarketItem) => void | Promise<void>;
}) {
  return (
    <article className={`px-4 py-4 ${index === 0 ? '' : 'border-t border-border/70'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background font-mono text-xs font-semibold text-[var(--amber-text)]">
            <Zap size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{skill.name}</h3>
              <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${
                skill.installed
                  ? 'border-success/25 bg-success/10 text-success'
                  : skill.installable
                    ? 'border-border bg-background text-muted-foreground'
                    : 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
              }`}
              >
                {skill.installed ? copy.installedBadge : skill.installable ? copy.availableBadge : copy.notInstallableBadge}
              </span>
              {skill.installs !== undefined && (
                <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                  {copy.installsLabel(skill.installs)}
                </span>
              )}
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              {copy.sourceLabel}: {skill.sourceRepo}
            </p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {copy.inspectSourceHint}
            </p>
            {skill.installCommand && (
              <div className="mt-2 rounded-md border border-border bg-background px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
                  <Terminal size={11} />
                  {copy.commandLabel}
                </div>
                <code className="block break-all font-mono text-2xs leading-relaxed text-foreground">
                  {skill.installCommand}
                </code>
              </div>
            )}
          </div>
        </div>

        <div className="grid w-full shrink-0 grid-cols-1 gap-2 sm:w-auto sm:grid-cols-none sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          {skill.installed ? (
            <Link
              href="/agents?tab=skills"
              data-skill-market-manage={skill.id}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              <PackageCheck size={11} />
              {copy.manageInstalled}
            </Link>
          ) : skill.installCommand ? (
            <button
              type="button"
              data-skill-market-copy={skill.id}
              onClick={() => void onCopyInstallCommand(skill)}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2.5 text-2xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? copy.copiedCommand : copy.copyCommand}
            </button>
          ) : null}
          {skill.repoUrl && (
            <a
              href={skill.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              <ExternalLink size={11} />
              {copy.sourceAction}
            </a>
          )}
        </div>
      </div>
    </article>
  );
});
