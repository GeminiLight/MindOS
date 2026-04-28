'use client';

import { useSyncExternalStore, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Table, Folder, FolderOpen, LayoutGrid, List, FilePlus, ScrollText, BookOpen, Copy, AlertTriangle, Sparkles, Loader2, Check } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import { encodePath, relativeTime } from '@/lib/utils';
import { FileNode, SYSTEM_FILES } from '@/lib/types';
import type { SpacePreview } from '@/lib/core/types';
import { useLocale } from '@/lib/stores/locale-store';

async function copyPathToClipboard(path: string) {
  try { await navigator.clipboard.writeText(path); } catch { /* noop */ }
}

interface DirViewProps {
  dirPath: string;
  entries: FileNode[];
  spacePreview?: SpacePreview | null;
}

function FileIcon({ node }: { node: FileNode }) {
  if (node.type === 'directory') return <Folder size={16} className="text-yellow-400 shrink-0" />;
  if (node.extension === '.csv') return <Table size={16} className="text-success shrink-0" />;
  return <FileText size={16} className="text-muted-foreground shrink-0" />;
}

function FileIconLarge({ node }: { node: FileNode }) {
  if (node.type === 'directory') return <FolderOpen size={28} className="text-yellow-400" />;
  if (node.extension === '.csv') return <Table size={28} className="text-success" />;
  return <FileText size={28} className="text-muted-foreground" />;
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((acc, c) => acc + countFiles(c), 0);
}

const DIR_VIEW_KEY = 'mindos-dir-view';
const HIDDEN_FILES_KEY = 'show-hidden-files';

function subscribeHiddenFiles(cb: () => void) {
  const handler = (e: StorageEvent) => { if (e.key === HIDDEN_FILES_KEY) cb(); };
  const custom = () => cb();
  window.addEventListener('storage', handler);
  window.addEventListener('mindos:hidden-files-changed', custom);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('mindos:hidden-files-changed', custom);
  };
}

function getShowHiddenFiles() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(HIDDEN_FILES_KEY) === 'true';
}

function useShowHiddenFiles() {
  return useSyncExternalStore(subscribeHiddenFiles, getShowHiddenFiles, () => false);
}

function useDirViewPref() {
  const view = useSyncExternalStore(
    (onStoreChange) => {
      const listener = () => onStoreChange();
      window.addEventListener('mindos-dir-view-change', listener);
      return () => window.removeEventListener('mindos-dir-view-change', listener);
    },
    () => {
      const saved = localStorage.getItem(DIR_VIEW_KEY);
      return (saved === 'list' || saved === 'grid') ? saved : 'grid';
    },
    () => 'grid' as const,
  );

  const setView = (v: 'grid' | 'list') => {
    localStorage.setItem(DIR_VIEW_KEY, v);
    window.dispatchEvent(new Event('mindos-dir-view-change'));
  };

  return [view, setView] as const;
}

// ─── Space Preview Cards ──────────────────────────────────────────────────────

function SpacePreviewCard({ icon, title, lines, viewAllHref, viewAllLabel, trailing, footer }: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  viewAllHref: string;
  viewAllLabel: string;
  trailing?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-sm font-medium text-muted-foreground flex-1">{title}</span>
        {trailing}
      </div>
      <div className="space-y-1">
        {lines.map((line, i) => (
          <p key={i} className="text-sm text-muted-foreground/80 leading-relaxed" suppressHydrationWarning>
            · {line}
          </p>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        {footer || <span />}
        <Link
          href={viewAllHref}
          className="text-xs hover:underline transition-colors text-[var(--amber)]"
        >
          {viewAllLabel}
        </Link>
      </div>
    </div>
  );
}

// ─── AI Overview Generation ───────────────────────────────────────────────────

type OverviewState = 'idle' | 'loading' | 'error' | 'unchanged';

function useSpaceFileCount(dirPath: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/api/space-overview?space=${encodeURIComponent(dirPath)}`)
      .then(r => r.json())
      .then(d => setCount(d.fileCount ?? 0))
      .catch(() => setCount(null));
  }, [dirPath]);
  return count;
}

function OverviewCtaCard({ dirPath }: { dirPath: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [state, setState] = useState<OverviewState>('idle');
  const [error, setError] = useState('');
  const fileCount = useSpaceFileCount(dirPath);

  const handleGenerate = async () => {
    setState('loading');
    setError('');
    try {
      const res = await fetch('/api/space-overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space: dirPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unknown error');
        setState('error');
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setState('error');
    }
  };

  return (
    <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-4">
      <div className="flex items-center gap-1.5 mb-3">
        <BookOpen size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-muted-foreground">{t.fileTree.about}</span>
      </div>

      {state === 'loading' ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <Loader2 size={20} className="text-[var(--amber)] animate-spin" />
          <p className="text-sm text-muted-foreground">{t.dirView.overviewGenerating}</p>
          {fileCount != null && fileCount > 0 && (
            <p className="text-xs text-muted-foreground/60">{t.dirView.overviewScanningFiles(fileCount)}</p>
          )}
        </div>
      ) : state === 'error' ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <AlertTriangle size={18} className="text-error" />
          <p className="text-sm text-muted-foreground">{t.dirView.overviewError}</p>
          <p className="text-xs text-muted-foreground/60 text-center max-w-[280px]">{error}</p>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={handleGenerate}
              className="text-xs text-[var(--amber)] hover:underline"
            >
              {t.dirView.overviewRetry}
            </button>
            <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground">
              {t.dirView.uninitSettings}
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5 py-2">
          {fileCount != null && fileCount > 0 ? (
            <>
              <p className="text-sm text-muted-foreground text-center">
                {t.dirView.overviewCtaHint(fileCount)}
              </p>
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90"
              >
                <Sparkles size={14} />
                {t.dirView.overviewCta}
              </button>
            </>
          ) : fileCount === 0 ? (
            <p className="text-sm text-muted-foreground">{t.dirView.overviewNoFiles}</p>
          ) : null}
          <Link
            href={`/view/${encodePath(`${dirPath}/README.md`)}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t.dirView.overviewOrEdit}
          </Link>
        </div>
      )}
    </div>
  );
}

