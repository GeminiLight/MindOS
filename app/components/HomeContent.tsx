'use client';

import Link from 'next/link';
import { FileText, Table, Clock, Sparkles, ArrowRight, FilePlus, Search, ChevronDown, Folder, Brain, Plus, Trash2, Check, Loader2, X, FolderInput, History, Star } from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath, relativeTime, extractEmoji, stripEmoji } from '@/lib/utils';
import { usePinnedFiles } from '@/lib/hooks/usePinnedFiles';
import OnboardingView from './OnboardingView';
import GuideCard from './GuideCard';
import SystemPulse from './SystemPulse';
import { scanExampleFilesAction, cleanupExamplesAction } from '@/lib/actions';
import type { SpaceInfo } from '@/app/page';
import RecentActivityFeed from '@/components/agents/RecentActivityFeed';

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

/* ── Shared small components ── */

interface SectionTitleProps {
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
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

/** Reusable "Show more / Show less" toggle */
function ToggleButton({ expanded, onToggle, showLabel, hideLabel, className = '' }: {
  expanded: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  className?: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      className={`flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display ${className}`}
    >
      <ChevronDown size={12} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      <span>{expanded ? hideLabel : showLabel}</span>
    </button>
  );
}

/** Reusable file row for recent-file lists */
function FileRow({ filePath, mtime, formatTime, subPath }: {
  filePath: string;
  mtime: number;
  formatTime: (t: number) => string;
  subPath?: string;
}) {
  const isCSV = filePath.endsWith('.csv');
  const name = filePath.split('/').pop() || filePath;
  return (
    <Link
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
}

const FILES_PER_GROUP = 3;
const SPACES_PER_ROW = 6;

export default function HomeContent({ recent, existingFiles, spaces }: { recent: RecentFile[]; existingFiles?: string[]; spaces?: SpaceInfo[] }) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);
  const [showAllSpaces, setShowAllSpaces] = useState(false);
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

  const spaceList = spaces ?? [];
  const { groups, rootFiles } = useMemo(() => groupBySpace(recent, spaceList), [recent, spaceList]);

