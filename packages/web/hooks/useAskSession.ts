'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { AgentIdentity, AgentRuntimeIdentity, Message, ChatSession, RuntimeSessionBinding } from '@/lib/types';
import {
  bindSessionAgent,
  bindSessionAgentRuntime,
  getMatchingRuntimeSessionBinding,
  isSessionInRuntimeLane,
} from '@/lib/ask-agent';
import {
  clearUnread,
  getMessageWriteAt,
  getMessages as storeGetMessages,
  getRun,
  hasMessages as storeHasMessages,
  registerMetaResolver,
  registerRuntimeBindingWriter,
  registerSessionsUpdater,
  removeSession as storeRemoveSession,
  schedulePersist,
  setActiveSession as storeSetActiveSession,
  setMessages as storeSetMessages,
  useSessionMessages,
} from '@/lib/ask-run-store';

const MAX_SESSIONS = 30;

function createSession(currentFile?: string, runtime?: AgentRuntimeIdentity | null): ChatSession {
  const ts = Date.now();
  const session: ChatSession = {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    currentFile,
    createdAt: ts,
    updatedAt: ts,
    messages: [],
  };

  if (!runtime || runtime.kind === 'mindos') return session;
  if (runtime.kind === 'acp') return bindSessionAgent(session, { id: runtime.id, name: runtime.name });
  return bindSessionAgentRuntime(session, runtime, { updatedAt: ts });
}

function hasDurableRuntimeBinding(session: Pick<ChatSession, 'runtimeSessionBinding' | 'externalAgentBinding'>): boolean {
  return Boolean(
    session.runtimeSessionBinding?.externalSessionId?.trim()
    || session.externalAgentBinding?.externalSessionId?.trim(),
  );
}

function shouldPersistSession(session: Pick<ChatSession, 'messages' | 'runtimeSessionBinding' | 'externalAgentBinding'>): boolean {
  return session.messages.length > 0 || hasDurableRuntimeBinding(session);
}

