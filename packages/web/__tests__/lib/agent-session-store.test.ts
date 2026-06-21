/**
 * agent-session-store — component-independent session metadata store
 * (wiki/specs/spec-chat-session-concurrency.md, PR3 展开设计 v3).
 *
 * Covers the PR3 acceptance items that live at store level: shared metadata,
 * single-flight initSessions, slot-free persistence metadata, single-source
 * activeSessionId, noteCurrentFile, and delete/attach interplay with runs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentRuntimeIdentity, ChatSession, Message } from '@/lib/types';
import {
  MAX_SESSIONS,
  attachRuntimeSession,
  clearSessions,
  createSessionEntry,
  deleteSession,
  getActiveSessionId,
  getSessions,
  getSessionsLoaded,
  initSessions,
  loadSession,
  noteCurrentFile,
  refreshSessions,
  renameSession,
  resetAgentSessionStoreForTests,
  resetSession,
  togglePinSession,
} from '@/lib/agent-session-store';
import {
  endRun,
  flushPersist,
  getActiveSession as runStoreActiveSession,
  getMessages,
  getUnread,
  resetAgentRunStoreForTests,
  setMessages as storeSetMessages,
  startRun,
} from '@/lib/agent-run-store';
import { createStudioProject } from '@/lib/studio-projects';

const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };

function userMsg(content: string): Message {
  return { role: 'user', content } as Message;
}

function serverSession(partial: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    createdAt: 1_000,
    updatedAt: 1_000,
    messages: [userMsg('hello')],
    ...partial,
  };
}

type FetchCall = { url: string; init?: RequestInit };

function installFetchMock(sessions: ChatSession[] = []) {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!init?.method || init.method === 'GET') {
      return { ok: true, json: async () => sessions } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal('fetch', mock);
  const byMethod = (method: string) =>
    calls.filter((c) => (c.init?.method ?? 'GET') === method);
  return { calls, byMethod };
}

function lastPostPayload(byMethod: (m: string) => FetchCall[]): ChatSession {
  const posts = byMethod('POST');
  expect(posts.length).toBeGreaterThan(0);
  return (JSON.parse(posts[posts.length - 1].init!.body as string) as { session: ChatSession }).session;
}

beforeEach(() => {
  resetAgentRunStoreForTests();
  resetAgentSessionStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent-session-store', () => {
  describe('createSessionEntry (legacy createSession semantics)', () => {
    it('creates an unbound session for mindos / no runtime', () => {
      const plain = createSessionEntry('notes/a.md');
      expect(plain.currentFile).toBe('notes/a.md');
      expect(plain.messages).toEqual([]);
      expect(plain.runtimeSessionBinding ?? null).toBeNull();
      expect(plain.externalAgentBinding ?? null).toBeNull();

      const mindos = createSessionEntry(undefined, { id: 'mindos', name: 'MindOS', kind: 'mindos' });
      expect(mindos.runtimeSessionBinding ?? null).toBeNull();
      expect(mindos.defaultAcpAgent ?? null).toBeNull();
    });

    it('binds the acp agent lane', () => {
      const acp = createSessionEntry(undefined, { id: 'my-acp', name: 'My ACP', kind: 'acp' });
      expect(acp.defaultAcpAgent).toEqual({ id: 'my-acp', name: 'My ACP' });
      expect(acp.runtimeSessionBinding ?? null).toBeNull();
    });

    it('binds the native runtime lane', () => {
      const codex = createSessionEntry(undefined, codexRuntime);
      expect(codex.runtimeSessionBinding?.runtime).toBe('codex');
      expect(codex.runtimeSessionBinding?.runtimeId).toBe('codex');
      expect(codex.externalAgentBinding?.runtime).toBe('codex');
    });

    it('generates unique ids', () => {
      const ids = new Set(Array.from({ length: 50 }, () => createSessionEntry().id));
      expect(ids.size).toBe(50);
    });

    it('inherits WorkDir, Spaces, and AI Kit defaults from the requested Project', () => {
      const project = createStudioProject({
        title: 'Growth Room',
        goal: 'Train launch review habits',
        workDir: {
          source: 'manual',
          path: '/Users/moonshot/projects/product/mindos-dev',
          label: 'mindos-dev',
        },
        spaces: [
          { path: 'MIND_DAO', label: '道', icon: '道', source: 'project-default' },
          { path: 'Product Strategy', label: 'Product Strategy', source: 'manual' },
        ],
        assistants: [
          { id: 'research-kit', name: 'Research Kit', kind: 'team', source: 'builtin' },
          { id: 'review-kit', name: 'Review Kit', kind: 'team', source: 'manual' },
        ],
      });

      const session = createSessionEntry(undefined, null, project.id);

      expect(session).toMatchObject({
        source: 'project',
        projectId: project.id,
        workDir: {
          source: 'manual',
          path: '/Users/moonshot/projects/product/mindos-dev',
          label: 'mindos-dev',
        },
      });
      expect(session.contextSelection?.spaces.map((space) => space.path)).toEqual(['MIND_DAO', 'Product Strategy']);
      expect(session.contextSelection?.assistants.map((assistant) => assistant.id)).toEqual(['research-kit', 'review-kit']);
    });
  });

  describe('initSessions', () => {
    it('deduplicates concurrent calls into a single fetch and a single fresh session', async () => {
      const { byMethod } = installFetchMock([]);
      await Promise.all([initSessions({}), initSessions({})]);

      expect(byMethod('GET').length).toBe(1);
      const sessions = getSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].messages).toEqual([]);
      expect(getActiveSessionId()).toBe(sessions[0].id);
    });

    it('matches the server session, backfills its messages, and activates it', async () => {
      const msgs = [userMsg('from server'), { role: 'assistant', content: 'answer' } as Message];
      installFetchMock([serverSession({ id: 's1', title: 'Server title', messages: msgs })]);

      await initSessions({});

      expect(getActiveSessionId()).toBe('s1');
      expect(getMessages('s1').map((m) => m.content)).toEqual(['from server', 'answer']);
      expect(getSessions().find((s) => s.id === 's1')?.title).toBe('Server title');
    });

    it('keeps sessions with a live run that the server does not know about', async () => {
      installFetchMock([]);
      await initSessions({});
      const fresh = getActiveSessionId()!;
      storeSetMessages(fresh, [userMsg('queued')], { skipPersist: true });
      const controller = new AbortController();
      startRun(fresh, { controller, runtimeSnapshot: null, reconnectMax: 0 });

      await initSessions({});

      expect(getSessions().some((s) => s.id === fresh)).toBe(true);
      endRun(fresh);
    });
  });

  describe('persistence metadata without component registration', () => {
    it('flushPersist payload reads title/bindings straight from the session store', async () => {
      const { byMethod } = installFetchMock([
        serverSession({ id: 's1', title: 'My research' }),
      ]);
      await initSessions({});

      storeSetMessages('s1', [userMsg('hello'), { role: 'assistant', content: 'done' } as Message]);
      flushPersist('s1');

      const payload = lastPostPayload(byMethod);
      expect(payload.id).toBe('s1');
      expect(payload.title).toBe('My research');
      expect(payload.messages.map((m) => m.content)).toEqual(['hello', 'done']);
    });

    it('re-wires the run-store bridges after both stores are reset', async () => {
      // setup.ts resets the run store (which nulls the bridge slots) and then the
      // session store; the session store reset must re-wire or persistence would
      // silently lose metadata for every test (and HMR reload) thereafter.
      resetAgentRunStoreForTests();
      resetAgentSessionStoreForTests();

      const { byMethod } = installFetchMock([serverSession({ id: 's2', title: 'After reset' })]);
      await initSessions({});
      storeSetMessages('s2', [userMsg('hi'), { role: 'assistant', content: 'ok' } as Message]);
      flushPersist('s2');

      expect(lastPostPayload(byMethod).title).toBe('After reset');
    });
  });

  describe('activeSessionId single source', () => {
    it('loadSession writes through to the run store so endRun unread judgement agrees with the UI', async () => {
      installFetchMock([
        serverSession({ id: 'a', updatedAt: 2_000 }),
        serverSession({ id: 'b', updatedAt: 1_000 }),
      ]);
      await initSessions({});
      loadSession('a');
      expect(runStoreActiveSession()).toBe('a');

      const controller = new AbortController();
      startRun('a', { controller, runtimeSnapshot: null, reconnectMax: 0 });
      startRun('b', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 0 });
      endRun('a'); // finished while active → read
      endRun('b'); // finished in background → unread
      expect(getUnread().has('a')).toBe(false);
      expect(getUnread().has('b')).toBe(true);

      loadSession('b');
      expect(getUnread().has('b')).toBe(false);
    });
  });

  describe('shared metadata mutations', () => {
    it('renameSession updates the shared list and persists', async () => {
      const { byMethod } = installFetchMock([serverSession({ id: 's1' })]);
      await initSessions({});

      renameSession('s1', '  New name  ');
      expect(getSessions().find((s) => s.id === 's1')?.title).toBe('New name');
      expect(lastPostPayload(byMethod).title).toBe('New name');
    });

    it('togglePinSession flips pinned and only persists persistable sessions', async () => {
      installFetchMock([serverSession({ id: 's1' })]);
      await initSessions({});
      togglePinSession('s1');
      expect(getSessions().find((s) => s.id === 's1')?.pinned).toBe(true);
      togglePinSession('s1');
      expect(getSessions().find((s) => s.id === 's1')?.pinned).toBe(false);
    });

    it('noteCurrentFile lands in the next persist payload without reordering or bumping updatedAt', async () => {
      const { byMethod } = installFetchMock([
        serverSession({ id: 'newer', updatedAt: 9_000 }),
        serverSession({ id: 'older', updatedAt: 2_000 }),
      ]);
      await initSessions({});
      const before = getSessions().map((s) => ({ id: s.id, updatedAt: s.updatedAt }));

      noteCurrentFile('older', 'notes/focus.md');

      expect(getSessions().map((s) => ({ id: s.id, updatedAt: s.updatedAt }))).toEqual(before);
      expect(getSessions().find((s) => s.id === 'older')?.currentFile).toBe('notes/focus.md');

      flushPersist('older');
      expect(lastPostPayload(byMethod).currentFile).toBe('notes/focus.md');
    });
  });

  describe('lifecycle operations', () => {
    it('deleteSession aborts the run, clears store entries, and replaces the active session', async () => {
      installFetchMock([serverSession({ id: 's1' })]);
      await initSessions({});
      const controller = new AbortController();
      startRun('s1', { controller, runtimeSnapshot: null, reconnectMax: 0 });

      deleteSession('s1', {});

      expect(controller.signal.aborted).toBe(true);
      expect(getMessages('s1')).toEqual([]);
      expect(getSessions().some((s) => s.id === 's1')).toBe(false);
      const active = getActiveSessionId();
      expect(active).not.toBeNull();
      expect(active).not.toBe('s1');
    });

    it('resetSession reuses an already-empty active session instead of stacking new ones', async () => {
      installFetchMock([]);
      await initSessions({});
      const first = getActiveSessionId();
      resetSession({});
      expect(getActiveSessionId()).toBe(first);
      expect(getSessions().length).toBe(1);
    });

    it('loadSession drops the abandoned empty session it leaves behind', async () => {
      installFetchMock([serverSession({ id: 'kept' })]);
      await initSessions({});
      resetSession({ currentFile: 'other.md' });
      const emptyId = getActiveSessionId()!;
      expect(emptyId).not.toBe('kept');

      loadSession('kept');
      expect(getSessions().some((s) => s.id === emptyId)).toBe(false);
      expect(getActiveSessionId()).toBe('kept');
    });

    it('clearSessions removes everything and starts fresh', async () => {
      installFetchMock([serverSession({ id: 's1' }), serverSession({ id: 's2' })]);
      await initSessions({});
      clearSessions(undefined, {});
      const sessions = getSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].messages).toEqual([]);
      expect(sessions.length).toBeLessThanOrEqual(MAX_SESSIONS);
    });
  });

  describe('attachRuntimeSession', () => {
    it('refuses while the matched session is running, attaches after the run ends', async () => {
      installFetchMock([
        serverSession({
          id: 'bound',
          runtimeSessionBinding: {
            kind: 'codex-thread',
            runtime: 'codex',
            runtimeId: 'codex',
            externalSessionId: 'ext-1',
            status: 'active',
            updatedAt: 1_000,
          },
        }),
      ]);
      await initSessions({});
      const controller = new AbortController();
      startRun('bound', { controller, runtimeSnapshot: codexRuntime, reconnectMax: 0 });

      expect(attachRuntimeSession(codexRuntime, { externalSessionId: 'ext-1' })).toBe(false);

      endRun('bound');
      expect(attachRuntimeSession(codexRuntime, { externalSessionId: 'ext-1' }, { title: 'Thread' })).toBe(true);
      expect(getActiveSessionId()).toBe('bound');
      expect(getSessions().find((s) => s.id === 'bound')?.title).toBe('Thread');
    });
  });

  describe('refreshSessions / getSessionsLoaded (titlebar Phase 2)', () => {
    it('marks sessions loaded only after a successful fetch+merge', async () => {
      installFetchMock([serverSession({ id: 's1' })]);
      expect(getSessionsLoaded()).toBe(false);
      await refreshSessions();
      expect(getSessionsLoaded()).toBe(true);
      expect(getSessions().some((s) => s.id === 's1')).toBe(true);
    });

    it('keeps local sessions and stays "not loaded" when the fetch fails', async () => {
      installFetchMock([serverSession({ id: 'kept' })]);
      await refreshSessions();
      expect(getSessionsLoaded()).toBe(true);
      resetAgentSessionStoreForTests();

      // Network down: a failure result must not be merged as an empty list,
      // or the tab-strip reconcile would close every chat tab.
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
      loadSession('local-only'); // no-op for unknown id, but list may hold local entries
      const before = getSessions();
      await refreshSessions();
      expect(getSessionsLoaded()).toBe(false);
      expect(getSessions()).toEqual(before);
    });

    it('treats non-ok and non-array payloads as failures', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] }) as Response));
      await refreshSessions();
      expect(getSessionsLoaded()).toBe(false);

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ nope: 1 }) }) as Response));
      await refreshSessions();
      expect(getSessionsLoaded()).toBe(false);
    });

    it('does not move the active session (no selection phase)', async () => {
      installFetchMock([serverSession({ id: 's1' }), serverSession({ id: 's2' })]);
      await initSessions({});
      loadSession('s2');
      await refreshSessions();
      expect(getActiveSessionId()).toBe('s2');
    });

    it('keeps a just-created (unflushed) active session across a concurrent refresh', async () => {
      // /chat/new flow: resetSession creates a fresh empty session that the
      // server has never seen; the tab strip's refreshSessions on mount must
      // not wipe it (would dead-end the route on the fallback page).
      installFetchMock([serverSession({ id: 'server-1' })]);
      resetSession({});
      const freshId = getActiveSessionId();
      expect(freshId).toBeTruthy();

      await refreshSessions();
      expect(getSessions().some((s) => s.id === freshId)).toBe(true);
      expect(getActiveSessionId()).toBe(freshId);
      expect(getSessions().some((s) => s.id === 'server-1')).toBe(true);
    });

    it('still drops abandoned empty local sessions that are not active', async () => {
      installFetchMock([serverSession({ id: 'server-1' })]);
      resetSession({});
      const abandonedId = getActiveSessionId()!;
      await refreshSessions();
      loadSession('server-1'); // navigating away drops the empty leftover
      await refreshSessions();
      expect(getSessions().some((s) => s.id === abandonedId)).toBe(false);
    });
  });
});
