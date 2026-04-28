import { describe, expect, it } from 'vitest';
import {
  buildSessionTitle,
  sortSessionsByRecent,
  generateSessionId,
  createSessionMeta,
  pruneSessionList,
  MAX_SESSIONS,
  MAX_MESSAGES_PER_SESSION,
  type ChatSessionMeta,
} from '@/lib/chat-session-store';
import type { Message } from '@/lib/types';

describe('chat-session-store', () => {
  describe('buildSessionTitle', () => {
    it('returns New Chat for empty messages', () => {
      expect(buildSessionTitle([])).toBe('New Chat');
    });

    it('returns New Chat when no user message exists', () => {
      const messages: Message[] = [{ role: 'assistant', content: 'Hello' }];
      expect(buildSessionTitle(messages)).toBe('New Chat');
    });

    it('truncates long user messages to 30 chars', () => {
      const messages: Message[] = [
        { role: 'user', content: 'This is a very long message that should be truncated' },
      ];
      expect(buildSessionTitle(messages)).toBe('This is a very long message...');
    });

    it('keeps short messages as-is', () => {
      const messages: Message[] = [{ role: 'user', content: 'Short message' }];
      expect(buildSessionTitle(messages)).toBe('Short message');
    });

    it('uses first user message even if assistant replied first', () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'How can I help?' },
        { role: 'user', content: 'My question' },
      ];
      expect(buildSessionTitle(messages)).toBe('My question');
    });
  });

  describe('sortSessionsByRecent', () => {
    it('sorts sessions by updatedAt descending', () => {
      const sessions: ChatSessionMeta[] = [
        { id: '1', title: 'Old', messageCount: 1, createdAt: 100, updatedAt: 100 },
        { id: '2', title: 'New', messageCount: 2, createdAt: 200, updatedAt: 300 },
        { id: '3', title: 'Mid', messageCount: 3, createdAt: 150, updatedAt: 200 },
      ];
      const sorted = sortSessionsByRecent(sessions);
      expect(sorted.map((s) => s.id)).toEqual(['2', '3', '1']);
    });

    it('returns empty array for empty input', () => {
      expect(sortSessionsByRecent([])).toEqual([]);
    });
  });

  describe('generateSessionId', () => {
    it('generates unique session IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      expect(id1).not.toBe(id2);
    });

    it('generates IDs starting with session-', () => {
      const id = generateSessionId();
      expect(id.startsWith('session-')).toBe(true);
    });
  });

  describe('createSessionMeta', () => {
    it('creates a default empty session meta', () => {
      const meta = createSessionMeta('session-1', 'New Chat', 123);
      expect(meta).toEqual({
        id: 'session-1',
        title: 'New Chat',
        messageCount: 0,
        createdAt: 123,
        updatedAt: 123,
      });
    });
  });

  describe('pruneSessionList', () => {
    it('keeps only the first N sessions and reports removed ones', () => {
      const sessions: ChatSessionMeta[] = [
        { id: '1', title: 'One', messageCount: 1, createdAt: 1, updatedAt: 1 },
        { id: '2', title: 'Two', messageCount: 2, createdAt: 2, updatedAt: 2 },
        { id: '3', title: 'Three', messageCount: 3, createdAt: 3, updatedAt: 3 },
      ];
      expect(pruneSessionList(sessions, 2)).toEqual({
        kept: [sessions[0], sessions[1]],
        removed: [sessions[2]],
      });
    });
  });

  describe('limits', () => {
    it('exports reasonable session limit', () => {
      expect(MAX_SESSIONS).toBe(50);
    });

    it('exports reasonable message limit per session', () => {
      expect(MAX_MESSAGES_PER_SESSION).toBe(200);
    });
  });
});
