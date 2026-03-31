'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, MessageSquare, AlertCircle } from 'lucide-react';
import type { ContentChangeEvent } from '@/lib/fs';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/LocaleContext';

interface EchoStats {
  fileCount: number;
  unreadChanges: number;
  sessionCount: number;
}

export default function EchoSidebarStats() {
  const [stats, setStats] = useState<EchoStats | null>(null);
  const [recentEvents, setRecentEvents] = useState<ContentChangeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLocale();

  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true);
        const [monitoring, changes, sessions] = await Promise.all([
          apiFetch<any>('/api/monitoring'),
          apiFetch<any>('/api/changes?op=list&limit=3'),
          apiFetch<any>('/api/ask-sessions'),
        ]);

        setStats({
          fileCount: monitoring?.knowledgeBase?.fileCount ?? 0,
          unreadChanges: changes?.events?.length ?? 0,
          sessionCount: Array.isArray(sessions) ? sessions.length : 0,
        });

        setRecentEvents((changes?.events ?? []).slice(0, 3));
      } catch (err) {
        console.warn('[EchoSidebarStats] Failed to load stats:', err);
        setStats({ fileCount: 0, unreadChanges: 0, sessionCount: 0 });
        setRecentEvents([]);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
    const interval = setInterval(loadStats, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading || !stats) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <div className="h-2 w-20 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3 border-t border-border">
      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center p-1.5 rounded bg-muted/40 hover:bg-muted/60 transition-colors cursor-default">
          <div className="text-sm font-semibold text-foreground">{stats.fileCount}</div>
          <div className="text-xs text-muted-foreground truncate">Files</div>
        </div>
        <div className="flex flex-col items-center p-1.5 rounded bg-muted/40 hover:bg-muted/60 transition-colors cursor-default">
          <div className="text-sm font-semibold text-foreground">{stats.unreadChanges}</div>
          <div className="text-xs text-muted-foreground truncate">Changes</div>
        </div>
        <div className="flex flex-col items-center p-1.5 rounded bg-muted/40 hover:bg-muted/60 transition-colors cursor-default">
          <div className="text-sm font-semibold text-foreground">{stats.sessionCount}</div>
          <div className="text-xs text-muted-foreground truncate">Chats</div>
        </div>
      </div>

      {/* Recent Activity */}
      {recentEvents.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground px-0.5">Recent</div>
          {recentEvents.map((evt) => {
            const relTime = formatRelativeTime(evt.ts);
            const iconType = getIconForOp(evt.op);
            const fileName = evt.path.split('/').pop() || evt.path;
            return (
              <div key={evt.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/40 transition-colors text-xs">
                <span className="text-muted-foreground shrink-0 mt-0.5">{iconType}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate font-medium" title={fileName}>{fileName}</p>
                  <p className="text-muted-foreground text-2xs">{relTime}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getIconForOp(op: string): React.ReactNode {
  switch (op) {
    case 'create':
      return <TrendingUp size={12} className="text-success" />;
    case 'write':
    case 'append':
      return <AlertCircle size={12} className="text-foreground" />;
    case 'delete':
      return <AlertCircle size={12} className="text-destructive" />;
    case 'rename':
    case 'move':
      return <MessageSquare size={12} className="text-muted-foreground" />;
    default:
      return <AlertCircle size={12} className="text-muted-foreground" />;
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return 'recently';
  }
}
