/**
 * Unit tests for the module-level agent-run-store (spec-chat-session-concurrency v2.1).
 * Covers: per-session message isolation, run lifecycle, late-write guards,
 * unread tracking, persistence channel (debounce + skip rules + image stripping),
 * removeSession cleanup, and submit cooldown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CONCURRENT_RUNS,
  abortRun,
  appendMessages,
  cancelPersist,
  clearUnread,
  endRun,
  flushPersist,
  getMessages,
  getRun,
  getRunCount,
  getUnread,
  isInSubmitCooldown,
  registerMetaResolver,
  registerSessionsUpdater,
  removeSession,
  replaceLastMessage,
  resetAgentRunStoreForTests,
  schedulePersist,
  setActiveSession,
  setMessages,
  startRun,
  startSubmitCooldown,
  updateRun,
} from '@/lib/agent-run-store';
import type { ChatSession, Message } from '@/lib/types';

function msg(role: 'user' | 'assistant', content: string, extra: Partial<Message> = {}): Message {
  return { role, content, timestamp: 1, ...extra };
}

function startTestRun(sessionId: string) {
  return startRun(sessionId, {
    controller: new AbortController(),
    runtimeSnapshot: null,
    reconnectMax: 3,
  });
}

describe('agent-run-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    resetAgentRunStoreForTests();
  });

  afterEach(() => {
    resetAgentRunStoreForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('per-session messages', () => {
    it('keeps interleaved streaming writes for two sessions fully isolated', () => {
      appendMessages('a', [msg('user', 'qa'), msg('assistant', '')]);
      appendMessages('b', [msg('user', 'qb'), msg('assistant', '')]);

      let aText = '';
      let bText = '';
      for (let i = 1; i <= 50; i++) {
        aText += `A${i}.`;
        bText += `B${i}.`;
        replaceLastMessage('a', msg('assistant', aText));
        replaceLastMessage('b', msg('assistant', bText));
      }

      expect(getMessages('a')[1].content).toBe(aText);
      expect(getMessages('b')[1].content).toBe(bText);
      expect(getMessages('a')[0].content).toBe('qa');
      expect(getMessages('b')[0].content).toBe('qb');
    });

    it('returns a stable empty array for unknown sessions', () => {
      expect(getMessages('missing')).toEqual([]);
      expect(getMessages('missing')).toBe(getMessages('missing'));
    });

    it('supports functional updates via setMessages', () => {
      appendMessages('a', [msg('user', 'hi')]);
      setMessages('a', (prev) => prev.filter((m) => m.role !== 'user'));
      expect(getMessages('a')).toEqual([]);
    });

    it('drops requireRun writes when the run is gone (late chunk guard)', () => {
      startTestRun('a');
      appendMessages('a', [msg('user', 'q'), msg('assistant', 'partial')]);
      endRun('a');

      replaceLastMessage('a', msg('assistant', 'late chunk'), { requireRun: true });
      setMessages('a', [msg('assistant', 'late set')], { requireRun: true });
      appendMessages('a', [msg('assistant', 'late append')], { requireRun: true });

      expect(getMessages('a')[1].content).toBe('partial');
      expect(getMessages('a')).toHaveLength(2);
    });
  });

  describe('run lifecycle', () => {
    it('tracks runs per session and enforces lookup by id', () => {
      expect(MAX_CONCURRENT_RUNS).toBe(3);
      startTestRun('a');
      startTestRun('b');
      expect(getRunCount()).toBe(2);
      expect(getRun('a')?.sessionId).toBe('a');
      expect(getRun('c')).toBeNull();

      endRun('a');
      expect(getRun('a')).toBeNull();
      expect(getRunCount()).toBe(1);
    });

    it('updates run state immutably', () => {
      const run = startTestRun('a');
      const updated = updateRun('a', { phase: 'streaming', reconnectAttempt: 2 });
      expect(updated).not.toBe(run);
      expect(getRun('a')?.phase).toBe('streaming');
      expect(getRun('a')?.reconnectAttempt).toBe(2);
      expect(updateRun('missing', { phase: 'thinking' })).toBeNull();
    });

    it('aborts the run controller without removing the run', () => {
      const run = startTestRun('a');
      abortRun('a');
      expect(run.controller.signal.aborted).toBe(true);
      expect(getRun('a')).not.toBeNull();
    });

    it('marks unread on endRun only when the session is not active', () => {
      setActiveSession('a');
      startTestRun('a');
      startTestRun('b');
      appendMessages('a', [msg('user', 'q')]);
      appendMessages('b', [msg('user', 'q')]);

      endRun('a');
      endRun('b');

      expect(getUnread().has('a')).toBe(false);
      expect(getUnread().has('b')).toBe(true);

      clearUnread('b');
      expect(getUnread().has('b')).toBe(false);
    });
  });

  describe('persistence channel', () => {
    it('debounces schedulePersist into one POST with resolver metadata and store messages', async () => {
      const meta: ChatSession = {
        id: 'a',
        title: 'My chat',
        createdAt: 10,
        updatedAt: 10,
        messages: [],
      };
      registerMetaResolver((id) => (id === 'a' ? meta : null));
      appendMessages('a', [msg('user', 'hello')]);
      schedulePersist('a');
      schedulePersist('a');

      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(700);

      const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(String(calls[0][1]?.body));
      expect(body.session).toMatchObject({
        id: 'a',
        title: 'My chat',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(body.session.updatedAt).toBeGreaterThan(10);
    });

    it('strips base64 image data from the persisted payload', async () => {
      appendMessages('a', [
        msg('user', 'see image', {
          images: [{ type: 'image', data: 'base64payload', mimeType: 'image/png' }],
        }),
      ]);
      schedulePersist('a');
      await vi.advanceTimersByTimeAsync(700);

      const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(String(calls[0][1]?.body));
      expect(body.session.messages[0].images[0].data).toBe('');
    });

    it('skips persistence while a run is streaming into an empty assistant placeholder', () => {
      startTestRun('a');
      appendMessages('a', [msg('user', 'q'), msg('assistant', '')]);
      flushPersist('a');
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();

      // After the run ends, the same flush persists.
      endRun('a');
      const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(calls).toHaveLength(1);
    });

    it('does not persist sessions without messages or durable bindings', () => {
      registerMetaResolver((id) => (id === 'a'
        ? { id: 'a', createdAt: 1, updatedAt: 1, messages: [] }
        : null));
      flushPersist('a');
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('persists metadata-only sessions that carry a durable runtime binding', () => {
      registerMetaResolver((id) => (id === 'a'
        ? {
            id: 'a',
            createdAt: 1,
            updatedAt: 1,
            messages: [],
            runtimeSessionBinding: {
              kind: 'codex-thread',
              runtime: 'codex',
              runtimeId: 'codex',
              externalSessionId: 'thread_1',
              status: 'active',
              updatedAt: 1,
            },
          }
        : null));
      flushPersist('a');
      const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(calls).toHaveLength(1);
    });

    it('notifies the registered sessions updater with the persisted payload', () => {
      const updater = vi.fn();
      registerSessionsUpdater(updater);
      appendMessages('a', [msg('user', 'hello')]);
      flushPersist('a');
      expect(updater).toHaveBeenCalledTimes(1);
      expect(updater.mock.calls[0][0]).toMatchObject({ id: 'a' });
    });

    it('cancelPersist drops a scheduled flush', async () => {
      appendMessages('a', [msg('user', 'hello')]);
      schedulePersist('a');
      cancelPersist('a');
      await vi.advanceTimersByTimeAsync(1000);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  describe('removeSession', () => {
    it('aborts the run, cancels timers, and clears every store entry', async () => {
      const run = startTestRun('a');
      appendMessages('a', [msg('user', 'q'), msg('assistant', 'partial')]);
      schedulePersist('a');
      setActiveSession('b');
      // Simulate a finished background run leaving an unread mark.
      startTestRun('c');
      endRun('c');
      expect(getUnread().has('c')).toBe(true);

      removeSession('a');
      removeSession('c');

      expect(run.controller.signal.aborted).toBe(true);
      expect(getRun('a')).toBeNull();
      expect(getMessages('a')).toEqual([]);
      expect(getUnread().has('c')).toBe(false);

      // No zombie persist timer fires after removal.
      await vi.advanceTimersByTimeAsync(1000);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();

      // Late chunks from the dead run are dropped.
      replaceLastMessage('a', msg('assistant', 'late'), { requireRun: true });
      expect(getMessages('a')).toEqual([]);
    });
  });

  describe('submit cooldown', () => {
    it('blocks per-session for a short window after stop, without affecting other sessions', () => {
      startSubmitCooldown('a');
      expect(isInSubmitCooldown('a')).toBe(true);
      expect(isInSubmitCooldown('b')).toBe(false);

      vi.advanceTimersByTime(400);
      expect(isInSubmitCooldown('a')).toBe(false);
    });
  });
});
