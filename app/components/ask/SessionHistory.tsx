'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';

interface SessionHistoryProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClearAll: () => void;
  labels: { title: string; clearAll: string; confirmClear: string; noSessions: string; rename: string };
}

export default function SessionHistory({ sessions, activeSessionId, onLoad, onDelete, onRename, onClearAll, labels }: SessionHistoryProps) {
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
    <div className="border-b border-border px-4 py-2.5 max-h-[190px] overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{labels.title}</span>
        {sessions.length > 1 && (
          <button
            type="button"
            onClick={handleClearAll}
            className={`text-2xs px-1.5 py-0.5 rounded transition-colors ${
              confirmClearAll
                ? 'bg-error/10 text-error font-medium'
                : 'text-muted-foreground hover:text-error hover:bg-muted'
            }`}
          >
            {confirmClearAll ? labels.confirmClear : labels.clearAll}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {sessions.length === 0 && (
          <div className="text-xs text-muted-foreground/70">{labels.noSessions}</div>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => onLoad(s.id)}
              onDoubleClick={() => startRename(s)}
              className={`flex-1 text-left px-2 py-1.5 rounded text-xs transition-colors min-w-0 ${
                activeSessionId === s.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
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
                <div className="truncate">{sessionTitle(s)}</div>
              )}
              {editingId !== s.id && (
                <div className="text-2xs opacity-60">{new Date(s.updatedAt).toLocaleString()}</div>
              )}
            </button>
            <button
              type="button"
              onClick={() => startRename(s)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
              title={labels.rename}
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              className="p-1 rounded text-muted-foreground hover:text-error hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete session"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