function AboutCardWithRegenerate({ dirPath, preview }: {
  dirPath: string;
  preview: SpacePreview;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [state, setState] = useState<OverviewState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const confirmRef = useRef<HTMLDivElement>(null);

  // Close confirm popover on click outside
  useEffect(() => {
    if (!showConfirm) return;
    const handler = (e: MouseEvent) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) {
        setShowConfirm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showConfirm]);

  const handleRegenerate = async () => {
    setShowConfirm(false);
    setState('loading');
    setErrorMsg('');
    setToastMsg('');
    try {
      const res = await fetch('/api/space-overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space: dirPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Unknown error');
        setState('error');
        return;
      }
      if (data.unchanged) {
        setState('unchanged');
        setTimeout(() => setState('idle'), 3000);
      } else {
        // Show incremental info if available
        if (data.stats?.mode === 'incremental') {
          setToastMsg(t.dirView.overviewIncremental(data.stats.scannedFiles));
          setTimeout(() => setToastMsg(''), 4000);
        }
        router.refresh();
        setState('idle');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
      setState('error');
    }
  };

  if (state === 'loading') {
    return (
      <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <BookOpen size={14} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-muted-foreground flex-1">{t.fileTree.about}</span>
        </div>
        <div className="flex items-center gap-2 py-2">
          <Loader2 size={14} className="text-[var(--amber)] animate-spin" />
          <span className="text-sm text-muted-foreground">{t.dirView.overviewGenerating}</span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <BookOpen size={14} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-muted-foreground flex-1">{t.fileTree.about}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 py-2">
          <p className="text-xs text-error">{t.dirView.overviewError}</p>
          {errorMsg && <p className="text-xs text-muted-foreground/60 text-center">{errorMsg}</p>}
          <button onClick={handleRegenerate} className="text-xs text-[var(--amber)] hover:underline mt-1">
            {t.dirView.overviewRetry}
          </button>
        </div>
      </div>
    );
  }

  const regenerateBtn = (
    <div className="relative" ref={confirmRef}>
      <button
        onClick={() => setShowConfirm(true)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground/60 hover:text-[var(--amber)] hover:bg-[var(--amber)]/10 transition-colors"
        title={t.dirView.overviewRegenerate}
      >
        <Sparkles size={13} />
        <span className="hidden sm:inline">{t.dirView.overviewRegenerateLabel}</span>
      </button>
      {showConfirm && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-[260px] bg-card border border-border rounded-lg shadow-lg p-3">
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            {t.dirView.overviewRegenerateConfirm}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowConfirm(false)}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              {t.dirView.overviewRegenerateCancel}
            </button>
            <button
              onClick={handleRegenerate}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-colors"
            >
              <Sparkles size={11} />
              {t.dirView.overviewRegenerateStart}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Build footer with lastCompiled time and status messages
  const footerContent = (
    <span className="text-2xs text-muted-foreground/50" suppressHydrationWarning>
      {state === 'unchanged' ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check size={10} />
          {t.dirView.overviewUnchanged}
        </span>
      ) : toastMsg ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check size={10} />
          {toastMsg}
        </span>
      ) : preview.lastCompiled ? (
        t.dirView.overviewLastCompiled(
          relativeTime(new Date(preview.lastCompiled).getTime(), t.home.relativeTime)
        )
      ) : null}
    </span>
  );

  return (
    <SpacePreviewCard
      icon={<BookOpen size={14} className="text-muted-foreground shrink-0" />}
      title={t.fileTree.about}
      lines={preview.readmeLines}
      viewAllHref={`/view/${encodePath(`${dirPath}/README.md`)}`}
      viewAllLabel={t.fileTree.viewAll}
      trailing={regenerateBtn}
      footer={footerContent}
    />
  );
}

function SpacePreviewSection({ preview, dirPath }: {
  preview: SpacePreview;
  dirPath: string;
}) {
  const { t } = useLocale();
  const hasRules = preview.instructionLines.length > 0;
  const hasAbout = preview.readmeLines.length > 0;
  const isReadmeTemplate = !hasAbout || preview.readmeIsTemplate || preview.isTemplate;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      {hasRules && (
        <SpacePreviewCard
          icon={<ScrollText size={14} className="text-muted-foreground shrink-0" />}
          title={t.fileTree.rules}
          lines={preview.instructionLines}
          viewAllHref={`/view/${encodePath(`${dirPath}/INSTRUCTION.md`)}`}
          viewAllLabel={t.fileTree.viewAll}
        />
      )}
      {isReadmeTemplate ? (
        <OverviewCtaCard dirPath={dirPath} />
      ) : (
        <AboutCardWithRegenerate dirPath={dirPath} preview={preview} />
      )}
    </div>
  );
}

