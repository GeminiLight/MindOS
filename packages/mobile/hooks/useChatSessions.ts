/**
 * useChatSessions — React hook for managing multiple chat sessions.
 *
 * Provides session CRUD, switching, and migration from legacy single-session storage.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type ChatSessionMeta,
  SESSIONS_META_KEY,
  ACTIVE_SESSION_KEY,
  SESSION_MESSAGES_PREFIX,
  LEGACY_MESSAGES_KEY,
  LEGACY_SESSION_KEY,
  MAX_SESSIONS,
  MAX_MESSAGES_PER_SESSION,
  buildSessionTitle,
  sortSessionsByRecent,
  generateSessionId,
  createSessionMeta,
  pruneSessionList,
} from '@/lib/chat-session-store';
import type { Message } from '@/lib/types';

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // --- Load sessions on mount ---
  useEffect(() => {
    (async () => {
      try {
        // Check for legacy migration first
        const legacyMessages = await AsyncStorage.getItem(LEGACY_MESSAGES_KEY);
        if (legacyMessages) {
          const migrated = await migrateLegacySession();
          if (migrated) {
            setSessions([migrated]);
            setActiveSessionIdState(migrated.id);
            setLoaded(true);
            return;
          }
        }

        // Load sessions metadata
        const storedMeta = await AsyncStorage.getItem(SESSIONS_META_KEY);
        const storedActive = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);

        let sessionList: ChatSessionMeta[] = [];
        if (storedMeta) {
          try {
            sessionList = JSON.parse(storedMeta);
          } catch { /* corrupt, start fresh */ }
        }

        if (sessionList.length === 0) {
          const freshSession = createSessionMeta();
          await AsyncStorage.setItem(SESSIONS_META_KEY, JSON.stringify([freshSession]));
          await AsyncStorage.setItem(ACTIVE_SESSION_KEY, freshSession.id);
          setSessions([freshSession]);
          setActiveSessionIdState(freshSession.id);
          setLoaded(true);
          return;
        }

        const sortedSessions = sortSessionsByRecent(sessionList);
        const nextActiveSessionId = storedActive && sortedSessions.some((session) => session.id === storedActive)
          ? storedActive
          : sortedSessions[0].id;

        setSessions(sortedSessions);
        setActiveSessionIdState(nextActiveSessionId);
      } catch { /* storage error */ }
      setLoaded(true);
    })();
  }, []);

  // --- Persist sessions metadata ---
  const persistSessions = useCallback(async (newSessions: ChatSessionMeta[]) => {
    await AsyncStorage.setItem(SESSIONS_META_KEY, JSON.stringify(newSessions));
  }, []);

  // --- Set active session ---
  const setActiveSession = useCallback(async (sessionId: string) => {
    setActiveSessionIdState(sessionId);
    await AsyncStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  }, []);

  // --- Create new session ---
  const createSession = useCallback(async (title?: string): Promise<ChatSessionMeta> => {
    const newSession = createSessionMeta(generateSessionId(), title || 'New Chat');
    const { kept, removed } = pruneSessionList([newSession, ...sessions], MAX_SESSIONS);
    setSessions(kept);
    await persistSessions(kept);
    await Promise.all(removed.map((session) => AsyncStorage.removeItem(SESSION_MESSAGES_PREFIX + session.id)));
    await setActiveSession(newSession.id);

    return newSession;
  }, [sessions, persistSessions, setActiveSession]);

  // --- Delete session ---
  const deleteSession = useCallback(async (sessionId: string) => {
    const newSessions = sessions.filter((s) => s.id !== sessionId);
    setSessions(newSessions);
    await persistSessions(newSessions);
    await AsyncStorage.removeItem(SESSION_MESSAGES_PREFIX + sessionId);

    // If deleted active session, switch to most recent or create new
    if (activeSessionId === sessionId) {
      if (newSessions.length > 0) {
        await setActiveSession(newSessions[0].id);
      } else {
        const fresh = await createSession();
        // createSession already sets active
        return fresh;
      }
    }
  }, [sessions, activeSessionId, persistSessions, setActiveSession, createSession]);

  // --- Rename session ---
  const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
    setSessions((prevSessions) => {
      const updated = prevSessions.map((s) =>
        s.id === sessionId ? { ...s, title: newTitle, updatedAt: Date.now() } : s
      );
      const sorted = sortSessionsByRecent(updated);
      void persistSessions(sorted);
      return sorted;
    });
  }, [persistSessions]);

  // --- Get session messages ---
  const getSessionMessages = useCallback(async (sessionId: string): Promise<Message[]> => {
    const stored = await AsyncStorage.getItem(SESSION_MESSAGES_PREFIX + sessionId);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  // --- Save session messages ---
  const saveSessionMessages = useCallback(async (sessionId: string, messages: Message[]) => {
    const toSave = messages.slice(-MAX_MESSAGES_PER_SESSION);
    await AsyncStorage.setItem(SESSION_MESSAGES_PREFIX + sessionId, JSON.stringify(toSave));

    setSessions((prevSessions) => {
      const updated = prevSessions.map((s) =>
        s.id === sessionId
          ? { ...s, messageCount: toSave.length, title: buildSessionTitle(toSave), updatedAt: Date.now() }
          : s
      );
      const sorted = sortSessionsByRecent(updated);
      void persistSessions(sorted);
      return sorted;
    });
  }, [persistSessions]);

  // --- Migrate legacy single-session data ---
  async function migrateLegacySession(): Promise<ChatSessionMeta | null> {
    try {
      const legacyMessages = await AsyncStorage.getItem(LEGACY_MESSAGES_KEY);
      if (!legacyMessages) return null;

      const messages: Message[] = JSON.parse(legacyMessages);
      if (!Array.isArray(messages) || messages.length === 0) {
        await AsyncStorage.removeItem(LEGACY_MESSAGES_KEY);
        await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
        return null;
      }

      const now = Date.now();
      const newSession: ChatSessionMeta = {
        ...createSessionMeta(generateSessionId(), buildSessionTitle(messages), now),
        messageCount: messages.length,
      };

      // Save migrated data
      await AsyncStorage.setItem(SESSION_MESSAGES_PREFIX + newSession.id, JSON.stringify(messages.slice(-MAX_MESSAGES_PER_SESSION)));
      await AsyncStorage.setItem(SESSIONS_META_KEY, JSON.stringify([newSession]));
      await AsyncStorage.setItem(ACTIVE_SESSION_KEY, newSession.id);

      // Clean up legacy keys
      await AsyncStorage.removeItem(LEGACY_MESSAGES_KEY);
      await AsyncStorage.removeItem(LEGACY_SESSION_KEY);

      return newSession;
    } catch {
      return null;
    }
  }

  return {
    sessions,
    activeSessionId,
    loaded,
    createSession,
    deleteSession,
    renameSession,
    setActiveSession,
    getSessionMessages,
    saveSessionMessages,
  };
}
