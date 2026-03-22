'use client';

import Link from 'next/link';
import { FileText, Table, Clock, Sparkles, ArrowRight, FilePlus, Search, ChevronDown, Compass, Folder, Puzzle, Brain } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath, relativeTime } from '@/lib/utils';
import { getAllRenderers } from '@/lib/renderers/registry';
import '@/lib/renderers/index'; // registers all renderers
import OnboardingView from './OnboardingView';
import GuideCard from './GuideCard';
import type { SpaceInfo } from '@/app/page';

interface RecentFile {
  path: string;
  mtime: number;
}

interface SpaceGroup {
  space: string;
  spacePath: string;
  files: RecentFile[];
  latestMtime: number;
  totalFiles: number;
}

function triggerSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
}

function triggerAsk() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
}

/** Group recent files by their top-level directory (Space) */
function groupBySpace(recent: RecentFile[], spaces: SpaceInfo[]): { groups: SpaceGroup[]; rootFiles: RecentFile[] } {
  const groupMap = new Map<string, SpaceGroup>();
  const rootFiles: RecentFile[] = [];

  for (const file of recent) {
    const parts = file.path.split('/');
    if (parts.length < 2) {
      rootFiles.push(file);
      continue;
    }
    const spaceName = parts[0];
    const spaceInfo = spaces.find(s => s.name === spaceName);

    if (!groupMap.has(spaceName)) {
      groupMap.set(spaceName, {
        space: spaceName,
        spacePath: spaceName + '/',
        files: [],
        latestMtime: 0,
        totalFiles: spaceInfo?.fileCount ?? 0,
      });
    }
    const g = groupMap.get(spaceName)!;
    g.files.push(file);
    g.latestMtime = Math.max(g.latestMtime, file.mtime);
  }

  const groups = [...groupMap.values()].sort((a, b) => b.latestMtime - a.latestMtime);
  return { groups, rootFiles };
}

/** Extract leading emoji from a directory name, e.g. "📝 Notes" → "📝" */
function extractEmoji(name: string): string {
  const match = name.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u);
  return match?.[0] ?? '';
}

/** Strip leading emoji+space from name for display, e.g. "📝 Notes" → "Notes" */
function stripEmoji(name: string): string {
  return name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || name;
}

/* ── Section Title component (shared across all three sections) ── */
function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-[var(--amber)]">{icon}</span>
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] font-display text-muted-foreground">
        {children}
      </h2>
    </div>
  );
}

const FILES_PER_GROUP = 3;

