'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import type { AgentIdentity, AgentRuntimeIdentity, Message, ChatSession, RuntimeSessionBinding } from '@/lib/types';
import {
  bindSessionAgent,
  bindSessionAgentRuntime,
  getMatchingRuntimeSessionBinding,
  isSessionInRuntimeLane,
} from '@/lib/ask-agent';

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Load sessions from server, pick the matching one or create fresh. Prunes stale empty sessions. */
  const initSessions = useCallback(async (runtime?: AgentRuntimeIdentity | null) => {
    const all = (await fetchSessions())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);

    // Prune abandoned empty sessions from older versions, but keep metadata-only
    // sessions that intentionally bind MindOS to a native runtime session.
    const emptyIds = all
      .filter((s) => s.messages.length === 0 && !hasDurableRuntimeBinding(s))
      .map((s) => s.id);
    const sorted = emptyIds.length > 0 ? all.filter((s) => !emptyIds.includes(s.id)) : all;
    if (emptyIds.length > 0) void removeSessions(emptyIds);

    // Always prepend a fresh empty session in memory (never persisted until first message)
    const fresh = createSession(currentFile, runtime);
    const candidates = runtime === undefined
      ? sorted
      : sorted.filter((sess) => isSessionInRuntimeLane(sess, runtime));
    const matched = currentFile
      ? candidates.find((sess) => sess.currentFile === currentFile) ?? candidates[0]
      : candidates[0];

    if (matched) {
      setActiveSessionId(matched.id);
      setMessages(matched.messages);
      setSessions([...sorted]);
    } else {
      setActiveSessionId(fresh.id);
      setMessages([]);
      // Empty session lives only in memory — no upsertSession call
      setSessions([fresh, ...sorted].slice(0, MAX_SESSIONS));
    }
  }, [currentFile]);

  /** Persist current session (debounced). Only persists if session has messages. */
  const persistSession = useCallback(
    (msgs: Message[], sessionId: string | null) => {
      if (!sessionId || msgs.length === 0) return;
      let sessionToPersist: ChatSession | null = null;
      setSessions((prev) => {
        const now = Date.now();
        const existing = prev.find((s) => s.id === sessionId);
        sessionToPersist = existing
          ? { ...existing, currentFile, updatedAt: now, messages: msgs }
          : { id: sessionId, currentFile, createdAt: now, updatedAt: now, messages: msgs };

        const rest = prev.filter((s) => s.id !== sessionId);
        return [sessionToPersist!, ...rest]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_SESSIONS);
      });

      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        if (sessionToPersist) void upsertSession(sessionToPersist);
      }, 600);
    },
    [currentFile],
  );

  const clearPersistTimer = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, []);

  /** Create a brand-new session (memory only). If current session is already empty, reuse it. */
  const resetSession = useCallback((runtime?: AgentRuntimeIdentity | null) => {
    setSessions((prev) => {
      const active = prev.find((s) => s.id === activeSessionId);
      // Already on an empty session in this runtime lane — just clear input,
      // unless it is bound to an external session and New Chat should create a
      // fresh unlinked runtime session.
      if (
        active
        && active.messages.length === 0
        && isSessionInRuntimeLane(active, runtime)
        && !hasDurableRuntimeBinding(active)
      ) return prev;

      const fresh = createSession(currentFile, runtime);
      setActiveSessionId(fresh.id);
      setMessages([]);
      // Memory only — no upsertSession call. Will be persisted on first message.
      return [fresh, ...prev]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });
  }, [currentFile, activeSessionId]);

  /** Switch to an existing session. Auto-drops abandoned empty sessions from memory. */
  const loadSession = useCallback(
    (id: string) => {
      const target = sessions.find((s) => s.id === id);
      if (!target) return;

      // Drop the session we're leaving if it's empty (it was never persisted, just remove from memory)
      const leaving = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
      if (leaving && leaving.messages.length === 0 && !hasDurableRuntimeBinding(leaving) && leaving.id !== id) {
        setSessions((prev) => prev.filter((s) => s.id !== leaving.id));
      }

      setActiveSessionId(target.id);
      setMessages(target.messages);
    },
    [sessions, activeSessionId],
  );

  /** Delete a session. If it's the active one, create fresh (memory only). */
  const deleteSession = useCallback(
    (id: string, runtime?: AgentRuntimeIdentity | null) => {
      const target = sessions.find((s) => s.id === id);
      // Only remove the local MindOS record. This never deletes the external
      // Codex/Claude session referenced by runtimeSessionBinding.
      if (target && shouldPersistSession(target)) void removeSession(id);

      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);

      if (activeSessionId === id) {
        const fresh = createSession(currentFile, runtime);
        setActiveSessionId(fresh.id);
        setMessages([]);
        setSessions([fresh, ...remaining].slice(0, MAX_SESSIONS));
        // No upsertSession — memory only
      }
    },
    [activeSessionId, currentFile, sessions],
  );

  const renameSession = useCallback((id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const updated = { ...prev[idx], title: trimmed || undefined };
      const next = [...prev];
      next[idx] = updated;
      void upsertSession(updated);
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
      if (shouldPersistSession(updated)) void upsertSession(updated);
      return next;
    });
  }, []);

  /** Update the session-level ACP agent binding for the currently active session. */
  const setSessionDefaultAcpAgent = useCallback((agent: AgentIdentity | null) => {
    if (!activeSessionId) return;

    const currentSession = sessions.find((session) => session.id === activeSessionId);
    if (!currentSession) return;

    const updatedSession = bindSessionAgent({
      ...currentSession,
      currentFile: currentSession.currentFile ?? currentFile,
      updatedAt: Date.now(),
    }, agent);

    setSessions((prev) => {
      const rest = prev.filter((session) => session.id !== activeSessionId);
      return [updatedSession, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    if (updatedSession.messages.length > 0) {
      persistTimerRef.current = setTimeout(() => {
        void upsertSession(updatedSession);
      }, 600);
    }
  }, [activeSessionId, currentFile, sessions]);

  /** Update the session-level runtime binding for native agent sessions. */
  const setSessionAgentRuntimeBinding = useCallback((
    runtime: AgentRuntimeIdentity,
    binding?: { externalSessionId?: string; cwd?: string; status?: RuntimeSessionBinding['status']; updatedAt?: number },
  ) => {
    if (!activeSessionId) return;

    const currentSession = sessions.find((session) => session.id === activeSessionId);
    if (!currentSession) return;

    const updatedSession = bindSessionAgentRuntime({
      ...currentSession,
      currentFile: currentSession.currentFile ?? currentFile,
      updatedAt: Date.now(),
    }, runtime, binding);

    setSessions((prev) => {
      const rest = prev.filter((session) => session.id !== activeSessionId);
      return [updatedSession, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    if (shouldPersistSession(updatedSession)) {
      persistTimerRef.current = setTimeout(() => {
        void upsertSession(updatedSession);
      }, 600);
    }
  }, [activeSessionId, currentFile, sessions]);

  const attachRuntimeSession = useCallback((
    runtime: AgentRuntimeIdentity,
    binding: {
      externalSessionId: string;
      cwd?: string;
      status?: RuntimeSessionBinding['status'];
      updatedAt?: number | string;
    },
    metadata?: { title?: string },
  ) => {
    if (runtime.kind !== 'codex' && runtime.kind !== 'claude') return;
    const externalSessionId = binding.externalSessionId.trim();
    if (!externalSessionId) return;

    const now = Date.now();
    const bindingUpdatedAt = runtimeBindingUpdatedAt(binding.updatedAt);
    let sessionToPersist: ChatSession | null = null;

    setSessions((prev) => {
      const existing = prev.find((item) => (
        getMatchingRuntimeSessionBinding(item, runtime)?.externalSessionId === externalSessionId
      ));
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

      sessionToPersist = updated;
      setActiveSessionId(updated.id);
      setMessages(updated.messages);

      const rest = prev.filter((item) => item.id !== updated.id);
      return [updated, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    });

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      if (sessionToPersist) void upsertSession(sessionToPersist);
    }, 0);
  }, [currentFile]);

  const clearSessions = useCallback((ids?: string[], runtime?: AgentRuntimeIdentity | null) => {
    const targetIds = ids
      ? new Set(ids)
      : new Set(sessions.map((s) => s.id));
    const persistedIds = sessions
      .filter((s) => targetIds.has(s.id) && shouldPersistSession(s))
      .map((s) => s.id);
    if (persistedIds.length > 0) void removeSessions(persistedIds);

    const remaining = sessions.filter((s) => !targetIds.has(s.id));
    const fresh = createSession(currentFile, runtime);
    setActiveSessionId(fresh.id);
    setMessages([]);
    setSessions([fresh, ...remaining].slice(0, MAX_SESSIONS));
    // No upsertSession — memory only
  }, [currentFile, sessions]);

  const clearAllSessions = useCallback(() => {
    clearSessions(undefined, null);
  }, [clearSessions]);

  /** Sessions sorted: pinned first, then by updatedAt desc */
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  }), [sessions]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  return {
    messages,
    setMessages,
    sessions: sortedSessions,
    activeSession,
    activeSessionId,
    initSessions,
    persistSession,
    clearPersistTimer,
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
