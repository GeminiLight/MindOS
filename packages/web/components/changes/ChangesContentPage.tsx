'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Edit3,
  FileMinus,
  FilePenLine,
  FileText,
  FileUp,
  Filter,
  History,
  Move,
  Pencil,
  RefreshCw,
  Search,
  User,
  Zap,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { encodePath } from '@/lib/utils';
import { useLocale } from '@/lib/stores/locale-store';
import CustomSelect from '@/components/CustomSelect';
import { ContentPageShell } from '@/components/shared/ContentPageShell';
import { collapseDiffContext, buildLineDiff } from './line-diff';

export type SourceFilter = 'all' | 'agent' | 'user' | 'system';
type ViewMode = 'review' | 'activity';
type SurfaceVariant = 'page' | 'embedded';

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
  lastSeenAt: string | null;
}

interface ListPayload {
  events: ChangeEvent[];
}

interface ChangesSurfaceProps {
  initialPath?: string;
  initialSource?: SourceFilter;
  variant?: SurfaceVariant;
}

const SOURCE_FILTERS: SourceFilter[] = ['all', 'agent', 'user', 'system'];

function getOpIcon(op: string): ReactNode {
  if (op === 'create_file' || op === 'create_space') return <FileUp size={14} aria-hidden="true" />;
  if (op === 'delete_file') return <FileMinus size={14} aria-hidden="true" />;
  if (op === 'update_lines' || op === 'update_section') return <Edit3 size={14} aria-hidden="true" />;
  if (op === 'insert_lines' || op === 'insert_after_heading') return <Pencil size={14} aria-hidden="true" />;
  if (op === 'append_to_file' || op === 'append_csv') return <Copy size={14} aria-hidden="true" />;
  if (op === 'rename_file' || op === 'rename_space' || op === 'move_file') return <Move size={14} aria-hidden="true" />;
  if (op === 'import_file') return <Zap size={14} aria-hidden="true" />;
  return <FileText size={14} aria-hidden="true" />;
}

function getSourceIcon(source: ChangeEvent['source']): ReactNode {
  if (source === 'agent') return <Bot size={13} aria-hidden="true" />;
  if (source === 'user') return <User size={13} aria-hidden="true" />;
  return <Cpu size={13} aria-hidden="true" />;
}

function getSourceClassName(source: ChangeEvent['source']): string {
  if (source === 'agent') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (source === 'user') return 'border-success/20 bg-success/10 text-success';
  return 'border-border bg-muted text-muted-foreground';
}

function getOperationClassName(op: string): string {
  if (op.startsWith('create') || op === 'import_file') return 'text-success';
  if (op.startsWith('delete')) return 'text-error';
  if (op.startsWith('rename') || op.startsWith('move')) return 'text-muted-foreground';
  return 'text-foreground';
}

