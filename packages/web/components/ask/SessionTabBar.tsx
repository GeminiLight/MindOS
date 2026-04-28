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
  const hasMore = sessions.length > maxTabs;

  if (visibleSessions.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border/60 shrink-0 bg-background/50" role="tablist">
      <div className="flex flex-1 min-w-0">
        {visibleSessions.map((s) => {
          const isActive = s.id === activeSessionId;
          const title = sessionTitle(s);
          return (
            <div key={s.id} className="group relative flex items-center min-w-0 max-w-[160px]">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onLoad(s.id)}
                className={`flex-1 min-w-0 px-3 py-2.5 text-xs transition-colors truncate
                  ${isActive
                    ? 'text-foreground border-b-2 border-[var(--amber)] bg-card font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border-b-2 border-transparent'
                  }`}
                title={title}
              >
                {title === '(empty session)' ? t.hints.newChat : title}
              </button>
              {visibleSessions.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 shrink-0 p-0.5 rounded opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-muted hover:text-error transition-opacity"
                  title={t.hints.closeSession}
                  aria-label={`${t.hints.closeSession}: ${title}`}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
        {hasMore && (
          <span className="flex items-center px-2 text-2xs text-muted-foreground/60">
            +{sessions.length - maxTabs}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onNew}
        className="shrink-0 p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-lg"
        title={t.hints.newChat}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