function runtimeBindingUpdatedAt(value?: number | string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** Messages now live in ask-run-store; metadata entries may carry a stale snapshot. */
function withStoreMessages(session: ChatSession): ChatSession {
  return storeHasMessages(session.id)
    ? { ...session, messages: storeGetMessages(session.id) }
    : session;
}

export function sessionTitle(s: ChatSession): string {
  if (s.title) return s.title;
  const firstUser = s.messages.find((m) => m.role === 'user');
  if (!firstUser) return '(empty session)';
  const line = firstUser.content.replace(/\s+/g, ' ').trim();
  if (!line && firstUser.images && firstUser.images.length > 0) {
    return `[${firstUser.images.length} image${firstUser.images.length > 1 ? 's' : ''}]`;
  }
  return line.length > 42 ? `${line.slice(0, 42)}...` : line || '(empty session)';
}

async function fetchSessions(): Promise<ChatSession[]> {
  try {
    const res = await fetch('/api/ask-sessions', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as ChatSession[];
    if (!Array.isArray(data)) return [];
    return data.slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

async function upsertSession(session: ChatSession): Promise<void> {
  try {
    // Strip base64 image data before persisting (images are session-only, not stored)
    const stripped: ChatSession = {
      ...session,
      messages: session.messages.map(m => {
        if (!m.images || m.images.length === 0) return m;
        return {
          ...m,
          images: m.images.map(img => ({
            ...img,
            data: '', // Strip base64 data — images are ephemeral
          })),
        };
      }),
    };
    await fetch('/api/ask-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: stripped }),
    });
  } catch {
    // ignore persistence errors
  }
}

async function removeSession(id: string): Promise<void> {
  try {
    await fetch('/api/ask-sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch {
    // ignore persistence errors
  }
}

async function removeSessions(ids: string[]): Promise<void> {
  try {
    await fetch('/api/ask-sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // ignore persistence errors
  }
}

export function useAskSession(currentFile?: string) {
  // `sessions` is metadata only (id/title/pinned/bindings/updatedAt). Message
  // contents live in ask-run-store; the `messages` field on entries is a
  // snapshot refreshed at each persistence flush, kept for type compat.
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);

  const messages = useSessionMessages(activeSessionId);

  const sessionsRef = useRef<ChatSession[]>([]);
  sessionsRef.current = sessions;
  const currentFileRef = useRef(currentFile);
  currentFileRef.current = currentFile;
  const activeIdRef = useRef(activeSessionId);
  activeIdRef.current = activeSessionId;

  const setActiveSessionId = useCallback((id: string | null) => {
    setActiveSessionIdState(id);
    storeSetActiveSession(id);
  }, []);

  const setMessages = useCallback((next: React.SetStateAction<Message[]>) => {
    const id = activeIdRef.current;
    if (id) storeSetMessages(id, next as Message[] | ((prev: Message[]) => Message[]));
  }, []);

  // --- store bridges (single-slot registrations; the most recently
  // initialized AskContent instance wins — known PR1 compromise, see spec) ---

  const resolveMeta = useCallback((id: string): ChatSession | null => {
    const found = sessionsRef.current.find((s) => s.id === id);
    if (!found) return null;
    if (id === activeIdRef.current) {
      return { ...found, currentFile: currentFileRef.current ?? found.currentFile };
    }
    return found;
  }, []);

  /** Persistence flush feeds the payload back so metadata (ordering, message snapshot) stays fresh. */
  const applyPersistedSession = useCallback((session: ChatSession) => {
    setSessions((prev) => {
      const rest = prev.filter((s) => s.id !== session.id);
      return [session, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });
  }, []);

  /** Component-independent binding write path for run closures (explicit session id). */
  const writeBindingForSession = useCallback((
    sessionId: string,
    runtime: AgentRuntimeIdentity,
    binding?: { externalSessionId?: string; cwd?: string; status?: RuntimeSessionBinding['status']; updatedAt?: number },
  ) => {
    setSessions((prev) => {
      const current = prev.find((s) => s.id === sessionId);
      if (!current) return prev;
      const updatedSession = bindSessionAgentRuntime({
        ...current,
        currentFile: current.currentFile ?? currentFileRef.current,
        updatedAt: Date.now(),
      }, runtime, binding);
      const rest = prev.filter((s) => s.id !== sessionId);
      return [updatedSession, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });
    schedulePersist(sessionId);
  }, []);

  const registerStoreBridges = useCallback(() => {
    registerMetaResolver(resolveMeta);
    registerSessionsUpdater(applyPersistedSession);
    registerRuntimeBindingWriter(writeBindingForSession);
  }, [resolveMeta, applyPersistedSession, writeBindingForSession]);

  useEffect(() => {
    registerStoreBridges();
  }, [registerStoreBridges]);

  /** Load sessions from server, pick the matching one or create fresh. Prunes stale empty sessions. */
  const initSessions = useCallback(async (runtime?: AgentRuntimeIdentity | null) => {
    // The visible instance re-claims the single-slot bridges on init.
    registerStoreBridges();

    const all = (await fetchSessions())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);

    // Prune abandoned empty sessions from older versions, but keep metadata-only
    // sessions that intentionally bind MindOS to a native runtime session.
    const emptyIds = all
      .filter((s) => s.messages.length === 0 && !hasDurableRuntimeBinding(s) && !getRun(s.id))
      .map((s) => s.id);
    const sorted = emptyIds.length > 0 ? all.filter((s) => !emptyIds.includes(s.id)) : all;
    if (emptyIds.length > 0) void removeSessions(emptyIds);

    // Idempotent backfill: the store is the in-memory source of truth, the
    // server snapshot must never clobber newer local state.
    for (const s of sorted) {
      if (getRun(s.id)) continue; // running: in-memory messages are always newer
      if (storeHasMessages(s.id) && getMessageWriteAt(s.id) >= s.updatedAt) continue; // local copy newer
      storeSetMessages(s.id, s.messages, { skipPersist: true });
    }

    // Always prepend a fresh empty session in memory (never persisted until first message)
    const fresh = createSession(currentFile, runtime);
    const candidates = runtime === undefined
      ? sorted
      : sorted.filter((sess) => isSessionInRuntimeLane(sess, runtime));
    const matched = currentFile
      ? candidates.find((sess) => sess.currentFile === currentFile) ?? candidates[0]
      : candidates[0];

    // Keep local sessions with live runs that the server doesn't know yet
    // (brand-new sessions are only persisted after their first flush).
    const localRunning = sessionsRef.current.filter(
      (p) => getRun(p.id) && !sorted.some((s) => s.id === p.id),
    );

    if (matched) {
      setActiveSessionId(matched.id);
      setSessions([...localRunning, ...sorted].slice(0, MAX_SESSIONS));
    } else {
      setActiveSessionId(fresh.id);
      // Empty session lives only in memory — no upsertSession call
      setSessions([fresh, ...localRunning, ...sorted].slice(0, MAX_SESSIONS));
    }
  }, [currentFile, registerStoreBridges, setActiveSessionId]);

  /** Create a brand-new session (memory only). If current session is already empty, reuse it. */
  const resetSession = useCallback((runtime?: AgentRuntimeIdentity | null) => {
    const active = sessionsRef.current.find((s) => s.id === activeIdRef.current);
    const activeMessages = active ? withStoreMessages(active).messages : [];
    // Already on an empty session in this runtime lane — just clear input,
    // unless it is bound to an external session and New Chat should create a
    // fresh unlinked runtime session.
    if (
      active
      && activeMessages.length === 0
      && isSessionInRuntimeLane(active, runtime)
      && !hasDurableRuntimeBinding(active)
    ) return;

    const fresh = createSession(currentFile, runtime);
    setActiveSessionId(fresh.id);
    // Memory only — no upsertSession call. Will be persisted on first message.
    setSessions((prev) => [fresh, ...prev]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS));
  }, [currentFile, setActiveSessionId]);

  /** Switch to an existing session. Auto-drops abandoned empty sessions from memory. */
  const loadSession = useCallback(
    (id: string) => {
      const target = sessionsRef.current.find((s) => s.id === id);
      if (!target) return;

      // Drop the session we're leaving if it's empty (it was never persisted, just remove from memory)
      const leaving = activeIdRef.current ? sessionsRef.current.find((s) => s.id === activeIdRef.current) : null;
      if (
        leaving
        && leaving.id !== id
        && !getRun(leaving.id)
        && withStoreMessages(leaving).messages.length === 0
        && !hasDurableRuntimeBinding(leaving)
      ) {
        setSessions((prev) => prev.filter((s) => s.id !== leaving.id));
      }

      setActiveSessionId(target.id);
      clearUnread(target.id);
    },
    [setActiveSessionId],
  );

  /** Delete a session. If it's the active one, create fresh (memory only). */
  const deleteSession = useCallback(
    (id: string, runtime?: AgentRuntimeIdentity | null) => {
      const target = sessionsRef.current.find((s) => s.id === id);
      const persisted = target ? shouldPersistSession(withStoreMessages(target)) : false;

      // Abort any live run and clear store entries (messages, timers, unread)
      // before touching metadata, so late chunks and zombie persists are impossible.
      storeRemoveSession(id);

      // Only remove the local MindOS record. This never deletes the external
      // Codex/Claude session referenced by runtimeSessionBinding.
      if (persisted) void removeSession(id);

      const remaining = sessionsRef.current.filter((s) => s.id !== id);
      if (activeIdRef.current === id) {
        const fresh = createSession(currentFile, runtime);
        setActiveSessionId(fresh.id);
        setSessions([fresh, ...remaining].slice(0, MAX_SESSIONS));
        // No upsertSession — memory only
      } else {
        setSessions(remaining);
      }
    },
    [currentFile, setActiveSessionId],
  );

  const renameSession = useCallback((id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const updated = { ...prev[idx], title: trimmed || undefined };
      const next = [...prev];
      next[idx] = updated;
      void upsertSession(withStoreMessages(updated));
      return next;
    });
  }, []);

  /** Toggle pin/unpin a session. Pinned sessions sort to top. */
  const togglePinSession = useCallback((id: string) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const updated = { ...prev[idx], pinned: !prev[idx].pinned };
      const next = [...prev];
      next[idx] = updated;
      const full = withStoreMessages(updated);
      if (shouldPersistSession(full)) void upsertSession(full);
      return next;
    });
  }, []);

  /** Update the session-level ACP agent binding for the currently active session. */
  const setSessionDefaultAcpAgent = useCallback((agent: AgentIdentity | null) => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;

    const currentSession = sessionsRef.current.find((session) => session.id === sessionId);
    if (!currentSession) return;

    const updatedSession = bindSessionAgent({
      ...currentSession,
      currentFile: currentSession.currentFile ?? currentFile,
      updatedAt: Date.now(),
    }, agent);

    setSessions((prev) => {
      const rest = prev.filter((session) => session.id !== sessionId);
      return [updatedSession, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });

    // Debounced via the store's per-session channel; flush itself decides
    // whether the session is persistable (has messages or durable binding).
    schedulePersist(sessionId);
  }, [currentFile]);

  /** Update the session-level runtime binding for native agent sessions. */
  const setSessionAgentRuntimeBinding = useCallback((
    runtime: AgentRuntimeIdentity,
    binding?: { externalSessionId?: string; cwd?: string; status?: RuntimeSessionBinding['status']; updatedAt?: number },
  ) => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;
    if (!sessionsRef.current.some((session) => session.id === sessionId)) return;
    writeBindingForSession(sessionId, runtime, binding);
  }, [writeBindingForSession]);

  /**
   * Attach an external runtime session (Codex thread / Claude session).
   * Returns false when refused — e.g. the matched local session is running.
   */
  const attachRuntimeSession = useCallback((
    runtime: AgentRuntimeIdentity,
    binding: {
      externalSessionId: string;
      cwd?: string;
      status?: RuntimeSessionBinding['status'];
      updatedAt?: number | string;
    },
    metadata?: { title?: string },
  ): boolean => {
    if (runtime.kind !== 'codex' && runtime.kind !== 'claude') return false;
    const externalSessionId = binding.externalSessionId.trim();
    if (!externalSessionId) return false;

    const now = Date.now();
    const bindingUpdatedAt = runtimeBindingUpdatedAt(binding.updatedAt);

    const existing = sessionsRef.current.find((item) => (
      getMatchingRuntimeSessionBinding(item, runtime)?.externalSessionId === externalSessionId
    ));
    // A running session keeps its binding — rebinding mid-run would desync
    // the UI from the run's submit-time snapshot. Browsing it is still fine.
    if (existing && getRun(existing.id)) return false;

    const base = existing ?? createSession(currentFile, runtime);
    const updated = bindSessionAgentRuntime({
      ...base,
      currentFile: base.currentFile ?? currentFile,
      title: metadata?.title?.trim() || base.title,
      updatedAt: now,
    }, runtime, {
      externalSessionId,
      cwd: binding.cwd,
      status: binding.status ?? 'active',
      updatedAt: bindingUpdatedAt,
    });

    if (!storeHasMessages(updated.id)) {
      storeSetMessages(updated.id, updated.messages, { skipPersist: true });
    }
    setActiveSessionId(updated.id);
    clearUnread(updated.id);

    setSessions((prev) => {
      const rest = prev.filter((item) => item.id !== updated.id);
      return [updated, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });

    void upsertSession(withStoreMessages(updated));
    return true;
  }, [currentFile, setActiveSessionId]);

  const clearSessions = useCallback((ids?: string[], runtime?: AgentRuntimeIdentity | null) => {
    const targetIds = ids
      ? new Set(ids)
      : new Set(sessionsRef.current.map((s) => s.id));
    const persistedIds = sessionsRef.current
      .filter((s) => targetIds.has(s.id) && shouldPersistSession(withStoreMessages(s)))
      .map((s) => s.id);
    if (persistedIds.length > 0) void removeSessions(persistedIds);

    // Abort runs and clear store entries for everything we drop.
    targetIds.forEach((id) => storeRemoveSession(id));

    const remaining = sessionsRef.current.filter((s) => !targetIds.has(s.id));
    const fresh = createSession(currentFile, runtime);
    setActiveSessionId(fresh.id);
    setSessions([fresh, ...remaining].slice(0, MAX_SESSIONS));
    // No upsertSession — memory only
  }, [currentFile, setActiveSessionId]);

  const clearAllSessions = useCallback(() => {
    clearSessions(undefined, null);
  }, [clearSessions]);

  /** Sessions sorted: pinned first, then by updatedAt desc */
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  }), [sessions]);

  /** Active session metadata with live messages from the store overlaid. */
  const activeSession = useMemo(() => {
    const meta = sessions.find((session) => session.id === activeSessionId) ?? null;
    if (!meta) return null;
    return meta.messages === messages ? meta : { ...meta, messages };
  }, [activeSessionId, sessions, messages]);

  return {
    messages,
    setMessages,
    sessions: sortedSessions,
    activeSession,
    activeSessionId,
    initSessions,
    resetSession,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    setSessionDefaultAcpAgent,
    setSessionAgentRuntimeBinding,
    attachRuntimeSession,
    clearSessions,
    clearAllSessions,
  };
}
