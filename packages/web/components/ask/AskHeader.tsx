import { memo, useState, useRef, useEffect, useCallback, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { SquarePen, History, X, Maximize2, Minimize2, PanelRight, ChevronDown, Check, Trash2, Pencil, Pin, PinOff } from 'lucide-react';
import { SaveSessionButton } from './SaveSessionInline';
import RuntimeIconSwitcher from './RuntimeIconSwitcher';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentRuntimeDescriptor, AgentRuntimeIdentity, ChatSession, RuntimeSessionBinding } from '@/lib/types';
import { getRuntimeSessionSummary } from '@/lib/ask-agent';
import { sessionTitle } from '@/hooks/useAskSession';
import type { NotInstalledAgent } from '@/hooks/useAcpDetection';

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
  onRefreshNativeRuntimes?: () => void;
}

function nativeSavedSessionLabel(runtime: AgentRuntimeIdentity | null | undefined): string {
  if (runtime?.kind === 'codex') return 'MindOS-linked Codex chats';
  if (runtime?.kind === 'claude') return 'MindOS-linked Claude Code chats';
  if (runtime?.kind === 'acp') return `Saved ${runtime.name} chats`;
  return 'Saved chats';
}

export default memo(function AskHeader({
  isPanel, showHistory, onToggleHistory, onReset, isLoading,
  maximized, onMaximize, onClose, onDockToPanel, hideTitle,
  sessions, activeSessionId, onLoadSession, onDeleteSession, onRenameSession, onTogglePinSession,
  messages, selectedAgentRuntime, onSelectAgentRuntime, runtimeSessionBinding,
  nativeRuntimes = [], notInstalledAgents = [], agentLoading, agentLoadingByKind, agentErrorByKind, onRefreshNativeRuntimes,
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
  const switcherRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) });
  }, [switcherOpen]);

  const switcherDropdown = switcherOpen && dropPos && sessions ? createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[60] pointer-events-auto rounded-xl border border-border/50 bg-card shadow-lg py-1 animate-in fade-in-0 slide-in-from-top-1 duration-100 max-h-[60vh] overflow-y-auto"
      style={{ top: dropPos.top, left: dropPos.left, minWidth: Math.max(dropPos.width, 280), maxWidth: 340 }}
      role="listbox"
    >
      {isNativeRuntime && (
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
          <span className="truncate text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
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
            className="hit-target-box inline-flex items-center gap-1 border border-transparent px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors duration-75 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-bg:var(--card)] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-border-width:1px] [--hit-target-border:color-mix(in_srgb,var(--border)_60%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_70%,transparent)] [--hit-target-radius:var(--radius-md)]"
          >
            <SquarePen size={10} />
            New chat
          </button>
        </div>
      )}
      {sessions.length === 0 && (
        <div className="px-3 py-3 text-xs text-muted-foreground/60">
          {isNativeRuntime
            ? `No ${nativeSavedSessionLabel(selectedAgentRuntime).toLowerCase()}.`
            : (t.ask?.noSessions ?? 'No saved sessions.')}
        </div>
      )}
      {sessions.map((s) => {
        const isActive = s.id === activeSessionId;
        const title = sessionTitle(s);
        const displayTitle = title === '(empty session)' ? (t.hints?.newChat ?? 'New chat') : title;
        const runtimeSummary = getRuntimeSessionSummary(s);

        if (renamingId === s.id) {
          return (
            <div key={s.id} className="flex items-center gap-1 px-2 py-1.5">
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onBlur={handleCommitRename}
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:border-[var(--amber)]/50"
                placeholder="Session name..."
              />
            </div>
          );
        }

        return (
          <div key={s.id} className="group/item flex items-center">
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              onClick={() => handleSelectSession(s.id)}
              className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-colors ${
                isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {s.pinned && <Pin size={10} className="shrink-0 text-[var(--amber)]/60 -rotate-45" />}
              {isActive && !s.pinned && <Check size={11} className="shrink-0 text-[var(--amber)]" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{displayTitle}</span>
                {runtimeSummary && (
                  <span className="mt-0.5 block truncate text-2xs font-normal text-muted-foreground/60">
                    {runtimeSummary.idLabel}
                    {runtimeSummary.status ? ` · ${runtimeSummary.status}` : ''}
                  </span>
                )}
                {runtimeSummary?.cwd && (
                  <span className="mt-0.5 block truncate font-mono text-[10px] font-normal text-muted-foreground/50">
                    {runtimeSummary.cwd}
                  </span>
                )}
              </span>
            </button>
            <div className="shrink-0 flex items-center gap-0.5 mr-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
              {onTogglePinSession && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTogglePinSession(s.id); }}
                  className={`hit-target-box inline-flex h-7 w-7 items-center justify-center transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] ${s.pinned ? 'text-[var(--amber)] hover:text-muted-foreground [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)]' : 'text-muted-foreground/40 hover:text-[var(--amber)] [--hit-target-hover-bg:color-mix(in_srgb,var(--amber)_5%,transparent)]'}`}
                  aria-label={s.pinned ? 'Unpin' : 'Pin'}
                >
                  {s.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                </button>
              )}
              {onRenameSession && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleStartRename(s.id, title); }}
                  className="hit-target-box inline-flex h-7 w-7 items-center justify-center text-muted-foreground/40 transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-radius:var(--radius-md)]"
                  aria-label={`Rename: ${displayTitle}`}
                >
                  <Pencil size={10} />
                </button>
              )}
              {sessions.length > 1 && onDeleteSession && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                  className="hit-target-box inline-flex h-7 w-7 items-center justify-center text-muted-foreground/40 transition-colors duration-75 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:color-mix(in_srgb,var(--error)_5%,transparent)] [--hit-target-radius:var(--radius-md)]"
                  aria-label={`Delete: ${displayTitle}`}
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          </div>
        );
      })}
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
                  setSwitcherOpen(v => !v);
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
        <button type="button" onClick={(e) => { e.stopPropagation(); startTransition(() => onToggleHistory()); }} aria-pressed={showHistory} data-hit-active={showHistory ? 'true' : undefined} className={`${headerButtonClass} ${showHistory ? 'text-[var(--amber)]' : 'text-muted-foreground hover:text-foreground'}`} title={t.hints.sessionHistory}>
          <History size={iconSize} />
        </button>
        {messages && messages.length > 0 && (
          <SaveSessionButton messages={messages} disabled={isLoading} />
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); startTransition(() => onReset()); }} disabled={isLoading} className={`${headerButtonClass} text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40`} title={t.hints.newSession}>
          <SquarePen size={iconSize} />
        </button>
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