function isEventUnread(event: ChangeEvent, lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  const seenMs = new Date(lastSeenAt).getTime();
  const eventMs = new Date(event.ts).getTime();
  return Number.isFinite(eventMs) && (!Number.isFinite(seenMs) || eventMs > seenMs);
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

function translateSummary(summary: string, t: ReturnType<typeof useLocale>['t']): string {
  const s = t.changes.summaries;
  if (summary === 'Updated file content') return s.updatedFileContent;
  if (summary === 'Appended content to file') return s.appendedContent;
  if (summary === 'Moved to trash') return s.movedToTrash;
  if (summary === 'Created file') return s.createdFile;
  if (summary === 'Created space') return s.createdSpace;
  if (summary === 'Imported file into knowledge base') return s.importedFile;

  const insertedLines = summary.match(/^Inserted (\d+) line\(s\)$/);
  if (insertedLines) return s.insertedLines(Number(insertedLines[1]));
  const updatedLines = summary.match(/^Updated lines (\d+)-(\d+)$/);
  if (updatedLines) return s.updatedLines(Number(updatedLines[1]), Number(updatedLines[2]));
  const insertedAfter = summary.match(/^Inserted content after heading "(.+)"$/);
  if (insertedAfter) return s.insertedAfterHeading(insertedAfter[1]);
  const updatedSection = summary.match(/^Updated section "(.+)"$/);
  if (updatedSection) return s.updatedSection(updatedSection[1]);
  const renamedFile = summary.match(/^Renamed file to (.+)$/);
  if (renamedFile) return s.renamedFile(renamedFile[1]);
  const movedFile = summary.match(/^Moved file to (.+)$/);
  if (movedFile) return s.movedFile(movedFile[1]);
  const renamedSpace = summary.match(/^Renamed space to (.+)$/);
  if (renamedSpace) return s.renamedSpace(renamedSpace[1]);
  const csvRow = summary.match(/^Appended CSV row \((\d+) cells?\)$/);
  if (csvRow) return s.appendedCsvRow(Number(csvRow[1]));
  if (summary.startsWith('Imported legacy agent diff')) return s.importedLegacyDiff;

  return summary;
}

function sourceLabel(source: ChangeEvent['source'], t: ReturnType<typeof useLocale>['t']) {
  if (source === 'agent') return t.changes.filters.agent;
  if (source === 'user') return t.changes.filters.user;
  return t.changes.filters.system;
}

function operationLabel(op: string, t: ReturnType<typeof useLocale>['t']) {
  return (t.changes.operations as Record<string, string>)?.[op] ?? op;
}

function ChangeCardSkeleton() {
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 px-4 py-3 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-md bg-muted" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
}) {
  const toneClass = tone === 'accent'
    ? 'border-[var(--amber)]/20 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
    : tone === 'success'
      ? 'border-success/20 bg-success/10 text-success'
      : 'border-border/70 bg-muted/45 text-muted-foreground';

  return (
    <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function DiffPreview({
  event,
  t,
}: {
  event: ChangeEvent;
  t: ReturnType<typeof useLocale>['t'];
}) {
  const rawDiff = useMemo(() => buildLineDiff(event.before ?? '', event.after ?? ''), [event.after, event.before]);
  const rows = useMemo(() => collapseDiffContext(rawDiff), [rawDiff]);
  const inserts = useMemo(() => rawDiff.filter(row => row.type === 'insert').length, [rawDiff]);
  const deletes = useMemo(() => rawDiff.filter(row => row.type === 'delete').length, [rawDiff]);

  let oldLine = 1;
  let newLine = 1;

  return (
    <div className="border-t border-border/60 bg-background/70">
      {(inserts > 0 || deletes > 0) && (
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t.changes.diffPreview}</span>
          {inserts > 0 && <span className="font-mono font-semibold text-success">+{inserts}</span>}
          {deletes > 0 && <span className="font-mono font-semibold text-error">-{deletes}</span>}
        </div>
      )}
      <div className="max-h-96 overflow-y-auto">
        {rows.map((row, idx) => {
          if (row.type === 'gap') {
            oldLine += row.count;
            newLine += row.count;
            return (
              <div
                key={`${event.id}-gap-${idx}`}
                className="border-y border-border/30 bg-muted/10 px-4 py-2 text-center text-xs font-medium text-muted-foreground/60"
              >
                {t.changes.unchangedLines(row.count)}
              </div>
            );
          }

          const prefix = row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' ';
          const showOld = row.type !== 'insert' ? oldLine : '';
          const showNew = row.type !== 'delete' ? newLine : '';
          if (row.type !== 'insert') oldLine++;
          if (row.type !== 'delete') newLine++;

          return (
            <div
              key={`${event.id}-${idx}`}
              className={`flex items-start px-4 text-xs font-mono leading-6 transition-colors ${
                row.type === 'insert'
                  ? 'bg-success/5 hover:bg-success/10'
                  : row.type === 'delete'
                    ? 'bg-error/5 hover:bg-error/10'
                    : 'hover:bg-muted/20'
              }`}
            >
              <span className="w-8 shrink-0 select-none pr-3 text-right font-medium text-muted-foreground/40">{showOld}</span>
              <span className="w-8 shrink-0 select-none pr-3 text-right font-medium text-muted-foreground/40">{showNew}</span>
              <span
                className={`w-3 shrink-0 select-none text-center font-bold ${
                  row.type === 'insert' ? 'text-success' : row.type === 'delete' ? 'text-error' : 'text-muted-foreground/20'
                }`}
              >
                {prefix}
              </span>
              <span
                className={`min-w-0 flex-1 overflow-hidden break-all whitespace-pre-wrap ${
                  row.type === 'insert' ? 'text-success' : row.type === 'delete' ? 'text-error' : 'text-muted-foreground'
                }`}
              >
                {row.text || '\u00A0'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChangeEventRow({
  event,
  open,
  onToggle,
  t,
}: {
  event: ChangeEvent;
  open: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useLocale>['t'];
}) {
  const translatedSummary = translateSummary(event.summary, t);
  const openHref = `/view/${encodePath(event.afterPath || event.path)}`;

  return (
    <article
      className="group overflow-hidden rounded-lg border border-border/70 bg-card/70 transition-colors duration-150 hover:border-border hover:bg-card"
      data-change-event-row
    >
      <div className="flex items-start gap-3 px-3 py-3 md:px-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? t.changes.collapseDetails : t.changes.expandDetails}
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        </button>

        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground transition-colors group-hover:bg-muted">
          {getOpIcon(event.op)}
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 text-sm font-medium leading-5 text-foreground">
              {translatedSummary}
            </span>
            <span className={`text-xs font-medium ${getOperationClassName(event.op)}`}>
              {operationLabel(event.op, t)}
            </span>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              className="inline-flex max-w-full items-center truncate rounded-md bg-[var(--amber-dim)] px-2 py-0.5 text-xs font-medium text-[var(--amber-text)]"
              title={event.path}
            >
              {event.path}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${getSourceClassName(event.source)}`}>
              {getSourceIcon(event.source)}
              {sourceLabel(event.source, t)}
            </span>
            <span className="text-xs text-muted-foreground/70">
              {relativeTime(event.ts, t)}
            </span>
          </div>
        </button>

        <Link
          href={openHref}
          className="mt-0.5 inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-[var(--amber-text)] transition-colors hover:bg-[var(--amber-subtle)] hover:text-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t.changes.openFile}
        >
          {t.changes.open}
        </Link>
      </div>

      {open && <DiffPreview event={event} t={t} />}
    </article>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-6 py-10 text-center">
      <div className="mx-auto mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export function ChangesSurface({
  initialPath = '',
  initialSource = 'all',
  variant = 'page',
}: ChangesSurfaceProps) {
  const { t } = useLocale();
  const [pathFilter, setPathFilter] = useState(initialPath);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initialSource);
  const [opFilter, setOpFilter] = useState<string>('all');
  const [queryFilter, setQueryFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(initialSource === 'agent' ? 'review' : 'activity');
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const [summary, setSummary] = useState<SummaryPayload>({ unreadCount: 0, totalCount: 0, lastSeenAt: null });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPathFilter(initialPath);
  }, [initialPath]);

  useEffect(() => {
    setSourceFilter(initialSource);
    if (initialSource === 'agent') setViewMode('review');
  }, [initialSource]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ op: 'list', limit: '120' });
      if (pathFilter.trim()) params.set('path', pathFilter.trim());
      if (viewMode === 'review') {
        params.set('source', 'agent');
      } else if (sourceFilter !== 'all') {
        params.set('source', sourceFilter);
      }
      if (opFilter !== 'all') params.set('event_op', opFilter);
      if (queryFilter.trim()) params.set('q', queryFilter.trim());

      const [list, summaryData] = await Promise.all([
        apiFetch<ListPayload>(`/api/changes?${params.toString()}`),
        apiFetch<SummaryPayload>('/api/changes?op=summary'),
      ]);
      setEvents(list.events);
      setSummary({
        unreadCount: summaryData.unreadCount ?? 0,
        totalCount: summaryData.totalCount ?? list.events.length,
        lastSeenAt: summaryData.lastSeenAt ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [opFilter, pathFilter, queryFilter, sourceFilter, viewMode]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const markSeen = useCallback(async () => {
    await apiFetch('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'mark_seen' }),
    });
    setExpanded({});
    await fetchData();
  }, [fetchData]);

  const visibleEvents = useMemo(() => {
    if (viewMode === 'review') {
      return events.filter(event => event.source === 'agent' && isEventUnread(event, summary.lastSeenAt));
    }
    return events;
  }, [events, summary.lastSeenAt, viewMode]);

  const reviewCount = useMemo(
    () => events.filter(event => event.source === 'agent' && isEventUnread(event, summary.lastSeenAt)).length,
    [events, summary.lastSeenAt],
  );

  const touchedPathCount = useMemo(
    () => new Set(visibleEvents.map(event => event.afterPath || event.path)).size,
    [visibleEvents],
  );

  const opOptions = useMemo(() => {
    const ops = Array.from(new Set(events.map((event) => event.op))).sort((a, b) => a.localeCompare(b));
    if (opFilter !== 'all' && !ops.includes(opFilter)) ops.unshift(opFilter);
    return ['all', ...ops];
  }, [events, opFilter]);

  const sourceSelectOptions = useMemo(
    () => SOURCE_FILTERS.map(source => ({
      value: source,
      label: source === 'all' ? t.changes.filters.all : sourceLabel(source, t),
    })),
    [t],
  );

  const opSelectOptions = useMemo(
    () => opOptions.map((op) => ({
      value: op,
      label: op === 'all' ? t.changes.filters.operationAll : operationLabel(op, t),
    })),
    [opOptions, t],
  );

  const scopedLabel = pathFilter.trim() ? t.changes.scopedToPath(pathFilter.trim()) : null;
  const isEmbedded = variant === 'embedded';
  const reviewActionLabel = viewMode === 'review' ? t.changes.markReviewed : t.changes.markAllRead;
  const reviewActionDisabled = viewMode === 'review' ? reviewCount <= 0 : summary.unreadCount <= 0;

  const content = (
    <div
      className={isEmbedded ? 'space-y-5 py-4' : 'space-y-5'}
      data-content-page-shell={isEmbedded ? 'changes' : undefined}
    >
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <History size={14} aria-hidden="true" />
              <span>{t.changes.eyebrow}</span>
            </div>
            <h1 className={`${isEmbedded ? 'text-xl' : 'text-2xl'} mt-2 font-semibold tracking-tight text-foreground`}>
              {t.changes.title}
            </h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t.changes.subtitle}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchData()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={t.changes.refresh}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span className="hidden sm:inline">{t.changes.refresh}</span>
            </button>
            <button
              type="button"
              onClick={() => void markSeen()}
              disabled={reviewActionDisabled}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
              title={reviewActionLabel}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>{reviewActionLabel}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {viewMode === 'review' ? (
            <StatusPill tone={reviewCount > 0 ? 'accent' : 'success'}>
              {reviewCount > 0 ? t.changes.pendingReviewCount(reviewCount) : t.changes.allReviewed}
            </StatusPill>
          ) : (
            <StatusPill>{t.changes.views.allActivity}</StatusPill>
          )}
          <StatusPill>{t.changes.eventsCount(visibleEvents.length)}</StatusPill>
          <StatusPill>{t.changes.pathsChanged(touchedPathCount)}</StatusPill>
          {summary.unreadCount > 0 && <StatusPill tone="accent">{t.changes.unreadCount(summary.unreadCount)}</StatusPill>}
          {scopedLabel && <StatusPill>{scopedLabel}</StatusPill>}
        </div>
      </header>

      <section aria-label={t.changes.viewModeLabel} className="rounded-lg border border-border/70 bg-card/65 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex h-9 w-full rounded-md bg-muted/60 p-1 sm:w-auto" role="tablist" aria-label={t.changes.viewModeLabel}>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'review'}
              onClick={() => setViewMode('review')}
              className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-3 text-xs font-medium transition-colors sm:flex-none ${
                viewMode === 'review'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FilePenLine size={14} aria-hidden="true" />
              {t.changes.views.needsReview}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'activity'}
              onClick={() => setViewMode('activity')}
              className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-3 text-xs font-medium transition-colors sm:flex-none ${
                viewMode === 'activity'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <History size={14} aria-hidden="true" />
              {t.changes.views.allActivity}
            </button>
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:max-w-xl">
            <label className="relative block">
              <span className="sr-only">{t.changes.filters.filePath}</span>
              <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" aria-hidden="true" />
              <input
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                placeholder={t.changes.filters.filePathPlaceholder}
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="relative block">
              <span className="sr-only">{t.changes.filters.keyword}</span>
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" aria-hidden="true" />
              <input
                value={queryFilter}
                onChange={(e) => setQueryFilter(e.target.value)}
                placeholder={t.changes.filters.keywordPlaceholder}
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {viewMode === 'review' ? (
            <div className="inline-flex min-h-7 w-fit max-w-full justify-self-start items-center gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 text-2xs font-medium text-[var(--amber-text)]">
              <Bot size={12} aria-hidden="true" />
              {t.changes.filters.agent}
            </div>
          ) : (
            <CustomSelect
              value={sourceFilter}
              onChange={(v) => setSourceFilter(v as SourceFilter)}
              options={sourceSelectOptions}
              size="sm"
            />
          )}
          <CustomSelect
            value={opFilter}
            onChange={setOpFilter}
            options={opSelectOptions}
            size="sm"
          />
        </div>
      </section>

      {loading && (
        <div className="space-y-2.5" aria-busy="true" aria-label={t.changes.loading}>
          <ChangeCardSkeleton />
          <ChangeCardSkeleton />
          <ChangeCardSkeleton />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-error/20 bg-error/5 p-4 text-sm text-error">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchData()}
            className="mt-2 font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.changes.refresh}
          </button>
        </div>
      )}

      {!loading && !error && visibleEvents.length === 0 && (
        viewMode === 'review'
          ? (
            <EmptyState
              icon={<CheckCircle2 size={24} aria-hidden="true" />}
              title={t.changes.reviewEmpty}
              description={t.changes.reviewEmptyHint}
            />
          )
          : (
            <EmptyState
              icon={<FileText size={24} aria-hidden="true" />}
              title={t.changes.empty}
              description={t.changes.emptyHint}
            />
          )
      )}

      {!loading && !error && visibleEvents.length > 0 && (
        <section className="space-y-2.5" aria-label={t.changes.eventListLabel}>
          {visibleEvents.map((event) => (
            <ChangeEventRow
              key={event.id}
              event={event}
              open={!!expanded[event.id]}
              onToggle={() => setExpanded((prev) => ({ ...prev, [event.id]: !prev[event.id] }))}
              t={t}
            />
          ))}
        </section>
      )}
    </div>
  );

  if (isEmbedded) return content;

  return (
    <div className="min-h-[calc(100vh-var(--app-titlebar-h))] bg-background">
      <ContentPageShell className="changes-content-page" data-content-page-shell="changes">
        {content}
      </ContentPageShell>
    </div>
  );
}

export default function ChangesContentPage({
  initialPath = '',
  initialSource = 'all',
}: {
  initialPath?: string;
  initialSource?: SourceFilter;
}) {
  return (
    <ChangesSurface
      initialPath={initialPath}
      initialSource={initialSource}
      variant="page"
    />
  );
}
