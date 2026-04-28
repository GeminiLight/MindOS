import type { Message } from '@/lib/types';

export interface ChatSessionMeta {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSessionStore {
  sessions: ChatSessionMeta[];
  activeSessionId: string | null;
}

export interface ChatSessionActions {
  loadStore(): Promise<ChatSessionStore>;
  getSessionMessages(sessionId: string): Promise<Message[]>;
  saveSessionMessages(sessionId: string, messages: Message[]): Promise<void>;
  createSession(title?: string): Promise<ChatSessionMeta>;
  deleteSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, newTitle: string): Promise<void>;
  setActiveSession(sessionId: string): Promise<void>;
  migrateFromLegacy(): Promise<ChatSessionMeta | null>;
}

// Storage keys
export const SESSIONS_META_KEY = 'mindos_chat_sessions';
export const ACTIVE_SESSION_KEY = 'mindos_chat_active_session';
export const SESSION_MESSAGES_PREFIX = 'mindos_chat_session_';
export const LEGACY_MESSAGES_KEY = 'mindos_chat_messages';
export const LEGACY_SESSION_KEY = 'mindos_chat_session';

// Limits
export const MAX_SESSIONS = 50;
export const MAX_MESSAGES_PER_SESSION = 200;

// Pure helpers
export const buildSessionTitle = (messages: Message[]): string => {
  if (!messages.length) return 'New Chat';
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg?.content) return 'New Chat';
  const text = firstUserMsg.content.trim();
  return text.length > 30 ? `${text.slice(0, 27)}...` : text;
};

export const sortSessionsByRecent = (sessions: ChatSessionMeta[]): ChatSessionMeta[] =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

export const generateSessionId = (): string => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createSessionMeta = (
  id = generateSessionId(),
  title = 'New Chat',
  now = Date.now(),
): ChatSessionMeta => ({
  id,
  title,
  messageCount: 0,
  createdAt: now,
  updatedAt: now,
});

export const pruneSessionList = (
  sessions: ChatSessionMeta[],
  maxSessions = MAX_SESSIONS,
): { kept: ChatSessionMeta[]; removed: ChatSessionMeta[] } => ({
  kept: sessions.slice(0, maxSessions),
  removed: sessions.slice(maxSessions),
});
