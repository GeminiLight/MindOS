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
  const firstUser = s.messages.find((m) => m.role === 'user');
  if (!firstUser) return '(empty session)';
  const line = firstUser.content.replace(/\s+/g, ' ').trim();
  return line.length > 42 ? `${line.slice(0, 42)}...` : line;
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
    await fetch('/api/ask-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
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

  /** Load sessions from server, pick the matching one or create fresh. */
  const initSessions = useCallback(async () => {
    const sorted = (await fetchSessions())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    setSessions(sorted);

    const matched = currentFile
      ? sorted.find((sess) => sess.currentFile === currentFile)
      : sorted[0];

    if (matched) {
      setActiveSessionId(matched.id);
      setMessages(matched.messages);
    } else {
      const fresh = createSession(currentFile);
      setActiveSessionId(fresh.id);
      setMessages([]);
      const next = [fresh, ...sorted].slice(0, MAX_SESSIONS);
      setSessions(next);
      await upsertSession(fresh);
    }
  }, [currentFile]);

  /** Persist current session (debounced). */
  const persistSession = useCallback(
    (msgs: Message[], sessionId: string | null) => {
      if (!sessionId) return;
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

  /** Create a brand-new session. */
  const resetSession = useCallback(() => {
    const fresh = createSession(currentFile);
    setActiveSessionId(fresh.id);
    setMessages([]);
    setSessions((prev) => {
      const next = [fresh, ...prev]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
      void upsertSession(fresh);
      return next;
    });
  }, [currentFile]);

  /** Switch to an existing session. */
  const loadSession = useCallback(
    (id: string) => {
      const target = sessions.find((s) => s.id === id);
      if (!target) return;
      setActiveSessionId(target.id);
      setMessages(target.messages);
    },
    [sessions],
  );

  /** Delete a session. If it's the active one, create fresh. */
  const deleteSession = useCallback(
    (id: string) => {
      void removeSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);

      if (activeSessionId === id) {
        const fresh = createSession(currentFile);
        setActiveSessionId(fresh.id);
        setMessages([]);
        setSessions([fresh, ...remaining].slice(0, MAX_SESSIONS));
        void upsertSession(fresh);
      }
    },
    [activeSessionId, currentFile, sessions],
  );

  const clearAllSessions = useCallback(() => {
    const allIds = sessions.map(s => s.id);
    void removeSessions(allIds);

    const fresh = createSession(currentFile);
    setActiveSessionId(fresh.id);
    setMessages([]);
    setSessions([fresh]);
    void upsertSession(fresh);
  }, [currentFile, sessions]);

  return {
    messages,
    setMessages,
    sessions,
    activeSessionId,
    initSessions,
    persistSession,
    clearPersistTimer,
    resetSession,
    loadSession,
    deleteSession,
    clearAllSessions,
  };
}
