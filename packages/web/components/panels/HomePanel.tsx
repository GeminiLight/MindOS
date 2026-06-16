'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Brain, Loader2, MessageSquare, Network, Plus, RefreshCw, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import FileTree from '@/components/FileTree';
import Logo from '@/components/Logo';
import type { FileNode, ChatSession } from '@/lib/types';
import type { MindSystemSlot } from '@/lib/mind-system';
import { getRuntimeSessionSummary, getSessionAgentRuntime } from '@/lib/ask-agent';
import { loadSession, refreshSessions, resetSession, useActiveSessionId, useSessions } from '@/lib/ask-session-store';
import { useRunSummary } from '@/lib/ask-run-store';
import { sessionTitle } from '@/hooks/useAskSession';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import PanelHeader from './PanelHeader';
import MindSystemSidebarSection from './MindSystemSidebarSection';

type HomeSidebarMode = 'sessions' | 'files';
type SessionAgentFilter = 'all' | 'mindos' | 'codex' | 'claude' | 'acp';

function compactTimeDistance(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.max(0, Math.floor(diff / 60_000));
  if (mins < 1) return '0m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function sessionAgentKind(session: ChatSession): Exclude<SessionAgentFilter, 'all'> {
  const runtime = getSessionAgentRuntime(session);
  if (!runtime || runtime.kind === 'mindos') return 'mindos';
  if (runtime.kind === 'codex') return 'codex';
  if (runtime.kind === 'claude') return 'claude';
  return 'acp';
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

function AgentMark({
  kind,
  id,
  active,
  size = 'md',
}: {
  kind: Exclude<SessionAgentFilter, 'all'>;
  id: string;
  active?: boolean;
  size?: 'sm' | 'md';
}) {
  const boxSize = size === 'sm' ? 'h-6 w-6 rounded-lg' : 'h-7 w-7 rounded-lg';
  const iconSize = size === 'sm' ? 12 : 13;
  const logoClass = size === 'sm' ? 'h-2.5 w-[18px]' : 'h-3 w-5';
  const runtimeLogoClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const shared = `inline-flex shrink-0 items-center justify-center border border-border/50 bg-background ${boxSize}`;

  if (kind === 'mindos') {
    return (
      <span
        data-home-session-agent={kind}
        className={`${shared} text-[var(--amber)] ${active ? 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--amber)_22%,transparent)_inset]' : ''}`}
      >
        <Logo id={`home-agent-${safeId}`} className={logoClass} />
      </span>
    );
  }

  if (kind === 'codex') {
    return (
      <span data-home-session-agent={kind} className={shared}>
        <img src="/agent-icons/openai.svg" alt="" aria-hidden="true" className={`${runtimeLogoClass} object-contain`} />
      </span>
    );
  }

  if (kind === 'claude') {
    return (
      <span data-home-session-agent={kind} className={shared}>
        <img src="/agent-icons/claude.svg" alt="" aria-hidden="true" className={`${runtimeLogoClass} object-contain`} />
      </span>
    );
  }

  return (
    <span data-home-session-agent={kind} className={`${shared} text-[var(--tool-read)]`}>
      <Network size={iconSize} aria-hidden="true" />
    </span>
  );
}

function SessionStatusDot({
  running,
  status,
}: {
  running: boolean;
  status?: string;
}) {
  const { t } = useLocale();
  if (!running && (!status || status === 'active')) return null;

  const failed = status === 'failed' || status === 'missing' || status === 'signed-out';
  const label = running ? t.sidebar.homeRuntimeRunning : status || t.sidebar.homeRuntimeIdle;

  return (
    <span
      data-home-session-status={running ? 'running' : status}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
      aria-label={label}
      title={label}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          running
            ? 'bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_14%,transparent)] motion-safe:animate-pulse'
            : failed
              ? 'bg-[var(--error)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--error)_12%,transparent)]'
              : 'bg-[var(--amber)] shadow-[0_0_0_3px_var(--amber-subtle)]'
        }`}
      />
    </span>
  );
}

function HomeHeaderIconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function HomeAgentFilter({
  value,
  onChange,
  counts,
}: {
  value: SessionAgentFilter;
  onChange: (value: SessionAgentFilter) => void;
  counts: Record<SessionAgentFilter, number>;
}) {
  const { t } = useLocale();
  const filters: Array<{ id: SessionAgentFilter; label: string; icon: ReactNode }> = [
    { id: 'all', label: t.sidebar.homeFilterAll, icon: <MessageSquare size={13} aria-hidden="true" /> },
    { id: 'mindos', label: t.sidebar.homeFilterMindOS, icon: <AgentMark kind="mindos" id="filter-mindos" size="sm" /> },
    { id: 'codex', label: t.sidebar.homeFilterCodex, icon: <AgentMark kind="codex" id="filter-codex" size="sm" /> },
    { id: 'claude', label: t.sidebar.homeFilterClaude, icon: <AgentMark kind="claude" id="filter-claude" size="sm" /> },
    { id: 'acp', label: t.sidebar.homeFilterAcp, icon: <AgentMark kind="acp" id="filter-acp" size="sm" /> },
  ];

  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-2" role="group" aria-label={t.sidebar.homeAgentFilter}>
      {filters.map((filter) => {
        const active = value === filter.id;
        return (
          <button
            key={filter.id}
            type="button"
            data-home-agent-filter={filter.id}
            data-hit-active={active ? 'true' : undefined}
            aria-label={`${filter.label} (${counts[filter.id]})`}
            aria-pressed={active}
            title={`${filter.label} (${counts[filter.id]})`}
            onClick={() => onChange(filter.id)}
            className={`hit-target-box inline-flex h-7 min-w-7 items-center justify-center px-0.5 text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-hover-bg:var(--muted)] ${
              active
                ? 'text-foreground [--hit-target-border-width:1px] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_24%,transparent)]'
                : 'hover:text-foreground'
            }`}
          >
            {filter.icon}
          </button>
        );
      })}
    </div>
  );
}

function HomeSessionRow({
  session,
  active,
  running,
  onOpen,
}: {
  session: ChatSession;
  active: boolean;
  running: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocale();
  const runtimeSummary = getRuntimeSessionSummary(session);
  const agentKind = sessionAgentKind(session);
  const title = sessionDisplayTitle(session, t.ask.historyEmptyHint);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-home-session-row={session.id}
      data-hit-active={active ? 'true' : undefined}
      className={`hit-target-box group flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-hover-bg:var(--muted)] ${
        active
          ? '[--hit-target-border-width:1px] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_26%,transparent)]'
          : ''
      }`}
    >
      <AgentMark kind={agentKind} id={session.id} active={active} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground" title={title}>
          {title}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          {compactTimeDistance(session.updatedAt)}
        </span>
        <SessionStatusDot running={running} status={runtimeSummary?.status} />
      </span>
    </button>
  );
}

export default function HomePanel({
  active,
  fileTree,
  mindSystemSlots,
  onNavigate,
  onSearchOpenOrFocus,
}: {
  active: boolean;
  fileTree: FileNode[];
  mindSystemSlots: MindSystemSlot[];
  onNavigate?: () => void;
  onSearchOpenOrFocus?: () => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const smoothPush = useSmoothRouterPush();
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();
  const runSummary = useRunSummary();
  const [mode, setMode] = useState<HomeSidebarMode>('sessions');
  const [agentFilter, setAgentFilter] = useState<SessionAgentFilter>('all');
  const [refreshingSessions, setRefreshingSessions] = useState(false);

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

  const agentCounts = useMemo(() => {
    const counts: Record<SessionAgentFilter, number> = {
      all: sortedSessions.length,
      mindos: 0,
      codex: 0,
      claude: 0,
      acp: 0,
    };
    for (const session of sortedSessions) counts[sessionAgentKind(session)] += 1;
    return counts;
  }, [sortedSessions]);

  const filteredSessions = useMemo(() => (
    agentFilter === 'all'
      ? sortedSessions
      : sortedSessions.filter((session) => sessionAgentKind(session) === agentFilter)
  ), [agentFilter, sortedSessions]);

  const handleNewSession = useCallback(() => {
    resetSession();
    if (pathname !== '/') smoothPush('/');
    window.dispatchEvent(new CustomEvent('mindos:open-ask-panel'));
  }, [pathname, smoothPush]);

  const handleRefreshSessions = useCallback(() => {
    if (refreshingSessions) return;
    setRefreshingSessions(true);
    void refreshSessions().finally(() => setRefreshingSessions(false));
  }, [refreshingSessions]);

  const openSession = useCallback((id: string) => {
    loadSession(id);
    if (pathname !== '/') smoothPush('/');
  }, [pathname, smoothPush]);

  return (
    <div className="flex h-full flex-col" data-home-sidebar-panel>
      <PanelHeader title={t.sidebar.home}>
        {mode === 'sessions' ? (
          <>
            <HomeHeaderIconButton label={t.sidebar.homeNewSession} onClick={handleNewSession}>
              <Plus size={13} aria-hidden="true" />
            </HomeHeaderIconButton>
            <HomeHeaderIconButton label={t.sidebar.homeSearchSessions} onClick={onSearchOpenOrFocus ?? (() => {})}>
              <Search size={13} aria-hidden="true" />
            </HomeHeaderIconButton>
            <HomeHeaderIconButton label={t.sidebar.homeRefreshSessions} onClick={handleRefreshSessions} disabled={refreshingSessions}>
              {refreshingSessions ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
            </HomeHeaderIconButton>
          </>
        ) : null}
        <HomeModeSwitch mode={mode} onModeChange={setMode} />
      </PanelHeader>

      {mode === 'sessions' ? (
        <>
          <HomeAgentFilter value={agentFilter} onChange={setAgentFilter} counts={agentCounts} />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-home-session-list>
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
              {filteredSessions.map((session) => (
                <HomeSessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                  running={runSummary.running.has(session.id)}
                  onOpen={() => openSession(session.id)}
                />
              ))}
            </div>
          )}
          </div>
        </>
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
