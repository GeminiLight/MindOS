'use client';

import Link from 'next/link';
import { FileText, Table, Clock, Sparkles, Puzzle } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { getAllRenderers } from '@/lib/renderers/registry';
import '@/lib/renderers/index'; // registers all renderers

interface RecentFile {
  path: string;
  mtime: number;
}

function encodePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

// Maps a renderer id to a canonical entry file path
const RENDERER_ENTRY: Record<string, string> = {
  todo: 'TODO.md',
  csv: 'Resources/Products.csv',
};

function deriveEntryPath(id: string): string | null {
  return RENDERER_ENTRY[id] ?? null;
}

export default function HomeContent({ recent }: { recent: RecentFile[] }) {
  const { t } = useLocale();

  function relativeTime(mtime: number): string {
    const diff = Date.now() - mtime;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return t.home.relativeTime.justNow;
    if (minutes < 60) return t.home.relativeTime.minutesAgo(minutes);
    if (hours < 24) return t.home.relativeTime.hoursAgo(hours);
    if (days < 7) return t.home.relativeTime.daysAgo(days);
    return new Date(mtime).toLocaleDateString();
  }

  const renderers = getAllRenderers();

  const shortcuts = [
    { key: '⌘K', label: t.home.shortcuts.searchFiles },
    { key: '⌘/', label: t.home.shortcuts.askAI },
    { key: '⌘,', label: t.home.shortcuts.settings },
  ];

  return (
    <div className="max-w-[900px] mx-auto px-6 py-12">
      {/* Hero */}
      <div className="mb-12">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--amber)' }} />
          <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--foreground)' }}>
            MindOS
          </h1>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)', paddingLeft: '1rem' }}>
          {t.app.tagline}
        </p>

        {/* Hint pills */}
        <div className="flex flex-wrap gap-2 mt-5" style={{ paddingLeft: '1rem' }}>
          {shortcuts.map(({ key, label }) => (
            <span key={key} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
              <kbd className="font-mono text-xs font-medium" style={{ color: 'var(--foreground)' }}>{key}</kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Plugins */}
      {renderers.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Puzzle size={13} style={{ color: 'var(--amber)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono', monospace" }}>
              Plugins
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {renderers.map((r) => {
              // Derive a suggested entry path from the match pattern
              // e.g. todo renderer → link to TODO.md if it exists, otherwise just show the renderer
              const entryPath = deriveEntryPath(r.id);
              return (
                <Link
                  key={r.id}
                  href={entryPath ? `/view/${encodePath(entryPath)}` : '#'}
                  className="group flex items-start gap-3 px-4 py-3.5 rounded-xl border border-border transition-all hover:border-amber-500/30 hover:bg-muted/50"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="text-xl leading-none mt-0.5 shrink-0">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold" style={{ color: 'var(--foreground)', fontFamily: "'IBM Plex Sans', sans-serif" }}>
                        {r.name}
                      </span>
                      {r.builtin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--amber-dim)', color: 'var(--amber)', fontFamily: "'IBM Plex Mono', monospace" }}>
                          built-in
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>
                      {r.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Recently modified — timeline feed */}
      {recent.length > 0 && (
        <section>
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
              {recent.map(({ path: filePath, mtime }, idx) => {
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
                        {relativeTime(mtime)}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <div className="mt-16 flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.4, fontFamily: "'IBM Plex Mono', monospace" }}>
        <Sparkles size={10} style={{ color: 'var(--amber)' }} />
        <span>{t.app.footer}</span>
      </div>
    </div>
  );
}
