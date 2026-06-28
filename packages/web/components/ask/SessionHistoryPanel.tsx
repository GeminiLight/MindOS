'use client';

import { useState, useRef, useEffect, useCallback, useMemo, useTransition, useDeferredValue, memo, type ReactNode } from 'react';
import { AlertCircle, Loader2, RefreshCw, Search, Link2, MessageSquare, SquarePen, X } from 'lucide-react';
import type { AgentRuntimeIdentity, ChatSession } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import { useRunSummary } from '@/lib/agent-run-store';
import { useLocale } from '@/lib/stores/locale-store';
import { SessionRowActions } from '@/components/shared/SessionRowActions';
import {
  type RuntimeSessionEntry,
} from '@/lib/runtime-session-entry';
import {
  buildChatSessionListEntry,
  buildRuntimeSessionListEntry,
  pluralizeSessionListCount,
  sessionListEntryMatchesSearch,
  type ChatSessionListEntry,
  type RuntimeSessionListEntry,
} from '@/lib/session-list-entry';
import { SessionHistoryRow } from './SessionHistoryRow';

interface SessionHistoryPanelProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  selectedAgentRuntime?: AgentRuntimeIdentity | null;
  runtimeSessions?: RuntimeSessionEntry[];
  runtimeSessionsLoading?: boolean;
  runtimeSessionsError?: string | null;
  runtimeSessionActionId?: string | null;
  runtimeSessionsSupported?: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onForkSession?: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
  onNewChat: () => void;
  onRefreshRuntimeSessions?: () => void;
  onAttachRuntimeSession?: (entry: RuntimeSessionEntry) => void;
  onForkRuntimeSession?: (entry: RuntimeSessionEntry) => void;
  onArchiveRuntimeSession?: (entry: RuntimeSessionEntry) => void;
}

type HistoryRow =
  | { kind: 'session'; id: string; session: ChatSession; listEntry: ChatSessionListEntry; updatedAt: number; pinned: boolean }
  | { kind: 'runtime-session'; id: string; entry: RuntimeSessionEntry; listEntry: RuntimeSessionListEntry; updatedAt: number; pinned: false };

function compareHistoryRows(a: HistoryRow, b: HistoryRow): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id.localeCompare(b.id);
}

// ── Main Component ──

