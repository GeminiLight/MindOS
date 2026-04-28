'use client';

import { useState, useRef, useEffect, useCallback, useMemo, useTransition } from 'react';
import { Search, Trash2, Pencil, Pin, PinOff, FolderInput, MessageSquare, SquarePen, X } from 'lucide-react';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import { useLocale } from '@/lib/stores/locale-store';

interface SessionHistoryPanelProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
  onNewChat: () => void;
}

// ── Helpers ──

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getTimeGroup(ts: number): 'pinned' | 'today' | 'yesterday' | 'week' | 'older' {
  const now = new Date();
  const date = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - now.getDay() * 86400000;
  if (ts >= startOfToday) return 'today';
  if (ts >= startOfYesterday) return 'yesterday';
  if (ts >= startOfWeek) return 'week';
  return 'older';
}

function sessionPreview(s: ChatSession): string {
  const firstUser = s.messages.find(m => m.role === 'user');
  if (!firstUser) return '';
  const text = firstUser.content.replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

// ── Main Component ──

export default function SessionHistoryPanel({
  sessions, activeSessionId,
  onLoad, onDelete, onRename, onTogglePin, onClearAll,
  onClose, onNewChat,
}: SessionHistoryPanelProps) {
  const { t } = useLocale();
  const [isPending, startTransition] = useTransition();
  const ask = t.ask;
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Focus rename input
  useEffect(() => { if (editingId) setTimeout(() => inputRef.current?.focus(), 0); }, [editingId]);

  // Clear timer cleanup
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

  // Filter sessions by search query
  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(s => {
      const title = sessionTitle(s).toLowerCase();
      if (title.includes(q)) return true;
      return s.messages.some(m => m.content.toLowerCase().includes(q));
    });
  }, [sessions, query]);

  // Group sessions by time
  const groups = useMemo(() => {
    const pinned: ChatSession[] = [];
    const today: ChatSession[] = [];
    const yesterday: ChatSession[] = [];
    const week: ChatSession[] = [];
    const older: ChatSession[] = [];

    for (const s of filtered) {
      if (s.pinned) { pinned.push(s); continue; }
      const group = getTimeGroup(s.updatedAt);
      if (group === 'today') today.push(s);
      else if (group === 'yesterday') yesterday.push(s);
      else if (group === 'week') week.push(s);
      else older.push(s);
    }
    return { pinned, today, yesterday, week, older };
  }, [filtered]);

  const pinnedCount = sessions.filter(s => s.pinned).length;
  // Only count sessions with messages (non-empty)
  const totalCount = sessions.filter(s => s.messages.length > 0).length;

  const handleLoad = useCallback((id: string) => {
    startTransition(() => {
      onLoad(id);
      onClose();
    });
  }, [onLoad, onClose]);

  const handleNewChat = useCallback(() => {
    startTransition(() => {
      onNewChat();
      onClose();
    });
  }, [onNewChat, onClose]);

  const startRename = useCallback((s: ChatSession) => {
    setEditingId(s.id);
    setEditValue(sessionTitle(s));
  }, []);

  const commitRename = useCallback(() => {
    startTransition(() => {
      if (editingId && editValue.trim()) {
        onRename(editingId, editValue.trim());
      }
      setEditingId(null);
    });
  }, [editingId, editValue, onRename]);

  const handleClearAll = useCallback(() => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setConfirmClearAll(false), 3000);
      return;
    }
    startTransition(() => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      onClearAll();
      setConfirmClearAll(false);
    });
  }, [confirmClearAll, onClearAll]);

  // Keyboard: Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editingId) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, editingId]);

  const renderGroup = (label: string, items: ChatSession[]) => {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div className="text-2xs font-medium text-muted-foreground/50 uppercase tracking-wider px-1 py-2">
          {label}
        </div>
        <div className="flex flex-col gap-1">
          {items.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              editing={editingId === s.id}
              editValue={editValue}
              onEditValueChange={setEditValue}
              inputRef={inputRef}
              onLoad={() => handleLoad(s.id)}
              onStartRename={() => startRename(s)}
              onCommitRename={commitRename}
              onCancelRename={() => setEditingId(null)}
              onDelete={() => onDelete(s.id)}
              onTogglePin={() => onTogglePin(s.id)}
              ask={ask}
            />
          ))}
        </div>
      </div>
    );
  };

  const hasResults = filtered.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-in fade-in-0 duration-150">
      {/* Search bar */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={ask?.historySearch ?? 'Search conversations...'}
            className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/40 outline-none focus-visible:border-[var(--amber)]/40 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground/40 hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between px-4 pb-2 shrink-0">
        <span className="text-2xs text-muted-foreground/60">
          {ask?.historyStats?.(totalCount) ?? `${totalCount} conversations`}
          {pinnedCount > 0 && <> &middot; {pinnedCount} {ask?.historyPinned ?? 'pinned'}</>}
        </span>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center gap-1 text-2xs text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors"
        >
          <SquarePen size={11} />
          <span>{t.hints?.newChat ?? 'New chat'}</span>
        </button>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3">
        {hasResults ? (
          <div className="flex flex-col gap-1">
            {renderGroup(ask?.historyPinned ?? 'Pinned', groups.pinned)}
            {renderGroup(ask?.historyToday ?? 'Today', groups.today)}
            {renderGroup(ask?.historyYesterday ?? 'Yesterday', groups.yesterday)}
            {renderGroup(ask?.historyThisWeek ?? 'This week', groups.week)}
            {renderGroup(ask?.historyOlder ?? 'Older', groups.older)}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare size={32} className="text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground/60">
              {query ? 'No matching conversations' : (ask?.historyEmpty ?? 'No conversations yet')}
            </p>
            {!query && (
              <p className="text-2xs text-muted-foreground/40 mt-1">
                {ask?.historyEmptyHint ?? 'Start a new chat to begin'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 shrink-0">
          <button
            type="button"
            onClick={handleClearAll}
            className={`text-2xs px-2 py-0.5 rounded-md transition-colors ${
              confirmClearAll
                ? 'bg-error/10 text-error font-medium'
                : 'text-muted-foreground/50 hover:text-error hover:bg-muted'
            }`}
          >
            <span className="flex items-center gap-1">
              <Trash2 size={10} />
              {confirmClearAll ? (ask?.confirmClear ?? 'Confirm clear?') : (ask?.clearAll ?? 'Clear all')}
            </span>
          </button>
          <span className="text-2xs text-muted-foreground/40 tabular-nums">
            {ask?.historyCapacity?.(totalCount) ?? `${totalCount} of 30`}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Session Card ──

function SessionCard({
  session: s, isActive, editing, editValue, onEditValueChange, inputRef,
  onLoad, onStartRename, onCommitRename, onCancelRename, onDelete, onTogglePin,
  ask,
}: {
  session: ChatSession;
  isActive: boolean;
  editing: boolean;
  editValue: string;
  onEditValueChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onLoad: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  ask: Record<string, any>;
}) {
  const title = sessionTitle(s);
  const preview = sessionPreview(s);
  const msgCount = s.messages.length;

  return (
    <div
      className={`group relative rounded-lg transition-colors cursor-pointer ${
        isActive
          ? 'bg-[var(--amber)]/8 border border-[var(--amber)]/15'
          : 'hover:bg-muted/60 border border-transparent'
      }`}
      onClick={onLoad}
    >
      {/* Active indicator */}
      {isActive && (
        <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full bg-[var(--amber)]" />
      )}

      <div className="px-3 py-2.5">
        {/* Title row */}
        <div className="flex items-center gap-1.5 mb-0.5">
          {s.pinned && <Pin size={10} className="shrink-0 text-[var(--amber)]/60 -rotate-45" />}
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onCommitRename(); }
                if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
              }}
              onClick={e => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent border-b border-[var(--amber)] outline-none text-xs font-medium text-foreground"
            />
          ) : (
            <span className="flex-1 min-w-0 text-xs font-medium text-foreground truncate">
              {title}
            </span>
          )}
          <span className="text-2xs text-muted-foreground/40 shrink-0 tabular-nums">
            {formatRelativeTime(new Date(s.updatedAt))}
          </span>
        </div>

        {/* Preview */}
        {!editing && preview && (
          <p className="text-2xs text-muted-foreground/50 truncate mt-0.5 pl-0.5">
            {preview}
          </p>
        )}

        {/* Meta row */}
        {!editing && (
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-2xs text-muted-foreground/40 flex items-center gap-1">
              <MessageSquare size={9} />
              {ask?.historyMsgs?.(msgCount) ?? `${msgCount} msgs`}
            </span>

            {/* Action buttons — visible on hover */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={onTogglePin}
                className={`p-1 rounded-md transition-colors ${s.pinned ? 'text-[var(--amber)] hover:text-muted-foreground' : 'text-muted-foreground/40 hover:text-[var(--amber)]'}`}
                title={s.pinned ? 'Unpin' : 'Pin'}
              >
                {s.pinned ? <PinOff size={11} /> : <Pin size={11} />}
              </button>
              <button
                type="button"
                onClick={onStartRename}
                className="p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
                title={ask?.renameSession ?? 'Rename'}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="p-1 rounded-md text-muted-foreground/40 hover:text-error hover:bg-error/5 transition-colors"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
