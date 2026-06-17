'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Bot, Brain, ChevronDown, FolderOpen, Plus, Sparkles, Search, FilePlus, ArrowRight, Clock, FileText, Table, Star, X, History } from 'lucide-react';
import { usePinnedFiles } from '@/lib/hooks/usePinnedFiles';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath, relativeTime, extractEmoji, stripEmoji } from '@/lib/utils';
import { InboxSection } from '@/components/home/InboxSection';
import type { BuiltInMindSystemSpaceRecord, SpaceInfo } from '@/lib/space-records';
import { Select } from '@/components/settings/Primitives';

interface RecentFile {
  path: string;
  mtime: number;
}

interface WikiHomeContentProps {
  spaces: SpaceInfo[];
  recent: RecentFile[];
  mindSystemSpaces: BuiltInMindSystemSpaceRecord[];
}

function triggerSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
}

function triggerAsk() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
}

/**
 * Calculate the max mtime for a space from recent files
 */
function getSpaceLatestMtime(spaceName: string, recentFiles: RecentFile[]): number {
  let maxMtime = 0;
  for (const file of recentFiles) {
    if (file.path.startsWith(`${spaceName}/`)) {
      maxMtime = Math.max(maxMtime, file.mtime);
    }
  }
  return maxMtime;
}

const SPACES_COLLAPSED = 6;

