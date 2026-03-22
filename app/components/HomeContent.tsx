'use client';

import Link from 'next/link';
import { FileText, Table, Clock, Sparkles, ArrowRight, FilePlus, Search, ChevronDown, Compass } from 'lucide-react';
import { useState, useEffect } from 'react';
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

  const existingSet = new Set(existingFiles ?? []);

  // Empty knowledge base → show onboarding
  if (recent.length === 0) {
    return <OnboardingView />;
  }

  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);

  // Only show renderers that are available (have entryPath + file exists) as quick-access chips
  const availablePlugins = getAllRenderers().filter(r => r.entryPath && existingSet.has(r.entryPath));

  const lastFile = recent[0];

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-12">
      <GuideCard onNavigate={(path) => { window.location.href = `/view/${encodeURIComponent(path)}`; }} />
      {/* Hero */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 rounded-full bg-[var(--amber)]" />
          <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">
            MindOS
          </h1>
        </div>
        <p className="text-sm leading-relaxed mb-5 text-muted-foreground pl-4">
          {t.app.tagline}
        </p>

        {/* AI-first command bar */}
        <div className="w-full max-w-[620px] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ml-4">
          {/* Ask AI (primary) */}
          <button
            onClick={triggerAsk}
            title="⌘/"
            data-walkthrough="ask-button"
            className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card transition-all duration-150 hover:border-amber-500/50 hover:bg-amber-500/8"
          >
            <Sparkles size={15} className="shrink-0 text-[var(--amber)]" />
            <span className="text-sm flex-1 text-left text-foreground">
              {suggestions[suggestionIdx]}
            </span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-[var(--amber-dim)] text-[var(--amber)]">
              ⌘/
            </kbd>
          </button>

          {/* Search files (secondary) */}
          <button
            onClick={triggerSearch}
            title="⌘K"
            className="flex items-center gap-2 px-3 py-3 rounded-xl border border-border text-sm text-muted-foreground transition-colors shrink-0 hover:bg-muted"
          >
            <Search size={14} />
            <span className="hidden sm:inline">{t.home.shortcuts.searchFiles}</span>
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono bg-muted">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2.5 mt-4 pl-4">
          {lastFile && (
            <Link
              href={`/view/${encodePath(lastFile.path)}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:translate-x-0.5 bg-[var(--amber-dim)] text-[var(--amber)]"
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
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors bg-muted text-muted-foreground"
          >
            <FilePlus size={14} />
            <span>{t.home.newNote}</span>
          </Link>
          <Link
            href="/explore"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:translate-x-0.5 text-[var(--amber)]"
          >
            <Compass size={14} />
            <span>{t.explore.title}</span>
          </Link>
        </div>

        {/* Plugin quick-access chips — only show available plugins */}
        {availablePlugins.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pl-4">
            {availablePlugins.map(r => (
              <Link
                key={r.id}
                href={`/view/${encodePath(r.entryPath!)}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground transition-all duration-100 hover:bg-muted/60"
              >
                <span className="text-sm leading-none" suppressHydrationWarning>{r.icon}</span>
                <span>{r.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recently modified — timeline feed */}
      {recent.length > 0 && (() => {
        const INITIAL_COUNT = 5;
        const visibleRecent = showAll ? recent : recent.slice(0, INITIAL_COUNT);
        const hasMore = recent.length > INITIAL_COUNT;

        return (
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-5">
            <Clock size={13} className="text-[var(--amber)]" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] font-display text-muted-foreground">
              {t.home.recentlyModified}
            </h2>
          </div>

          <div className="relative pl-4">
            {/* Timeline line */}
            <div className="absolute left-0 top-1 bottom-1 w-px bg-border" />

            <div className="flex flex-col gap-0.5">
              {visibleRecent.map(({ path: filePath, mtime }, idx) => {
                const isCSV = filePath.endsWith('.csv');
                const name = filePath.split('/').pop() || filePath;
                const dir = filePath.split('/').slice(0, -1).join('/');
                return (
                  <div key={filePath} className="relative group">
                    {/* Timeline dot */}
                    <div
                      aria-hidden="true"
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
                        ? <Table size={13} className="shrink-0 text-success" />
                        : <FileText size={13} className="shrink-0 text-muted-foreground" />
                      }
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block text-foreground" suppressHydrationWarning>{name}</span>
                        {dir && <span className="text-xs truncate block text-muted-foreground opacity-60" suppressHydrationWarning>{dir}</span>}
                      </div>
                      <span className="text-xs shrink-0 tabular-nums font-display text-muted-foreground opacity-50" suppressHydrationWarning>
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
                className="flex items-center gap-1.5 mt-2 ml-3 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display"
              >
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`}
                />
                <span>{showAll ? t.home.showLess : t.home.showMore}</span>
              </button>
            )}
          </div>
        </section>
        );
      })()}

      {/* Footer */}
      <div className="mt-16 flex items-center gap-1.5 text-xs font-display text-muted-foreground opacity-60">
        <Sparkles size={10} className="text-[var(--amber)]" />
        <span>{t.app.footer}</span>
      </div>
    </div>
  );
}
