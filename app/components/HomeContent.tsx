'use client';

import Link from 'next/link';
import { FileText, Table, Clock, Sparkles, ArrowRight, FilePlus, Search, ChevronDown, Compass, Folder, Puzzle, Brain, Plus, Trash2, Check, Loader2, X, FolderInput } from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath, relativeTime, extractEmoji, stripEmoji } from '@/lib/utils';
import { getAllRenderers, getPluginRenderers } from '@/lib/renderers/registry';
import OnboardingView from './OnboardingView';
import GuideCard from './GuideCard';
import CreateSpaceModal from './CreateSpaceModal';
import { scanExampleFilesAction, cleanupExamplesAction } from '@/lib/actions';
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

/* ── Section Title component (shared across all three sections) ── */
interface SectionTitleProps {
  icon: React.ReactNode;
  children: React.ReactNode;
  /** Item count badge — only rendered when > 0 */
  count?: number;
  /** Right-aligned action slot (e.g. "View all" button) */
  action?: React.ReactNode;
}

function SectionTitle({ icon, children, count, action }: SectionTitleProps) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-[var(--amber)]">{icon}</span>
      <h2 className="text-sm font-semibold font-display text-foreground">
        {children}
      </h2>
      {count != null && count > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground font-display">{count}</span>
      )}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

const FILES_PER_GROUP = 3;
const SPACES_PER_ROW = 6;   // 3 cols × 2 rows on desktop, show 1 row initially
const PLUGINS_INITIAL = 4;

export default function HomeContent({ recent, existingFiles, spaces, dirPaths }: { recent: RecentFile[]; existingFiles?: string[]; spaces?: SpaceInfo[]; dirPaths?: string[] }) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);
  const [showAllSpaces, setShowAllSpaces] = useState(false);
  const [showAllPlugins, setShowAllPlugins] = useState(false);
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
  const spaceList = spaces ?? [];
  const { groups, rootFiles } = useMemo(() => groupBySpace(recent, spaceList), [recent, spaceList]);

  if (recent.length === 0) {
    return <OnboardingView />;
  }

  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);

  const availablePlugins = getPluginRenderers().filter(r => r.entryPath && existingSet.has(r.entryPath));
  const builtinFeatures = getAllRenderers().filter((r) => r.appBuiltinFeature && r.id !== 'csv');

  const lastFile = recent[0];

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-12">
      <GuideCard />
      <ExampleCleanupBanner />

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
            className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card transition-all duration-150 hover:border-[var(--amber)]/50 hover:bg-[var(--amber)]/8"
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
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('mindos:open-import'))}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:translate-x-0.5 bg-[var(--amber-dim)] text-[var(--amber)]"
          >
            <FolderInput size={14} />
            <span>{t.fileTree.importFile}</span>
          </button>
          <Link
            href="/view/Untitled.md"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors bg-muted text-muted-foreground"
          >
            <FilePlus size={14} />
            <span>{t.home.newNote}</span>
          </Link>
          {lastFile && (
            <Link
              href={`/view/${encodePath(lastFile.path)}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:text-foreground"
            >
              <ArrowRight size={14} />
              <span>{t.home.continueEditing}</span>
              <span className="text-xs opacity-50 truncate max-w-[140px]" suppressHydrationWarning>
                {lastFile.path.split('/').pop()}
              </span>
            </Link>
          )}
          <Link
            href="/explore"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:translate-x-0.5 text-[var(--amber)]"
          >
            <Compass size={14} />
            <span>{t.explore.title}</span>
          </Link>
        </div>
      </div>

      {/* ── Section 1: Spaces ── */}
      <section className="mb-8">
        <SectionTitle
          icon={<Brain size={13} />}
          count={spaceList.length > 0 ? spaceList.length : undefined}
          action={<CreateSpaceButton t={t} />}
        >
          {t.home.spaces}
        </SectionTitle>
        {spaceList.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(showAllSpaces ? spaceList : spaceList.slice(0, SPACES_PER_ROW)).map(s => {
                const emoji = extractEmoji(s.name);
                const label = stripEmoji(s.name);
                const isEmpty = s.fileCount === 0;
                return (
                  <Link
                    key={s.name}
                    href={`/view/${encodePath(s.path)}`}
                    className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border transition-all duration-150 ${
                      isEmpty
                        ? 'border-dashed border-border/50 opacity-50 hover:opacity-70'
                        : 'border-border hover:border-[var(--amber)]/30 hover:shadow-sm'
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
            {spaceList.length > SPACES_PER_ROW && (
              <button
                onClick={() => setShowAllSpaces(v => !v)}
                className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display"
              >
                <ChevronDown size={12} className={`transition-transform duration-200 ${showAllSpaces ? 'rotate-180' : ''}`} />
                <span>{showAllSpaces ? t.home.showLess : t.home.showMore}</span>
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground py-2">
            {t.home.noSpacesYet ?? 'No spaces yet. Create one to organize your knowledge.'}
          </p>
        )}
        <CreateSpaceModal t={t} dirPaths={dirPaths ?? []} />
      </section>

      {/* ── Section 2: Built-in capabilities ── */}
      {builtinFeatures.length > 0 && (
        <section className="mb-8">
          <SectionTitle icon={<Puzzle size={13} />} count={builtinFeatures.length}>
            {t.home.builtinFeatures}
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {builtinFeatures.map((r) => {
              const active = !!r.entryPath && existingSet.has(r.entryPath);
              if (active && r.entryPath) {
                return (
                  <Link key={r.id} href={`/view/${encodePath(r.entryPath)}`}>
                    <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs transition-all duration-150 hover:border-[var(--amber)]/30 hover:bg-muted/60">
                      <span className="text-sm leading-none" suppressHydrationWarning>{r.icon}</span>
                      <span className="font-medium text-foreground">{r.name}</span>
                    </span>
                  </Link>
                );
              }
              return (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground opacity-70"
                  title={r.entryPath ? t.home.createToActivate.replace('{file}', r.entryPath) : t.home.builtinInactive}
                >
                  <span className="text-sm leading-none" suppressHydrationWarning>{r.icon}</span>
                  <span className="font-medium">{r.name}</span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Section 3: Extensions ── */}
      {availablePlugins.length > 0 && (
        <section className="mb-8">
          <SectionTitle
            icon={<Puzzle size={13} />}
            count={availablePlugins.length}
            action={
              availablePlugins.length > PLUGINS_INITIAL ? (
                <button
                  onClick={() => setShowAllPlugins(v => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display"
                >
                  <span>{showAllPlugins ? t.home.showLess : t.home.viewAll}</span>
                  <ChevronDown size={12} className={`transition-transform duration-200 ${showAllPlugins ? 'rotate-180' : ''}`} />
                </button>
              ) : undefined
            }
          >
            {t.home.plugins}
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {(showAllPlugins ? availablePlugins : availablePlugins.slice(0, PLUGINS_INITIAL)).map(r => (
              <Link
                key={r.id}
                href={`/view/${encodePath(r.entryPath!)}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs transition-all duration-150 hover:border-[var(--amber)]/30 hover:bg-muted/60"
              >
                <span className="text-sm leading-none" suppressHydrationWarning>{r.icon}</span>
                <span className="font-medium text-foreground">{r.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 4: Recently Edited ── */}
      {recent.length > 0 && (
        <section className="mb-12">
          <SectionTitle icon={<Clock size={13} />} count={recent.length}>{t.home.recentlyEdited}</SectionTitle>

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

/* ── Create Space: title-bar button ── */
function CreateSpaceButton({ t }: { t: ReturnType<typeof useLocale>['t'] }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event('mindos:create-space'))}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--amber)] text-white transition-colors hover:opacity-90 cursor-pointer"
    >
      <Plus size={12} />
      <span>{t.home.newSpace}</span>
    </button>
  );
}

