/**
 * @vitest-environment jsdom
 *
 * Integration tests for concurrent chat sessions at the useAgentChat level
 * (wiki/specs/spec-chat-session-concurrency.md, PR1 acceptance).
 *
 * The stream consumer is mocked with manually-driven runs so two sessions can
 * stream interleaved chunks: this is the no-cross-talk proof. Also covers the
 * frontend concurrency cap, the submit-time runtime snapshot for binding
 * writes, background completion + unread, and stop/retract semantics.
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, AgentRuntimeIdentity, RuntimeSessionBinding } from '@/lib/types';
import type { RuntimeBindingMetadata, AgentRunContextMetadata } from '@/lib/agent/stream-consumer';

const harness = vi.hoisted(() => {
  interface CapturedRun {
    onMessage: (msg: Message) => void;
    hooks: {
      onRuntimeBinding?: (binding: unknown) => void;
      onAgentRunContext?: (context: unknown) => void;
    };
    resolve: (msg: Message) => void;
    reject: (err: Error) => void;
    signal: AbortSignal;
    body: string;
  }
  return { captured: [] as CapturedRun[], lastRequestBody: '' };
});

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: vi.fn(
    (
      _body: unknown,
      onMessage: (msg: Message) => void,
      signal: AbortSignal,
      hooks: {
        onRuntimeBinding?: (binding: RuntimeBindingMetadata) => void;
        onAgentRunContext?: (context: AgentRunContextMetadata) => void;
      },
    ) => new Promise<Message>((resolve, reject) => {
      harness.captured.push({
        onMessage, hooks, resolve, reject, signal,
        body: harness.lastRequestBody,
      });
    }),
  ),
}));

import { useAgentChat, type AgentChatRefs } from '@/hooks/useAgentChat';
import { toast } from '@/lib/toast';
import {
  MAX_CONCURRENT_RUNS,
  getMessages,
  getRun,
  getRunCount,
  getUnread,
  isInSubmitCooldown,
  registerRuntimeBindingWriter,
  resetAgentRunStoreForTests,
  setActiveSession,
} from '@/lib/agent-run-store';
import { MAX_TABS, openTab, resetWorkspaceTabsForTests } from '@/lib/workspace-tabs';

type ChatApi = ReturnType<typeof useAgentChat>;

function makeRefs(activeSessionId: string): AgentChatRefs {
  return {
    inputValueRef: { current: '' },
    mentionRef: { current: { mentionQuery: null } },
    slashRef: { current: { slashQuery: null } },
    imageUploadRef: { current: { images: [], clearImages: vi.fn() } },
    sessionRef: {
      current: {
        activeSession: null,
        activeSessionId,
        messages: [],
        setMessages: vi.fn(),
      },
    },
    uploadRef: { current: { localAttachments: [] } },
    selectedSkillRef: { current: null },
    selectedAgentRuntimeRef: { current: null },
    attachedFilesRef: { current: [] },
  };
}

describe('concurrent chat sessions (useAgentChat × agent-run-store)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let chat: ChatApi;
  let refs: AgentChatRefs;
  let restoredInputs: Message[];
  let transientErrors: string[];

  function Harness({ activeSessionId }: { activeSessionId: string | null }) {
    chat = useAgentChat({
      providerOverride: null,
      modelOverride: null,
      activeSessionId,
      refs,
      errorLabels: {
        noResponse: 'no response',
        stopped: 'stopped',
        concurrentLimit: 'too many sessions',
        tabLimitReached: 'too many tabs',
      },
      resetInputState: () => { refs.inputValueRef.current = ''; },
      onRestoreInput: (msg) => restoredInputs.push(msg),
      onTransientError: (message) => transientErrors.push(message),
    });
    return null;
  }

  async function render(activeSessionId: string | null) {
    await act(async () => {
      root.render(<Harness activeSessionId={activeSessionId} />);
    });
  }

  /** Switch the active session the way useAskSession would. */
  async function activate(sessionId: string) {
    refs.sessionRef.current!.activeSessionId = sessionId;
    setActiveSession(sessionId);
    await render(sessionId);
  }

  async function submitText(sessionId: string, text: string) {
    await activate(sessionId);
    refs.inputValueRef.current = text;
    await act(async () => {
      // Don't await submit to completion — it resolves only when the (manually
      // driven) stream ends. Start it and flush a tick so fetch resolves and
      // the consume call is captured.
      void chat.submit({ preventDefault: () => {} } as unknown as React.FormEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    resetAgentRunStoreForTests();
    resetWorkspaceTabsForTests();
    harness.captured.length = 0;
    restoredInputs = [];
    transientErrors = [];
    refs = makeRefs('a');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (typeof init?.body === 'string') harness.lastRequestBody = init.body;
      return { ok: true, body: {} as ReadableStream, json: async () => ({}) };
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.useRealTimers();
    localStorage.clear();
    resetWorkspaceTabsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('streams two sessions concurrently without cross-talk and marks the background one unread', async () => {
    await submitText('a', 'question for a');
    expect(getRun('a')).not.toBeNull();
    expect(harness.captured).toHaveLength(1);

    // Switch to session b while a is still streaming — submit must target b.
    await submitText('b', 'question for b');
    expect(getRunCount()).toBe(2);
    expect(harness.captured).toHaveLength(2);

    // Each run sent its own session's history, keyed by its own id.
    expect(JSON.parse(harness.captured[0].body).chatSessionId).toBe('a');
    expect(JSON.parse(harness.captured[1].body).chatSessionId).toBe('b');

    // Interleave chunks: a and b alternate writes into the store.
    let aText = '';
    let bText = '';
    await act(async () => {
      for (let i = 1; i <= 50; i++) {
        aText += `A${i} `;
        bText += `B${i} `;
        harness.captured[0].onMessage({ role: 'assistant', content: aText, timestamp: 1 });
        harness.captured[1].onMessage({ role: 'assistant', content: bText, timestamp: 1 });
      }
    });

    expect(getMessages('a')[0].content).toBe('question for a');
    expect(getMessages('a')[1].content).toBe(aText);
    expect(getMessages('b')[0].content).toBe('question for b');
    expect(getMessages('b')[1].content).toBe(bText);

    // The hook's UI state reflects the *active* session (b), while a keeps running.
    expect(chat.isLoading).toBe(true);

    // Finish a in the background (active session is b) → unread mark on a.
    await act(async () => {
      harness.captured[0].resolve({ role: 'assistant', content: aText, timestamp: 1 });
    });
    expect(getRun('a')).toBeNull();
    expect(getUnread().has('a')).toBe(true);

    // Finish b while active → no unread mark.
    await act(async () => {
      harness.captured[1].resolve({ role: 'assistant', content: bText, timestamp: 1 });
    });
    expect(getRun('b')).toBeNull();
    expect(getUnread().has('b')).toBe(false);
    expect(chat.isLoading).toBe(false);
  });

  it('rejects oversized uploaded attachments before opening a run', async () => {
    await activate('a');
    refs.inputValueRef.current = 'Please use this upload';
    refs.uploadRef.current!.localAttachments = [
      { name: 'large.md', content: 'x'.repeat(20_001), status: 'success' },
    ];

    await act(async () => {
      await chat.submit({ preventDefault: () => {} } as unknown as React.FormEvent);
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(getRun('a')).toBeNull();
    expect(getMessages('a')).toEqual([]);
    expect(transientErrors).toEqual([expect.stringContaining('large.md')]);
  });

  it('keeps a run streaming into its own session after the component unmounts', async () => {
    await submitText('a', 'long task');
    await act(async () => { root.unmount(); });

    await act(async () => {
      harness.captured[0].onMessage({ role: 'assistant', content: 'still going', timestamp: 1 });
      harness.captured[0].resolve({ role: 'assistant', content: 'still going', timestamp: 1 });
    });

    expect(getMessages('a')[1].content).toBe('still going');
    expect(getRun('a')).toBeNull();

    // Re-create a root so afterEach's unmount stays valid.
    root = createRoot(host);
  });

  it('rejects a per-session double submit but allows other sessions', async () => {
    await submitText('a', 'first');
    expect(harness.captured).toHaveLength(1);

    // Same session again while running → silently ignored (button shows stop).
    refs.inputValueRef.current = 'second';
    await act(async () => {
      await chat.submit({ preventDefault: () => {} } as unknown as React.FormEvent);
    });
    expect(harness.captured).toHaveLength(1);
    expect(getMessages('a').filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('caps total concurrent runs with a visible error message in the offending session', async () => {
    const ids = ['a', 'b', 'c'];
    expect(ids).toHaveLength(MAX_CONCURRENT_RUNS);
    for (const id of ids) {
      await submitText(id, `run ${id}`);
    }
    expect(getRunCount()).toBe(MAX_CONCURRENT_RUNS);

    await submitText('d', 'one too many');
    // No run started, no request sent…
    expect(getRunCount()).toBe(MAX_CONCURRENT_RUNS);
    expect(getRun('d')).toBeNull();
    expect(harness.captured).toHaveLength(MAX_CONCURRENT_RUNS);
    // …but the refusal is visible in the session, not a dead send button.
    const dMessages = getMessages('d');
    expect(dMessages[0].content).toBe('one too many');
    expect(dMessages[1].content).toBe('__error__too many sessions');
  });

  it('warns when a sent message cannot promote the session because the tab strip is full', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    for (let i = 0; i < MAX_TABS; i++) {
      openTab('doc', `note-${i}.md`, `Note ${i}`);
    }

    await submitText('overflow', 'keep this session visible');

    expect(toastSpy).toHaveBeenCalledWith('too many tabs');
    expect(getRun('overflow')).not.toBeNull();
  });

  it('writes runtime bindings using the submit-time snapshot, not the currently selected runtime', async () => {
    const bindingWriter = vi.fn();
    registerRuntimeBindingWriter(bindingWriter);

    const codex: AgentRuntimeIdentity & { binaryPath?: string } = { id: 'codex', name: 'Codex', kind: 'codex' };
    refs.selectedAgentRuntimeRef.current = codex;
    await submitText('a', 'use codex');

    // The user switches runtime mid-stream — the run must not care.
    refs.selectedAgentRuntimeRef.current = { id: 'claude', name: 'Claude Code', kind: 'claude' };

    await act(async () => {
      harness.captured[0].hooks.onRuntimeBinding?.({
        runtime: 'codex',
        externalSessionId: 'thread_42',
        cwd: '/work',
        status: 'active' satisfies RuntimeSessionBinding['status'],
      });
    });
    expect(bindingWriter).toHaveBeenCalledTimes(1);
    expect(bindingWriter.mock.calls[0][0]).toBe('a');
    expect(bindingWriter.mock.calls[0][1]).toMatchObject({ kind: 'codex', id: 'codex' });
    expect(bindingWriter.mock.calls[0][2]).toMatchObject({ externalSessionId: 'thread_42', cwd: '/work' });

    // A binding event from a different lane than the snapshot is dropped.
    await act(async () => {
      harness.captured[0].hooks.onRuntimeBinding?.({
        runtime: 'claude',
        externalSessionId: 'sess_99',
      });
    });
    expect(bindingWriter).toHaveBeenCalledTimes(1);
  });

  it('reattaches to an existing agent run on retry instead of posting a duplicate turn', async () => {
    localStorage.setItem('mindos-reconnect-retries', '1');
    await submitText('a', 'recover this run');
    expect(harness.captured).toHaveLength(1);

    vi.useFakeTimers();
    await act(async () => {
      harness.captured[0].hooks.onAgentRunContext?.({
        rootRunId: 'run-root-1',
        chatSessionId: 'a',
        startedAt: 123,
      });
      harness.captured[0].reject(new TypeError('Failed to fetch'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(harness.captured).toHaveLength(2);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/agent/sessions/a/turns');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/agent-runs/reattach?chatSessionId=a&rootRunId=run-root-1');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'GET' });

    await act(async () => {
      harness.captured[1].onMessage({ role: 'assistant', content: 'recovered answer', timestamp: 1 });
      harness.captured[1].resolve({ role: 'assistant', content: 'recovered answer', timestamp: 1 });
    });
    vi.useRealTimers();

    expect(getRun('a')).toBeNull();
    expect(getMessages('a')[1].content).toBe('recovered answer');
  });

  it('preserves visible assistant text while replaying a reattach stream', async () => {
    localStorage.setItem('mindos-reconnect-retries', '1');
    await submitText('a', 'recover partial output');
    expect(harness.captured).toHaveLength(1);

    await act(async () => {
      harness.captured[0].onMessage({
        role: 'assistant',
        content: 'partial answer',
        parts: [{ type: 'text', text: 'partial answer' }],
        timestamp: 1,
      });
    });
    expect(getMessages('a')[1].content).toBe('partial answer');

    vi.useFakeTimers();
    await act(async () => {
      harness.captured[0].hooks.onAgentRunContext?.({
        rootRunId: 'run-root-1',
        chatSessionId: 'a',
        startedAt: 123,
      });
      harness.captured[0].reject(new TypeError('Failed to fetch'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(harness.captured).toHaveLength(2);

    await act(async () => {
      harness.captured[1].onMessage({
        role: 'assistant',
        content: '',
        parts: [{ type: 'reasoning', text: 'still thinking' }],
        timestamp: 2,
      });
    });
    expect(getMessages('a')[1].content).toBe('partial answer');
    expect(getMessages('a')[1].parts?.some((part) => part.type === 'text' && part.text === 'partial answer')).toBe(true);

    await act(async () => {
      harness.captured[1].onMessage({
        role: 'assistant',
        content: 'answer plus more',
        parts: [{ type: 'text', text: 'answer plus more' }],
        timestamp: 2,
      });
      harness.captured[1].resolve({
        role: 'assistant',
        content: 'answer plus more',
        parts: [{ type: 'text', text: 'answer plus more' }],
        timestamp: 2,
      });
    });
    vi.useRealTimers();

    expect(getRun('a')).toBeNull();
    expect(getMessages('a')[1].content).toBe('partial answer plus more');
  });

  it('stop() retracts the pending exchange, restores input, and starts a cooldown', async () => {
    await submitText('a', 'cancel me');
    expect(getMessages('a')).toHaveLength(2);

    await act(async () => {
      chat.stop();
    });
    // Retraction is synchronous; the run closure's AbortError lands later.
    expect(getMessages('a')).toHaveLength(0);
    expect(restoredInputs).toHaveLength(1);
    expect(restoredInputs[0].content).toBe('cancel me');
    expect(isInSubmitCooldown('a')).toBe(true);

    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    await act(async () => {
      harness.captured[0].reject(abortErr);
    });
    // No __error__stopped resurrection after retraction; run fully ended.
    expect(getMessages('a')).toHaveLength(0);
    expect(getRun('a')).toBeNull();
    expect(getUnread().has('a')).toBe(false);
  });

  it('stop() sends an explicit cancel request once an agent run context exists', async () => {
    await submitText('a', 'cancel backend too');
    await act(async () => {
      harness.captured[0].hooks.onAgentRunContext?.({
        rootRunId: 'run-stop-1',
        chatSessionId: 'a',
        startedAt: 123,
      });
      chat.stop();
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/agent-runs/cancel');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ chatSessionId: 'a', rootRunId: 'run-stop-1' }),
    });

    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    await act(async () => {
      harness.captured[0].reject(abortErr);
    });
    expect(getRun('a')).toBeNull();
  });

  it('stopping one session leaves the other run streaming to completion', async () => {
    await submitText('a', 'task a');
    await submitText('b', 'task b');
    expect(getRunCount()).toBe(2);

    // Stop targets the active session — switch back to a first.
    await activate('a');
    await act(async () => {
      chat.stop();
    });
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    await act(async () => {
      harness.captured[0].reject(abortErr);
    });
    expect(getRun('a')).toBeNull();
    expect(harness.captured[0].signal.aborted).toBe(true);

    // b's run was never aborted and keeps streaming normally.
    expect(getRun('b')).not.toBeNull();
    expect(harness.captured[1].signal.aborted).toBe(false);
    await act(async () => {
      harness.captured[1].onMessage({ role: 'assistant', content: 'b still streaming', timestamp: 1 });
      harness.captured[1].resolve({ role: 'assistant', content: 'b still streaming', timestamp: 1 });
    });
    expect(getRun('b')).toBeNull();
    expect(getMessages('b')[0].content).toBe('task b');
    expect(getMessages('b')[1].content).toBe('b still streaming');
    // b finished while a was active → background completion is marked unread.
    expect(getUnread().has('b')).toBe(true);
  });

  it('drops a runtime binding that arrives after the run has ended', async () => {
    const bindingWriter = vi.fn();
    registerRuntimeBindingWriter(bindingWriter);
    refs.selectedAgentRuntimeRef.current = { id: 'codex', name: 'Codex', kind: 'codex' };

    await submitText('a', 'finish fast');
    await act(async () => {
      harness.captured[0].resolve({ role: 'assistant', content: 'done', timestamp: 1 });
    });
    expect(getRun('a')).toBeNull();

    // Late event after endRun — no run, no write to any lane.
    await act(async () => {
      harness.captured[0].hooks.onRuntimeBinding?.({
        runtime: 'codex',
        externalSessionId: 'thread_late',
      });
    });
    expect(bindingWriter).not.toHaveBeenCalled();
  });
});
