'use client';

import { useState, useRef, useEffect, useCallback, useMemo, useTransition, memo } from 'react';
import { AlertCircle, Archive, GitFork, Loader2, RefreshCw, Search, Trash2, Pencil, Pin, PinOff, Link2, MessageSquare, SquarePen, X } from 'lucide-react';
import type { AgentRuntimeIdentity, ChatSession, CodexThreadSummary } from '@/lib/types';
import { sessionTitle } from '@/hooks/useAskSession';
import { useRunSummary } from '@/lib/ask-run-store';
import { getRuntimeSessionSummary, shortRuntimeSessionId } from '@/lib/ask-agent';
import { useLocale } from '@/lib/stores/locale-store';

interface SessionHistoryPanelProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  selectedAgentRuntime?: AgentRuntimeIdentity | null;
  codexThreads?: CodexThreadSummary[];
  codexThreadsLoading?: boolean;
  codexThreadsError?: string | null;
  codexThreadActionId?: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
  onNewChat: () => void;
  onRefreshCodexThreads?: () => void;
  onAttachCodexThread?: (thread: CodexThreadSummary) => void;
  onForkCodexThread?: (thread: CodexThreadSummary) => void;
  onArchiveCodexThread?: (thread: CodexThreadSummary) => void;
}

// ── Helpers ──

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

function getTimeGroup(ts: number): 'pinned' | 'today' | 'yesterday' | 'week' | 'older' {
  const now = new Date();
  const date = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - now.getDay() * 86400000;
  if (ts >= startOfToday) return 'today';
  if (ts >= startOfYesterday) return 'yesterday';
  if (ts >= startOfWeek) return 'week';
  return 'older';
}

