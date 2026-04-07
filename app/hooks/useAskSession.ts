'use client';

import { useState, useCallback, useRef } from 'react';
import type { Message, ChatSession } from '@/lib/types';
import { apiFetch } from '@/lib/api';

const MAX_SESSIONS = 30;

function createSession(currentFile?: string): ChatSession {
  const ts = Date.now();
  return {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    currentFile,
    createdAt: ts,
    updatedAt: ts,
    messages: [],
  };
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
  const initSessions = useCallback(async () => {
    const all = (await fetchSessions())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);

    // Prune any empty sessions that leaked to server (from older versions)
    const emptyIds = all.filter((s) => s.messages.length === 0).map((s) => s.id);
    const sorted = emptyIds.length > 0 ? all.filter((s) => !emptyIds.includes(s.id)) : all;
    if (emptyIds.length > 0) void removeSessions(emptyIds);

    // Always prepend a fresh empty session in memory (never persisted until first message)
    const fresh = createSession(currentFile);
    const matched = currentFile
      ? sorted.find((sess) => sess.currentFile === currentFile)
      : sorted[0];

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
  const resetSession = useCallback(() => {
    setSessions((prev) => {
      const active = prev.find((s) => s.id === activeSessionId);
      // Already on an empty session — just clear input, don't create another
      if (active && active.messages.length === 0) return prev;

      const fresh = createSession(currentFile);
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
      if (leaving && leaving.messages.length === 0 && leaving.id !== id) {
        setSessions((prev) => prev.filter((s) => s.id !== leaving.id));
      }

      setActiveSessionId(target.id);
      setMessages(target.messages);
    },
    [sessions, activeSessionId],
  );

  /** Delete a session. If it's the active one, create fresh (memory only). */
  const deleteSession = useCallback(
    (id: string) => {
      const target = sessions.find((s) => s.id === id);
      // Only call removeSession if the session has messages (i.e. was persisted)
      if (target && target.messages.length > 0) void removeSession(id);

      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);

      if (activeSessionId === id) {
        const fresh = createSession(currentFile);
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
      // Only persist if session has messages
      if (updated.messages.length > 0) void upsertSession(updated);
      return next;
    });
  }, []);

  const clearAllSessions = useCallback(() => {
    // Only delete sessions that have messages (were persisted)
    const persistedIds = sessions.filter(s => s.messages.length > 0).map(s => s.id);
    if (persistedIds.length > 0) void removeSessions(persistedIds);

    const fresh = createSession(currentFile);
    setActiveSessionId(fresh.id);
    setMessages([]);
    setSessions([fresh]);
    // No upsertSession — memory only
  }, [currentFile, sessions]);

  /** Sessions sorted: pinned first, then by updatedAt desc */
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  return {
    messages,
    setMessages,
    sessions: sortedSessions,
    activeSessionId,
    initSessions,
    persistSession,
    clearPersistTimer,
    resetSession,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    clearAllSessions,
  };
}