  if (recent.length === 0) {
    return <OnboardingView />;
  }

  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);

  const lastFile = recent[0];

  return (
    <div className="content-width px-4 md:px-6 py-10 md:py-14">
      <GuideCard />
      <ExampleCleanupBanner />

      {/* ══════════ Hero ══════════ */}
      <div className="mb-10">
        {/* Brand mark */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-1 h-7 rounded-full bg-gradient-to-b from-[var(--amber)] to-[var(--amber)]/20" />
          <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">
            MindOS
          </h1>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground pl-4 max-w-lg mb-6">
          {t.app.tagline}
        </p>

        {/* Command bar — the single most important action */}
        <div className="w-full max-w-xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pl-4">
          <button
            onClick={triggerAsk}
            title="⌘/"
            data-walkthrough="ask-button"
            className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 shadow-sm bg-card transition-all duration-150 hover:border-[var(--amber)]/50 hover:shadow-md group"
          >
            <Sparkles size={15} className="shrink-0 text-[var(--amber)] group-hover:scale-110 transition-transform duration-150" />
            <span className="text-sm flex-1 text-left text-muted-foreground">
              {suggestions[suggestionIdx]}
            </span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-[var(--amber-dim)] text-[var(--amber-text)]">
              ⌘/
            </kbd>
          </button>
          <button
            onClick={triggerSearch}
            title="⌘K"
            className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-border/60 text-sm text-muted-foreground transition-all duration-150 shrink-0 hover:bg-muted hover:shadow-sm"
          >
            <Search size={14} />
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono bg-muted">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Quick actions — only 2: New + Continue */}
        <div className="flex items-center gap-3 mt-4 pl-4">
          <Link
            href="/view/Untitled.md"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:shadow-sm bg-[var(--amber)] text-[var(--amber-foreground)]"
          >
            <FilePlus size={14} />
            <span>{t.home.newNote}</span>
          </Link>
          {lastFile && (
            <Link
              href={`/view/${encodePath(lastFile.path)}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <ArrowRight size={14} className="text-[var(--amber)]/60" />
              <span>{t.home.continueEditing}</span>
              <span className="text-xs opacity-40 truncate max-w-32" suppressHydrationWarning>
                {lastFile.path.split('/').pop()}
              </span>
            </Link>
          )}
        </div>
      </div>

      {/* ══════════ Knowledge Stats ══════════ */}
      <KnowledgeStatsBar spaces={spaceList} totalFiles={recent.length} />

      {/* ══════════ Knowledge Pulse ══════════ */}
      <SystemPulse />

      {/* ══════════ Pinned Files ══════════ */}
      <PinnedFilesSection formatTime={formatTime} />

      {/* ══════════ Spaces ══════════ */}
      {(spaceList.length > 0 || true) && (
        <section className="mb-10">
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
                        <span className="text-xs text-muted-foreground/50 mt-0.5 block tabular-nums">
                          {t.home.nFiles(s.fileCount)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
              {spaceList.length > SPACES_PER_ROW && (
                <ToggleButton
                  expanded={showAllSpaces}
                  onToggle={() => setShowAllSpaces(v => !v)}
                  showLabel={t.home.showMore}
                  hideLabel={t.home.showLess}
                  className="mt-2"
                />
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground py-2">
              {t.home.noSpacesYet ?? 'No spaces yet. Create one to organize your knowledge.'}
            </p>
          )}
        </section>
      )}

      {/* ══════════ Recently Edited ══════════ */}
      {recent.length > 0 && (
        <section className="mb-10">
          <SectionTitle
            icon={<Clock size={13} />}
            count={recent.length}
            action={
              <Link
                href="/changes"
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 font-display"
              >
                <History size={12} />
                <span>{t.home.changeHistory}</span>
              </Link>
            }
          >
            {t.home.recentlyEdited}
          </SectionTitle>

          {groups.length > 0 ? (
            <div className="flex flex-col gap-3">
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
                      <span className="text-xs text-muted-foreground/50 tabular-nums" suppressHydrationWarning>
                        {t.home.nFiles(group.totalFiles)} · {formatTime(group.latestMtime)}
                      </span>
                      {hasMoreFiles && !showAll && (
                        <span className="text-xs text-muted-foreground/30 tabular-nums">
                          +{group.files.length - FILES_PER_GROUP}
                        </span>
                      )}
                    </Link>
                    <div className="flex flex-col gap-0.5 ml-2 border-l border-border/40 pl-3">
                      {visibleFiles.map(({ path: filePath, mtime }) => (
                        <FileRow
                          key={filePath}
                          filePath={filePath}
                          mtime={mtime}
                          formatTime={formatTime}
                          subPath={filePath.split('/').slice(1, -1).join('/')}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {rootFiles.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-1 py-1.5">
                    <FileText size={13} className="shrink-0 text-muted-foreground/50" />
                    <span className="text-xs font-semibold font-display text-muted-foreground/60">
                      {t.home.other}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 ml-2 border-l border-border/40 pl-3">
                    {rootFiles.map(({ path: filePath, mtime }) => (
                      <FileRow key={filePath} filePath={filePath} mtime={mtime} formatTime={formatTime} />
                    ))}
                  </div>
                </div>
              )}

              {groups.some(g => g.files.length > FILES_PER_GROUP) && (
                <ToggleButton
                  expanded={showAll}
                  onToggle={() => setShowAll(v => !v)}
                  showLabel={t.home.showMore}
                  hideLabel={t.home.showLess}
                  className="mt-1 ml-1"
                />
              )}
            </div>
          ) : (
            <div className="relative pl-4">
              <div className="absolute left-0 top-1 bottom-1 w-px bg-border/40" />
              <div className="flex flex-col gap-0.5">
                {(showAll ? recent : recent.slice(0, 5)).map(({ path: filePath, mtime }, idx) => {
                  const isCSV = filePath.endsWith('.csv');
                  const name = filePath.split('/').pop() || filePath;
                  const dir = filePath.split('/').slice(0, -1).join('/');
                  return (
                    <div key={filePath} className="relative group">
                      <div
                        aria-hidden="true"
                        className={`absolute -left-4 top-1/2 -translate-y-1/2 rounded-full transition-all duration-150 group-hover:scale-150 ${
                          idx === 0
                            ? 'w-2 h-2 bg-[var(--amber)] ring-2 ring-[var(--amber)]/20'
                            : 'w-1.5 h-1.5 bg-muted-foreground/20'
                        }`}
                      />
                      <Link
                        href={`/view/${encodePath(filePath)}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 group-hover:translate-x-0.5 hover:bg-muted"
                      >
                        {isCSV
                          ? <Table size={12} className="shrink-0 text-success" />
                          : <FileText size={12} className="shrink-0 text-muted-foreground/50" />
                        }
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate block text-foreground" suppressHydrationWarning>{name}</span>
                          {dir && <span className="text-xs truncate block text-muted-foreground/40" suppressHydrationWarning>{dir}</span>}
                        </div>
                        <span className="text-xs shrink-0 tabular-nums font-display text-muted-foreground/40" suppressHydrationWarning>
                          {formatTime(mtime)}
                        </span>
                      </Link>
                    </div>
                  );
                })}
              </div>
              {recent.length > 5 && (
                <ToggleButton
                  expanded={showAll}
                  onToggle={() => setShowAll(v => !v)}
                  showLabel={t.home.showMore}
                  hideLabel={t.home.showLess}
                  className="mt-2 ml-3"
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* ══════════ Recent Agent Activity ══════════ */}
      <div className="mb-10">
        <RecentActivityFeed />
      </div>

      {/* Footer */}
      <div className="py-6 border-t border-border/20 flex items-center gap-1.5 text-xs font-display text-muted-foreground/30">
        <Sparkles size={10} className="text-[var(--amber)]/40" />
        <span>{t.app.footer}</span>
      </div>
    </div>
  );
}