function sessionPreview(s: ChatSession): string {
  const firstUser = s.messages.find(m => m.role === 'user');
  if (!firstUser) return '';
  const text = firstUser.content.replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

function timestampMs(value: CodexThreadSummary['updatedAt'] | CodexThreadSummary['createdAt']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function codexThreadTitle(thread: CodexThreadSummary): string {
  const title = thread.name?.trim() || thread.preview?.trim();
  if (title) return title.length > 56 ? `${title.slice(0, 56)}...` : title;
  return `Thread ${shortRuntimeSessionId(thread.id)}`;
}

function codexThreadPreview(thread: CodexThreadSummary): string {
  const preview = thread.preview?.trim();
  if (!preview || preview === thread.name?.trim()) return '';
  return preview.length > 72 ? `${preview.slice(0, 72)}...` : preview;
}

function codexThreadStatus(thread: CodexThreadSummary): string | null {
  if (thread.archived) return 'archived';
  return typeof thread.status === 'string' && thread.status.trim() ? thread.status : null;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ── Main Component ──

function SessionHistoryPanel({
  sessions, activeSessionId,
  selectedAgentRuntime,
  codexThreads = [],
  codexThreadsLoading = false,
  codexThreadsError = null,
  codexThreadActionId = null,
  onLoad, onDelete, onRename, onTogglePin, onClearAll,
  onClose, onNewChat,
  onRefreshCodexThreads, onAttachCodexThread, onForkCodexThread, onArchiveCodexThread,
}: SessionHistoryPanelProps) {
  const { t } = useLocale();
  const [isPending, startTransition] = useTransition();
  const ask = t.ask;
  // Run/unread state comes from ask-run-store's summary snapshot, which only
  // changes on run start/end or unread membership — streaming chunks never
  // re-render the list (spec-chat-session-concurrency.md performance bar).
  const runSummary = useRunSummary();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Focus rename input
  useEffect(() => { if (editingId) setTimeout(() => inputRef.current?.focus(), 0); }, [editingId]);

  // Clear timer cleanup
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

  // Filter sessions by search query
  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(s => {
      const title = sessionTitle(s).toLowerCase();
      if (title.includes(q)) return true;
      const runtimeSummary = getRuntimeSessionSummary(s);
      if (
        runtimeSummary &&
        [
          runtimeSummary.idLabel,
          runtimeSummary.cwd,
          runtimeSummary.status,
          runtimeSummary.binding.externalSessionId,
        ].filter(Boolean).some(value => String(value).toLowerCase().includes(q))
      ) return true;
      return s.messages.some(m => m.content.toLowerCase().includes(q));
    });
  }, [sessions, query]);

  const filteredCodexThreads = useMemo(() => {
    if (selectedAgentRuntime?.kind !== 'codex') return [];
    if (!query.trim()) return codexThreads;
    const q = query.toLowerCase();
    return codexThreads.filter((thread) => [
      thread.id,
      thread.name,
      thread.preview,
      thread.cwd,
      codexThreadStatus(thread),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q)));
  }, [codexThreads, query, selectedAgentRuntime?.kind]);

  // Group sessions by time
  const groups = useMemo(() => {
    const pinned: ChatSession[] = [];
    const today: ChatSession[] = [];
    const yesterday: ChatSession[] = [];
    const week: ChatSession[] = [];
    const older: ChatSession[] = [];

    for (const s of filtered) {
      if (s.pinned) { pinned.push(s); continue; }
      const group = getTimeGroup(s.updatedAt);
      if (group === 'today') today.push(s);
      else if (group === 'yesterday') yesterday.push(s);
      else if (group === 'week') week.push(s);
      else older.push(s);
    }
    return { pinned, today, yesterday, week, older };
  }, [filtered]);

  const pinnedCount = sessions.filter(s => s.pinned).length;
  const totalCount = sessions.filter(s => s.messages.length > 0 || getRuntimeSessionSummary(s)).length;

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

  const handleClearAll = useCallback(() => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setConfirmClearAll(false), 3000);
      return;
    }
    startTransition(() => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      onClearAll();
      setConfirmClearAll(false);
    });
  }, [confirmClearAll, onClearAll]);

  // Keyboard: Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editingId) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, editingId]);

  const renderGroup = (label: string, items: ChatSession[]) => {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div className="text-2xs font-medium text-muted-foreground/50 uppercase tracking-wider px-1 py-2">
          {label}
        </div>
        <div className="flex flex-col gap-1">
          {items.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              isRunning={runSummary.running.has(s.id)}
              isUnread={!runSummary.running.has(s.id) && runSummary.unread.has(s.id)}
              editing={editingId === s.id}
              editValue={editValue}
              onEditValueChange={setEditValue}
              inputRef={inputRef}
              onLoad={() => handleLoad(s.id)}
              onStartRename={() => startRename(s)}
              onCommitRename={commitRename}
              onCancelRename={() => setEditingId(null)}
              onDelete={() => onDelete(s.id)}
              onTogglePin={() => onTogglePin(s.id)}
              ask={ask}
            />
          ))}
        </div>
      </div>
    );
  };

  const hasResults = filtered.length > 0;
  const showCodexThreads = selectedAgentRuntime?.kind === 'codex';
  const isNativeRuntimeHistory = selectedAgentRuntime?.kind === 'codex' || selectedAgentRuntime?.kind === 'claude';
  const hasAnyResults = hasResults || filteredCodexThreads.length > 0 || (showCodexThreads && codexThreadsLoading);
  const statsLabel = showCodexThreads
    ? `${pluralize(totalCount, 'saved chat', 'saved chats')} · ${pluralize(codexThreads.length, 'Codex thread', 'Codex threads')}`
    : (ask?.historyStats?.(totalCount) ?? `${totalCount} conversations`);
  const clearLabel = isNativeRuntimeHistory ? 'Clear saved chats' : (ask?.clearAll ?? 'Clear all');
  const confirmClearLabel = isNativeRuntimeHistory ? 'Confirm clear saved chats?' : (ask?.confirmClear ?? 'Confirm clear?');

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-in fade-in-0 duration-150">
      {/* Search bar */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={ask?.historySearch ?? 'Search conversations...'}
            className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/40 outline-none focus-visible:border-[var(--amber)]/40 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground/40 hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between px-4 pb-2 shrink-0">
        <span className="text-2xs text-muted-foreground/60">
          {statsLabel}
          {pinnedCount > 0 && <> &middot; {pinnedCount} {ask?.historyPinned ?? 'pinned'}</>}
        </span>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center gap-1 text-2xs text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors"
        >
          <SquarePen size={11} />
          <span>{t.hints?.newChat ?? 'New chat'}</span>
        </button>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3">
        {hasAnyResults ? (
          <div className="flex flex-col gap-1">
            {showCodexThreads && (
              <CodexThreadSection
                threads={filteredCodexThreads}
                loading={codexThreadsLoading}
                error={codexThreadsError}
                actionId={codexThreadActionId}
                onRefresh={onRefreshCodexThreads}
                onAttach={onAttachCodexThread}
                onFork={onForkCodexThread}
                onArchive={onArchiveCodexThread}
              />
            )}
            {renderGroup(ask?.historyPinned ?? 'Pinned', groups.pinned)}
            {renderGroup(ask?.historyToday ?? 'Today', groups.today)}
            {renderGroup(ask?.historyYesterday ?? 'Yesterday', groups.yesterday)}
            {renderGroup(ask?.historyThisWeek ?? 'This week', groups.week)}
            {renderGroup(ask?.historyOlder ?? 'Older', groups.older)}
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

      {/* Footer */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 shrink-0">
          <button
            type="button"
            onClick={handleClearAll}
            className={`text-2xs px-2 py-0.5 rounded-md transition-colors ${
              confirmClearAll
                ? 'bg-error/10 text-error font-medium'
                : 'text-muted-foreground/50 hover:text-error hover:bg-muted'
            }`}
          >
            <span className="flex items-center gap-1">
              <Trash2 size={10} />
              {confirmClearAll ? confirmClearLabel : clearLabel}
            </span>
          </button>
          <span className="text-2xs text-muted-foreground/40 tabular-nums">
            {showCodexThreads
              ? pluralize(totalCount, 'saved', 'saved')
              : (ask?.historyCapacity?.(totalCount) ?? `${totalCount} of 30`)}
          </span>
        </div>
      )}
    </div>
  );
}

