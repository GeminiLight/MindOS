'use client';

import { useSyncExternalStore, useMemo } from 'react';
import Link from 'next/link';
import { FileText, Table, Folder, FolderOpen, LayoutGrid, List, FilePlus, ScrollText, BookOpen } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import { encodePath, relativeTime } from '@/lib/utils';
import { FileNode } from '@/lib/types';
import type { SpacePreview } from '@/lib/core/types';
import { useLocale } from '@/lib/LocaleContext';

const SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md']);

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

function SpacePreviewCard({ icon, title, lines, viewAllHref, viewAllLabel }: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  viewAllHref: string;
  viewAllLabel: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="bg-muted/30 border border-border/40 rounded-lg px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="space-y-1">
        {lines.map((line, i) => (
          <p key={i} className="text-sm text-muted-foreground/80 leading-relaxed">
            · {line}
          </p>
        ))}
      </div>
      <div className="flex justify-end mt-2">
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

function SpacePreviewSection({ preview, dirPath }: {
  preview: SpacePreview;
  dirPath: string;
}) {
  const { t } = useLocale();
  const hasRules = preview.instructionLines.length > 0;
  const hasAbout = preview.readmeLines.length > 0;
  if (!hasRules && !hasAbout) return null;

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
      {hasAbout && (
        <SpacePreviewCard
          icon={<BookOpen size={14} className="text-muted-foreground shrink-0" />}
          title={t.fileTree.about}
          lines={preview.readmeLines}
          viewAllHref={`/view/${encodePath(`${dirPath}/README.md`)}`}
          viewAllLabel={t.fileTree.viewAll}
        />
      )}
    </div>
  );
}

// ─── DirView ──────────────────────────────────────────────────────────────────

export default function DirView({ dirPath, entries, spacePreview }: DirViewProps) {
  const [view, setView] = useDirViewPref();
  const { t } = useLocale();
  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);

  const visibleEntries = useMemo(() => {
    if (spacePreview) {
      return entries.filter(e => e.type !== 'file' || !SYSTEM_FILES.has(e.name));
    }
    return entries.filter(e => e.type !== 'file' || e.name !== 'README.md');
  }, [entries, spacePreview]);

  const fileCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of visibleEntries) map.set(e.path, countFiles(e));
    return map;
  }, [visibleEntries]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Topbar */}
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border px-4 md:px-6 py-2.5 bg-background">
        <div className="max-w-[860px] mx-auto flex items-center justify-between gap-2">
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
          {/* Space preview cards */}
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
                  className={
                    entry.type === 'directory'
                      ? 'flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
                      : 'flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
                  }
                >
                  {entry.type === 'directory'
                    ? <FolderOpen size={22} className="text-yellow-400" />
                    : <FileIconLarge node={entry} />}
                  <span className="text-xs text-foreground leading-snug line-clamp-2 w-full" suppressHydrationWarning>
                    {entry.name}
                  </span>
                  {entry.type === 'directory' && (
                    <span className="text-2xs text-muted-foreground">{t.dirView.fileCount(fileCounts.get(entry.path) ?? 0)}</span>
                  )}
                  {entry.type === 'file' && entry.mtime && (
                    <span className="text-2xs text-muted-foreground font-display" suppressHydrationWarning>
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
                  className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent transition-colors duration-100"
                >
                  <FileIcon node={entry} />
                  <span className="flex-1 text-sm text-foreground truncate" suppressHydrationWarning>
                    {entry.name}
                  </span>
                  {entry.type === 'directory' ? (
                    <span className="text-xs text-muted-foreground shrink-0">{t.dirView.fileCount(fileCounts.get(entry.path) ?? 0)}</span>
                  ) : entry.mtime ? (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums font-display" suppressHydrationWarning>
                      {formatTime(entry.mtime)}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
