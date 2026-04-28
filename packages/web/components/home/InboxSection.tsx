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
  X,
  ExternalLink,
  Copy,
  Trash2,
  Link2,
  Globe,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import { quickDropToInbox, clipUrlToInbox, looksLikeUrl, extractUrlFromDrop, dragContainsUrl } from '@/lib/inbox-upload';
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
  const [dragIsUrl, setDragIsUrl] = useState(false);
  const [history, setHistory] = useState<OrganizeHistoryEntry[]>([]);
  const [clipUrl, setClipUrl] = useState('');
  const [clipping, setClipping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clipInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const isOrganizing = externalOrganizing || organizing;

  const handleOrganize = useCallback(() => {
    if (files.length === 0 || isOrganizing) return;
    setOrganizing(true);
    window.dispatchEvent(
      new CustomEvent('mindos:inbox-organize', { detail: { files } }),
    );
  }, [files, isOrganizing]);

  const handleDeleteFile = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/inbox', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [name] }),
      });
      if (!res.ok) throw new Error('Failed to delete');
      setFiles(prev => prev.filter(f => f.name !== name));
      window.dispatchEvent(new Event('mindos:inbox-updated'));
      toast.success(t.inbox.fileRemoved);
    } catch {
      toast.error(t.inbox.fileRemoveFailed);
    }
  }, [t]);

  const handleUpload = useCallback((selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    quickDropToInbox(Array.from(selected), t);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [t]);

  const handleClipUrl = useCallback(async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!looksLikeUrl(trimmed)) {
      toast.error(t.inbox.clipInvalidUrl, 3000);
      return;
    }
    setClipping(true);
    try {
      await clipUrlToInbox(trimmed, t);
      setClipUrl('');
    } finally {
      setClipping(false);
    }
  }, [t]);

  const handleLocalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);
    setDragIsUrl(false);

    const droppedUrl = extractUrlFromDrop(e.nativeEvent);
    if (droppedUrl) {
      handleClipUrl(droppedUrl);
      return;
    }

    if (e.dataTransfer.files.length > 0) {
      quickDropToInbox(Array.from(e.dataTransfer.files), t);
    }
  }, [t, handleClipUrl]);

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
    const resetDrag = () => { dragCounterRef.current = 0; setDragOver(false); setDragIsUrl(false); };
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
    <section className="mb-8 animate-pulse">
      <div className="h-4 w-24 bg-muted rounded mb-3" />
      <div className="space-y-2">
        <div className="h-10 bg-muted/50 rounded-lg" />
        <div className="h-10 bg-muted/50 rounded-lg" />
      </div>
    </section>
  );

  return (
    <section className="mb-8">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
          <Inbox size={13} />
        </div>
        <h2 className="text-[13px] font-semibold text-foreground tracking-wide">
          {t.inbox.title}
        </h2>
        {hasFiles && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-semibold rounded-full bg-muted text-muted-foreground tabular-nums shadow-sm shadow-black/[0.02]">
            {t.inbox.count(files.length)}
          </span>
        )}
        {hasFiles && (
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground rounded-md px-2 py-1 transition-all duration-150 ease-out hover:text-foreground hover:bg-muted/40 cursor-pointer"
              title={t.inbox.uploadButton}
            >
              <Upload size={12} />
              <span className="hidden sm:inline">{t.inbox.uploadButton}</span>
            </button>
            <button
              onClick={handleOrganize}
              disabled={isOrganizing}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] bg-[var(--amber)]/[0.08] rounded-md px-2.5 py-1 transition-all duration-150 ease-out hover:bg-[var(--amber)]/[0.15] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
        accept=".md,.markdown,.txt,.csv,.json,.yaml,.yml,.xml,.html,.htm,.pdf,.doc,.docx,.docm"
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      {/* File list */}
      {hasFiles && (
        <div className="rounded-xl bg-card/50 border border-border/10 p-1 mb-3">
          <div className="flex flex-col gap-px">
            {visibleFiles.map((file) => (
              <InboxFileRow key={file.path} file={file} onDelete={handleDeleteFile} />
            ))}
          </div>
          {overflowCount > 0 && (
            <Link
              href="/capture"
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-[var(--amber)] transition-colors duration-150"
            >
              <ChevronRight size={12} />
              {t.inbox.viewAllFiles(files.length)}
            </Link>
          )}
        </div>
      )}

      {/* ─── Unified capture card: drop zone + URL clip ─── */}
      <div
        className={`rounded-xl border overflow-hidden transition-all duration-150 ease-out ${
          dragOver
            ? 'border-[var(--amber)] bg-[var(--amber-subtle)] shadow-[inset_0_0_0_1px_var(--amber)]'
            : 'border-border/40 bg-card/30'
        }`}
        onDragEnter={(e) => {
          const hasFiles = e.dataTransfer.types.includes('Files');
          const hasUrl = dragContainsUrl(e.nativeEvent);
          if (!hasFiles && !hasUrl) return;
          e.preventDefault();
          e.stopPropagation();
          dragCounterRef.current++;
          if (dragCounterRef.current === 1) {
            setDragOver(true);
            setDragIsUrl(hasUrl && !hasFiles);
          }
        }}
        onDragOver={(e) => {
          const hasFiles = e.dataTransfer.types.includes('Files');
          const hasUrl = dragContainsUrl(e.nativeEvent);
          if (!hasFiles && !hasUrl) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) {
            setDragOver(false);
            setDragIsUrl(false);
          }
        }}
        onDrop={handleLocalDrop}
      >
        {/* File drop zone */}
        <div
          className={`cursor-pointer transition-colors duration-150 ${
            hasFiles
              ? 'px-4 py-3'
              : 'px-4 py-7'
          } ${!dragOver ? 'hover:bg-muted/[0.06]' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={t.inbox.uploadButton}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        >
          {dragOver && dragIsUrl ? (
            <div className="flex items-center justify-center gap-2.5 text-center py-1">
              <Globe size={20} className="shrink-0 text-[var(--amber)] animate-pulse" />
              <p className="text-sm font-medium text-[var(--amber)]">
                {t.inbox.dropUrlOverlay}
              </p>
            </div>
          ) : hasFiles ? (
            <div className="flex items-center justify-center gap-2 text-center">
              <FolderInput size={15} className={`shrink-0 ${dragOver ? 'text-[var(--amber)]' : 'text-muted-foreground/30'}`} />
              <p className="text-xs text-muted-foreground/50">
                {t.inbox.dropFilesOrLinks}{' '}
                <span className="text-[var(--amber)]/70 hover:text-[var(--amber)] hover:underline">{t.fileImport.dropzoneCompactButton}</span>
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-center">
              <FolderInput size={26} className={`${dragOver ? 'text-[var(--amber)]' : 'text-muted-foreground/15'}`} />
              <p className="text-sm text-muted-foreground/60">
                {t.inbox.emptyTitle}
              </p>
              <p className="text-xs text-muted-foreground/35">
                {t.inbox.emptyDesc}
              </p>
              <p className="text-2xs text-muted-foreground/25">{t.inbox.dropOverlayFormats}</p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 ease-out bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted/80"
              >
                <Upload size={12} />
                {t.inbox.uploadButton}
              </button>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border/20 mx-3" />

        {/* URL clip input */}
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 transition-colors duration-150 focus-within:bg-muted/[0.06]"
          onClick={(e) => { e.stopPropagation(); clipInputRef.current?.focus(); }}
        >
          <div className={`flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors duration-150 ${
            clipping
              ? 'bg-[var(--amber)]/15'
              : clipUrl
                ? 'bg-[var(--amber)]/10'
                : 'bg-muted/50'
          }`}>
            {clipping ? (
              <Loader2 size={12} className="text-[var(--amber)] animate-spin" />
            ) : (
              <Link2 size={12} className={`transition-colors duration-150 ${clipUrl ? 'text-[var(--amber)]' : 'text-muted-foreground/40'}`} />
            )}
          </div>
          <input
            ref={clipInputRef}
            type="url"
            value={clipUrl}
            onChange={(e) => setClipUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !clipping) {
                e.preventDefault();
                handleClipUrl(clipUrl);
              }
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text/plain').trim();
              if (pasted && looksLikeUrl(pasted) && !clipUrl) {
                e.preventDefault();
                setClipUrl(pasted);
                setTimeout(() => handleClipUrl(pasted), 50);
              }
            }}
            placeholder={t.inbox.clipUrlPlaceholder}
            disabled={clipping}
            className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/30 outline-none disabled:opacity-50"
          />
          {clipUrl && !clipping && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleClipUrl(clipUrl); }}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-[var(--amber)]/10 text-[var(--amber)] hover:bg-[var(--amber)]/20 transition-all duration-150 ease-out cursor-pointer"
            >
              <Globe size={11} />
              {t.inbox.clipButton}
            </button>
          )}
          {clipping && (
            <span className="shrink-0 text-xs text-[var(--amber)]/70 tabular-nums">
              {t.inbox.clipping}
            </span>
          )}
        </div>
      </div>

      {/* Recently processed — inline history */}
      {history.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={11} className="text-muted-foreground/40" />
            <span className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
              {t.importHistory.title}
            </span>
            <Link
              href="/capture/history"
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

function InboxFileRow({ file, onDelete }: { file: InboxFile; onDelete: (name: string) => void }) {
  const { t } = useLocale();
  const router = useRouter();
  const isCSV = file.name.endsWith('.csv');
  const age = formatRelativeTime(file.modifiedAt, t.home.relativeTime);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleNavigate = () => {
    router.push(`/view/${encodePath(file.path)}`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDelete(file.name);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleNavigate}
        onKeyDown={(e) => { if (e.key === 'Enter') handleNavigate(); }}
        onContextMenu={handleContextMenu}
        className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all duration-150 ease-out hover:translate-x-0.5 hover:bg-muted/50 hover:shadow-sm hover:shadow-black/[0.03] group cursor-pointer"
      >
        <span
          className={`w-[5px] h-[5px] rounded-full shrink-0 ring-2 ring-background ${
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
        <span className="text-2xs text-muted-foreground/40 tabular-nums shrink-0 group-hover:hidden">
          {age}
        </span>
        {file.isAging && (
          <span title="7+ days" className="group-hover:hidden">
            <AlertCircle
              size={11}
              className="shrink-0 text-[var(--amber)]/60"
            />
          </span>
        )}
        {/* Hover delete button */}
        <button
          type="button"
          onClick={handleDelete}
          className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded shrink-0 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all duration-150 ease-out"
          title={t.inbox.removeFile}
        >
          <X size={12} />
        </button>
      </div>
      {ctxMenu && (
        <InboxFileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          file={file}
          onDelete={() => { setCtxMenu(null); onDelete(file.name); }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

/** Right-click context menu for Inbox file items */
function InboxFileContextMenu({ x, y, file, onDelete, onClose }: {
  x: number; y: number; file: InboxFile; onDelete: () => void; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [onClose]);

  const adjX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 200) : x;
  const adjY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 120) : y;

  const menuItemClass = 'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left';

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ top: adjY, left: adjX }}
    >
      <button
        className={menuItemClass}
        onClick={() => { router.push(`/view/${encodePath(file.path)}`); onClose(); }}
      >
        <ExternalLink size={14} className="shrink-0" /> {t.inbox.openFile}
      </button>
      <button
        className={menuItemClass}
        onClick={() => { navigator.clipboard.writeText(file.name); toast.copy(); onClose(); }}
      >
        <Copy size={14} className="shrink-0" /> {t.inbox.copyName}
      </button>
      <div className="border-t border-border my-1" />
      <button
        className={`${menuItemClass} text-destructive hover:text-destructive`}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" /> {t.inbox.removeFile}
      </button>
    </div>
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
    <div className="rounded-lg border border-border/15 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/15 transition-all duration-150 ease-out"
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
        <div className="border-t border-border/10 px-3 py-1.5 space-y-0.5">
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