// ─── Context Menu for DirView entries ─────────────────────────────────────────

function DirContextMenu({ x, y, path, label, onClose }: {
  x: number; y: number; path: string; label: string; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
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

  // Keep within viewport
  const adjX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 200) : x;
  const adjY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 60) : y;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ top: adjY, left: adjX }}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
        onClick={() => { copyPathToClipboard(path); onClose(); }}
      >
        <Copy size={14} className="shrink-0" /> {t.fileTree.copyPath}
      </button>
    </div>
  );
}

// ─── DirView ──────────────────────────────────────────────────────────────────

export default function DirView({ dirPath, entries, spacePreview }: DirViewProps) {
  const [view, setView] = useDirViewPref();
  const showHidden = useShowHiddenFiles();
  const { t } = useLocale();
  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const handleCtx = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  const visibleEntries = useMemo(() => {
    return showHidden ? entries : entries.filter(e => e.type !== 'file' || !SYSTEM_FILES.has(e.name));
  }, [entries, showHidden]);

  const fileCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of visibleEntries) map.set(e.path, countFiles(e));
    return map;
  }, [visibleEntries]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Topbar */}
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border px-4 md:px-6 h-[46px] flex items-center bg-background">
        <div className="w-full flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Breadcrumb filePath={dirPath} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/view/${encodePath(dirPath ? `${dirPath}/Untitled.md` : 'Untitled.md')}`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <FilePlus size={13} />
              <span className="hidden sm:inline">{t.dirView.newFile}</span>
            </Link>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setView('grid')}
                className={`p-1.5 rounded transition-colors ${view === 'grid' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                title={t.dirView.gridView}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-1.5 rounded transition-colors ${view === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                title={t.dirView.listView}
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 md:px-6 py-6">
        <div className="max-w-[860px] mx-auto">
          {/* Space preview cards (always shown when there's a spacePreview) */}
          {spacePreview && (
            <SpacePreviewSection preview={spacePreview} dirPath={dirPath} />
          )}

          {visibleEntries.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.dirView.emptyFolder}</p>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {visibleEntries.map(entry => (
                <Link
                  key={entry.path}
                  href={`/view/${encodePath(entry.path)}`}
                  onContextMenu={(e) => handleCtx(e, entry.path)}
                  className={
                    entry.type === 'directory'
                      ? 'flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
                      : 'flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
                  }
                >
                  {entry.type === 'directory'
                    ? <FolderOpen size={22} className="text-yellow-400" />
                    : <FileIconLarge node={entry} />}
                  <span className="text-xs text-foreground leading-snug line-clamp-2 w-full" title={entry.name} suppressHydrationWarning>
                    {entry.name}
                  </span>
                  {entry.type === 'directory' && (
                    <span className="text-2xs text-muted-foreground">{t.dirView.fileCount(fileCounts.get(entry.path) ?? 0)}</span>
                  )}
                  {entry.type === 'file' && entry.mtime && (
                    <span className="text-2xs text-muted-foreground" suppressHydrationWarning>
                      {formatTime(entry.mtime)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
              {visibleEntries.map(entry => (
                <Link
                  key={entry.path}
                  href={`/view/${encodePath(entry.path)}`}
                  onContextMenu={(e) => handleCtx(e, entry.path)}
                  className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent transition-colors duration-100"
                >
                  <FileIcon node={entry} />
                  <span className="flex-1 text-sm text-foreground truncate" title={entry.name} suppressHydrationWarning>
                    {entry.name}
                  </span>
                  {entry.type === 'directory' ? (
                    <span className="text-xs text-muted-foreground shrink-0">{t.dirView.fileCount(fileCounts.get(entry.path) ?? 0)}</span>
                  ) : entry.mtime ? (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums" suppressHydrationWarning>
                      {formatTime(entry.mtime)}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <DirContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          path={ctxMenu.path}
          label={t.fileTree.copyPath}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
