'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Sparkles,
  FileText,
  Table,
  AlertCircle,
  Loader2,
  ChevronRight,
  Upload,
  FolderInput,
  Check,
  Clock,
  ChevronDown,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import { quickDropToInbox } from '@/lib/inbox-upload';
import { loadHistory, type OrganizeHistoryEntry, type OrganizeSource } from '@/lib/organize-history';

interface InboxFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isAging: boolean;
}

interface InboxSectionProps {
  isOrganizing?: boolean;
}

const VISIBLE_LIMIT = 5;
const HISTORY_LIMIT = 3;

export function InboxSection({ isOrganizing: externalOrganizing = false }: InboxSectionProps) {
  const { t } = useLocale();
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [organizing, setOrganizing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<OrganizeHistoryEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const isOrganizing = externalOrganizing || organizing;

  const handleOrganize = useCallback(() => {
    if (files.length === 0 || isOrganizing) return;
    setOrganizing(true);
    window.dispatchEvent(
      new CustomEvent('mindos:inbox-organize', { detail: { files } }),
    );
  }, [files, isOrganizing]);

  const handleUpload = useCallback((selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    quickDropToInbox(Array.from(selected), t);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [t]);

  const handleLocalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      quickDropToInbox(Array.from(e.dataTransfer.files), t);
    }
  }, [t]);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.files)) {
        setFiles(data.files);
      }
    } catch (err) {
      console.warn('[InboxSection] Failed to fetch inbox:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHistory = useCallback(() => {
    setHistory(loadHistory().slice(0, HISTORY_LIMIT));
  }, []);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debouncedRefresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchInbox();
      refreshHistory();
    }, 80);
  }, [fetchInbox, refreshHistory]);

  useEffect(() => {
    const resetDrag = () => { dragCounterRef.current = 0; setDragOver(false); };
    window.addEventListener('drop', resetDrag, true);
    window.addEventListener('dragend', resetDrag, true);
    return () => {
      window.removeEventListener('drop', resetDrag, true);
      window.removeEventListener('dragend', resetDrag, true);
    };
  }, []);

  useEffect(() => {
    fetchInbox();
    refreshHistory();

    const onOrganizeDone = () => { setOrganizing(false); debouncedRefresh(); };

    window.addEventListener('mindos:files-changed', debouncedRefresh);
    window.addEventListener('mindos:inbox-updated', debouncedRefresh);
    window.addEventListener('mindos:organize-done', onOrganizeDone);
    window.addEventListener('mindos:organize-history-update', refreshHistory);
    return () => {
      clearTimeout(refreshTimerRef.current);
      window.removeEventListener('mindos:files-changed', debouncedRefresh);
      window.removeEventListener('mindos:inbox-updated', debouncedRefresh);
      window.removeEventListener('mindos:organize-done', onOrganizeDone);
      window.removeEventListener('mindos:organize-history-update', refreshHistory);
    };
  }, [fetchInbox, debouncedRefresh, refreshHistory]);

  const visibleFiles = useMemo(
    () => files.slice(0, VISIBLE_LIMIT),
    [files],
  );
  const overflowCount = Math.max(0, files.length - VISIBLE_LIMIT);
  const hasFiles = files.length > 0;
  const [totalHistory, setTotalHistory] = useState(0);

  useEffect(() => {
    setTotalHistory(loadHistory().length);
  }, [history]);

  if (loading) return (
    <section className="mb-10 animate-pulse">
      <div className="h-4 w-24 bg-muted rounded mb-3" />
      <div className="space-y-2">
        <div className="h-10 bg-muted/50 rounded-lg" />
        <div className="h-10 bg-muted/50 rounded-lg" />
      </div>
    </section>
  );

  return (
    <section className="mb-10">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
          <Inbox size={13} />
        </div>
        <h2 className="text-[13px] font-semibold text-foreground tracking-wide">
          {t.inbox.title}
        </h2>
        {hasFiles && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-semibold rounded-full bg-muted text-muted-foreground tabular-nums">
            {t.inbox.count(files.length)}
          </span>
        )}
        {hasFiles && (
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              title={t.inbox.uploadButton}
            >
              <Upload size={12} />
              <span className="hidden sm:inline">{t.inbox.uploadButton}</span>
            </button>
            <button
              onClick={handleOrganize}
              disabled={isOrganizing}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={isOrganizing ? t.inbox.organizing : undefined}
            >
              {isOrganizing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              <span>{isOrganizing ? t.inbox.organizing : t.inbox.organizeButton}</span>
            </button>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.txt,.csv,.json,.pdf"
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      {/* File list */}
      {hasFiles && (
        <>
          <div className="flex flex-col gap-0.5 mb-3">
            {visibleFiles.map((file) => (
              <InboxFileRow key={file.path} file={file} />
            ))}
          </div>
          {overflowCount > 0 && (
            <Link
              href="/view/Inbox/"
              className="flex items-center gap-1 mb-3 text-xs text-muted-foreground hover:text-[var(--amber)] transition-colors"
            >
              <ChevronRight size={12} />
              {t.inbox.viewAllFiles(files.length)}
            </Link>
          )}
        </>
      )}

      {/* Drop zone — always visible */}
      <div
        className={`rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${
          dragOver
            ? 'border-[var(--amber)] bg-[var(--amber-subtle)]'
            : hasFiles
              ? 'border-border/60 hover:border-[var(--amber)]/40'
              : 'border-border hover:border-[var(--amber)]/40'
        } ${hasFiles ? 'px-4 py-4' : 'px-4 py-8'}`}
        role="button"
        tabIndex={0}
        aria-label={t.inbox.uploadButton}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          dragCounterRef.current++;
          if (dragCounterRef.current === 1) setDragOver(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) setDragOver(false);
        }}
        onDrop={handleLocalDrop}
      >
        {hasFiles ? (
          <div className="flex items-center justify-center gap-2 text-center">
            <FolderInput size={16} className={`shrink-0 ${dragOver ? 'text-[var(--amber)]' : 'text-muted-foreground/40'}`} />
            <p className="text-xs text-muted-foreground">
              {t.fileImport.dropzoneCompact}{' '}
              <span className="text-[var(--amber)] hover:underline">{t.fileImport.dropzoneCompactButton}</span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <FolderInput size={28} className={`${dragOver ? 'text-[var(--amber)]' : 'text-muted-foreground/20'}`} />
            <p className="text-sm text-muted-foreground/70">
              {t.inbox.emptyTitle}
            </p>
            <p className="text-xs text-muted-foreground/40">
              {t.inbox.emptyDesc}
            </p>
            <p className="text-2xs text-muted-foreground/30">{t.inbox.dropOverlayFormats}</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            >
              <Upload size={12} />
              {t.inbox.uploadButton}
            </button>
          </div>
        )}
      </div>

      {/* Recently processed — inline history */}
      {history.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={11} className="text-muted-foreground/40" />
            <span className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
              {t.importHistory.title}
            </span>
            <Link
              href="/inbox/history"
              className="ml-auto text-2xs text-muted-foreground/50 hover:text-[var(--amber)] transition-colors"
            >
              {t.inbox.viewAllHistory(totalHistory)}
            </Link>
          </div>
          <div className="flex flex-col gap-1">
            {history.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function InboxFileRow({ file }: { file: InboxFile }) {
  const { t } = useLocale();
  const isCSV = file.name.endsWith('.csv');
  const age = formatRelativeTime(file.modifiedAt, t.home.relativeTime);

  return (
    <Link
      href={`/view/${encodePath(file.path)}`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 hover:translate-x-0.5 hover:bg-muted group"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          file.isAging ? 'bg-[var(--amber)]/60' : 'bg-[var(--amber)]'
        }`}
      />
      {isCSV ? (
        <Table size={12} className="shrink-0 text-success" />
      ) : (
        <FileText size={12} className="shrink-0 text-muted-foreground" />
      )}
      <span
        className="text-sm truncate flex-1 text-foreground"
        title={file.name}
        suppressHydrationWarning
      >
        {file.name}
      </span>
      <span className="text-2xs text-muted-foreground/50 tabular-nums shrink-0">
        {age}
      </span>
      {file.isAging && (
        <span title="7+ days">
          <AlertCircle
            size={11}
            className="shrink-0 text-[var(--amber)]/60"
          />
        </span>
      )}
    </Link>
  );
}

function HistoryRow({ entry }: { entry: OrganizeHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isUndone = entry.status === 'undone';
  const sourceBadge = getSourceBadge(entry.source);
  const duration = entry.durationMs ? formatDuration(entry.durationMs) : null;
  const age = formatRelativeTime(new Date(entry.timestamp).toISOString(), {
    justNow: 'just now',
    minutesAgo: (n: number) => `${n}m ago`,
    hoursAgo: (n: number) => `${n}h ago`,
    daysAgo: (n: number) => `${n}d ago`,
  });

  return (
    <div className="rounded-lg border border-border/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
      >
        {isUndone ? (
          <AlertCircle size={12} className="text-muted-foreground/40 shrink-0" />
        ) : (
          <Check size={12} className="text-success/70 shrink-0" />
        )}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className={`text-xs truncate ${isUndone ? 'text-muted-foreground/50 line-through' : 'text-foreground/80'}`}>
            {entry.sourceFiles.length === 1 ? entry.sourceFiles[0] : `${entry.sourceFiles.length} files`}
          </span>
          {sourceBadge && (
            <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${sourceBadge.className}`}>
              {sourceBadge.label}
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
        <div className="border-t border-border/20 px-3 py-1.5 space-y-0.5">
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
                  {dirPath && (
                    <span className="text-muted-foreground/30">{dirPath}/</span>
                  )}
                  <span className={f.undone ? '' : 'text-foreground/70'}>{fileName}</span>
                </span>
                <span className="text-muted-foreground/40 shrink-0">
                  {f.undone ? 'undone' : f.action === 'create' ? 'created' : 'updated'}
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

function getSourceBadge(source?: OrganizeSource): { label: string; className: string } | null {
  switch (source) {
    case 'drag-drop':      return { label: 'drop',   className: 'bg-muted/50 text-muted-foreground/50' };
    case 'inbox-organize': return { label: 'inbox',  className: 'bg-[var(--amber)]/10 text-[var(--amber)]/70' };
    case 'import-modal':   return { label: 'import', className: 'bg-blue-500/10 text-blue-500/70' };
    case 'plugin':         return { label: 'plugin', className: 'bg-violet-500/10 text-violet-500/70' };
    case 'upload':         return { label: 'upload', className: 'bg-teal-500/10 text-teal-500/70' };
    case 'web-clipper':    return { label: 'clip',   className: 'bg-emerald-500/10 text-emerald-500/70' };
    default: return null;
  }
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem > 0 ? `${rem}s` : ''}`;
}

interface RelativeTimeStrings {
  justNow: string;
  minutesAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  daysAgo: (n: number) => string;
}

function formatRelativeTime(isoString: string, rt: RelativeTimeStrings): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return rt.justNow;
  if (minutes < 60) return rt.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rt.hoursAgo(hours);
  const days = Math.floor(hours / 24);
  return rt.daysAgo(days);
}
