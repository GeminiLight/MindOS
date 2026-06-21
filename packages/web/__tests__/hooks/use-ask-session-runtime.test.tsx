/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAskSession } from '@/hooks/useAskSession';
import { getSessionAgentRuntime, isSessionInRuntimeLane } from '@/lib/ask-agent';
import {
  getMessages,
  setMessages as storeSetMessages,
  startRun,
  endRun,
} from '@/lib/agent-run-store';
import type { AgentRuntimeIdentity, ChatSession } from '@/lib/types';

const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
const claudeRuntime: AgentRuntimeIdentity = { id: 'claude', name: 'Claude Code', kind: 'claude' };

type AskSessionState = ReturnType<typeof useAskSession>;

function renderUseAskSession(projectId?: string): {
  getLatest: () => AskSessionState;
  root: Root;
} {
  let latest: AskSessionState | null = null;

  function Probe() {
    latest = useAskSession(undefined, projectId);
    return null;
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    getLatest: () => {
      if (!latest) throw new Error('useAskSession did not render');
      return latest;
    },
    root,
  };
}

describe('useAskSession native runtime lane', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates new empty sessions in the selected Codex runtime lane', () => {
    const { getLatest, root } = renderUseAskSession();

    act(() => {
      getLatest().resetSession(codexRuntime);
    });

    const active = getLatest().activeSession;
    expect(active).not.toBeNull();
    expect(getSessionAgentRuntime(active)).toEqual(codexRuntime);
    expect(isSessionInRuntimeLane(active!, codexRuntime)).toBe(true);
    expect(isSessionInRuntimeLane(active!, null)).toBe(false);

    act(() => {
      root.unmount();
    });
  });

  it('keeps the active Claude Code runtime when deleting the active session', () => {
    const { getLatest, root } = renderUseAskSession();

    act(() => {
      getLatest().resetSession(claudeRuntime);
    });

    const claudeSessionId = getLatest().activeSessionId;
    expect(claudeSessionId).toBeTruthy();

    act(() => {
      getLatest().deleteSession(claudeSessionId!, claudeRuntime);
    });

    const replacement = getLatest().activeSession;
    expect(replacement).not.toBeNull();
    expect(replacement?.id).not.toBe(claudeSessionId);
    expect(getSessionAgentRuntime(replacement)).toEqual(claudeRuntime);
    expect(isSessionInRuntimeLane(replacement!, claudeRuntime)).toBe(true);
    expect(isSessionInRuntimeLane(replacement!, null)).toBe(false);

    act(() => {
      root.unmount();
    });
  });

  it('keeps metadata-only native runtime sessions when pruning leaked empty sessions', async () => {
    const linkedCodexSession: ChatSession = {
      id: 'linked-codex',
      title: 'Existing Codex thread',
      createdAt: 10,
      updatedAt: 10,
      messages: [],
      defaultAgentRuntime: codexRuntime,
      runtimeSessionBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thread_existing',
        cwd: '/tmp/mindos',
        status: 'active',
        updatedAt: 10,
      },
    };
    const leakedEmptySession: ChatSession = {
      id: 'leaked-empty',
      createdAt: 9,
      updatedAt: 9,
      messages: [],
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return { ok: true, json: async () => [linkedCodexSession, leakedEmptySession] };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getLatest, root } = renderUseAskSession();

    await act(async () => {
      await getLatest().initSessions();
    });

    expect(getLatest().sessions.map((session) => session.id)).toContain('linked-codex');
    expect(getLatest().sessions.map((session) => session.id)).not.toContain('leaked-empty');
    expect(getLatest().activeSessionId).toBe('linked-codex');
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(deleteCall).toBeTruthy();
    expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({ ids: ['leaked-empty'] });

    act(() => {
      root.unmount();
    });
  });

  it('initSessions backfills missing messages but never clobbers newer local or running state', async () => {
    const serverSession: ChatSession = {
      id: 'persisted',
      title: 'Persisted chat',
      createdAt: 10,
      updatedAt: 10,
      messages: [
        { role: 'user', content: 'old question', timestamp: 10 },
        { role: 'assistant', content: 'old stale answer', timestamp: 10 },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return { ok: true, json: async () => [serverSession] };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }));

    // Branch 1 (missing): no local copy → server messages backfill the store.
    const { getLatest, root } = renderUseAskSession();
    await act(async () => {
      await getLatest().initSessions();
    });
    expect(getMessages('persisted')[1].content).toBe('old stale answer');

    // Branch 2 (newer local): a fresher local write survives a remount-style re-init.
    const newer = [
      { role: 'user' as const, content: 'old question', timestamp: 10 },
      { role: 'assistant' as const, content: 'streamed final answer', timestamp: Date.now() },
    ];
    act(() => {
      storeSetMessages('persisted', newer, { skipPersist: true });
    });
    await act(async () => {
      await getLatest().initSessions();
    });
    expect(getMessages('persisted')[1].content).toBe('streamed final answer');

    // Branch 3 (running): a live run's messages are untouchable even if the
    // server snapshot claims a future updatedAt.
    act(() => {
      startRun('persisted', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 3 });
    });
    serverSession.updatedAt = Date.now() + 60_000;
    await act(async () => {
      await getLatest().initSessions();
    });
    expect(getMessages('persisted')[1].content).toBe('streamed final answer');
    act(() => {
      endRun('persisted');
    });

    act(() => {
      root.unmount();
    });
  });

  it('initializes into the requested native runtime lane instead of loading a newer MindOS chat', async () => {
    const mindosSession: ChatSession = {
      id: 'newer-mindos',
      createdAt: 20,
      updatedAt: 20,
      messages: [{ role: 'user', content: 'mindos chat' }],
    };
    const codexSession: ChatSession = {
      id: 'older-codex',
      createdAt: 10,
      updatedAt: 10,
      messages: [{ role: 'user', content: 'codex chat' }],
      defaultAgentRuntime: codexRuntime,
    };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [mindosSession, codexSession] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatest, root } = renderUseAskSession();

    await act(async () => {
      await getLatest().initSessions(codexRuntime);
    });

    expect(getLatest().activeSessionId).toBe('older-codex');
    expect(getLatest().messages).toEqual(codexSession.messages);
    expect(getSessionAgentRuntime(getLatest().activeSession)).toEqual(codexRuntime);

    act(() => {
      root.unmount();
    });
  });

  it('creates a fresh requested native runtime session when no saved chat is in that lane', async () => {
    const mindosSession: ChatSession = {
      id: 'newer-mindos',
      createdAt: 20,
      updatedAt: 20,
      messages: [{ role: 'user', content: 'mindos chat' }],
    };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [mindosSession] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatest, root } = renderUseAskSession();

    await act(async () => {
      await getLatest().initSessions(codexRuntime);
    });

    const active = getLatest().activeSession;
    expect(active?.id).not.toBe('newer-mindos');
    expect(active?.messages).toEqual([]);
    expect(getSessionAgentRuntime(active)).toEqual(codexRuntime);
    expect(isSessionInRuntimeLane(active!, codexRuntime)).toBe(true);
    expect(isSessionInRuntimeLane(active!, null)).toBe(false);

    act(() => {
      root.unmount();
    });
  });

  it('initializes into the requested Project lane instead of loading a newer unrelated chat', async () => {
    const quickSession: ChatSession = {
      id: 'newer-quick',
      createdAt: 30,
      updatedAt: 30,
      messages: [{ role: 'user', content: 'quick chat' }],
    };
    const otherProjectSession: ChatSession = {
      id: 'other-project',
      source: 'project',
      projectId: 'research-practice',
      createdAt: 20,
      updatedAt: 20,
      messages: [{ role: 'user', content: 'research chat' }],
    };
    const launchProjectSession: ChatSession = {
      id: 'launch-project',
      source: 'project',
      projectId: 'launch-practice',
      createdAt: 10,
      updatedAt: 10,
      messages: [{ role: 'user', content: 'launch chat' }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [quickSession, otherProjectSession, launchProjectSession],
    })));
    const { getLatest, root } = renderUseAskSession('launch-practice');

    await act(async () => {
      await getLatest().initSessions();
    });

    expect(getLatest().activeSessionId).toBe('launch-project');
    expect(getLatest().activeSession?.projectId).toBe('launch-practice');
    expect(getLatest().messages).toEqual(launchProjectSession.messages);

    act(() => {
      root.unmount();
    });
  });

  it('creates replacement empty sessions inside the requested Project lane', () => {
    const { getLatest, root } = renderUseAskSession('launch-practice');

    act(() => {
      getLatest().resetSession();
    });
    const firstProjectSessionId = getLatest().activeSessionId;
    expect(getLatest().activeSession).toMatchObject({
      source: 'project',
      projectId: 'launch-practice',
    });

    act(() => {
      getLatest().deleteSession(firstProjectSessionId!);
    });

    expect(getLatest().activeSessionId).not.toBe(firstProjectSessionId);
    expect(getLatest().activeSession).toMatchObject({
      source: 'project',
      projectId: 'launch-practice',
    });

    act(() => {
      root.unmount();
    });
  });

  it('attaches an existing Codex thread as a persisted metadata-only session', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatest, root } = renderUseAskSession();

    act(() => {
      getLatest().attachRuntimeSession(codexRuntime, {
        externalSessionId: 'thread_attached',
        cwd: '/tmp/repo',
        status: 'active',
        updatedAt: 123,
      }, {
        title: 'Attached repo thread',
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const active = getLatest().activeSession;
    expect(active).not.toBeNull();
    expect(active?.messages).toEqual([]);
    expect(active?.title).toBe('Attached repo thread');
    expect(active?.runtimeSessionBinding).toMatchObject({
      kind: 'codex-thread',
      runtime: 'codex',
      runtimeId: 'codex',
      externalSessionId: 'thread_attached',
      cwd: '/tmp/repo',
      status: 'active',
      updatedAt: 123,
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.session).toMatchObject({
      title: 'Attached repo thread',
      messages: [],
      runtimeSessionBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thread_attached',
      },
    });

    act(() => {
      root.unmount();
    });
  });

  it('keeps attached Codex threads inside the requested Project lane', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatest, root } = renderUseAskSession('launch-practice');

    act(() => {
      getLatest().attachRuntimeSession(codexRuntime, {
        externalSessionId: 'thread_project_attached',
        cwd: '/tmp/project',
        status: 'active',
        updatedAt: 456,
      }, {
        title: 'Project attached thread',
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(getLatest().activeSession).toMatchObject({
      source: 'project',
      projectId: 'launch-practice',
      title: 'Project attached thread',
      runtimeSessionBinding: {
        externalSessionId: 'thread_project_attached',
      },
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.session).toMatchObject({
      source: 'project',
      projectId: 'launch-practice',
      title: 'Project attached thread',
    });

    act(() => {
      root.unmount();
    });
  });
});

describe('useAskSession shared metadata across instances (PR3)', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const serverSessions: ChatSession[] = [
    {
      id: 'shared-a',
      createdAt: 20,
      updatedAt: 20,
      messages: [{ role: 'user', content: 'first chat' }],
    },
    {
      id: 'shared-b',
      createdAt: 10,
      updatedAt: 10,
      messages: [{ role: 'user', content: 'second chat' }],
    },
  ];

  function stubServer() {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return { ok: true, json: async () => serverSessions };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('two mounted instances see one list, one active session, and each other\'s edits', async () => {
    const fetchMock = stubServer();
    const a = renderUseAskSession();
    const b = renderUseAskSession();

    await act(async () => {
      await Promise.all([a.getLatest().initSessions(), b.getLatest().initSessions()]);
    });

    // Concurrent inits share a single GET (single-flight).
    expect(fetchMock.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET').length).toBe(1);
    expect(a.getLatest().sessions.map((s) => s.id)).toEqual(b.getLatest().sessions.map((s) => s.id));
    expect(a.getLatest().activeSessionId).toBe(b.getLatest().activeSessionId);

    // Metadata edits propagate: rename and pin from A are visible through B.
    act(() => {
      a.getLatest().renameSession('shared-b', 'Renamed by A');
      a.getLatest().togglePinSession('shared-b');
    });
    const seenByB = b.getLatest().sessions.find((s) => s.id === 'shared-b');
    expect(seenByB?.title).toBe('Renamed by A');
    expect(seenByB?.pinned).toBe(true);

    // Activation is one shared fact: switching in A switches B too.
    act(() => {
      a.getLatest().loadSession('shared-b');
    });
    expect(b.getLatest().activeSessionId).toBe('shared-b');
    expect(b.getLatest().messages.map((m) => m.content)).toEqual(['second chat']);

    act(() => {
      a.root.unmount();
      b.root.unmount();
    });
  });

  it('survives one instance unmounting: the remaining instance keeps the shared state', async () => {
    stubServer();
    const a = renderUseAskSession();
    const b = renderUseAskSession();

    await act(async () => {
      await a.getLatest().initSessions();
    });
    act(() => {
      a.getLatest().renameSession('shared-a', 'Kept title');
    });

    act(() => {
      a.root.unmount();
    });

    expect(b.getLatest().sessions.find((s) => s.id === 'shared-a')?.title).toBe('Kept title');
    expect(b.getLatest().activeSessionId).toBe('shared-a');

    act(() => {
      b.root.unmount();
    });
  });
});
