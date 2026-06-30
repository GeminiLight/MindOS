'use client';

import { Loader2, Link2, MessageSquare, Pin } from 'lucide-react';
import type { RefObject } from 'react';
import type { ChatSession } from '@/lib/types';
import type { RuntimeSessionSummary } from '@/lib/ask-agent';
import { buildChatSessionListEntry, chatSessionPreview } from '@/lib/session-list-entry';
import { cn } from '@/lib/utils';
import { SessionRowActions } from '@/components/shared/SessionRowActions';

type SessionHistoryRowCopy = {
  historyMsgs?: (count: number) => string;
  pinSession?: string;
  unpinSession?: string;
  renameSession?: string;
  forkSession?: string;
  archiveSession?: string;
  sessionRunningIndicator?: string;
  sessionUnreadIndicator?: string;
};

export function sessionHistoryPreview(session: ChatSession): string {
  return chatSessionPreview(session);
}

export function SessionHistoryRow({
  session,
  title,
  preview,
  runtimeSummary,
  isActive = false,
  isRunning = false,
  isUnread = false,
  editing = false,
  editValue = '',
  onEditValueChange,
  inputRef,
  onLoad,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onArchive,
  onFork,
  onTogglePin,
  ask,
  canDelete = true,
  showActions = true,
  showUpdatedAt = true,
  className,
  role,
  'aria-selected': ariaSelected,
}: {
  session: ChatSession;
  title?: string;
  preview?: string;
  runtimeSummary?: RuntimeSessionSummary;
  isActive?: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  editing?: boolean;
  editValue?: string;
  onEditValueChange?: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  onLoad?: () => void;
  onStartRename?: () => void;
  onCommitRename?: () => void;
  onCancelRename?: () => void;
  onArchive?: () => void;
  onFork?: () => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
  ask?: SessionHistoryRowCopy;
  canDelete?: boolean;
  showActions?: boolean;
  showUpdatedAt?: boolean;
  className?: string;
  role?: string;
  'aria-selected'?: boolean;
}) {
  const entry = buildChatSessionListEntry(session, { title, preview, runtimeSummary });
  const updatedAtLabel = showUpdatedAt ? entry.updatedAtLabel : null;
  const msgLabel = ask?.historyMsgs?.(entry.messageCount ?? 0) ?? `${entry.messageCount ?? 0} msgs`;
  const archiveHandler = onArchive ?? onDelete;
  const statusIndicator = !editing && isRunning ? (
    <span
      data-testid="session-running-indicator"
      title={ask?.sessionRunningIndicator}
      aria-label={ask?.sessionRunningIndicator}
      className="inline-flex text-[var(--amber)]"
    >
      <Loader2 size={11} className="animate-spin" />
    </span>
  ) : !editing && isUnread ? (
    <span
      data-testid="session-unread-indicator"
      title={ask?.sessionUnreadIndicator}
      aria-label={ask?.sessionUnreadIndicator}
      className="h-1.5 w-1.5 rounded-full bg-[var(--amber)]"
    />
  ) : !editing && session.pinned ? (
    <Pin size={10} className="-rotate-45 text-[var(--amber)]/70" />
  ) : null;
  const hasActions = Boolean(showActions && (
    onTogglePin
    || onStartRename
    || onFork
    || (canDelete && archiveHandler)
  ));
  const hasDefaultTrailingChrome = !editing && Boolean(updatedAtLabel || statusIndicator);
  const titleTrailingInsetClass = !editing
    ? updatedAtLabel
      ? statusIndicator
        ? 'pr-16'
        : 'pr-14'
      : statusIndicator
        ? 'pr-6'
        : undefined
    : undefined;

  return (
    <div
      data-session-history-row
      role={role}
      aria-selected={ariaSelected}
      className={cn(
        'group relative cursor-pointer rounded-md border transition-colors focus-within:bg-muted/55',
        isActive
          ? 'border-[var(--amber)]/15 bg-[var(--amber)]/8'
          : 'border-transparent hover:bg-muted/55',
        className,
      )}
      onClick={onLoad}
    >
      {isActive && (
        <span className="absolute bottom-2 left-0 top-2 w-[2px] rounded-r-full bg-[var(--amber)]" />
      )}

      <div className="px-3 py-1.5">
        <div className="relative flex min-w-0 items-center gap-1.5">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={event => onEditValueChange?.(event.target.value)}
              onBlur={onCommitRename}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); onCommitRename?.(); }
                if (event.key === 'Escape') { event.preventDefault(); onCancelRename?.(); }
              }}
              onClick={event => event.stopPropagation()}
              className="min-w-0 flex-1 border-b border-[var(--amber)] bg-transparent text-xs font-medium text-foreground outline-none"
              placeholder="Session name..."
            />
          ) : (
            <span className={cn('min-w-0 flex-1 truncate text-xs font-medium text-foreground', titleTrailingInsetClass)}>
              {entry.title}
            </span>
          )}
          {hasDefaultTrailingChrome && (
            <span
              data-session-row-time
              className={cn(
                'pointer-events-none absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 text-2xs tabular-nums text-muted-foreground/40 transition-opacity duration-100',
                hasActions && 'group-hover:opacity-0 group-focus-within:opacity-0',
              )}
            >
              {statusIndicator && (
                <span className="inline-flex shrink-0 items-center">
                  {statusIndicator}
                </span>
              )}
              {updatedAtLabel && (
                <span className="shrink-0">
                  {updatedAtLabel}
                </span>
              )}
            </span>
          )}
          {!editing && hasActions && (
            <span
              data-session-row-actions
              className="pointer-events-none absolute right-0 top-1/2 z-10 inline-flex -translate-y-1/2 items-center justify-end rounded-md bg-background/90 pl-1 opacity-0 backdrop-blur-sm transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            >
              <SessionRowActions
                pinned={session.pinned}
                onTogglePin={onTogglePin}
                onRename={onStartRename}
                onFork={onFork}
                onArchive={canDelete ? archiveHandler : undefined}
                labels={{
                  pin: ask?.pinSession ?? 'Pin',
                  unpin: ask?.unpinSession ?? 'Unpin',
                  rename: ask?.renameSession ?? 'Rename',
                  fork: ask?.forkSession ?? 'Fork',
                  archive: ask?.archiveSession ?? 'Archive',
                }}
              />
            </span>
          )}
        </div>

        {!editing && (
          <div
            data-session-row-meta
            className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/45 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
            title={entry.metadataTitle}
          >
            {entry.runtimeLabel && (
              <>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <Link2 size={9} className="text-[var(--amber)]/70" />
                  {entry.runtimeLabel}
                </span>
                <span className="shrink-0 text-muted-foreground/25">·</span>
              </>
            )}
            {entry.status && (
              <>
                <span className="shrink-0">{entry.status}</span>
                <span className="shrink-0 text-muted-foreground/25">·</span>
              </>
            )}
            {entry.compactRuntimePath && (
              <>
                <span className="truncate font-mono">{entry.compactRuntimePath}</span>
                <span className="shrink-0 text-muted-foreground/25">·</span>
              </>
            )}
            {entry.compactSessionId && (
              <>
                <span className="min-w-0 max-w-[8.5rem] truncate font-mono">{entry.compactSessionId}</span>
                <span className="shrink-0 text-muted-foreground/25">·</span>
              </>
            )}
            <span className="inline-flex shrink-0 items-center gap-1">
              <MessageSquare size={9} />
              {msgLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