export default function WikiHomeContent({ spaces, recent, mindSystemSpaces }: WikiHomeContentProps) {
  const { t } = useLocale();
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'fileCount'>('recent');
  const [showAllSpaces, setShowAllSpaces] = useState(false);
  const [suggestionIdx, setSuggestionIdx] = useState(0);

  const suggestions = t.ask?.suggestions ?? [
    'Summarize this document',
    'List all action items',
    'What are the key points?',
    'Find related notes',
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setSuggestionIdx(i => (i + 1) % suggestions.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [suggestions.length]);

  const sortedSpaces = useMemo(() => {
    const sorted = [...spaces];
    if (sortBy === 'recent') {
      sorted.sort((a, b) => {
        const aMtime = getSpaceLatestMtime(a.name, recent);
        const bMtime = getSpaceLatestMtime(b.name, recent);
        return bMtime - aMtime;
      });
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'fileCount') {
      sorted.sort((a, b) => b.fileCount - a.fileCount);
    }
    return sorted;
  }, [spaces, recent, sortBy]);

  const visibleSpaces = showAllSpaces ? sortedSpaces : sortedSpaces.slice(0, SPACES_COLLAPSED);
  const formatTime = (mtime: number) => relativeTime(mtime, t.home.relativeTime);
  const lastFile = recent[0];

  return (
    <div className="content-width px-4 md:px-6 py-10 md:py-14">

      {/* ══════════ Hero ══════════ */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1 h-7 rounded-full bg-gradient-to-b from-[var(--amber)] to-[var(--amber)]/20" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t.sidebar.files}
          </h1>
        </div>
        <p className="pl-4 -mt-3 mb-5 text-sm text-muted-foreground">
          {t.home.mindTagline}
        </p>

        {/* Command bar */}
        <div className="w-full max-w-xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pl-4">
          <button
            onClick={triggerAsk}
            title="⌘/"
            className="hit-target-box flex-1 flex items-center gap-3 px-4 py-3.5 border border-transparent transition-all duration-200 hover:-translate-y-0.5 group [--hit-target-bg:color-mix(in_srgb,var(--card)_80%,transparent)] [--hit-target-hover-bg:color-mix(in_srgb,var(--card)_90%,transparent)] [--hit-target-border-width:1px] [--hit-target-border:color-mix(in_srgb,var(--border)_50%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--amber)_40%,transparent)] [--hit-target-radius:var(--radius-xl)] [--hit-target-shadow:0_1px_2px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)] [--hit-target-hover-shadow:0_4px_6px_-1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]"
          >
            <Sparkles size={16} className="shrink-0 text-[var(--amber)] group-hover:scale-110 transition-transform duration-150" />
            <div className="flex-1 min-h-[1.5rem] flex items-center">
              <span
                key={suggestionIdx}
                className="text-sm text-left text-muted-foreground animate-in fade-in duration-300"
              >
                {suggestions[suggestionIdx].label}
              </span>
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-[var(--amber-dim)] text-[var(--amber-text)]">
              ⌘/
            </kbd>
          </button>
          <button
            onClick={triggerSearch}
            aria-label={t.sidebar.searchTitle}
            className="hit-target-box flex items-center gap-2 px-3.5 py-3 border border-transparent text-sm text-muted-foreground transition-all duration-200 shrink-0 hover:-translate-y-0.5 [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-border-width:1px] [--hit-target-border:color-mix(in_srgb,var(--border)_50%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_65%,transparent)] [--hit-target-radius:var(--radius-xl)] [--hit-target-hover-shadow:0_1px_2px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
          >
            <Search size={14} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-3 mt-4 pl-4">
          <Link
            href="/view/Untitled.md"
            className="hit-target-box inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 text-[var(--amber-foreground)] [--hit-target-bg:var(--amber)] [--hit-target-hover-bg:var(--amber)] [--hit-target-radius:var(--radius-lg)] [--hit-target-hover-shadow:0_4px_6px_-1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]"
          >
            <FilePlus size={14} />
            <span>{t.home.newNote}</span>
          </Link>
          {lastFile && (
            <Link
              href={`/view/${encodePath(lastFile.path)}`}
              className="hit-target-box inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium transition-colors text-muted-foreground hover:text-foreground [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-lg)]"
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

      {/* ══════════ Built-in Mind Spaces ══════════ */}
      <BuiltInMindSpacesSection spaces={mindSystemSpaces} />

      {/* ══════════ Spaces Grid ══════════ */}
      <section className="mb-10">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
            <Brain size={14} />
          </div>
          <h2 className="text-[13px] font-semibold text-foreground tracking-wide">
            {t.home.spaces}
          </h2>
          {spaces.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-semibold rounded-full bg-muted text-muted-foreground tabular-nums">
              {spaces.length}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3">
            {spaces.length > 0 && (
              <Select
                size="sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="recent">{t.home.sortRecent ?? 'Recent'}</option>
                <option value="name">{t.home.sortName ?? 'A-Z'}</option>
                <option value="fileCount">{t.home.sortCount ?? 'File Count'}</option>
              </Select>
            )}
            <button
              onClick={() => window.dispatchEvent(new Event('mindos:create-space'))}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display"
            >
              <Plus size={12} />
              <span>{t.home.newSpace}</span>
            </button>
          </div>
        </div>

        {spaces.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-card/30 px-6 py-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--amber-subtle)] mb-4">
              <Brain size={22} className="text-[var(--amber)]/60" />
            </div>
            <p className="text-sm font-medium text-muted-foreground/70 mb-1">
              {t.home.noSpacesYet ?? 'No spaces yet'}
            </p>
            <p className="text-xs text-muted-foreground/60 mb-4">
              Create your first space to organize your knowledge
            </p>
            <button
              onClick={() => window.dispatchEvent(new Event('mindos:create-space'))}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-80"
            >
              <Plus size={14} />
              Create Space
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleSpaces.map((space) => {
                const emoji = extractEmoji(space.name);
                const label = stripEmoji(space.name);
                const latestMtime = getSpaceLatestMtime(space.name, recent);
                const isEmpty = space.fileCount === 0;

                return (
                  <Link
                    key={space.name}
                    href={`/view/${encodePath(space.path)}`}
                    className={`flex items-start gap-3 px-4 py-3.5 border transition-all duration-200 ${
                      isEmpty
                        ? 'rounded-xl border-dashed border-border/50 opacity-50 hover:opacity-70'
                        : 'hit-target-box border-transparent hover:-translate-y-0.5 [--hit-target-bg:color-mix(in_srgb,var(--card)_40%,transparent)] [--hit-target-hover-bg:color-mix(in_srgb,var(--card)_58%,transparent)] [--hit-target-border-width:1px] [--hit-target-border:color-mix(in_srgb,var(--border)_60%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--amber)_30%,transparent)] [--hit-target-radius:var(--radius-xl)] [--hit-target-hover-shadow:0_4px_6px_-1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]'
                    }`}
                  >
                    {emoji ? (
                      <span className="text-lg leading-none shrink-0 mt-0.5" suppressHydrationWarning>{emoji}</span>
                    ) : (
                      <FolderOpen size={16} className="shrink-0 text-[var(--amber)] mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium truncate block text-foreground">{label}</span>
                      {space.description && (
                        <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5" suppressHydrationWarning>
                          {space.description}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground/50 mt-0.5 block tabular-nums">
                        {t.home.nFiles(space.fileCount)}
                        {latestMtime > 0 && ` · ${formatTime(latestMtime)}`}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {sortedSpaces.length > SPACES_COLLAPSED && (
              <button
                onClick={() => setShowAllSpaces(!showAllSpaces)}
                aria-expanded={showAllSpaces}
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display mt-3"
              >
                <ChevronDown size={12} className={`transition-transform duration-200 ${showAllSpaces ? 'rotate-180' : ''}`} />
                <span>{showAllSpaces ? t.home.showLess : t.home.showMore}</span>
              </button>
            )}
          </>
        )}
      </section>

      {/* ══════════ Inbox ══════════ */}
      <InboxSection />

      {/* ══════════ Pinned Files ══════════ */}
      <PinnedFilesSection formatTime={formatTime} />

      {/* ── Visual divider ── */}
      <div className="border-t border-border/30 mb-8" />

      {/* ══════════ Recently Edited (flat list) ══════════ */}
      {recent.length > 0 && (
        <RecentlyEditedSection recent={recent} formatTime={formatTime} />
      )}

      {/* Footer */}
      <div className="py-6 border-t border-border/20 flex items-center gap-1.5 text-xs font-display text-muted-foreground/30">
        <Sparkles size={10} className="text-[var(--amber)]/40" />
        <span>{t.app.footer}</span>
      </div>
    </div>
  );
}

function BuiltInMindSpacesSection({
  spaces,
}: {
  spaces: BuiltInMindSystemSpaceRecord[];
}) {
  const { t } = useLocale();
  const pillars = spaces.map(space => ({
    ...space,
    data: t.home.mindPillars[space.slot.key],
  }));

  if (pillars.length === 0) return null;

  return (
    <section className="mb-10">
      <SectionTitle
        icon={<Star size={14} />}
        count={pillars.length}
      >
        {t.home.builtInSpacesTitle}
      </SectionTitle>
      <div className="mb-3 max-w-2xl text-sm leading-normal text-muted-foreground" data-mind-system-home-desc>
        {t.home.builtInSpacesDesc}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {pillars.map((pillar) => {
          const desc = pillar.data?.desc ?? pillar.slot.role;
          const assistantCount = pillar.assistantSummary?.assistants.length ?? 0;
          return (
            <article
              key={pillar.slot.key}
              aria-label={`${pillar.slot.label} - ${desc}`}
              data-mind-system-card={pillar.slot.key}
              className="group relative overflow-hidden rounded-lg border border-border/70 bg-card/60 p-3.5 transition-[background-color,border-color,box-shadow] duration-150 hover:border-[var(--amber)]/35 hover:bg-card hover:shadow-sm"
            >
              <Link
                href={`/view/${encodePath(pillar.slot.path)}`}
                className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="mb-3 flex items-start gap-3">
                  <span
                    data-mind-system-icon={pillar.slot.key}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-base font-semibold text-[var(--amber)] transition-colors group-hover:border-[var(--amber)]/50 group-hover:bg-[var(--amber-dim)]"
                    aria-hidden="true"
                  >
                    {pillar.slot.label}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    <span className="block text-sm font-semibold leading-5 text-foreground">{pillar.data?.title ?? pillar.slot.label}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/45">{pillar.slot.systemId}</span>
                  </span>
                </span>
                <span
                  className="block truncate text-xs leading-5 text-muted-foreground"
                  title={desc}
                  data-mind-system-card-desc={pillar.slot.key}
                >
                  {desc}
                </span>
              </Link>
              <span className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2.5" data-mind-system-card-assistant-summary={pillar.slot.key}>
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-[var(--amber)]/10 px-2 py-1 text-[10px] font-medium text-[var(--amber)]/80">
                  <Bot size={11} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{t.home.mindAssistant.spaceTitle}</span>
                </span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1.5 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {assistantCount}
                </span>
              </span>
              <span className="mt-3 flex items-center justify-between border-t border-border/40 pt-2">
                <Link
                  href={`/view/${encodePath(pillar.slot.path)}`}
                  className="inline-flex min-w-0 items-center gap-1 rounded-sm font-mono text-[10px] text-muted-foreground/45 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate">{pillar.slot.path}</span>
                  <span className="sr-only">{t.home.mindAssistant.openSpace}</span>
                </Link>
                <ArrowRight size={12} className="shrink-0 text-[var(--amber)]/45 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--amber)]" aria-hidden="true" />
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ── Section Title ── */
function SectionTitle({ icon, children, count, action }: {
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
        {icon}
      </div>
      <h2 className="text-[13px] font-semibold text-foreground tracking-wide">
        {children}
      </h2>
      {count != null && count > 0 && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-semibold rounded-full bg-muted text-muted-foreground tabular-nums">{count}</span>
      )}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

/* ── Pinned Files Section ── */
function PinnedFilesSection({ formatTime }: { formatTime: (t: number) => string }) {
  const { t } = useLocale();
  const { pinnedFiles, removePin } = usePinnedFiles();

  if (pinnedFiles.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionTitle icon={<Star size={14} />} count={pinnedFiles.length}>
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
                className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 hover:translate-x-0.5 hover:bg-muted overflow-hidden"
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

/* ── Recently Edited Section ── */
const RECENT_FILES_LIMIT = 8;

function RecentlyEditedSection({ recent, formatTime }: { recent: RecentFile[]; formatTime: (t: number) => string }) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);

  return (
    <section className="mb-8">
      <SectionTitle
        icon={<Clock size={14} />}
        count={recent.length}
        action={
          <Link
            href="/changelog"
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80"
          >
            <History size={12} />
            <span>{t.home.changeHistory}</span>
          </Link>
        }
      >
        {t.home.recentlyEdited}
      </SectionTitle>

      <div className="flex flex-col gap-0.5">
        {(showAll ? recent : recent.slice(0, RECENT_FILES_LIMIT)).map(({ path: filePath, mtime }) => {
          const name = filePath.split('/').pop() || filePath;
          const dir = filePath.split('/').slice(0, -1).join('/');
          const isCSV = filePath.endsWith('.csv');
          return (
            <Link
              key={filePath}
              href={`/view/${encodePath(filePath)}`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 hover:translate-x-0.5 hover:bg-muted group overflow-hidden"
            >
              {isCSV
                ? <Table size={12} className="shrink-0 text-success" />
                : <FileText size={12} className="shrink-0 text-muted-foreground" />
              }
              <div className="flex-1 min-w-0">
                <span className="text-sm truncate block text-foreground" suppressHydrationWarning>{name}</span>
                {dir && <span className="text-xs truncate block text-muted-foreground opacity-50" suppressHydrationWarning>{dir}</span>}
              </div>
              <span className="text-xs shrink-0 tabular-nums text-muted-foreground/40" suppressHydrationWarning>
                {formatTime(mtime)}
              </span>
            </Link>
          );
        })}
      </div>
      {recent.length > RECENT_FILES_LIMIT && (
        <button
          onClick={() => setShowAll(v => !v)}
          aria-expanded={showAll}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer mt-2 ml-1"
        >
          <ChevronDown size={12} className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
          <span>{showAll ? t.home.showLess : t.home.showMore}</span>
        </button>
      )}
    </section>
  );
}
