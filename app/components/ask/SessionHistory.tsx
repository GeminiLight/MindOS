'use client';

import { Trash2 } from 'lucide-react';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';

interface SessionHistoryProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function SessionHistory({ sessions, activeSessionId, onLoad, onDelete }: SessionHistoryProps) {
  return (
    <div className="border-b border-border px-4 py-2.5 max-h-[190px] overflow-y-auto">
      <div className="text-[11px] text-muted-foreground mb-2">Session History</div>
      <div className="flex flex-col gap-1.5">
        {sessions.length === 0 && (
          <div className="text-xs text-muted-foreground/70">No saved sessions.</div>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onLoad(s.id)}
              className={`flex-1 text-left px-2 py-1.5 rounded text-xs transition-colors ${
                activeSessionId === s.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <div className="truncate">{sessionTitle(s)}</div>
              <div className="text-[10px] opacity-60">{new Date(s.updatedAt).toLocaleString()}</div>
            </button>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              className="p-1 rounded text-muted-foreground hover:text-error hover:bg-muted"
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
