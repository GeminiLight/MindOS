'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { FileText, Table, Folder, FolderOpen, LayoutGrid, List } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import { encodePath } from '@/lib/utils';
import { FileNode } from '@/lib/types';
import { useLocale } from '@/lib/LocaleContext';

interface DirViewProps {
  dirPath: string;
  entries: FileNode[];
}

function FileIcon({ node }: { node: FileNode }) {
  if (node.type === 'directory') return <Folder size={16} className="text-yellow-400 shrink-0" />;
  if (node.extension === '.csv') return <Table size={16} className="text-emerald-400 shrink-0" />;
  return <FileText size={16} className="text-zinc-400 shrink-0" />;
}

function FileIconLarge({ node }: { node: FileNode }) {
  if (node.type === 'directory') return <FolderOpen size={28} className="text-yellow-400" />;
  if (node.extension === '.csv') return <Table size={28} className="text-emerald-400" />;
  return <FileText size={28} className="text-zinc-400" />;
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((acc, c) => acc + countFiles(c), 0);
}

const DIR_VIEW_KEY = 'mindos-dir-view';

function useDirViewPref() {
  const [view, setViewState] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const saved = localStorage.getItem(DIR_VIEW_KEY);
    if (saved === 'list' || saved === 'grid') setViewState(saved);
  }, []);

  const setView = (v: 'grid' | 'list') => {
    setViewState(v);
    localStorage.setItem(DIR_VIEW_KEY, v);
  };

  return [view, setView] as const;
}

export default function DirView({ dirPath, entries }: DirViewProps) {
  const [view, setView] = useDirViewPref();
  const { t } = useLocale();
  const fileCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.path, countFiles(e));
    return map;
  }, [entries]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Topbar */}
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border px-4 md:px-6 py-2.5" style={{ background: 'var(--background)' }}>
        <div className="max-w-[860px] mx-auto flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Breadcrumb filePath={dirPath} />
          </div>
          {/* View toggle */}
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg shrink-0">
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

      {/* Content */}
      <div className="flex-1 px-4 md:px-6 py-6">
        <div className="max-w-[860px] mx-auto">
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.dirView.emptyFolder}</p>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {entries.map(entry => (
                <Link
                  key={entry.path}
                  href={`/view/${encodePath(entry.path)}`}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center"
                >
                  <FileIconLarge node={entry} />
                  <span className="text-xs text-foreground leading-snug line-clamp-2 w-full" suppressHydrationWarning>
                    {entry.name}
                  </span>
                  {entry.type === 'directory' && (
                    <span className="text-[10px] text-muted-foreground">{t.dirView.fileCount(fileCounts.get(entry.path) ?? 0)}</span>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
              {entries.map(entry => (
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
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }} suppressHydrationWarning>
                      {new Date(entry.mtime).toLocaleDateString()}
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
