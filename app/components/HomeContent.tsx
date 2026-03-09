'use client';

import Link from 'next/link';
import { FileText, Table, Clock, Sparkles, Puzzle, ArrowRight, FilePlus, Search, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath, relativeTime } from '@/lib/utils';
import { getAllRenderers } from '@/lib/renderers/registry';
import '@/lib/renderers/index'; // registers all renderers

interface RecentFile {
  path: string;
  mtime: number;
}

// Maps a renderer id to a canonical entry file path
const RENDERER_ENTRY: Record<string, string> = {
  todo: 'TODO.md',
  csv: 'Resources/Products.csv',
  graph: 'README.md',
  timeline: 'CHANGELOG.md',
  backlinks: 'BACKLINKS.md',
  summary: 'DAILY.md',
  'agent-inspector': 'Agent-Audit.md',
  workflow: 'Workflow.md',
  'diff-viewer': 'Agent-Diff.md',
};

function deriveEntryPath(id: string): string | null {
  return RENDERER_ENTRY[id] ?? null;
}

function triggerSearch() {
  // Dispatch ⌘K to open the Sidebar's SearchModal
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
}

export default function HomeContent({ recent }: { recent: RecentFile[] }) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);

  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);

  const renderers = getAllRenderers();

  const shortcuts = [
    { key: '⌘/', label: t.home.shortcuts.askAI },
    { key: '⌘,', label: t.home.shortcuts.settings },
  ];

  const lastFile = recent[0];

  return (
    <div className="max-w-[900px] mx-auto px-6 py-12">
      {/* Hero */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--amber)' }} />
          <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--foreground)' }}>
            MindOS
          </h1>
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--muted-foreground)', paddingLeft: '1rem' }}>
          {t.app.tagline}
        </p>

        {/* Search bar — prominent, clickable */}
        <button
          onClick={triggerSearch}
          className="w-full max-w-[520px] flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-150 cursor-text hover:border-amber-500/40 group"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border)',
            marginLeft: '1rem',
          }}
        >
          <Search size={16} style={{ color: 'var(--muted-foreground)' }} className="shrink-0 group-hover:text-amber-500 transition-colors" />
          <span className="text-sm flex-1 text-left" style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Sans', sans-serif" }}>
            {t.search.placeholder}
          </span>
          <kbd
            className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium"
            style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2.5 mt-4" style={{ paddingLeft: '1rem' }}>
          {lastFile && (
            <Link
              href={`/view/${encodePath(lastFile.path)}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:translate-x-0.5"
              style={{
                background: 'var(--amber-dim)',
                color: 'var(--amber)',
                fontFamily: "'IBM Plex Sans', sans-serif",
              }}
            >
              <ArrowRight size={14} />
              <span>{t.home.continueEditing}</span>
              <span className="text-xs opacity-60 truncate max-w-[160px]" suppressHydrationWarning>
                {lastFile.path.split('/').pop()}
              </span>
            </Link>
          )}
          <Link
            href="/view/Untitled.md"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'var(--muted)',
              color: 'var(--muted-foreground)',
              fontFamily: "'IBM Plex Sans', sans-serif",
            }}
          >
            <FilePlus size={14} />
            <span>{t.home.newNote}</span>
          </Link>
        </div>

        {/* Remaining shortcut hints (search removed — has its own bar now) */}
        <div className="flex flex-wrap gap-2 mt-3" style={{ paddingLeft: '1rem' }}>
          {shortcuts.map(({ key, label }) => (
            <span key={key} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
              <kbd className="font-mono text-xs font-medium" style={{ color: 'var(--foreground)' }}>{key}</kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Plugins — compact 3-column grid, always visible */}
      {renderers.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Puzzle size={13} style={{ color: 'var(--amber)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono', monospace" }}>
              {t.home.plugins}
            </h2>
            <span className="text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}>
              {renderers.length}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {renderers.map((r) => {
              const entryPath = deriveEntryPath(r.id);
              return (
                <Link
                  key={r.id}
                  href={entryPath ? `/view/${encodePath(entryPath)}` : '#'}
                  className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all hover:border-amber-500/30 hover:bg-muted/50"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="text-base leading-none shrink-0" suppressHydrationWarning>{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold truncate block" style={{ color: 'var(--foreground)', fontFamily: "'IBM Plex Sans', sans-serif" }}>
                      {r.name}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Recently modified — timeline feed */}
      {recent.length > 0 && (() => {
        const INITIAL_COUNT = 5;
        const visibleRecent = showAll ? recent : recent.slice(0, INITIAL_COUNT);
        const hasMore = recent.length > INITIAL_COUNT;

        return (
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-5">
            <Clock size={13} style={{ color: 'var(--amber)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono', monospace" }}>
              {t.home.recentlyModified}
            </h2>
          </div>

          <div className="relative pl-4">
            {/* Timeline line */}
            <div className="absolute left-0 top-1 bottom-1 w-px" style={{ background: 'var(--border)' }} />

            <div className="flex flex-col gap-0.5">
              {visibleRecent.map(({ path: filePath, mtime }, idx) => {
                const isCSV = filePath.endsWith('.csv');
                const name = filePath.split('/').pop() || filePath;
                const dir = filePath.split('/').slice(0, -1).join('/');
                return (
                  <div key={filePath} className="relative group">
                    {/* Timeline dot */}
                    <div
                      className="absolute -left-4 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full transition-all duration-150 group-hover:scale-150"
                      style={{
                        background: idx === 0 ? 'var(--amber)' : 'var(--border)',
                        outline: idx === 0 ? '2px solid var(--amber-dim)' : 'none',
                      }}
                    />
                    <Link
                      href={`/view/${encodePath(filePath)}`}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-100 group-hover:translate-x-0.5 hover:bg-muted"
                    >
                      {isCSV
                        ? <Table size={13} className="shrink-0" style={{ color: '#7aad80' }} />
                        : <FileText size={13} className="shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                      }
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block" style={{ color: 'var(--foreground)' }} suppressHydrationWarning>{name}</span>
                        {dir && <span className="text-xs truncate block" style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}>{dir}</span>}
                      </div>
                      <span className="text-xs shrink-0 tabular-nums" style={{ color: 'var(--muted-foreground)', opacity: 0.5, fontFamily: "'IBM Plex Mono', monospace" }} suppressHydrationWarning>
                        {formatTime(mtime)}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* Show more / less */}
            {hasMore && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="flex items-center gap-1.5 mt-2 ml-3 text-xs font-medium transition-colors hover:opacity-80 cursor-pointer"
                style={{ color: 'var(--amber)', fontFamily: "'IBM Plex Mono', monospace" }}
              >
                <ChevronDown
                  size={12}
                  className="transition-transform duration-200"
                  style={{ transform: showAll ? 'rotate(180deg)' : undefined }}
                />
                <span>{showAll ? t.home.showLess : t.home.showMore}</span>
              </button>
            )}
          </div>
        </section>
        );
      })()}

      {/* Footer */}
      <div className="mt-16 flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.4, fontFamily: "'IBM Plex Mono', monospace" }}>
        <Sparkles size={10} style={{ color: 'var(--amber)' }} />
        <span>{t.app.footer}</span>
      </div>
    </div>
  );
}
