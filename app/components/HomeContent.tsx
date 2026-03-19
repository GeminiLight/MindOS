'use client';

import Link from 'next/link';
import { FileText, Table, Clock, Sparkles, Puzzle, ArrowRight, FilePlus, Search, ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath, relativeTime } from '@/lib/utils';
import { getAllRenderers } from '@/lib/renderers/registry';
import '@/lib/renderers/index'; // registers all renderers
import OnboardingView from './OnboardingView';
import GuideCard from './GuideCard';

interface RecentFile {
  path: string;
  mtime: number;
}

function triggerSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
}

function triggerAsk() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
}

export default function HomeContent({ recent, existingFiles }: { recent: RecentFile[]; existingFiles?: string[] }) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [hintId, setHintId] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const suggestions = t.ask?.suggestions ?? [
    'Summarize this document',
    'List all action items and TODOs',
    'What are the key points?',
    'Find related notes on this topic',
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setSuggestionIdx(i => (i + 1) % suggestions.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [suggestions.length]);

  // Cleanup hint timer on unmount
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  function showHint(id: string) {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHintId(id);
    hintTimer.current = setTimeout(() => setHintId(null), 3000);
  }

  const existingSet = new Set(existingFiles ?? []);

  // Empty knowledge base → show onboarding
  if (recent.length === 0) {
    return <OnboardingView />;
  }

  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);

  // Only show renderers with an entryPath on the home page grid.
  // Opt-in renderers (like Graph) have no entryPath and are toggled from the view toolbar.
  const renderers = getAllRenderers().filter(r => r.entryPath);

  const lastFile = recent[0];

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-12">
      <GuideCard onNavigate={(path) => { window.location.href = `/view/${encodeURIComponent(path)}`; }} />
      {/* Hero */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--amber)' }} />
          <h1 className="text-2xl font-semibold tracking-tight font-display" style={{ color: 'var(--foreground)' }}>
            MindOS
          </h1>
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--muted-foreground)', paddingLeft: '1rem' }}>
          {t.app.tagline}
        </p>

        {/* AI-first command bar */}
        <div
          className="w-full max-w-[620px] flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
          style={{
            marginLeft: '1rem',
          }}
        >
          {/* Ask AI (primary) */}
          <button
            onClick={triggerAsk}
            title="⌘/"
            className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-150 hover:border-amber-500/50 hover:bg-amber-500/8"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <Sparkles size={15} style={{ color: 'var(--amber)' }} className="shrink-0" />
            <span className="text-sm flex-1 text-left" style={{ color: 'var(--foreground)' }}>
              {suggestions[suggestionIdx]}
            </span>
            <kbd
              className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-mono font-medium"
              style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}
            >
              ⌘/
            </kbd>
          </button>

          {/* Search files (secondary) */}
          <button
            onClick={triggerSearch}
            title="⌘K"
            className="flex items-center gap-2 px-3 py-3 rounded-xl border text-sm transition-colors shrink-0 hover:bg-muted"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            <Search size={14} />
            <span className="hidden sm:inline">{t.home.shortcuts.searchFiles}</span>
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono" style={{ background: 'var(--muted)' }}>
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2.5 mt-4" style={{ paddingLeft: '1rem' }}>
          {lastFile && (
            <Link
              href={`/view/${encodePath(lastFile.path)}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:translate-x-0.5"
              style={{
                background: 'var(--amber-dim)',
                color: 'var(--amber)',
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
            }}
          >
            <FilePlus size={14} />
            <span>{t.home.newNote}</span>
          </Link>
        </div>

      </div>

      {/* Plugins */}
      {renderers.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Puzzle size={13} style={{ color: 'var(--amber)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] font-display" style={{ color: 'var(--muted-foreground)' }}>
              {t.home.plugins}
            </h2>
            <span className="text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.65 }}>
              {renderers.length}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-start">
            {renderers.map((r) => {
              const entryPath = r.entryPath ?? null;
              const available = !entryPath || existingSet.has(entryPath);

              if (!available) {
                return (
                  <button
                    key={r.id}
                    onClick={() => showHint(r.id)}
                    className="group flex flex-col gap-1.5 px-3.5 py-3 rounded-lg border transition-all opacity-60 cursor-pointer hover:opacity-80 text-left"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base leading-none shrink-0" suppressHydrationWarning>{r.icon}</span>
                      <span className="text-xs font-semibold truncate font-display" style={{ color: 'var(--foreground)' }}>
                        {r.name}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>
                      {r.description}
                    </p>
                    {hintId === r.id ? (
                      <p className="text-2xs animate-in" style={{ color: 'var(--amber)' }} role="status">
                        {(t.home.createToActivate ?? 'Create {file} to activate').replace('{file}', entryPath ?? '')}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-2xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              }

              return (
                <Link
                  key={r.id}
                  href={entryPath ? `/view/${encodePath(entryPath)}` : '#'}
                  className="group flex flex-col gap-1.5 px-3.5 py-3 rounded-lg border transition-all hover:border-amber-500/30 hover:bg-muted/50"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base leading-none shrink-0" suppressHydrationWarning>{r.icon}</span>
                    <span className="text-xs font-semibold truncate font-display" style={{ color: 'var(--foreground)' }}>
                      {r.name}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>
                    {r.description}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {r.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-2xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                        {tag}
                      </span>
                    ))}
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
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] font-display" style={{ color: 'var(--muted-foreground)' }}>
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
                      className={`absolute -left-4 top-1/2 -translate-y-1/2 rounded-full transition-all duration-150 group-hover:scale-150 ${idx === 0 ? 'w-2 h-2' : 'w-1.5 h-1.5'}`}
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
                        ? <Table size={13} className="shrink-0" style={{ color: 'var(--success)' }} />
                        : <FileText size={13} className="shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                      }
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block" style={{ color: 'var(--foreground)' }} suppressHydrationWarning>{name}</span>
                        {dir && <span className="text-xs truncate block" style={{ color: 'var(--muted-foreground)', opacity: 0.6 }} suppressHydrationWarning>{dir}</span>}
                      </div>
                      <span className="text-xs shrink-0 tabular-nums font-display" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }} suppressHydrationWarning>
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
                aria-expanded={showAll}
                style={{ color: 'var(--amber)' }}
                className="flex items-center gap-1.5 mt-2 ml-3 text-xs font-medium transition-colors hover:opacity-80 cursor-pointer font-display"
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
      <div className="mt-16 flex items-center gap-1.5 text-xs font-display" style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}>
        <Sparkles size={10} style={{ color: 'var(--amber)' }} />
        <span>{t.app.footer}</span>
      </div>
    </div>
  );
}