// Memoized: AskContent re-renders on every streamed chunk (it subscribes to the
// active session's messages), but every prop here is referentially stable during
// a stream, so memo keeps the open history panel from reconciling per chunk.
export default memo(SessionHistoryPanel);

function CodexThreadSection({
  threads,
  loading,
  error,
  actionId,
  onRefresh,
  onAttach,
  onFork,
  onArchive,
}: {
  threads: CodexThreadSummary[];
  loading: boolean;
  error: string | null;
  actionId: string | null;
  onRefresh?: () => void;
  onAttach?: (thread: CodexThreadSummary) => void;
  onFork?: (thread: CodexThreadSummary) => void;
  onArchive?: (thread: CodexThreadSummary) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-1 py-2">
        <div className="text-2xs font-medium text-muted-foreground/50 uppercase tracking-wider">
          Codex local threads
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Refresh Codex threads"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-1 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-2xs text-muted-foreground">
          <AlertCircle size={12} className="mt-0.5 shrink-0 text-error" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {loading && threads.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-2xs text-muted-foreground/60">
          <Loader2 size={12} className="animate-spin" />
          <span>Loading Codex threads...</span>
        </div>
      )}

      {!loading && !error && threads.length === 0 && (
        <div className="rounded-lg border border-border/50 px-3 py-2 text-2xs text-muted-foreground/50">
          No Codex threads found.
        </div>
      )}

      {threads.length > 0 && (
        <div className="flex flex-col gap-1">
          {threads.map((thread) => (
            <CodexThreadRow
              key={thread.id}
              thread={thread}
              busy={actionId === thread.id}
              onAttach={onAttach}
              onFork={onFork}
              onArchive={onArchive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CodexThreadRow({
  thread,
  busy,
  onAttach,
  onFork,
  onArchive,
}: {
  thread: CodexThreadSummary;
  busy: boolean;
  onAttach?: (thread: CodexThreadSummary) => void;
  onFork?: (thread: CodexThreadSummary) => void;
  onArchive?: (thread: CodexThreadSummary) => void;
}) {
  const title = codexThreadTitle(thread);
  const preview = codexThreadPreview(thread);
  const status = codexThreadStatus(thread);
  const updatedAt = timestampMs(thread.updatedAt ?? thread.createdAt);

  return (
    <div className="group rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-muted/60">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onAttach?.(thread)}
          disabled={busy || !onAttach}
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--amber)] transition-colors hover:bg-[var(--amber)]/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Open this Codex thread"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{title}</span>
            {status && (
              <span className="shrink-0 rounded-full border border-border/50 px-1 py-0 text-[9px] text-muted-foreground/60">
                {status}
              </span>
            )}
            {updatedAt && (
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground/40">
                {formatRelativeTime(new Date(updatedAt))}
              </span>
            )}
          </div>
          {preview && (
            <div className="mt-0.5 truncate text-2xs text-muted-foreground/50">{preview}</div>
          )}
          <div className="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground/40">
            <span className="shrink-0 font-mono">{shortRuntimeSessionId(thread.id)}</span>
            {thread.cwd && (
              <>
                <span className="shrink-0">·</span>
                <span className="truncate font-mono">{thread.cwd}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-75 group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onFork?.(thread)}
            disabled={busy || !onFork}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Fork Codex thread"
          >
            <GitFork size={11} />
          </button>
          <button
            type="button"
            onClick={() => onArchive?.(thread)}
            disabled={busy || !onArchive}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted/60 hover:text-error disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Archive Codex thread"
          >
            <Archive size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Session Card ──

function SessionCard({
  session: s, isActive, isRunning, isUnread, editing, editValue, onEditValueChange, inputRef,
  onLoad, onStartRename, onCommitRename, onCancelRename, onDelete, onTogglePin,
  ask,
}: {
  session: ChatSession;
  isActive: boolean;
  isRunning: boolean;
  isUnread: boolean;
  editing: boolean;
  editValue: string;
  onEditValueChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onLoad: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  ask: Record<string, any>;
}) {
  const title = sessionTitle(s);
  const preview = sessionPreview(s);
  const msgCount = s.messages.length;
  const runtimeSummary = getRuntimeSessionSummary(s);

  return (
    <div
      className={`group relative rounded-lg transition-colors cursor-pointer ${
        isActive
          ? 'bg-[var(--amber)]/8 border border-[var(--amber)]/15'
          : 'hover:bg-muted/60 border border-transparent'
      }`}
      onClick={onLoad}
    >
      {/* Active indicator */}
      {isActive && (
        <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full bg-[var(--amber)]" />
      )}

      <div className="px-3 py-2.5">
        {/* Title row */}
        <div className="flex items-center gap-1.5 mb-0.5">
          {s.pinned && <Pin size={10} className="shrink-0 text-[var(--amber)]/60 -rotate-45" />}
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onCommitRename(); }
                if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
              }}
              onClick={e => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent border-b border-[var(--amber)] outline-none text-xs font-medium text-foreground"
            />
          ) : (
            <span className="flex-1 min-w-0 text-xs font-medium text-foreground truncate">
              {title}
            </span>
          )}
          {!editing && isRunning && (
            <span
              data-testid="session-running-indicator"
              title={ask?.sessionRunningIndicator}
              aria-label={ask?.sessionRunningIndicator}
              className="inline-flex shrink-0 text-[var(--amber)]"
            >
              <Loader2 size={11} className="animate-spin" />
            </span>
          )}
          {!editing && isUnread && (
            <span
              data-testid="session-unread-indicator"
              title={ask?.sessionUnreadIndicator}
              aria-label={ask?.sessionUnreadIndicator}
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber)]"
            />
          )}
          <span className="text-2xs text-muted-foreground/40 shrink-0 tabular-nums">
            {formatRelativeTime(new Date(s.updatedAt))}
          </span>
        </div>

        {/* Preview */}
        {!editing && preview && (
          <p className="text-2xs text-muted-foreground/50 truncate mt-0.5 pl-0.5">
            {preview}
          </p>
        )}

        {!editing && runtimeSummary && (
          <div className="mt-1.5 space-y-0.5 pl-0.5">
            <div className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground/50">
              <Link2 size={9} className="shrink-0 text-[var(--amber)]/70" />
              <span className="truncate">{runtimeSummary.idLabel}</span>
              {runtimeSummary.status && (
                <span className="shrink-0 rounded-full border border-border/50 px-1 py-0 text-[9px] text-muted-foreground/60">
                  {runtimeSummary.status}
                </span>
              )}
            </div>
            {runtimeSummary.cwd && (
              <div className="truncate font-mono text-[10px] text-muted-foreground/40">
                {runtimeSummary.cwd}
              </div>
            )}
          </div>
        )}

        {/* Meta row */}
        {!editing && (
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-2xs text-muted-foreground/40 flex items-center gap-1">
              <MessageSquare size={9} />
              {ask?.historyMsgs?.(msgCount) ?? `${msgCount} msgs`}
            </span>

            {/* Action buttons — visible on hover */}
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-75 group-hover:opacity-100 focus-within:opacity-100" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={onTogglePin}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation ${s.pinned ? 'text-[var(--amber)] hover:bg-muted/60 hover:text-muted-foreground' : 'text-muted-foreground/40 hover:bg-[var(--amber)]/10 hover:text-[var(--amber)]'}`}
                title={s.pinned ? 'Unpin' : 'Pin'}
              >
                {s.pinned ? <PinOff size={11} /> : <Pin size={11} />}
              </button>
              <button
                type="button"
                onClick={onStartRename}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors duration-75 hover:text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
                title={ask?.renameSession ?? 'Rename'}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors duration-75 hover:text-error hover:bg-error/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
