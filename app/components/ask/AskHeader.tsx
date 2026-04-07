import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, SquarePen, History, X, Maximize2, Minimize2, PanelRight, AppWindow, ChevronDown, Check, Trash2, Pencil, Pin, PinOff } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';

interface AskHeaderProps {
  isPanel: boolean;
  showHistory: boolean;
  onToggleHistory: () => void;
  onReset: () => void;
  isLoading: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
  askMode?: 'panel' | 'popup';
  onModeSwitch?: () => void;
  onClose?: () => void;
  hideTitle?: boolean;
  /** Session switching — inline in header when >=2 sessions */
  sessions?: ChatSession[];
  activeSessionId?: string | null;
  onLoadSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onRenameSession?: (id: string, name: string) => void;
  onTogglePinSession?: (id: string) => void;
}

export default memo(function AskHeader({
  isPanel, showHistory, onToggleHistory, onReset, isLoading,
  maximized, onMaximize, askMode, onModeSwitch, onClose, hideTitle,
  sessions, activeSessionId, onLoadSession, onDeleteSession, onRenameSession, onTogglePinSession,
}: AskHeaderProps) {
  const { t } = useLocale();
  const iconSize = 14;
  const hasMultipleSessions = sessions && sessions.length >= 1;
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
    onLoadSession?.(id);
    setSwitcherOpen(false);
  }, [onLoadSession]);

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle === '(empty session)' ? '' : currentTitle);
  }, []);

  const handleCommitRename = useCallback(() => {
    if (renamingId && onRenameSession && renameValue.trim()) {
      onRenameSession(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameSession]);

  // Position dropdown below trigger
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!switcherOpen || !switcherRef.current) return;
    const rect = switcherRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240) });
  }, [switcherOpen]);

  const switcherDropdown = switcherOpen && dropPos && sessions ? createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-50 rounded-xl border border-border/50 bg-card shadow-lg py-1 animate-in fade-in-0 slide-in-from-top-1 duration-100"
      style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width, maxWidth: 320 }}
      role="listbox"
    >
      {sessions.map((s) => {
        const isActive = s.id === activeSessionId;
        const title = sessionTitle(s);
        const displayTitle = title === '(empty session)' ? (t.hints?.newChat ?? 'New chat') : title;

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
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground outline-none focus:border-[var(--amber)]/50"
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
              className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {s.pinned && <Pin size={10} className="shrink-0 text-[var(--amber)]/60 -rotate-45" />}
              {isActive && !s.pinned && <Check size={11} className="shrink-0 text-[var(--amber)]" />}
              <span className="truncate">{displayTitle}</span>
            </button>
            <div className="shrink-0 flex items-center gap-0.5 mr-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
              {onTogglePinSession && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTogglePinSession(s.id); }}
                  className={`p-1.5 rounded-md transition-colors ${s.pinned ? 'text-[var(--amber)] hover:text-muted-foreground hover:bg-muted/60' : 'text-muted-foreground/40 hover:text-[var(--amber)] hover:bg-[var(--amber)]/5'}`}
                  aria-label={s.pinned ? 'Unpin' : 'Pin'}
                >
                  {s.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                </button>
              )}
              {onRenameSession && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleStartRename(s.id, title); }}
                  className="p-1.5 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/60"
                  aria-label={`Rename: ${displayTitle}`}
                >
                  <Pencil size={10} />
                </button>
              )}
              {sessions.length > 1 && onDeleteSession && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                  className="p-1.5 rounded-md text-muted-foreground/40 hover:text-error hover:bg-error/5"
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
    <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
      {!isPanel && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-muted-foreground/20 md:hidden" />
      )}
      {!hideTitle && (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-[var(--amber)]/10 flex items-center justify-center shrink-0">
            <Sparkles size={13} className="text-[var(--amber)]" />
          </div>
          {hasMultipleSessions && activeTitle ? (
            <button
              ref={switcherRef}
              type="button"
              onClick={() => {
                if (sessions && sessions.length >= 2) {
                  setSwitcherOpen(v => !v);
                } else {
                  onToggleHistory();
                }
              }}
              className="flex items-center gap-1 min-w-0 text-sm font-medium text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors"
              aria-expanded={switcherOpen}
              aria-haspopup="listbox"
            >
              <span className="truncate max-w-[180px]">{activeTitle === '(empty session)' ? (t.hints?.newChat ?? 'New chat') : activeTitle}</span>
              <ChevronDown size={12} className={`shrink-0 text-muted-foreground transition-transform duration-150 ${switcherOpen ? 'rotate-180' : ''}`} />
            </button>
          ) : activeTitle ? (
            <span className="text-sm font-medium text-muted-foreground/60 truncate max-w-[180px]">
              {activeTitle === '(empty session)' ? (t.hints?.newChat ?? 'New chat') : activeTitle}
            </span>
          ) : (
            /* Placeholder while sessions load — avoids flash of "MindOS Agent" text */
            <span className="text-sm font-medium text-muted-foreground/40">
              {t.hints?.newChat ?? 'New chat'}
            </span>
          )}
        </div>
      )}
      {hideTitle && <div />}
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleHistory(); }} aria-pressed={showHistory} className={`p-2 rounded-lg transition-colors ${showHistory ? 'bg-[var(--amber)]/10 text-[var(--amber)]' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title={t.hints.sessionHistory}>
          <History size={iconSize} />
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onReset(); }} disabled={isLoading} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title={t.hints.newSession}>
          <SquarePen size={iconSize} />
        </button>
        {onMaximize && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={maximized ? t.hints.restorePanel : t.hints.maximizePanel}>
            {maximized ? <Minimize2 size={iconSize} /> : <Maximize2 size={iconSize} />}
          </button>
        )}
        {onModeSwitch && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onModeSwitch(); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={askMode === 'popup' ? t.hints.dockToSide : t.hints.openAsPopup}>
            {askMode === 'popup' ? <PanelRight size={iconSize} /> : <AppWindow size={iconSize} />}
          </button>
        )}
        {onClose && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t.hints.closePanel} aria-label="Close">
            <X size={iconSize} />
          </button>
        )}
      </div>
      {typeof document !== 'undefined' && switcherDropdown}
    </div>
  );
});
