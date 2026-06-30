import { memo, useState, useRef, useEffect, useCallback, useMemo, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { SquarePen, History, X, Maximize2, Minimize2, PanelRight, ChevronDown, Search, MessageSquare } from 'lucide-react';
import { SaveSessionButton } from './SaveSessionInline';
import RuntimeIconSwitcher from './RuntimeIconSwitcher';
import { SessionHistoryRow } from './SessionHistoryRow';
import { useLocale } from '@/lib/stores/locale-store';
import type {
  AgentRuntimeDescriptor,
  AgentRuntimeIdentity,
  AgentRuntimeReadinessProjection,
  ChatSession,
  RuntimeSessionBinding,
} from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import type { NotInstalledAgent } from '@/hooks/useAcpDetection';
import { agentIconFile } from '@/lib/agent-icons';
import {
  buildChatSessionListEntry,
  sessionListAgentFilterId,
  sessionListEntryMatchesSearch,
  type ChatSessionListEntry,
  type SessionListAgentFilter,
} from '@/lib/session-list-entry';

interface AskHeaderProps {
  isPanel: boolean;
  showHistory: boolean;
  onToggleHistory: () => void;
  onReset: () => void;
  isLoading: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
  onClose?: () => void;
  /** Navigate from fullscreen to right-side panel mode */
  onDockToPanel?: () => void;
  hideTitle?: boolean;
  /** Session switching — inline in header when >=2 sessions */
  sessions?: ChatSession[];
  activeSessionId?: string | null;
  onLoadSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onForkSession?: (id: string) => void;
  onRenameSession?: (id: string, name: string) => void;
  onTogglePinSession?: (id: string) => void;
  /** Current session messages — used by Save Session button */
  messages?: import('@/lib/types').Message[];
  /** Current Chat Panel runtime selection */
  selectedAgentRuntime?: AgentRuntimeIdentity | null;
  onSelectAgentRuntime?: (agent: AgentRuntimeIdentity | null) => void;
  runtimeSessionBinding?: RuntimeSessionBinding | null;
  nativeRuntimes?: Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName' | 'binaryPath'>>>;
  notInstalledAgents?: NotInstalledAgent[];
  agentLoading?: boolean;
  agentLoadingByKind?: Partial<Record<'codex' | 'claude', boolean>>;
  agentErrorByKind?: Partial<Record<'codex' | 'claude', string | null>>;
  runtimeReadinessByRuntimeId?: Record<string, AgentRuntimeReadinessProjection>;
  runtimeReadinessLoading?: boolean;
  acpRuntimes?: Array<AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'description' | 'binaryPath' | 'resolvedCommand'>>>;
  acpLoading?: boolean;
  acpError?: string | null;
  onRefreshNativeRuntimes?: () => void;
}

function nativeSavedSessionLabel(runtime: AgentRuntimeIdentity | null | undefined): string {
  if (runtime?.kind === 'codex') return 'MindOS-linked Codex chats';
  if (runtime?.kind === 'claude') return 'MindOS-linked Claude Code chats';
  if (runtime?.kind === 'acp') return `Saved ${runtime.name} chats`;
  return 'Saved chats';
}

function filterIdForRuntime(runtime: AgentRuntimeIdentity | null | undefined): SessionListAgentFilter {
  if (!runtime || runtime.kind === 'mindos') return 'mindos';
  if (runtime.kind === 'codex' || runtime.kind === 'claude') return runtime.kind;
  return `acp:${runtime.id}`;
}

function acpAgentIconSrc(runtime: AgentRuntimeIdentity | null | undefined): string | null {
  if (!runtime || runtime.kind !== 'acp') return null;
  const iconFile = agentIconFile(runtime.id) ?? agentIconFile(runtime.name) ?? agentIconFile(`${runtime.id} ${runtime.name}`);
  return iconFile ? `/agent-icons/${iconFile}` : null;
}

function SessionSwitcherAgentMark({
  filterId,
  runtime,
}: {
  filterId: SessionListAgentFilter;
  runtime?: AgentRuntimeIdentity | null;
}) {
  if (filterId === 'all') return <MessageSquare size={13} aria-hidden="true" />;
  if (filterId === 'mindos') {
    return <img src="/logo-square.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain" />;
  }
  if (filterId === 'codex') {
    return <img src="/agent-icons/openai.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain" />;
  }
  if (filterId === 'claude') {
    return <img src="/agent-icons/claude.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain" />;
  }
  const iconSrc = acpAgentIconSrc(runtime);
  if (iconSrc) {
    return <img src={iconSrc} alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain" />;
  }
  return <span className="text-[10px] font-semibold leading-none">{runtime?.name?.slice(0, 1) ?? 'A'}</span>;
}

export default memo(function AskHeader({
  isPanel, showHistory, onToggleHistory, onReset, isLoading,
  maximized, onMaximize, onClose, onDockToPanel, hideTitle,
  sessions, activeSessionId, onLoadSession, onDeleteSession, onForkSession, onRenameSession, onTogglePinSession,
  messages, selectedAgentRuntime, onSelectAgentRuntime, runtimeSessionBinding,
  nativeRuntimes = [], notInstalledAgents = [], agentLoading, agentLoadingByKind, agentErrorByKind,
  runtimeReadinessByRuntimeId, runtimeReadinessLoading, acpRuntimes = [], acpLoading, acpError, onRefreshNativeRuntimes,
}: AskHeaderProps) {
  const { t } = useLocale();
  const [isPending, startTransition] = useTransition();
  const iconSize = 14;
  const isNativeRuntime = selectedAgentRuntime?.kind === 'codex' || selectedAgentRuntime?.kind === 'claude';
  const canOpenSessionSwitcher = !!sessions && (sessions.length >= 2 || isNativeRuntime);
  const headerButtonClass = 'hit-target-box relative z-10 inline-flex h-9 w-9 items-center justify-center pointer-events-auto touch-manipulation transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-hover-bg:var(--muted)] [--hit-target-active-bg:color-mix(in_srgb,var(--amber)_10%,transparent)]';
  const titleTriggerClass = 'hit-target-box relative z-10 inline-flex min-h-9 items-center px-2 pointer-events-auto touch-manipulation transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_40%,transparent)]';
  const activeSession = sessions?.find(s => s.id === activeSessionId);
  const activeTitle = activeSession ? sessionTitle(activeSession) : null;

  // Session switcher dropdown state
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');
  const [switcherAgentFilter, setSwitcherAgentFilter] = useState<SessionListAgentFilter>(() => filterIdForRuntime(selectedAgentRuntime));
  const switcherRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const switcherSearchRef = useRef<HTMLInputElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        switcherRef.current && !switcherRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setSwitcherOpen(false);
        setRenamingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [switcherOpen]);

  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingId) { setRenamingId(null); } else { setSwitcherOpen(false); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [switcherOpen, renamingId]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [renamingId]);

  useEffect(() => {
    if (switcherOpen) setTimeout(() => switcherSearchRef.current?.focus(), 0);
  }, [switcherOpen]);

  const sessionEntries = useMemo<ChatSessionListEntry[]>(() => (
    (sessions ?? []).map((session) => buildChatSessionListEntry(session, { emptyTitleFallback: t.hints?.newChat ?? t.ask?.historyEmptyHint }))
  ), [sessions, t.ask?.historyEmptyHint, t.hints?.newChat]);

  const agentFilterItems = useMemo(() => {
    const acpByFilter = new Map<SessionListAgentFilter, AgentRuntimeIdentity>();
    for (const entry of sessionEntries) {
      const filterId = sessionListAgentFilterId(entry);
      if (filterId.startsWith('acp:') && entry.runtime) acpByFilter.set(filterId, entry.runtime);
    }
    if (selectedAgentRuntime?.kind === 'acp') {
      acpByFilter.set(`acp:${selectedAgentRuntime.id}`, selectedAgentRuntime);
    }
    return [
      { id: 'all' as const, label: t.sidebar?.homeFilterAll ?? 'All agents', runtime: null },
      { id: 'mindos' as const, label: t.sidebar?.homeFilterMindOS ?? 'MindOS', runtime: null },
      { id: 'codex' as const, label: t.sidebar?.homeFilterCodex ?? 'Codex', runtime: null },
      { id: 'claude' as const, label: t.sidebar?.homeFilterClaude ?? 'Claude Code', runtime: null },
      ...Array.from(acpByFilter.entries()).map(([id, runtime]) => ({
        id,
        label: runtime.name,
        runtime,
      })),
    ];
  }, [sessionEntries, selectedAgentRuntime, t.sidebar?.homeFilterAll, t.sidebar?.homeFilterClaude, t.sidebar?.homeFilterCodex, t.sidebar?.homeFilterMindOS]);

  const availableAgentFilterIds = useMemo(
    () => new Set<SessionListAgentFilter>(agentFilterItems.map((item) => item.id)),
    [agentFilterItems],
  );

  useEffect(() => {
    if (!availableAgentFilterIds.has(switcherAgentFilter)) {
      setSwitcherAgentFilter(filterIdForRuntime(selectedAgentRuntime));
    }
  }, [availableAgentFilterIds, selectedAgentRuntime, switcherAgentFilter]);

  const switcherFilteredEntries = useMemo(() => {
    const agentFilteredEntries = switcherAgentFilter === 'all'
      ? sessionEntries
      : sessionEntries.filter((entry) => sessionListAgentFilterId(entry) === switcherAgentFilter);
    const query = switcherQuery.trim();
    if (!query) return agentFilteredEntries;
    return agentFilteredEntries.filter((entry) => sessionListEntryMatchesSearch(entry, query));
  }, [sessionEntries, switcherAgentFilter, switcherQuery]);

  const handleSelectSession = useCallback((id: string) => {
    startTransition(() => {
      onLoadSession?.(id);
      setSwitcherOpen(false);
    });
  }, [onLoadSession]);

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle === '(empty session)' ? '' : currentTitle);
  }, []);

  const handleCommitRename = useCallback(() => {
    startTransition(() => {
      if (renamingId && onRenameSession && renameValue.trim()) {
        onRenameSession(renamingId, renameValue.trim());
      }
      setRenamingId(null);
    });
  }, [renamingId, renameValue, onRenameSession]);

  // Position dropdown below trigger
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!switcherOpen || !switcherRef.current) return;
    const rect = switcherRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 340) });
  }, [switcherOpen]);

  const switcherDropdown = switcherOpen && dropPos && sessions ? createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[60] flex max-h-[64vh] flex-col overflow-hidden rounded-xl border border-border/50 bg-card shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-100"
      style={{ top: dropPos.top, left: dropPos.left, minWidth: Math.max(dropPos.width, 340), maxWidth: 380 }}
      role="listbox"
    >
      {isNativeRuntime && (
        <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2.5">
          <span className="min-w-0 truncate text-2xs text-muted-foreground/60">
            {nativeSavedSessionLabel(selectedAgentRuntime)}
          </span>
          <button
            type="button"
            onClick={() => {
              startTransition(() => {
                onReset();
                setSwitcherOpen(false);
              });
            }}
            disabled={isLoading}
            className="hit-target-box inline-flex min-h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-[var(--amber)] transition-colors hover:text-[var(--amber)]/80 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SquarePen size={10} />
            New chat
          </button>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5" role="group" aria-label={t.sidebar?.homeAgentFilter ?? 'Filter sessions by agent'} data-session-switcher-agent-filter-rail>
        {agentFilterItems.map((item) => {
          const active = switcherAgentFilter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-session-switcher-agent-filter={item.id}
              data-hit-active={active ? 'true' : undefined}
              aria-label={item.label}
              aria-pressed={active}
              title={item.label}
              onClick={() => setSwitcherAgentFilter(item.id)}
              className={`hit-target-box inline-flex h-7 w-7 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] ${
                active
                  ? 'text-[var(--amber)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-border-width:1px] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_26%,transparent)]'
                  : 'text-muted-foreground/55 [--hit-target-hover-bg:var(--muted)] hover:text-foreground'
              }`}
            >
              <SessionSwitcherAgentMark filterId={item.id} runtime={item.runtime} />
            </button>
          );
        })}
      </div>
      <div className="shrink-0 px-2 pb-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={switcherSearchRef}
            type="text"
            value={switcherQuery}
            onChange={(event) => setSwitcherQuery(event.currentTarget.value)}
            placeholder={t.ask?.historySearch ?? 'Search conversations...'}
            aria-label={t.ask?.historySearch ?? 'Search conversations'}
            data-session-switcher-search-input
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus-visible:border-[var(--amber)]/40 focus-visible:ring-2 focus-visible:ring-ring/20"
          />
          {switcherQuery && (
            <button
              type="button"
              onClick={() => setSwitcherQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {sessions.length === 0 && (
        <div className="px-3 py-3 text-xs text-muted-foreground/60">
          {isNativeRuntime
            ? `No ${nativeSavedSessionLabel(selectedAgentRuntime).toLowerCase()}.`
            : (t.ask?.noSessions ?? 'No saved sessions.')}
        </div>
      )}
      {sessions.length > 0 && switcherFilteredEntries.length === 0 && (
        <div className="px-3 py-3 text-xs text-muted-foreground/60">
          {switcherQuery ? (t.ask?.historyNoMatches ?? 'No matching conversations') : (t.ask?.historyEmpty ?? 'No conversations yet')}
        </div>
      )}
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1 pb-1.5">
        {switcherFilteredEntries.map((entry) => {
          const s = entry.session;
          const title = entry.title;
          const displayTitle = title === '(empty session)' ? (t.hints?.newChat ?? 'New chat') : title;
          return (
            <SessionHistoryRow
              key={s.id}
              role="option"
              aria-selected={s.id === activeSessionId}
              session={s}
              title={displayTitle}
              preview={entry.preview}
              runtimeSummary={entry.runtimeSummary}
              isActive={s.id === activeSessionId}
              editing={renamingId === s.id}
              editValue={renameValue}
              onEditValueChange={setRenameValue}
              inputRef={renameInputRef}
              onLoad={() => handleSelectSession(s.id)}
              onStartRename={onRenameSession ? () => handleStartRename(s.id, title) : undefined}
              onCommitRename={handleCommitRename}
              onCancelRename={() => setRenamingId(null)}
              onArchive={onDeleteSession ? () => onDeleteSession(s.id) : undefined}
              onFork={onForkSession ? () => {
                onForkSession(s.id);
                setSwitcherOpen(false);
              } : undefined}
              onTogglePin={onTogglePinSession ? () => onTogglePinSession(s.id) : undefined}
              ask={t.ask}
              canDelete={Boolean(onDeleteSession)}
            />
          );
        })}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div data-ask-header className={`relative z-20 isolate flex items-center justify-between border-b border-border/20 bg-background/95 px-4 shrink-0 backdrop-blur supports-[backdrop-filter]:bg-background/80 ${isPanel ? 'py-1.5' : 'py-2.5'}`}>
      {!isPanel && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-muted-foreground/20 md:hidden" />
      )}
      {!hideTitle && (
        <div className="relative z-10 flex items-center gap-2 min-w-0">
          {onSelectAgentRuntime ? (
            <RuntimeIconSwitcher
              selectedRuntime={selectedAgentRuntime ?? null}
              onSelect={onSelectAgentRuntime}
              runtimeSessionBinding={runtimeSessionBinding ?? null}
              nativeRuntimes={nativeRuntimes}
              notInstalledAgents={notInstalledAgents}
              loading={agentLoading}
              loadingByKind={agentLoadingByKind}
              errorByKind={agentErrorByKind}
              runtimeReadinessByRuntimeId={runtimeReadinessByRuntimeId}
              runtimeReadinessLoading={runtimeReadinessLoading}
              acpRuntimes={acpRuntimes}
              acpLoading={acpLoading}
              acpError={acpError}
              onRefreshNativeRuntimes={onRefreshNativeRuntimes}
              disabled={isLoading}
            />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-[var(--amber)]/10 flex items-center justify-center shrink-0">
              <img src="/logo-square.svg" alt="" aria-hidden="true" className="h-4 w-4 object-contain" />
            </div>
          )}
          {showHistory ? (
            <span className="text-sm font-medium text-[var(--amber)]">
              {t.ask?.sessionHistory ?? 'Session History'}
            </span>
          ) : canOpenSessionSwitcher ? (
            <button
              ref={switcherRef}
              type="button"
              onClick={() => {
                startTransition(() => {
                  setSwitcherOpen((open) => {
                    if (!open) {
                      setSwitcherAgentFilter(filterIdForRuntime(selectedAgentRuntime));
                      setSwitcherQuery('');
                    }
                    return !open;
                  });
                });
              }}
              className={`min-w-0 gap-1 text-sm font-medium text-[var(--amber)] hover:text-[var(--amber)]/80 ${titleTriggerClass}`}
              data-hit-active={switcherOpen ? 'true' : undefined}
              aria-expanded={switcherOpen}
              aria-haspopup="listbox"
            >
              <span className="truncate max-w-[180px]">
                {activeTitle
                  ? activeTitle === '(empty session)' ? (t.hints?.newChat ?? 'New chat') : activeTitle
                  : isNativeRuntime ? nativeSavedSessionLabel(selectedAgentRuntime) : (t.hints?.newChat ?? 'New chat')}
              </span>
              <ChevronDown size={12} className={`shrink-0 text-muted-foreground transition-transform duration-150 ${switcherOpen ? 'rotate-180' : ''}`} />
            </button>
          ) : activeTitle ? (
            <span className="text-sm font-medium text-muted-foreground/60 truncate max-w-[180px]">
              {activeTitle === '(empty session)' ? (t.hints?.newChat ?? 'New chat') : activeTitle}
            </span>
          ) : (
            /* Placeholder while sessions load — avoids flash of "MindOS" text */
            <span className="text-sm font-medium text-muted-foreground/40">
              {t.hints?.newChat ?? 'New chat'}
            </span>
          )}
        </div>
      )}
      {hideTitle && <div />}
      <div data-ask-header-actions className="relative z-10 flex items-center gap-1 shrink-0 pointer-events-auto">
        <button type="button" onClick={(e) => { e.stopPropagation(); startTransition(() => onReset()); }} disabled={isLoading} className={`${headerButtonClass} text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40`} title={t.hints.newSession}>
          <SquarePen size={iconSize} />
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); startTransition(() => onToggleHistory()); }} aria-pressed={showHistory} data-hit-active={showHistory ? 'true' : undefined} className={`${headerButtonClass} ${showHistory ? 'text-[var(--amber)]' : 'text-muted-foreground hover:text-foreground'}`} title={t.hints.sessionHistory}>
          <History size={iconSize} />
        </button>
        {messages && messages.length > 0 && (
          <SaveSessionButton messages={messages} disabled={isLoading} />
        )}
        {onMaximize && (
          <button type="button" onClick={(e) => { e.stopPropagation(); startTransition(() => onMaximize()); }} className={`${headerButtonClass} text-muted-foreground hover:text-foreground`} title={maximized ? t.hints.restorePanel : t.hints.maximizePanel}>
            {maximized ? <Minimize2 size={iconSize} /> : <Maximize2 size={iconSize} />}
          </button>
        )}
        {onDockToPanel && (
          <button type="button" onClick={(e) => { e.stopPropagation(); startTransition(() => onDockToPanel()); }} className={`${headerButtonClass} text-muted-foreground hover:text-foreground`} title={t.hints.dockToSide ?? 'Dock to side panel'}>
            <PanelRight size={iconSize} />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={(e) => { e.stopPropagation(); startTransition(() => onClose()); }} className={`${headerButtonClass} text-muted-foreground hover:text-foreground`} title={t.hints.closePanel} aria-label="Close">
            <X size={iconSize} />
          </button>
        )}
      </div>
      {typeof document !== 'undefined' && switcherDropdown}
    </div>
  );
});
