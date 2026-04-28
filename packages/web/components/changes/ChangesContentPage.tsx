'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  History,
  RefreshCw,
  FileText,
  // Operation icons
  FileUp,
  FileMinus,
  Pencil,
  Copy,
  Edit3,
  Move,
  Zap,
  // Source icons
  Bot,
  User,
  Cpu,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import CustomSelect from '@/components/CustomSelect';
import { collapseDiffContext, buildLineDiff } from './line-diff';

/** Icon mapping for different operations */
function getOpIcon(op: string): React.ReactNode {
  if (op === 'create_file' || op === 'create_space') return <FileUp size={14} />;
  if (op === 'delete_file') return <FileMinus size={14} />;
  if (op === 'update_lines' || op === 'update_section') return <Edit3 size={14} />;
  if (op === 'insert_lines' || op === 'insert_after_heading') return <Pencil size={14} />;
  if (op === 'append_to_file' || op === 'append_csv') return <Copy size={14} />;
  if (op === 'rename_file' || op === 'rename_space' || op === 'move_file') return <Move size={14} />;
  if (op === 'import_file') return <Zap size={14} />;
  return null;
}

/** Icon and color for source (User/Agent/System) */
function getSourceIcon(source: string): React.ReactNode {
  if (source === 'agent') return <Bot size={13} />;
  if (source === 'user') return <User size={13} />;
  return <Cpu size={13} />;
}

function getSourceBgColor(source: string): string {
  if (source === 'agent') return 'bg-[var(--info)]/10 text-[var(--info)] border border-[var(--info)]/20';
  if (source === 'user') return 'bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20';
  return 'bg-muted text-muted-foreground border border-border';
}

/** Skeleton placeholder for loading state */
function ChangeCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="w-4 h-4 bg-muted rounded mt-1" />
          <div className="flex-1 space-y-2">
            <div className="h-5 bg-muted rounded w-2/3" />
            <div className="h-3 bg-muted rounded w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

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

/**
 * Translate backend-generated English summaries to the current locale.
 * Matches known patterns; returns the original string as fallback.
 */
