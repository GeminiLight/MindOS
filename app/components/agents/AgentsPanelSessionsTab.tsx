'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, Play, Trash2 } from 'lucide-react';
import type { AcpSession } from '@/lib/acp/types';

interface SessionEntry {
  id: string;
  agentId: string;
  state: string;
  cwd?: string;
  createdAt: string;
  lastActivityAt: string;
}

export default function AgentsPanelSessionsTab() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/acp/session');
      if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleClose = useCallback(async (sessionId: string) => {
    try {
      await fetch('/api/acp/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (err) {
      console.error('Failed to close session:', err);
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted rounded" />
                <div className="h-3 w-48 bg-muted rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground mb-3">{error}</p>
        <button
          onClick={fetchSessions}
          className="text-sm text-[var(--amber)] hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <History size={32} className="mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground mb-1">No active sessions</p>
        <p className="text-xs text-muted-foreground">
          Sessions appear here when you chat with ACP agents.
          <br />
          Select an agent from the Network tab and send a message to start.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
          Active Sessions ({sessions.length})
        </p>
        <button
          onClick={fetchSessions}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Refresh
        </button>
      </div>

      {sessions.map(session => (
        <div
          key={session.id}
          className="group rounded-lg border border-border bg-card hover:border-[var(--amber)]/30 transition-colors p-3.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  session.state === 'active' ? 'bg-[var(--success)]' :
                  session.state === 'error' ? 'bg-[var(--error)]' :
                  'bg-muted-foreground/40'
                }`} />
                <span className="text-sm font-medium text-foreground truncate">
                  {session.agentId}
                </span>
                <span className="text-2xs text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40">
                  {session.state}
                </span>
              </div>
              {session.cwd && (
                <p className="text-xs text-muted-foreground truncate font-mono">
                  {session.cwd}
                </p>
              )}
              <p className="text-2xs text-muted-foreground/60 mt-1">
                {formatRelativeTime(session.lastActivityAt)}
              </p>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleClose(session.id)}
                className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-[var(--error)] transition-colors"
                title="Close session"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = now - then;

  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}
