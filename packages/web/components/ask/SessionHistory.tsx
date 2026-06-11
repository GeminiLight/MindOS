'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2, Pencil, Pin, PinOff, Loader2 } from 'lucide-react';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import { useRunSummary } from '@/lib/ask-run-store';

interface SessionHistoryProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onClearAll: () => void;
  labels: {
    title: string;
    clearAll: string;
    confirmClear: string;
    noSessions: string;
    rename: string;
    running?: string;
    unread?: string;
  };
}

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

export default function SessionHistory({ sessions, activeSessionId, onLoad, onDelete, onRename, onTogglePin, onClearAll, labels }: SessionHistoryProps) {
  // Run/unread state lives in ask-run-store; the summary snapshot only changes
  // on run start/end or unread membership, so streaming chunks never re-render
  // this list (spec-chat-session-concurrency.md performance acceptance).
  const runSummary = useRunSummary();
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current); }, []);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleClearAll = () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setConfirmClearAll(false), 3000);
      return;
    }
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    onClearAll();
    setConfirmClearAll(false);
  };

  const startRename = useCallback((s: ChatSession) => {
    setEditingId(s.id);
    setEditValue(sessionTitle(s));
  }, []);

  const commitRename = useCallback(() => {
    if (editingId) {
      onRename(editingId, editValue);
      setEditingId(null);
    }
  }, [editingId, editValue, onRename]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  return (
    <div className="border-b border-border/40 px-4 py-3 max-h-[220px] overflow-y-auto">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-medium text-muted-foreground">{labels.title}</span>
        {sessions.length > 1 && (
          <button
            type="button"
            onClick={handleClearAll}
            className={`text-2xs px-2 py-0.5 rounded-md transition-colors ${
              confirmClearAll
                ? 'bg-error/10 text-error font-medium'
                : 'text-muted-foreground/60 hover:text-error hover:bg-muted'
            }`}
          >
            {confirmClearAll ? labels.confirmClear : labels.clearAll}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {sessions.length === 0 && (
          <div className="text-xs text-muted-foreground/50 py-2 text-center">{labels.noSessions}</div>
        )}
        {sessions.map((s) => {
          const isActive = activeSessionId === s.id;
          const isRunning = runSummary.running.has(s.id);
          const isUnread = !isRunning && runSummary.unread.has(s.id);
          return (
            <div key={s.id} className="group flex items-center gap-0.5">
              {s.pinned && <Pin size={10} className="shrink-0 text-[var(--amber)]/50 -rotate-45 ml-1" />}
              <button
                type="button"
                onClick={() => onLoad(s.id)}
                onDoubleClick={() => startRename(s)}
                className={`flex-1 text-left px-2.5 py-2 rounded-lg text-xs transition-colors min-w-0 ${
                  isActive
                    ? 'bg-[var(--amber)]/8 text-foreground border border-[var(--amber)]/15'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent'
                }`}
              >
                {editingId === s.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-transparent border-b border-[var(--amber)] outline-none text-xs text-foreground"
                  />
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="truncate font-medium">{sessionTitle(s)}</div>
                    {isRunning && (
                      <span
                        data-testid="session-running-indicator"
                        title={labels.running}
                        aria-label={labels.running}
                        className="inline-flex shrink-0 text-[var(--amber)]"
                      >
                        <Loader2 size={11} className="animate-spin" />
                      </span>
                    )}
                    {isUnread && (
                      <span
                        data-testid="session-unread-indicator"
                        title={labels.unread}
                        aria-label={labels.unread}
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber)]"
                      />
                    )}
                  </div>
                )}
                {editingId !== s.id && (
                  <div className="text-2xs text-muted-foreground/50 mt-0.5">{formatRelativeTime(new Date(s.updatedAt))}</div>
                )}
              </button>
              <button
                type="button"
                onClick={() => onTogglePin(s.id)}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg opacity-0 transition-colors duration-75 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation ${s.pinned ? 'text-[var(--amber)] hover:bg-muted/60 hover:text-muted-foreground' : 'text-muted-foreground hover:bg-[var(--amber)]/10 hover:text-[var(--amber)]'}`}
                title={s.pinned ? 'Unpin' : 'Pin'}
              >
                {s.pinned ? <PinOff size={11} /> : <Pin size={11} />}
              </button>
              <button
                type="button"
                onClick={() => startRename(s)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-colors duration-75 hover:text-foreground hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
                title={labels.rename}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-colors duration-75 hover:text-error hover:bg-error/5 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
                title="Delete session"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