function SessionHistoryPanel({
  sessions, activeSessionId,
  selectedAgentRuntime,
  runtimeSessions = [],
  runtimeSessionsLoading = false,
  runtimeSessionsError = null,
  runtimeSessionActionId = null,
  runtimeSessionsSupported = false,
  onLoad, onDelete, onRename, onTogglePin,
  onForkSession,
  onClose, onNewChat,
  onRefreshRuntimeSessions, onAttachRuntimeSession, onForkRuntimeSession, onArchiveRuntimeSession,
}: SessionHistoryPanelProps) {
  const { t } = useLocale();
  const [, startTransition] = useTransition();
  const ask = t.ask;
  // Run/unread state comes from agent-run-store's summary snapshot, which only
  // changes on run start/end or unread membership — streaming chunks never
  // re-render the list (spec-chat-session-concurrency.md performance bar).
  const runSummary = useRunSummary();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const deferredNormalizedQuery = useDeferredValue(normalizedQuery);
  const searchQuery = normalizedQuery ? deferredNormalizedQuery : '';

  // Focus search on mount
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Focus rename input
  useEffect(() => { if (editingId) setTimeout(() => inputRef.current?.focus(), 0); }, [editingId]);

  const sessionEntryById = useMemo(() => {
    const index = new Map<string, ChatSessionListEntry>();
    for (const session of sessions) {
      index.set(session.id, buildChatSessionListEntry(session));
    }
    return index;
  }, [sessions]);

  const runtimeSessionEntryById = useMemo(() => {
    const index = new Map<string, RuntimeSessionListEntry>();
    for (const entry of runtimeSessions) {
      index.set(entry.id, buildRuntimeSessionListEntry(entry));
    }
    return index;
  }, [runtimeSessions]);

  // Filter sessions by search query
  const filtered = useMemo(() => {
    if (!searchQuery) return sessions;
    return sessions.filter((session) => {
      const entry = sessionEntryById.get(session.id);
      return entry ? sessionListEntryMatchesSearch(entry, searchQuery) : false;
    });
  }, [sessions, searchQuery, sessionEntryById]);

  const filteredRuntimeSessions = useMemo(() => {
    if (!runtimeSessionsSupported) return [];
    if (!searchQuery) return runtimeSessions;
    return runtimeSessions.filter((entry) => {
      const listEntry = runtimeSessionEntryById.get(entry.id);
      return listEntry ? sessionListEntryMatchesSearch(listEntry, searchQuery) : false;
    });
  }, [runtimeSessionEntryById, runtimeSessions, runtimeSessionsSupported, searchQuery]);

  const pinnedCount = useMemo(() => sessions.filter(s => s.pinned).length, [sessions]);
  const totalCount = useMemo(() => {
    let count = 0;
    for (const session of sessions) {
      if (sessionEntryById.get(session.id)?.hasListContent) count += 1;
    }
    return count;
  }, [sessions, sessionEntryById]);
  const showRuntimeSessions = Boolean(selectedAgentRuntime && runtimeSessionsSupported);
  const historyRows = useMemo<HistoryRow[]>(() => {
    const rows: HistoryRow[] = filtered.map((session) => {
      const listEntry = sessionEntryById.get(session.id) ?? buildChatSessionListEntry(session);
      return {
        kind: 'session',
        id: session.id,
        session,
        listEntry,
        updatedAt: listEntry.updatedAtMs ?? 0,
        pinned: listEntry.pinned,
      };
    });

    if (showRuntimeSessions) {
      for (const entry of filteredRuntimeSessions) {
        const listEntry = runtimeSessionEntryById.get(entry.id) ?? buildRuntimeSessionListEntry(entry);
        rows.push({
          kind: 'runtime-session',
          id: entry.id,
          entry,
          listEntry,
          updatedAt: listEntry.updatedAtMs ?? 0,
          pinned: false,
        });
      }
    }

    rows.sort(compareHistoryRows);
    return rows;
  }, [filtered, filteredRuntimeSessions, runtimeSessionEntryById, sessionEntryById, showRuntimeSessions]);
  const totalHistoryCount = totalCount + (showRuntimeSessions ? runtimeSessions.length : 0);

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

  // Keyboard: Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editingId) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, editingId]);

  const hasAnyResults = historyRows.length > 0 || (showRuntimeSessions && (runtimeSessionsLoading || Boolean(runtimeSessionsError)));
  const statsLabel = showRuntimeSessions
    ? pluralizeSessionListCount(totalHistoryCount, 'session', 'sessions')
    : (ask?.historyStats?.(totalCount) ?? `${totalCount} conversations`);

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-in fade-in-0 duration-150">
      {/* Search bar */}
      <div className="px-4 pt-2.5 pb-1.5 shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={ask?.historySearch ?? 'Search conversations...'}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus-visible:border-[var(--amber)]/40 focus-visible:ring-2 focus-visible:ring-ring/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between px-4 pb-1.5 shrink-0">
        <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground/60">
          <span className="min-w-0 truncate">
            {statsLabel}
            {pinnedCount > 0 && <> &middot; {pinnedCount} {ask?.historyPinned ?? 'pinned'}</>}
          </span>
          {showRuntimeSessions && onRefreshRuntimeSessions && (
            <button
              type="button"
              onClick={onRefreshRuntimeSessions}
              disabled={runtimeSessionsLoading}
              className="hit-target-box inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)]"
              title="Refresh runtime sessions"
              aria-label="Refresh runtime sessions"
            >
              {runtimeSessionsLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={handleNewChat}
          className="hit-target-box inline-flex min-h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-[var(--amber)] transition-colors hover:text-[var(--amber)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SquarePen size={11} />
          <span>{t.hints?.newChat ?? 'New chat'}</span>
        </button>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3">
        {hasAnyResults ? (
          <div className="flex flex-col gap-0.5">
            {showRuntimeSessions && runtimeSessionsError && (
              <RuntimeHistoryNotice
                tone="error"
                icon={<AlertCircle size={12} className="mt-0.5 shrink-0 text-error" />}
                text={runtimeSessionsError}
              />
            )}
            {showRuntimeSessions && runtimeSessionsLoading && filteredRuntimeSessions.length === 0 && (
              <RuntimeHistoryNotice
                icon={<Loader2 size={12} className="animate-spin text-muted-foreground/50" />}
                text="Loading runtime sessions..."
              />
            )}
            {historyRows.map((row) => (
              row.kind === 'session' ? (
                <SessionHistoryRow
                  key={`session:${row.id}`}
                  session={row.session}
                  title={row.listEntry.title}
                  preview={row.listEntry.preview}
                  runtimeSummary={row.listEntry.runtimeSummary}
                  isActive={row.id === activeSessionId}
                  isRunning={runSummary.running.has(row.id)}
                  isUnread={!runSummary.running.has(row.id) && runSummary.unread.has(row.id)}
                  editing={editingId === row.id}
                  editValue={editValue}
                  onEditValueChange={setEditValue}
                  inputRef={inputRef}
                  onLoad={() => handleLoad(row.id)}
                  onStartRename={() => startRename(row.session)}
                  onCommitRename={commitRename}
                  onCancelRename={() => setEditingId(null)}
                  onArchive={() => onDelete(row.id)}
                  onFork={onForkSession ? () => {
                    onForkSession(row.id);
                    onClose();
                  } : undefined}
                  onTogglePin={() => onTogglePin(row.id)}
                  ask={ask}
                />
              ) : (
                <RuntimeSessionRow
                  key={`runtime-session:${row.id}`}
                  entry={row.entry}
                  listEntry={row.listEntry}
                  busy={runtimeSessionActionId === row.id}
                  onAttach={onAttachRuntimeSession}
                  onFork={onForkRuntimeSession}
                  onArchive={onArchiveRuntimeSession}
                />
              )
            ))}
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

    </div>
  );
}

// Memoized: ChatContent re-renders on every streamed chunk (it subscribes to the
// active session's messages), but every prop here is referentially stable during
// a stream, so memo keeps the open history panel from reconciling per chunk.
export default memo(SessionHistoryPanel);

function RuntimeHistoryNotice({
  icon,
  text,
  tone = 'muted',
}: {
  icon: ReactNode;
  text: string;
  tone?: 'muted' | 'error';
}) {
  return (
    <div
      className={`mb-0.5 flex items-start gap-2 rounded-md border px-3 py-2 text-2xs ${
        tone === 'error'
          ? 'border-border/60 bg-muted/30 text-muted-foreground'
          : 'border-border/50 text-muted-foreground/60'
      }`}
    >
      {icon}
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function RuntimeSessionRow({
  entry,
  listEntry,
  busy,
  onAttach,
  onFork,
  onArchive,
}: {
  entry: RuntimeSessionEntry;
  listEntry: RuntimeSessionListEntry;
  busy: boolean;
  onAttach?: (entry: RuntimeSessionEntry) => void;
  onFork?: (entry: RuntimeSessionEntry) => void;
  onArchive?: (entry: RuntimeSessionEntry) => void;
}) {
  const title = listEntry.title;
  const noun = listEntry.noun;
  const updatedAtLabel = listEntry.updatedAtLabel;
  const disabled = busy || !onAttach;
  const hasActions = Boolean(onFork || onArchive);
  const titleTrailingInsetClass = updatedAtLabel
    ? busy
      ? 'pr-16'
      : 'pr-14'
    : busy
      ? 'pr-6'
      : undefined;

  return (
    <div
      data-runtime-session-row
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`Open ${noun}: ${title}`}
      title={`Open this ${noun}`}
      onClick={() => {
        if (!disabled) onAttach?.(entry);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onAttach?.(entry);
        }
      }}
      className={`group cursor-pointer rounded-md border border-transparent px-3 py-1.5 transition-colors hover:bg-muted/55 focus-within:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      }`}
    >
      <div className="relative flex min-w-0 items-center gap-1.5">
        <span className={`min-w-0 flex-1 truncate text-xs font-medium text-foreground ${titleTrailingInsetClass ?? ''}`}>
          {title}
        </span>
        {(updatedAtLabel || busy) && (
          <span
            data-session-row-time
            className={`pointer-events-none absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 text-2xs tabular-nums text-muted-foreground/40 transition-opacity duration-100 ${
              hasActions ? 'group-hover:opacity-0 group-focus-within:opacity-0' : ''
            }`}
          >
            {busy && (
              <Loader2 size={11} className="shrink-0 animate-spin text-[var(--amber)]" />
            )}
            {updatedAtLabel && (
              <span className="shrink-0">
                {updatedAtLabel}
              </span>
            )}
          </span>
        )}
        {hasActions && (
          <span
            data-session-row-actions
            className="pointer-events-none absolute right-0 top-1/2 z-10 inline-flex -translate-y-1/2 items-center justify-end rounded-md bg-background/90 pl-1 opacity-0 backdrop-blur-sm transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            <SessionRowActions
              disabled={busy}
              onFork={onFork ? () => onFork(entry) : undefined}
              onArchive={onArchive ? () => onArchive(entry) : undefined}
              labels={{
                fork: `Fork ${noun}`,
                archive: `Archive ${noun}`,
              }}
            />
          </span>
        )}
      </div>
      <div
        className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/45"
        title={listEntry.metadataTitle}
      >
        <span className="inline-flex shrink-0 items-center gap-1">
          <Link2 size={9} className="text-[var(--amber)]/70" />
          {listEntry.runtimeLabel}
        </span>
        {listEntry.status && (
          <>
            <span className="shrink-0 text-muted-foreground/25">·</span>
            <span className="shrink-0">{listEntry.status}</span>
          </>
        )}
        {listEntry.compactRuntimePath && (
          <>
            <span className="shrink-0 text-muted-foreground/25">·</span>
            <span className="truncate font-mono">{listEntry.compactRuntimePath}</span>
          </>
        )}
        <span className="shrink-0 text-muted-foreground/25">·</span>
        <span className="min-w-0 max-w-[8.5rem] truncate font-mono">{listEntry.compactSessionId}</span>
        <span className="shrink-0 text-muted-foreground/25">·</span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <MessageSquare size={9} />
          {typeof listEntry.messageCount === 'number' ? pluralizeSessionListCount(listEntry.messageCount, 'msg', 'msgs') : '? msgs'}
        </span>
      </div>
    </div>
  );
}
