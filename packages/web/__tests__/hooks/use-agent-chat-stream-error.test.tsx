/**
 * @vitest-environment jsdom
 *
 * useAgentChat must treat a consumed message whose stream ended with an
 * `error` frame (`message.status === 'error'`) as a failed turn: no fake
 * success, no reattach retry against an already-terminal run, and the same
 * `__error__` rendering the exception path uses (which keeps the user
 * message and its resend affordance in place).
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/lib/types';

const harness = vi.hoisted(() => {
  interface CapturedRun {
    onMessage: (msg: Message) => void;
    resolve: (msg: Message) => void;
    reject: (err: Error) => void;
  }
  return { captured: [] as CapturedRun[], fetchUrls: [] as string[] };
});

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: vi.fn(
    (_body: unknown, onMessage: (msg: Message) => void) => new Promise<Message>((resolve, reject) => {
      harness.captured.push({ onMessage, resolve, reject });
    }),
  ),
}));

import { useAgentChat, type AgentChatRefs } from '@/hooks/useAgentChat';
import {
  getMessages,
  getRun,
  resetAgentRunStoreForTests,
  setActiveSession,
} from '@/lib/agent-run-store';
import { resetWorkspaceTabsForTests } from '@/lib/workspace-tabs';

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

describe('useAgentChat stream error surfacing', () => {
  let host: HTMLDivElement;
  let root: Root;
  let chat: ChatApi;
  let refs: AgentChatRefs;

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
    });
    return null;
  }

  async function submitText(sessionId: string, text: string) {
    refs.sessionRef.current!.activeSessionId = sessionId;
    setActiveSession(sessionId);
    await act(async () => {
      root.render(<Harness activeSessionId={sessionId} />);
    });
    refs.inputValueRef.current = text;
    await act(async () => {
      void chat.submit({ preventDefault: () => {} } as unknown as React.FormEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** Mirror the real consumer: the final snapshot is emitted, then the promise resolves. */
  async function finish(message: Message) {
    await act(async () => {
      harness.captured[0].onMessage(message);
      harness.captured[0].resolve(message);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    resetAgentRunStoreForTests();
    resetWorkspaceTabsForTests();
    harness.captured.length = 0;
    harness.fetchUrls.length = 0;
    refs = makeRefs('a');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      harness.fetchUrls.push(String(url));
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

  it('renders a consumed error state as a failed turn without reattaching', async () => {
    await submitText('a', 'ask something');
    expect(harness.captured).toHaveLength(1);

    await finish({ role: 'assistant', content: '', timestamp: 1, parts: [], status: 'error', error: 'model exploded' });

    const messages = getMessages('a');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'ask something' });
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '__error__model exploded' });
    expect(getRun('a')).toBeNull();
    // One turn request; a terminal error must not trigger the reattach loop.
    expect(harness.fetchUrls.filter((url) => url.includes('/api/agent-runs/reattach'))).toEqual([]);
    expect(harness.fetchUrls.filter((url) => url.includes('/turns'))).toHaveLength(1);
    expect(chat.isLoading).toBe(false);
  });

  it('keeps partial content and appends the error when the stream failed mid-answer', async () => {
    await submitText('a', 'long question');
    await act(async () => {
      harness.captured[0].onMessage({ role: 'assistant', content: 'partial answer', timestamp: 1, parts: [{ type: 'text', text: 'partial answer' }] });
    });

    await finish({ role: 'assistant', content: 'partial answer', timestamp: 1, parts: [{ type: 'text', text: 'partial answer' }], status: 'error', error: 'model overloaded' });

    const messages = getMessages('a');
    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'partial answer' });
    expect(messages[2]).toMatchObject({ role: 'assistant', content: '__error__model overloaded' });
    expect(getRun('a')).toBeNull();
  });

  it('falls back to a generic message when the error state carries no text', async () => {
    await submitText('a', 'ask');

    await finish({ role: 'assistant', content: '', timestamp: 1, parts: [], status: 'error' });

    expect(getMessages('a')[1].content.startsWith('__error__')).toBe(true);
    expect(getMessages('a')[1].content.length).toBeGreaterThan('__error__'.length);
  });

  it('still treats a completed message as success', async () => {
    await submitText('a', 'ask');

    await finish({ role: 'assistant', content: 'done answer', timestamp: 1, parts: [{ type: 'text', text: 'done answer' }], status: 'completed' });

    const messages = getMessages('a');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'done answer' });
    expect(getRun('a')).toBeNull();
  });
});
