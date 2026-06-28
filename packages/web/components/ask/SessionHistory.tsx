'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import { useRunSummary } from '@/lib/agent-run-store';
import { SessionHistoryRow } from './SessionHistoryRow';

interface SessionHistoryProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onFork?: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onClearAll: () => void;
  labels: {
    title: string;
    clearAll: string;
    confirmClear: string;
    noSessions: string;
    pin?: string;
    unpin?: string;
    rename: string;
    fork?: string;
    archive?: string;
    running?: string;
    unread?: string;
  };
}

export default function SessionHistory({ sessions, activeSessionId, onLoad, onDelete, onFork, onRename, onTogglePin, onClearAll, labels }: SessionHistoryProps) {
  // Run/unread state lives in agent-run-store; the summary snapshot only changes
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
            <SessionHistoryRow
              key={s.id}
              session={s}
              isActive={isActive}
              isRunning={isRunning}
              isUnread={isUnread}
              editing={editingId === s.id}
              editValue={editValue}
              onEditValueChange={setEditValue}
              inputRef={inputRef}
              onLoad={() => onLoad(s.id)}
              onStartRename={() => startRename(s)}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              onArchive={() => onDelete(s.id)}
              onFork={onFork ? () => onFork(s.id) : undefined}
              onTogglePin={() => onTogglePin(s.id)}
              ask={{
                pinSession: labels.pin ?? 'Pin',
                unpinSession: labels.unpin ?? 'Unpin',
                renameSession: labels.rename,
                forkSession: labels.fork ?? 'Fork',
                archiveSession: labels.archive ?? 'Archive',
                sessionRunningIndicator: labels.running,
                sessionUnreadIndicator: labels.unread,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
