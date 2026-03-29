'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, History, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/LocaleContext';
import CustomSelect from '@/components/CustomSelect';
import { collapseDiffContext, buildLineDiff } from './line-diff';

/** Semantic color for operation type badges */
function opColorClass(op: string): string {
  if (op.startsWith('create') || op === 'import_file') return 'text-success';
  if (op.startsWith('delete')) return 'text-error';
  if (op.startsWith('rename') || op.startsWith('move')) return 'text-muted-foreground';
  return ''; // update_lines, update_section — default foreground
}

interface ChangeEvent {
  id: string;
  ts: string;
  op: string;
  path: string;
  source: 'user' | 'agent' | 'system';
  summary: string;
  before?: string;
  after?: string;
  beforePath?: string;
  afterPath?: string;
}

interface SummaryPayload {
  unreadCount: number;
  totalCount: number;
}

interface ListPayload {
  events: ChangeEvent[];
}

function relativeTime(ts: string, t: ReturnType<typeof useLocale>['t']): string {
  const delta = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return t.changes.relativeTime.justNow;
  if (mins < 60) return t.changes.relativeTime.minutesAgo(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.changes.relativeTime.hoursAgo(hours);
  return t.changes.relativeTime.daysAgo(Math.floor(hours / 24));
}

export default function ChangesContentPage({ initialPath = '' }: { initialPath?: string }) {
  const { t } = useLocale();
  const [pathFilter, setPathFilter] = useState(initialPath);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'agent' | 'user' | 'system'>('all');
  const [opFilter, setOpFilter] = useState<string>('all');
  const [queryFilter, setQueryFilter] = useState('');
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const [summary, setSummary] = useState<SummaryPayload>({ unreadCount: 0, totalCount: 0 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ op: 'list', limit: '120' });
      if (pathFilter.trim()) params.set('path', pathFilter.trim());
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (opFilter !== 'all') params.set('event_op', opFilter);
      if (queryFilter.trim()) params.set('q', queryFilter.trim());
      const listUrl = `/api/changes?${params.toString()}`;
      const [list, summaryData] = await Promise.all([
        apiFetch<ListPayload>(listUrl),
        apiFetch<SummaryPayload>('/api/changes?op=summary'),
      ]);
      setEvents(list.events);
      setSummary(summaryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load changes');
    } finally {
      setLoading(false);
    }
  }, [pathFilter, sourceFilter, opFilter, queryFilter]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const markSeen = useCallback(async () => {
    await apiFetch('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'mark_seen' }),
    });
    await fetchData();
  }, [fetchData]);

  const eventCountLabel = useMemo(() => t.changes.eventsCount(events.length), [events.length, t]);
  const opOptions = useMemo(() => {
    const ops = Array.from(new Set(events.map((e) => e.op))).sort((a, b) => a.localeCompare(b));
    if (opFilter !== 'all' && !ops.includes(opFilter)) ops.unshift(opFilter);
    return ['all', ...ops];
  }, [events, opFilter]);

  const sourceSelectOptions = useMemo(
    () => [
      { value: 'all', label: t.changes.filters.all },
      { value: 'agent', label: t.changes.filters.agent },
      { value: 'user', label: t.changes.filters.user },
      { value: 'system', label: t.changes.filters.system },
    ],
    [t],
  );

  const opSelectOptions = useMemo(
    () =>
      opOptions.map((op) => ({
        value: op,
        label: op === 'all' ? t.changes.filters.operationAll : op,
      })),
    [opOptions, t],
  );

  const sourceLabel = useCallback((source: ChangeEvent['source']) => {
    if (source === 'agent') return t.changes.filters.agent;
    if (source === 'user') return t.changes.filters.user;
    return t.changes.filters.system;
  }, [t]);

  return (
    <div className="min-h-screen">
      <div className="px-4 md:px-6 pt-6 md:pt-8">
        <div className="content-width xl:mr-[220px] rounded-xl border border-border bg-card px-4 py-3 md:px-5 md:py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground font-display">
                <History size={15} />
                {t.changes.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.changes.subtitle}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{eventCountLabel}</span>
                <span className="rounded-full bg-[var(--amber-dim)] px-2 py-0.5 text-[var(--amber)]">
                  {t.changes.unreadCount(summary.unreadCount)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchData()}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="inline-flex items-center gap-1"><RefreshCw size={12} /> {t.changes.refresh}</span>
              </button>
              <button
                type="button"
                onClick={() => void markSeen()}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.changes.markAllRead}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 md:py-6">
        <div className="content-width xl:mr-[220px] space-y-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
              <label className="block">
                <span className="text-xs text-muted-foreground font-display">{t.changes.filters.filePath}</span>
                <input
                  value={pathFilter}
                  onChange={(e) => setPathFilter(e.target.value)}
                  placeholder={t.changes.filters.filePathPlaceholder}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm bg-background border border-border rounded-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="block">
                <span className="text-xs text-muted-foreground font-display">{t.changes.filters.source}</span>
                <CustomSelect
                  value={sourceFilter}
                  onChange={(v) => setSourceFilter(v as 'all' | 'agent' | 'user' | 'system')}
                  options={sourceSelectOptions}
                  className="mt-1"
                />
              </div>
              <div className="block">
                <span className="text-xs text-muted-foreground font-display">{t.changes.filters.operation}</span>
                <CustomSelect
                  value={opFilter}
                  onChange={setOpFilter}
                  options={opSelectOptions}
                  className="mt-1"
                />
              </div>
              <label className="block">
                <span className="text-xs text-muted-foreground font-display">{t.changes.filters.keyword}</span>
                <input
                  value={queryFilter}
                  onChange={(e) => setQueryFilter(e.target.value)}
                  placeholder={t.changes.filters.keywordPlaceholder}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm bg-background border border-border rounded-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>
          </div>

          {loading && <p className="text-sm text-muted-foreground">{t.changes.loading}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
          {!loading && !error && events.length === 0 && (
            <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              {t.changes.empty}
            </div>
          )}

          {!loading && !error && events.map((event) => {
            const open = !!expanded[event.id];
            const rows = collapseDiffContext(buildLineDiff(event.before ?? '', event.after ?? ''));
            return (
              <div key={event.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [event.id]: !prev[event.id] }))}
                  className="w-full px-3 py-3 text-left hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-2">
                    <span className="pt-0.5 text-muted-foreground">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground font-display">{event.summary}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="rounded-md px-2 py-0.5 font-medium"
                          style={{
                            background: 'color-mix(in srgb, var(--amber) 16%, var(--muted))',
                            color: 'var(--foreground)',
                            border: '1px solid color-mix(in srgb, var(--amber) 36%, var(--border))',
                          }}
                        >
                          {event.path}
                        </span>
                        <span className={opColorClass(event.op)}>{event.op}</span>
                        <span>·</span>
                        <span>{sourceLabel(event.source)}</span>
                        <span>·</span>
                        <span>{relativeTime(event.ts, t)}</span>
                      </div>
                    </div>
                    <Link
                      href={`/view/${event.path.split('/').map(encodeURIComponent).join('/')}`}
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-[var(--amber-dim)] text-[var(--amber-text)] focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.changes.open}
                    </Link>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border bg-background/70">
                    {rows.map((row, idx) => {
                      if (row.type === 'gap') {
                        return <div key={`${event.id}-gap-${idx}`} className="px-3 py-1 text-2xs text-muted-foreground">{t.changes.unchangedLines(row.count)}</div>;
                      }
                      const prefix = row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' ';
                      const color = row.type === 'insert'
                        ? 'var(--success)'
                        : row.type === 'delete'
                          ? 'var(--error)'
                          : 'var(--muted-foreground)';
                      return (
                        <div key={`${event.id}-${idx}`} className="px-3 py-0.5 text-xs font-mono flex items-start gap-2">
                          <span style={{ color }} className="select-none w-3">{prefix}</span>
                          <span style={{ color }} className="whitespace-pre-wrap break-all flex-1">{row.text || ' '}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
