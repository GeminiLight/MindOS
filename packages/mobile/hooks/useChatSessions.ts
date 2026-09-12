/** Session mutations are serialized against a current snapshot, never render closures. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createSessionMeta, buildSessionTitle, sortSessionsByRecent, pruneSessionList,
  SESSIONS_META_KEY, ACTIVE_SESSION_KEY, SESSION_MESSAGES_PREFIX, LEGACY_MESSAGES_KEY,
  MAX_SESSIONS, MAX_MESSAGES_PER_SESSION, type ChatSessionMeta
} from '@/lib/chat-session-store';
import { getWorkspaceIdentity, workspaceKey, serializeWorkspace, migrateLegacyWorkspace } from '@/lib/workspace-storage';
import type { Message } from '@/lib/types';

export function useChatSessions(scope = getWorkspaceIdentity()) {
  const [loadGeneration, setLoadGeneration] = useState(0);
  const reload = useCallback(() => setLoadGeneration(n => n + 1), []);
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const store = useMemo(() => ({ sessions: [] as ChatSessionMeta[], active: null as string | null }), [scope]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const key = useCallback((name: string) => workspaceKey(name, scope), [scope]);
  const publish = useCallback(() => {
    if (!alive.current) return;
    setSessions([...store.sessions]); setActiveSessionId(store.active);
  }, [store]);
  const commit = useCallback(async (next: ChatSessionMeta[], active: string | null) => {
    await AsyncStorage.setItem(key(SESSIONS_META_KEY), JSON.stringify(next));
    if (active) await AsyncStorage.setItem(key(ACTIVE_SESSION_KEY), active);
    store.sessions = next; store.active = active; publish();
  }, [key, publish, store]);
  const mutate = useCallback(<T,>(fn: () => Promise<T>) => serializeWorkspace(key(SESSIONS_META_KEY), fn)
    .then(value => { if (alive.current) setError(''); return value; })
    .catch((e) => { if (alive.current) setError('Could not save chat on this device. Please retry.'); throw e; }), [key]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setError('');
    void mutate(async () => {
      await migrateLegacyWorkspace(scope);
      const raw = await AsyncStorage.getItem(key(SESSIONS_META_KEY));
      let list: ChatSessionMeta[] = [];
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Invalid session history');
        list = parsed.filter((item): item is ChatSessionMeta => !!item && typeof item.id === 'string' && typeof item.title === 'string');
      }
      if (!list.length) {
        const fresh = createSessionMeta();
        const legacy = await AsyncStorage.getItem(key(LEGACY_MESSAGES_KEY));
        if (legacy) {
          const messages: unknown = JSON.parse(legacy);
          if (Array.isArray(messages)) {
            fresh.title = buildSessionTitle(messages); fresh.messageCount = messages.length;
            await AsyncStorage.setItem(key(SESSION_MESSAGES_PREFIX + fresh.id), JSON.stringify(messages.slice(-MAX_MESSAGES_PER_SESSION)));
          }
        }
        list = [fresh];
      }
      const active = await AsyncStorage.getItem(key(ACTIVE_SESSION_KEY));
      if (cancelled) return;
      await commit(sortSessionsByRecent(list), list.some(s => s.id === active) ? active : list[0].id);
    }).catch(() => { }).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [commit, key, mutate, loadGeneration]);

  const createSession = useCallback((title?: string) => mutate(async () => {
    const fresh = { ...createSessionMeta(undefined, title?.trim() || 'New Chat'), customTitle: !!title?.trim() };
    const { kept, removed } = pruneSessionList([fresh, ...store.sessions], MAX_SESSIONS);
    await commit(kept, fresh.id);
    await Promise.all(removed.map(s => AsyncStorage.removeItem(key(SESSION_MESSAGES_PREFIX + s.id))));
    return fresh;
  }), [commit, key, mutate, store]);
  const selectSession = useCallback((id: string) => mutate(async () => {
    if (!store.sessions.some(s => s.id === id)) throw new Error('Session no longer exists');
    await AsyncStorage.setItem(key(ACTIVE_SESSION_KEY), id); store.active = id; publish();
  }), [key, mutate, publish, store]);
  const deleteSession = useCallback((id: string) => mutate(async () => {
    const next = store.sessions.filter(s => s.id !== id);
    if (!next.length) next.push(createSessionMeta());
    await commit(next, store.active === id ? next[0].id : store.active);
    await AsyncStorage.removeItem(key(SESSION_MESSAGES_PREFIX + id));
  }), [commit, key, mutate, store]);
  const renameSession = useCallback((id: string, title: string) => mutate(async () => {
    if (!title.trim()) throw new Error('Enter a session name');
    await commit(store.sessions.map(s => s.id === id ? { ...s, title: title.trim(), customTitle: true } : s), store.active);
  }), [commit, mutate, store]);
  const getSessionMessages = useCallback(async (id: string): Promise<Message[]> => {
    const raw = await AsyncStorage.getItem(key(SESSION_MESSAGES_PREFIX + id));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Chat history could not be read');
    return parsed.filter((m): m is Message => !!m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
  }, [key]);
  const saveSessionMessages = useCallback((id: string, messages: Message[]) => {
    // Snapshot before entering the queue: tool parts may continue changing during streaming.
    const serialized = JSON.stringify(messages.slice(-MAX_MESSAGES_PER_SESSION));
    return mutate(async () => {
      if (!store.sessions.some(s => s.id === id)) return; // A late stream cannot resurrect a deleted session.
      const messageKey = key(SESSION_MESSAGES_PREFIX + id);
      const unchanged = await AsyncStorage.getItem(messageKey) === serialized;
      if (!unchanged) await AsyncStorage.setItem(messageKey, serialized);
      const saved = JSON.parse(serialized) as Message[];
      const next = store.sessions.map(s => s.id === id ? {
        ...s, messageCount: saved.length,
        title: s.customTitle ? s.title : buildSessionTitle(saved), updatedAt: unchanged ? s.updatedAt : Date.now()
      } : s);
      await commit(sortSessionsByRecent(next), store.active);
    });
  }, [commit, key, mutate, store]);
  return {
    reload, sessions, activeSessionId, loaded, error, createSession, deleteSession, renameSession,
    setActiveSession: selectSession, getSessionMessages, saveSessionMessages
  };
}