function translateSummary(summary: string, t: ReturnType<typeof useLocale>['t']): string {
  const s = t.changes.summaries;
  // Exact matches
  if (summary === 'Updated file content') return s.updatedFileContent;
  if (summary === 'Appended content to file') return s.appendedContent;
  if (summary === 'Moved to trash') return s.movedToTrash;
  if (summary === 'Created file') return s.createdFile;
  if (summary === 'Created space') return s.createdSpace;
  if (summary === 'Imported file into knowledge base') return s.importedFile;

  // Pattern: "Inserted N line(s)"
  const insertedLines = summary.match(/^Inserted (\d+) line\(s\)$/);
  if (insertedLines) return s.insertedLines(Number(insertedLines[1]));

  // Pattern: "Updated lines N-M"
  const updatedLines = summary.match(/^Updated lines (\d+)-(\d+)$/);
  if (updatedLines) return s.updatedLines(Number(updatedLines[1]), Number(updatedLines[2]));

  // Pattern: 'Inserted content after heading "..."'
  const insertedAfter = summary.match(/^Inserted content after heading "(.+)"$/);
  if (insertedAfter) return s.insertedAfterHeading(insertedAfter[1]);

  // Pattern: 'Updated section "..."'
  const updatedSection = summary.match(/^Updated section "(.+)"$/);
  if (updatedSection) return s.updatedSection(updatedSection[1]);

  // Pattern: "Renamed file to ..."
  const renamedFile = summary.match(/^Renamed file to (.+)$/);
  if (renamedFile) return s.renamedFile(renamedFile[1]);

  // Pattern: "Moved file to ..."
  const movedFile = summary.match(/^Moved file to (.+)$/);
  if (movedFile) return s.movedFile(movedFile[1]);

  // Pattern: "Renamed space to ..."
  const renamedSpace = summary.match(/^Renamed space to (.+)$/);
  if (renamedSpace) return s.renamedSpace(renamedSpace[1]);

  // Pattern: "Appended CSV row (N cell(s))"
  const csvRow = summary.match(/^Appended CSV row \((\d+) cells?\)$/);
  if (csvRow) return s.appendedCsvRow(Number(csvRow[1]));

  // Pattern: "Imported legacy agent diff (...)"
  if (summary.startsWith('Imported legacy agent diff')) return s.importedLegacyDiff;

  return summary; // fallback: show original
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
      setError(e instanceof Error ? e.message : String(e));
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
        label: op === 'all' ? t.changes.filters.operationAll : ((t.changes.operations as Record<string, string>)?.[op] ?? op),
      })),
    [opOptions, t],
  );

  const sourceLabel = useCallback((source: ChangeEvent['source']) => {
    if (source === 'agent') return t.changes.filters.agent;
    if (source === 'user') return t.changes.filters.user;
    return t.changes.filters.system;
  }, [t]);

  const opLabel = useCallback((op: string) => {
    return (t.changes.operations as Record<string, string>)?.[op] ?? op;
  }, [t]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header with icon in box */}
      <div className="px-4 md:px-6 pt-6 md:pt-8">
        <div className="content-width xl:mr-[220px] rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {/* Title with icon in box (Settings pattern) */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--amber)]/8 flex items-center justify-center shrink-0 mt-0.5">
                  <History size={20} className="text-[var(--amber)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl font-semibold text-foreground tracking-tight">{t.changes.title}</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t.changes.subtitle}</p>
                </div>
              </div>

              {/* Stats badges */}
              <div className="mt-5 flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-full bg-muted/60 text-muted-foreground text-xs font-medium">
                  {eventCountLabel}
                </span>
                {summary.unreadCount > 0 && (
                  <span className="px-3 py-1.5 rounded-full bg-[var(--amber)]/10 text-[var(--amber)] text-xs font-medium border border-[var(--amber)]/20">
                    {t.changes.unreadCount(summary.unreadCount)}
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons with icon */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void fetchData()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[var(--amber)]"
                title={t.changes.refresh}
              >
                <RefreshCw size={14} />
                <span className="hidden sm:inline">{t.changes.refresh}</span>
              </button>
              <button
                type="button"
                onClick={() => void markSeen()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[var(--amber)]"
                title={t.changes.markAllRead}
              >
                <span className="hidden sm:inline">{t.changes.markAllRead}</span>
                <span className="inline sm:hidden">✓</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Section (SettingCard pattern) */}
      <div className="px-4 md:px-6 py-4 md:py-6">
        <div className="content-width xl:mr-[220px] space-y-4">
          <div className="rounded-xl border border-border/60 bg-card/60 p-5 md:p-6 shadow-sm hover:border-border hover:shadow transition-all duration-150">
            <div className="space-y-4">
              {/* Row 1: File path + Source */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2.5">
                    {t.changes.filters.filePath}
                  </span>
                  <input
                    value={pathFilter}
                    onChange={(e) => setPathFilter(e.target.value)}
                    placeholder={t.changes.filters.filePathPlaceholder}
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground/40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--amber)]/40 hover:border-border/80 transition-all"
                  />
                </label>
                <div className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2.5">
                    {t.changes.filters.source}
                  </span>
                  <CustomSelect
                    value={sourceFilter}
                    onChange={(v) => setSourceFilter(v as 'all' | 'agent' | 'user' | 'system')}
                    options={sourceSelectOptions}
                  />
                </div>
              </div>

              {/* Row 2: Operation + Keyword */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2.5">
                    {t.changes.filters.operation}
                  </span>
                  <CustomSelect
                    value={opFilter}
                    onChange={setOpFilter}
                    options={opSelectOptions}
                  />
                </div>
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2.5">
                    {t.changes.filters.keyword}
                  </span>
                  <input
                    value={queryFilter}
                    onChange={(e) => setQueryFilter(e.target.value)}
                    placeholder={t.changes.filters.keywordPlaceholder}
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground/40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--amber)]/40 hover:border-border/80 transition-all"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Content Area */}
          {loading && (
            <div className="space-y-3">
              <ChangeCardSkeleton />
              <ChangeCardSkeleton />
              <ChangeCardSkeleton />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-error/20 bg-error/5 p-4 text-sm text-error">
              {error}
              <button
                onClick={() => void fetchData()}
                className="ml-2 underline hover:no-underline font-medium"
              >
                {t.changes.refresh}
              </button>
            </div>
          )}

          {!loading && !error && events.length === 0 && (
            <div className="rounded-xl border border-border/60 bg-card/60 p-8 md:p-12 shadow-sm">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 p-4 bg-muted/50 rounded-lg">
                  <FileText size={32} className="text-muted-foreground/60" />
                </div>
                <h3 className="text-base font-semibold text-foreground mb-1">{t.changes.empty}</h3>
                <p className="text-sm text-muted-foreground max-w-sm">{t.changes.emptyHint}</p>
              </div>
            </div>
          )}

          {/* Event Cards - Premium Design */}
          {!loading && !error && events.length > 0 && (
            <div className="space-y-2.5">
              {events.map((event) => {
                const open = !!expanded[event.id];
                const rawDiff = buildLineDiff(event.before ?? '', event.after ?? '');
                const rows = collapseDiffContext(rawDiff);
                const inserts = rawDiff.filter(r => r.type === 'insert').length;
                const deletes = rawDiff.filter(r => r.type === 'delete').length;
                return (
                  <div
                    key={event.id}
                    className="group rounded-xl border border-border/60 bg-card/70 overflow-hidden transition-all duration-150 hover:border-border hover:bg-card hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [event.id]: !prev[event.id] }))}
                      className="w-full px-4 md:px-5 py-3.5 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--amber)] hover:bg-muted/30 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        {/* Expand/Collapse indicator with left amber bar on open */}
                        <div className="pt-0.5 text-muted-foreground/60 shrink-0 relative">
                          {open && <div className="absolute -left-6 top-1 bottom-1 w-[3px] rounded-r-full bg-[var(--amber)]" />}
                          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>

                        {/* Operation icon in box */}
                        <div className="w-8 h-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0 mt-0.5 text-muted-foreground group-hover:bg-muted transition-all">
                          {getOpIcon(event.op)}
                        </div>

                        {/* Main content */}
                        <div className="min-w-0 flex-1">
                          {/* Summary + diff count */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">
                              {translateSummary(event.summary, t)}
                            </span>
                            {(inserts > 0 || deletes > 0) && (
                              <span className="text-xs font-mono text-muted-foreground/70">
                                {inserts > 0 && <span className="text-success font-semibold">+{inserts}</span>}
                                {inserts > 0 && deletes > 0 && <span className="mx-1">·</span>}
                                {deletes > 0 && <span className="text-error font-semibold">-{deletes}</span>}
                              </span>
                            )}
                          </div>

                          {/* Metadata row with source badge, op label, time */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            {/* File path badge */}
                            <span className="rounded-md px-2 py-1 bg-[var(--amber-dim)] text-[var(--amber)] text-xs font-medium truncate inline-block max-w-xs hover:bg-[var(--amber)]/20 transition-colors" title={event.path}>
                              {event.path}
                            </span>

                            {/* Source badge with icon */}
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${getSourceBgColor(event.source)} transition-colors`}>
                              {getSourceIcon(event.source)}
                              {sourceLabel(event.source)}
                            </span>

                            {/* Operation label */}
                            <span className={`text-xs font-medium ${opColorClass(event.op)}`}>
                              {opLabel(event.op)}
                            </span>

                            {/* Time */}
                            <span className="text-xs text-muted-foreground/60 ml-auto shrink-0">
                              {relativeTime(event.ts, t)}
                            </span>
                          </div>
                        </div>

                        {/* Open button */}
                        <Link
                          href={`/view/${event.path.split('/').map(encodeURIComponent).join('/')}`}
                          className="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--amber)]/10 text-[var(--amber)] hover:bg-[var(--amber)] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--amber)] transition-all duration-150 shrink-0 group-hover:bg-[var(--amber)]/15"
                          onClick={(e) => e.stopPropagation()}
                          title={t.changes.open}
                        >
                          {t.changes.open}
                        </Link>
                      </div>
                    </button>

                    {/* Diff Viewer with premium styling */}
                    {open && (() => {
                      let oln = 1;
                      let nln = 1;
                      return (
                      <div className="border-t border-border/50 bg-background/60 max-h-96 overflow-y-auto">
                        {rows.map((row, idx) => {
                          if (row.type === 'gap') {
                            oln += row.count;
                            nln += row.count;
                            return (
                              <div key={`${event.id}-gap-${idx}`} className="px-4 py-2.5 text-xs text-muted-foreground/50 border-y border-border/30 bg-muted/10 text-center font-medium">
                                {t.changes.unchangedLines(row.count)}
                              </div>
                            );
                          }
                          const prefix = row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' ';
                          const showOld = row.type !== 'insert' ? oln : '';
                          const showNew = row.type !== 'delete' ? nln : '';
                          if (row.type !== 'insert') oln++;
                          if (row.type !== 'delete') nln++;
                          return (
                            <div
                              key={`${event.id}-${idx}`}
                              className={`flex items-start text-xs font-mono leading-6 px-4 ${
                                row.type === 'insert'
                                  ? 'bg-success/5 hover:bg-success/8'
                                  : row.type === 'delete'
                                    ? 'bg-error/5 hover:bg-error/8'
                                    : 'hover:bg-muted/20'
                              } transition-colors`}
                            >
                              <span className="w-8 shrink-0 text-right pr-3 select-none text-muted-foreground/40 font-medium">{showOld}</span>
                              <span className="w-8 shrink-0 text-right pr-3 select-none text-muted-foreground/40 font-medium">{showNew}</span>
                              <span
                                className={`w-3 shrink-0 text-center select-none font-bold ${
                                  row.type === 'insert' ? 'text-success' : row.type === 'delete' ? 'text-error' : 'text-muted-foreground/20'
                                }`}
                              >
                                {prefix}
                              </span>
                              <span
                                className={`flex-1 whitespace-pre-wrap break-all overflow-hidden ${
                                  row.type === 'insert' ? 'text-success' : row.type === 'delete' ? 'text-error' : 'text-muted-foreground'
                                }`}
                              >
                                {row.text || '\u00A0'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