/* ── Example files cleanup banner ── */
function ExampleCleanupBanner() {
  const { t } = useLocale();
  const [count, setCount] = useState<number | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    scanExampleFilesAction().then(r => {
      if (r.files.length > 0) setCount(r.files.length);
    }).catch(() => {});
  }, []);

  const handleCleanup = useCallback(async () => {
    if (count === null) return;
    setCleaning(true);
    try {
      const r = await cleanupExamplesAction();
      if (r.success) {
        setDone(true);
        setTimeout(() => setDismissed(true), 2500);
      }
    } catch { /* silent — banner stays, user can retry */ }
    setCleaning(false);
  }, [count]);

  if (dismissed || count === null || count === 0) return null;

  if (done) {
    return (
      <div className="mb-6 flex items-center gap-2.5 px-4 py-3 rounded-xl border border-success/30 bg-success/5 animate-in fade-in duration-300">
        <Check size={14} className="text-success shrink-0" />
        <span className="text-xs text-success">{t.home.cleanupExamplesDone}</span>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-muted/30 animate-in fade-in duration-300">
      <span className="text-sm leading-none shrink-0">🧪</span>
      <span className="text-xs text-muted-foreground flex-1">
        {t.home.cleanupExamples(count)}
      </span>
      <button
        onClick={handleCleanup}
        disabled={cleaning}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 disabled:opacity-50 bg-[var(--amber-dim)] text-[var(--amber)] hover:opacity-80"
      >
        {cleaning ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
        {t.home.cleanupExamplesButton}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}