/* ── Pinned Files Section ── */
function PinnedFilesSection({ formatTime }: { formatTime: (t: number) => string }) {
  const { t } = useLocale();
  const { pinnedFiles, removePin } = usePinnedFiles();

  if (pinnedFiles.length === 0) return null;

  return (
    <section className="mb-12">
      <SectionTitle icon={<Star size={13} />} count={pinnedFiles.length}>
        {t.pinnedFiles.title}
      </SectionTitle>
      <div className="flex flex-col gap-0.5">
        {pinnedFiles.map((filePath) => {
          const name = filePath.split('/').pop() || filePath;
          const dir = filePath.split('/').slice(0, -1).join('/');
          const isCSV = filePath.endsWith('.csv');
          return (
            <div key={filePath} className="group/pin relative">
              <Link
                href={`/view/${encodePath(filePath)}`}
                className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 hover:translate-x-0.5 hover:bg-muted"
              >
                <Star size={12} className="shrink-0 fill-[var(--amber)] text-[var(--amber)]" />
                {isCSV
                  ? <Table size={12} className="shrink-0 text-success" />
                  : <FileText size={12} className="shrink-0 text-muted-foreground" />
                }
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block text-foreground" suppressHydrationWarning>{name}</span>
                  {dir && <span className="text-xs truncate block text-muted-foreground opacity-50" suppressHydrationWarning>{dir}</span>}
                </div>
              </Link>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removePin(filePath); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover/pin:flex p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={t.pinnedFiles.removedToast}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Create Space: title-bar button ── */
function CreateSpaceButton({ t }: { t: ReturnType<typeof useLocale>['t'] }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event('mindos:create-space'))}
      className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display"
    >
      <Plus size={12} />
      <span>{t.home.newSpace}</span>
    </button>
  );
}

/* ── Knowledge Stats Bar ── */
function KnowledgeStatsBar({ spaces, totalFiles }: { spaces: SpaceInfo[]; totalFiles: number }) {
  const { t } = useLocale();
  const totalFileCount = useMemo(() => spaces.reduce((sum, s) => sum + s.fileCount, 0), [spaces]);
  const home = t.home;

  if (totalFileCount === 0 && spaces.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center gap-px rounded-lg overflow-hidden border border-border/40">
        <div className="flex-1 px-3 py-2.5 bg-card">
          <p className="text-2xs text-muted-foreground/50 leading-none mb-1 font-display">{home.statFiles ?? 'Files'}</p>
          <p className="text-base font-semibold text-foreground font-mono tabular-nums leading-none">{totalFileCount}</p>
        </div>
        <div className="flex-1 px-3 py-2.5 bg-card border-l border-border/30">
          <p className="text-2xs text-muted-foreground/50 leading-none mb-1 font-display">{home.statSpaces ?? 'Spaces'}</p>
          <p className="text-base font-semibold text-foreground font-mono tabular-nums leading-none">{spaces.length}</p>
        </div>
        <div className="flex-1 px-3 py-2.5 bg-card border-l border-border/30">
          <p className="text-2xs text-muted-foreground/50 leading-none mb-1 font-display">{home.statRecent ?? 'Recent'}</p>
          <p className="text-base font-semibold text-foreground font-mono tabular-nums leading-none">{totalFiles}</p>
        </div>
      </div>
    </section>
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
    }).catch((err) => { console.warn("[HomeContent] scanExampleFilesAction failed:", err); });
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
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 disabled:opacity-50 bg-[var(--amber-dim)] text-[var(--amber-text)] hover:opacity-80"
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
