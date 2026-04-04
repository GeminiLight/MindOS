'use client';

import { Plus, X } from 'lucide-react';
import type { ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import { useLocale } from '@/lib/stores/locale-store';

interface SessionTabBarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  maxTabs?: number;
}

export default function SessionTabBar({
  sessions, activeSessionId, onLoad, onDelete, onNew, maxTabs = 3,
}: SessionTabBarProps) {
  const { t } = useLocale();
  const visibleSessions = sessions.slice(0, maxTabs);

  if (visibleSessions.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border shrink-0 bg-background/50">
      <div className="flex flex-1 min-w-0">
        {visibleSessions.map((s) => {
          const isActive = s.id === activeSessionId;
          const title = sessionTitle(s);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onLoad(s.id)}
              className={`group relative flex items-center gap-1 min-w-0 max-w-[160px] px-3 py-2 text-xs transition-colors
                ${isActive
                  ? 'text-foreground border-b-2 border-[var(--amber)] bg-card'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border-b-2 border-transparent'
                }`}
              title={title}
            >
              <span className="truncate">{title === '(empty session)' ? t.hints.newChat : title}</span>
              {visibleSessions.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete(s.id); } }}
                  className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-error transition-opacity"
                  title={t.hints.closeSession}
                >
                  <X size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onNew}
        className="shrink-0 p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        title={t.hints.newChat}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
