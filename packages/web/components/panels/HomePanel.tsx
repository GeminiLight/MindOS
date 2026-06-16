'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, Brain, Loader2, MessageSquare } from 'lucide-react';
import { usePathname } from 'next/navigation';
import FileTree from '@/components/FileTree';
import type { FileNode, ChatSession } from '@/lib/types';
import type { MindSystemSlot } from '@/lib/mind-system';
import { getRuntimeSessionSummary, getSessionAgentRuntime } from '@/lib/ask-agent';
import { loadSession, refreshSessions, useActiveSessionId, useSessions } from '@/lib/ask-session-store';
import { useRunSummary } from '@/lib/ask-run-store';
import { sessionTitle } from '@/hooks/useAskSession';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import PanelHeader from './PanelHeader';
import MindSystemSidebarSection from './MindSystemSidebarSection';

type HomeSidebarMode = 'sessions' | 'files';

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function runtimeLabel(session: ChatSession, mindosLabel: string): string {
  const runtime = getSessionAgentRuntime(session);
  if (!runtime || runtime.kind === 'mindos') return mindosLabel;
  if (runtime.kind === 'codex') return 'Codex';
  if (runtime.kind === 'claude') return 'Claude';
  return runtime.name || 'ACP';
}

function runtimeInitial(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return 'M';
  if (trimmed.toLowerCase().startsWith('claude')) return 'Cl';
  return trimmed.slice(0, 1).toUpperCase();
}

function sessionDisplayTitle(session: ChatSession, fallback: string): string {
  const title = sessionTitle(session);
  return title === '(empty session)' ? fallback : title;
}

function HomeModeSwitch({
  mode,
  onModeChange,
}: {
  mode: HomeSidebarMode;
  onModeChange: (mode: HomeSidebarMode) => void;
}) {
  const { t } = useLocale();
  const options: Array<{ id: HomeSidebarMode; label: string; icon: ReactNode }> = [
    { id: 'sessions', label: t.sidebar.homeAgentSessions, icon: <MessageSquare size={13} aria-hidden="true" /> },
    { id: 'files', label: t.sidebar.homeMindFiles, icon: <Brain size={13} aria-hidden="true" /> },
  ];

  return (
    <div className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border/70 bg-background/70 p-0.5" role="group" aria-label={t.sidebar.home}>
      {options.map((option) => {
        const active = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-home-sidebar-mode={option.id}
            data-hit-active={active ? 'true' : undefined}
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            onClick={() => onModeChange(option.id)}
            className={`hit-target-box inline-flex h-7 w-7 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] ${
              active
                ? 'bg-[var(--amber-subtle)] text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}

function SessionStatusBadge({
  running,
  unread,
  active,
  status,
}: {
  running: boolean;
  unread: boolean;
  active: boolean;
  status?: string;
}) {
  const { t } = useLocale();
  const label = running
    ? t.sidebar.homeRuntimeRunning
    : unread
      ? t.sidebar.homeRuntimeUnread
      : active
        ? t.sidebar.homeRuntimeActive
        : status || t.sidebar.homeRuntimeIdle;

  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium leading-none ${
        running
          ? 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber)]'
          : active || unread
            ? 'border-[var(--amber)]/20 bg-[var(--amber-subtle)] text-[var(--amber)]'
            : 'border-border/60 bg-muted/40 text-muted-foreground'
      }`}
    >
      {running ? <Loader2 size={10} className="motion-safe:animate-spin" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

function HomeSessionRow({
  session,
  active,
  running,
  unread,
  onOpen,
}: {
  session: ChatSession;
  active: boolean;
  running: boolean;
  unread: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocale();
  const runtime = runtimeLabel(session, t.sidebar.homeRuntimeMindOS);
  const runtimeSummary = getRuntimeSessionSummary(session);
  const title = sessionDisplayTitle(session, t.ask.historyEmptyHint);
  const msgCount = session.messages.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-home-session-row={session.id}
      data-hit-active={active ? 'true' : undefined}
      className={`hit-target-box group relative flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-border-width:1px] [--hit-target-border:transparent] [--hit-target-hover-bg:var(--muted)] ${
        active
          ? '[--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_24%,transparent)]'
          : ''
      }`}
    >
      {active ? (
        <span className="pointer-events-none absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-[var(--amber)]" aria-hidden="true" />
      ) : null}
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[10px] font-semibold ${
        active
          ? 'border-[var(--amber)]/30 bg-[var(--amber)]/10 text-[var(--amber)]'
          : 'border-border/70 bg-background text-muted-foreground group-hover:text-foreground'
      }`}>
        {runtimeInitial(runtime)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={title}>
            {title}
          </span>
          <SessionStatusBadge
            running={running}
            unread={unread}
            active={active}
            status={runtimeSummary?.status}
          />
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
          <Bot size={10} className="shrink-0 text-[var(--amber)]/70" aria-hidden="true" />
          <span className="truncate">{runtime}</span>
          {runtimeSummary?.binding.externalSessionId ? (
            <>
              <span className="shrink-0 text-muted-foreground/40">/</span>
              <span className="truncate">{runtimeSummary.idLabel}</span>
            </>
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-2xs text-muted-foreground/60">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MessageSquare size={10} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{t.ask.historyMsgs(msgCount)}</span>
          </span>
          <span className="shrink-0 tabular-nums">{formatRelativeTime(session.updatedAt)}</span>
        </span>
      </span>
    </button>
  );
}

export default function HomePanel({
  active,
  fileTree,
  mindSystemSlots,
  onNavigate,
}: {
  active: boolean;
  fileTree: FileNode[];
  mindSystemSlots: MindSystemSlot[];
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const smoothPush = useSmoothRouterPush();
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();
  const runSummary = useRunSummary();
  const [mode, setMode] = useState<HomeSidebarMode>('sessions');

  useEffect(() => {
    if (active) setMode('sessions');
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void refreshSessions();
  }, [active]);

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  }), [sessions]);

  const openSession = useCallback((id: string) => {
    loadSession(id);
    if (pathname !== '/') smoothPush('/');
  }, [pathname, smoothPush]);

  return (
    <div className="flex h-full flex-col" data-home-sidebar-panel>
      <PanelHeader title={t.sidebar.home}>
        <HomeModeSwitch mode={mode} onModeChange={setMode} />
      </PanelHeader>

      {mode === 'sessions' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-home-session-list>
          {sortedSessions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-5 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                <MessageSquare size={17} aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-foreground">{t.sidebar.homeEmptySessions}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.sidebar.homeEmptySessionsHint}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedSessions.map((session) => (
                <HomeSessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                  running={runSummary.running.has(session.id)}
                  unread={runSummary.unread.has(session.id)}
                  onOpen={() => openSession(session.id)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          data-home-mind-files
          onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) e.stopPropagation(); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
          onDrop={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
        >
          <MindSystemSidebarSection
            title={t.sidebar.builtInSpacesTitle}
            slots={mindSystemSlots}
            activePathname={pathname}
            onOpen={(path) => smoothPush(`/view/${encodePath(path)}`)}
          />
          <FileTree nodes={fileTree} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
