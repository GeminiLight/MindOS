'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { AlertCircle, Archive, Check, ChevronDown, Eye, History, ListChecks, Plus, RotateCcw } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import type { OrganizeHistoryEntry } from '@/lib/organize-history';
import { SourceIcon, getInboxSourceLabel } from '@/components/inbox/SourceIcon';
import type { InboxFile, InboxViewMode } from './InboxViewTypes';
import type { InboxUnderstanding } from './InboxViewModel';
import { formatContentPreview, formatDuration, formatRelativeTime, formatSize, getFileExt, getSourceBadge, isContentPreviewable } from './InboxViewFormat';

export function InboxItemDetailsPanel({
  file,
  understanding,
  mode = 'pending',
  onOpen,
  onShelve,
  onRestore,
  onDelete,
}: {
  file: InboxFile | null;
  understanding: InboxUnderstanding | null;
  mode?: 'pending' | 'shelved';
  onOpen: (file: InboxFile) => void;
  onShelve?: (file: InboxFile) => void;
  onRestore?: (file: InboxFile) => void;
  onDelete: (file: InboxFile) => void;
}) {
  const { t } = useLocale();

  if (!file || !understanding) {
    return (
      <section className="overflow-hidden rounded-xl border border-dashed border-border/60 bg-card/35 shadow-none">
        <div className="p-7 text-center">
          <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-muted/35 text-muted-foreground/45">
            <Eye size={16} />
          </span>
          <p className="mt-3 text-sm font-medium text-foreground/70">{t.inbox.understandingEmptyTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground/55">{t.inbox.understandingEmptyDesc}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye size={15} className="text-[var(--amber)]" />
          <h3 className="text-sm font-semibold text-foreground">{t.inbox.itemDetailsTitle}</h3>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
          {t.inbox.itemDetailsDesc}
        </p>
      </div>

      <div className="px-4 py-4">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
          {t.inbox.understandingTitle}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {file.source && <SourceIcon source={file.source} size="sm" />}
          <p className="truncate text-sm font-medium text-foreground" title={file.name}>
            {file.name}
          </p>
        </div>
        {file.source && (
          <p className="mt-1 truncate text-2xs text-muted-foreground/60" title={file.source.url}>
            {getInboxSourceLabel(file.source)} · {file.source.domain ?? file.source.url}
          </p>
        )}
        <p className="mt-1 text-2xs text-muted-foreground/60">
          {formatSize(file.size)} · {formatRelativeTime(file.modifiedAt, t.home.relativeTime)}
        </p>
      </div>

      <div className="border-y border-border/45">
        <ReviewFactRow label={t.inbox.suggestedType} value={understanding.type} />
        <ReviewFactRow label={t.inbox.suggestedTarget} value={understanding.target} />
        <ReviewFactRow label={t.inbox.densityTitle} value={understanding.density} />
      </div>

      <div className="px-4 py-4">
        <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
          {t.inbox.relatedSignals}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {understanding.signals.map(signal => (
            <span key={signal} className="rounded-md bg-muted/45 px-2 py-1 text-2xs text-muted-foreground">
              {signal}
            </span>
          ))}
        </div>
      </div>

      <InboxContentPreview key={file.path} file={file} />

      <div className="grid grid-cols-1 gap-2 border-t border-border/45 px-4 py-4 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onOpen(file)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.inbox.actionOpen}
        </button>
        {mode === 'shelved' ? (
          <button
            type="button"
            onClick={() => onRestore?.(file)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--amber)]/35 bg-[var(--amber-subtle)] px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-[var(--amber-subtle)]/80 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw size={13} className="text-[var(--amber)]" />
            {t.inbox.actionRestore}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onShelve?.(file)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Archive size={13} />
            {t.inbox.actionShelve}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(file)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.inbox.actionRemove}
        </button>
      </div>
    </section>
  );
}

type PreviewState =
  | { status: 'unsupported' }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'error' };

function InboxContentPreview({ file }: { file: InboxFile }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<PreviewState>(() => (
    isContentPreviewable(file.name) ? { status: 'loading' } : { status: 'unsupported' }
  ));

  useEffect(() => {
    if (!isContentPreviewable(file.name)) {
      return;
    }

    let cancelled = false;
    fetch(`/api/file?path=${encodeURIComponent(file.path)}&op=read_file`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`read failed ${res.status}`);
        const body = await res.json() as { content?: string };
        if (!cancelled) {
          setPreview({ status: 'ready', content: formatContentPreview(body.content ?? '') });
        }
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [file.name, file.path]);

  return (
    <div className="border-t border-border/45 px-4 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
          {t.inbox.contentPreviewTitle}
        </p>
        {isContentPreviewable(file.name) && (
          <span className="text-2xs text-muted-foreground/45">{getFileExt(file.name) || 'text'}</span>
        )}
      </div>
      {preview.status === 'loading' ? (
        <div className="space-y-2 rounded-lg border border-border/45 bg-background/60 p-3">
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ) : preview.status === 'ready' ? (
        preview.content ? (
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg border border-border/45 bg-background/65 p-3 font-mono text-[11px] leading-relaxed text-foreground/78">
            {preview.content}
          </pre>
        ) : (
          <div className="rounded-lg border border-border/45 bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground/55">
            {t.inbox.contentPreviewEmpty}
          </div>
        )
      ) : (
        <div className="rounded-lg border border-border/45 bg-background/60 px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground/55">
          {preview.status === 'unsupported' ? t.inbox.contentPreviewUnavailable : t.inbox.contentPreviewFailed}
        </div>
      )}
    </div>
  );
}

export function HistoryRow({ entry }: { entry: OrganizeHistoryEntry }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const isUndone = entry.status === 'undone';
  const sourceBadge = getSourceBadge(entry.source);
  const duration = entry.durationMs ? formatDuration(entry.durationMs) : null;
  const age = formatRelativeTime(new Date(entry.timestamp).toISOString(), t.home.relativeTime);
  const successCount = entry.files.filter(f => f.ok && !f.undone).length;

  return (
    <div className="rounded-lg border border-border/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/20 transition-colors"
      >
        {isUndone ? (
          <AlertCircle size={13} className="text-muted-foreground/40 shrink-0" />
        ) : (
          <Check size={13} className="text-success/70 shrink-0" />
        )}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className={`text-xs truncate ${isUndone ? 'text-muted-foreground/50 line-through' : 'text-foreground/80'}`}>
            {entry.sourceFiles.length === 1 ? entry.sourceFiles[0] : t.importHistory.nFiles(entry.sourceFiles.length)}
          </span>
          {sourceBadge && (
            <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${sourceBadge.className}`}>
              {sourceBadge.label}
            </span>
          )}
          {successCount > 0 && (
            <span className="text-2xs text-muted-foreground/40 shrink-0">
              {t.importHistory.changesSummary(successCount)}
            </span>
          )}
        </div>
        <span className="text-2xs text-muted-foreground/40 tabular-nums shrink-0">
          {duration && `${duration} · `}{age}
        </span>
        {entry.files.length > 0 && (
          <ChevronDown
            size={10}
            className={`text-muted-foreground/30 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {expanded && entry.files.length > 0 && (
        <div className="border-t border-border/20 px-3.5 py-2 space-y-0.5">
          {entry.files.map((f, idx) => {
            const parts = f.path.split('/');
            const fileName = parts.pop() ?? f.path;
            const dirPath = parts.length > 0 ? parts.join('/') : null;
            const isClickable = !f.undone && f.ok;
            const rowClass = `flex items-center gap-2 py-1 text-2xs${f.undone ? ' opacity-40' : ''}${isClickable ? ' rounded -mx-1 px-1 hover:bg-muted/20 transition-colors' : ''}`;
            const rowContent = (
              <>
                <span className={`w-1 h-1 rounded-full shrink-0 ${f.ok && !f.undone ? 'bg-success/60' : 'bg-muted-foreground/30'}`} />
                <span className={`truncate flex-1 min-w-0 ${f.undone ? 'line-through text-muted-foreground' : ''}`}>
                  {dirPath && <span className="text-muted-foreground/30">{dirPath}/</span>}
                  <span className={f.undone ? '' : 'text-foreground/70'}>{fileName}</span>
                </span>
                <span className="text-muted-foreground/40 shrink-0">
                  {f.undone ? t.importHistory.statusUndone : f.action === 'create' ? t.importHistory.statusCreated : t.importHistory.statusUpdated}
                </span>
              </>
            );
            return isClickable ? (
              <Link key={`${f.path}-${idx}`} href={`/view/${encodePath(f.path)}`} className={rowClass}>
                {rowContent}
              </Link>
            ) : (
              <div key={`${f.path}-${idx}`} className={rowClass}>
                {rowContent}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function InboxProcessNav({
  activeView,
  pendingCount,
  shelvedCount,
  doneCount,
  onSwitch,
}: {
  activeView: InboxViewMode;
  pendingCount: number;
  shelvedCount: number;
  doneCount: number;
  onSwitch: (view: InboxViewMode) => void;
}) {
  const { t } = useLocale();
  const entries: Array<{
    view: Exclude<InboxViewMode, 'capture'>;
    icon: ComponentType<{ size?: number; className?: string }>;
    label: string;
    count: number;
  }> = [
    {
      view: 'queue',
      icon: ListChecks,
      label: t.inbox.viewQueue,
      count: pendingCount,
    },
    {
      view: 'shelved',
      icon: Archive,
      label: t.inbox.viewShelved,
      count: shelvedCount,
    },
    {
      view: 'history',
      icon: History,
      label: t.inbox.viewHistory,
      count: doneCount,
    },
  ];

  return (
    <nav className="md:hidden rounded-xl border border-border/60 bg-card/45 p-3 shadow-sm" aria-label={t.inbox.title}>
      <button
        type="button"
        onClick={() => onSwitch('capture')}
        aria-current={activeView === 'capture' ? 'page' : undefined}
        className={`relative z-10 flex min-h-10 w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity focus-visible:ring-2 focus-visible:ring-ring ${
          activeView === 'capture'
            ? 'bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90'
            : 'bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90'
        }`}
      >
        <Plus size={13} />
        {t.inbox.viewCapture}
      </button>

      <div className="mt-3">
        <p className="mb-1.5 px-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">
          {t.inbox.sidebarProcessTitle}
        </p>
        <div className="space-y-1">
          {entries.map(entry => {
            const active = activeView === entry.view;
            const Icon = entry.icon;
            return (
              <button
                key={entry.view}
                type="button"
                onClick={() => onSwitch(entry.view)}
                aria-current={active ? 'page' : undefined}
                className={`relative z-10 flex min-h-10 w-full touch-manipulation items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? 'border-[var(--amber)]/45 bg-[var(--amber-subtle)] text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted/45'
                }`}
              >
                <Icon size={13} className={`shrink-0 ${active ? 'text-[var(--amber)]' : 'text-muted-foreground/60'}`} />
                <span className={`min-w-0 flex-1 truncate text-xs font-medium ${active ? 'text-foreground' : 'text-foreground/85'}`}>
                  {entry.label}
                </span>
                {entry.count > 0 && (
                  <span className={`rounded-full px-1.5 py-px text-2xs font-medium tabular-nums ${
                    active
                      ? 'bg-background/75 text-[var(--amber-text)]'
                      : 'bg-muted/55 text-muted-foreground/75'
                  }`}>
                    {entry.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export function InboxErrorBanner({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-error/20 bg-error/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle size={15} className="mt-0.5 shrink-0 text-error" />
        <p className="min-w-0 text-xs leading-relaxed text-error">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-lg border border-error/20 bg-background px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function ReviewFactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 border-b border-border/35 px-4 py-2.5 last:border-b-0">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">{label}</p>
      <p className="min-w-0 text-sm font-medium leading-snug text-foreground">{value}</p>
    </div>
  );
}