export default function HomeContent({ recent, existingFiles, spaces }: { recent: RecentFile[]; existingFiles?: string[]; spaces?: SpaceInfo[] }) {
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

  // Group recent files by Space
  const spaceList = spaces ?? [];
  const { groups, rootFiles } = useMemo(() => groupBySpace(recent, spaceList), [recent, spaceList]);

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-12">
      <GuideCard onNavigate={(path) => { window.location.href = `/view/${encodeURIComponent(path)}`; }} />

      {/* ── Hero ── */}
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
      </div>

      {/* ── Section 1: Plugins ── */}
      {availablePlugins.length > 0 && (
        <section className="mb-8">
          <SectionTitle icon={<Puzzle size={13} />}>{t.home.plugins}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {availablePlugins.map(r => (
              <Link
                key={r.id}
                href={`/view/${encodePath(r.entryPath!)}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs transition-all duration-150 hover:border-amber-500/30 hover:bg-muted/60"
              >
                <span className="text-sm leading-none" suppressHydrationWarning>{r.icon}</span>
                <span className="font-medium text-foreground">{r.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 2: Spaces ── */}
      {spaceList.length > 0 && (
        <section className="mb-8">
          <SectionTitle icon={<Brain size={13} />}>{t.home.spaces}</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {spaceList.map(s => {
              const emoji = extractEmoji(s.name);
              const label = stripEmoji(s.name);
              const isEmpty = s.fileCount === 0;
              return (
                <Link
                  key={s.name}
                  href={`/view/${encodePath(s.path)}`}
                  className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border transition-all duration-150 hover:translate-x-0.5 ${
                    isEmpty
                      ? 'border-dashed border-border/50 opacity-50 hover:opacity-70'
                      : 'border-border hover:border-amber-500/30 hover:bg-muted/40'
                  }`}
                >
                  {emoji ? (
                    <span className="text-lg leading-none shrink-0 mt-0.5" suppressHydrationWarning>{emoji}</span>
                  ) : (
                    <Folder size={16} className="shrink-0 text-[var(--amber)] mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium truncate block text-foreground">{label}</span>
                    {s.description && (
                      <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5" suppressHydrationWarning>{s.description}</span>
                    )}
                    <span className="text-xs text-muted-foreground opacity-50 mt-0.5 block">
                      {t.home.nFiles(s.fileCount)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Section 3: Recently Edited ── */}
      {recent.length > 0 && (
        <section className="mb-12">
          <SectionTitle icon={<Clock size={13} />}>{t.home.recentlyEdited}</SectionTitle>

          {groups.length > 0 ? (
            /* Space-Grouped View */
            <div className="flex flex-col gap-4">
              {groups.map((group) => {
                const visibleFiles = showAll ? group.files : group.files.slice(0, FILES_PER_GROUP);
                const hasMoreFiles = group.files.length > FILES_PER_GROUP;
                return (
                  <div key={group.space}>
                    <Link
                      href={`/view/${encodePath(group.spacePath)}`}
                      className="flex items-center gap-2 px-1 py-1.5 rounded-lg group transition-colors hover:bg-muted/50"
                    >
                      <Folder size={13} className="shrink-0 text-[var(--amber)]" />
                      <span className="text-xs font-semibold font-display text-foreground group-hover:text-[var(--amber)] transition-colors" suppressHydrationWarning>
                        {group.space}
                      </span>
                      <span className="text-xs text-muted-foreground opacity-60 tabular-nums" suppressHydrationWarning>
                        {t.home.nFiles(group.totalFiles)} · {formatTime(group.latestMtime)}
                      </span>
                      {hasMoreFiles && !showAll && (
                        <span className="text-xs text-muted-foreground opacity-40">
                          +{group.files.length - FILES_PER_GROUP}
                        </span>
                      )}
                    </Link>
                    <div className="flex flex-col gap-0.5 ml-2 border-l border-border pl-3">
                      {visibleFiles.map(({ path: filePath, mtime }) => {
                        const isCSV = filePath.endsWith('.csv');
                        const name = filePath.split('/').pop() || filePath;
                        const subPath = filePath.split('/').slice(1, -1).join('/');
                        return (
                          <Link
                            key={filePath}
                            href={`/view/${encodePath(filePath)}`}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 hover:translate-x-0.5 hover:bg-muted group"
                          >
                            {isCSV
                              ? <Table size={12} className="shrink-0 text-success" />
                              : <FileText size={12} className="shrink-0 text-muted-foreground" />
                            }
                            <div className="flex-1 min-w-0">
                              <span className="text-sm truncate block text-foreground" suppressHydrationWarning>{name}</span>
                              {subPath && <span className="text-xs truncate block text-muted-foreground opacity-50" suppressHydrationWarning>{subPath}</span>}
                            </div>
                            <span className="text-xs shrink-0 tabular-nums font-display text-muted-foreground opacity-40" suppressHydrationWarning>
                              {formatTime(mtime)}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Root-level files (Other) */}
              {rootFiles.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-1 py-1.5">
                    <FileText size={13} className="shrink-0 text-muted-foreground" />
                    <span className="text-xs font-semibold font-display text-muted-foreground">
                      {t.home.other}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 ml-2 border-l border-border pl-3">
                    {rootFiles.map(({ path: filePath, mtime }) => (
                      <Link
                        key={filePath}
                        href={`/view/${encodePath(filePath)}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 hover:translate-x-0.5 hover:bg-muted"
                      >
                        <FileText size={12} className="shrink-0 text-muted-foreground" />
                        <span className="text-sm flex-1 min-w-0 truncate text-foreground" suppressHydrationWarning>
                          {filePath.split('/').pop() || filePath}
                        </span>
                        <span className="text-xs shrink-0 tabular-nums font-display text-muted-foreground opacity-40" suppressHydrationWarning>
                          {formatTime(mtime)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Show more / less */}
              {groups.some(g => g.files.length > FILES_PER_GROUP) && (
                <button
                  onClick={() => setShowAll(v => !v)}
                  aria-expanded={showAll}
                  className="flex items-center gap-1.5 mt-1 ml-1 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display"
                >
                  <ChevronDown size={12} className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
                  <span>{showAll ? t.home.showLess : t.home.showMore}</span>
                </button>
              )}
            </div>
          ) : (
            /* Flat Timeline Fallback */
            <div className="relative pl-4">
              <div className="absolute left-0 top-1 bottom-1 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                {(showAll ? recent : recent.slice(0, 5)).map(({ path: filePath, mtime }, idx) => {
                  const isCSV = filePath.endsWith('.csv');
                  const name = filePath.split('/').pop() || filePath;
                  const dir = filePath.split('/').slice(0, -1).join('/');
                  return (
                    <div key={filePath} className="relative group">
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
              {recent.length > 5 && (
                <button
                  onClick={() => setShowAll(v => !v)}
                  aria-expanded={showAll}
                  className="flex items-center gap-1.5 mt-2 ml-3 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display"
                >
                  <ChevronDown size={12} className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
                  <span>{showAll ? t.home.showLess : t.home.showMore}</span>
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Footer */}
      <div className="mt-16 flex items-center gap-1.5 text-xs font-display text-muted-foreground opacity-60">
        <Sparkles size={10} className="text-[var(--amber)]" />
        <span>{t.app.footer}</span>
      </div>
    </div>
  );
}
