/**
 * @vitest-environment jsdom
 *
 * SessionHistoryPanel run/unread indicators + render-isolation performance bar
 * (wiki/specs/spec-chat-session-concurrency.md, PR2 acceptance).
 *
 * The panel subscribes to agent-run-store's run summary internally, so a card
 * shows a spinner while its session has a live run and an amber dot once a
 * background run finishes unread. Streaming chunks must NOT re-render the
 * panel: the summary snapshot only changes on run/unread membership, and the
 * memoized panel ignores parent re-renders driven by message updates.
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@/lib/types';

// Wrap useLocale with a spy so tests can count panel renders: the panel calls
// it exactly once per render and nothing else in these trees uses it.
const localeSpy = vi.hoisted(() => ({ renders: 0 }));
vi.mock('@/lib/stores/locale-store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/stores/locale-store')>();
  return {
    ...mod,
    useLocale: (...args: Parameters<typeof mod.useLocale>) => {
      localeSpy.renders += 1;
      return mod.useLocale(...args);
    },
  };
});

import SessionHistoryPanel from '@/components/ask/SessionHistoryPanel';
import {
  endRun,
  markUnread,
  clearUnread,
  replaceLastMessage,
  resetAgentRunStoreForTests,
  setActiveSession,
  setMessages,
  startRun,
  useSessionMessages,
} from '@/lib/agent-run-store';

function makeSession(id: string, title: string): ChatSession {
  const now = Date.now();
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [{ role: 'user', content: `hello from ${id}`, timestamp: now }],
  };
}

const sessions = [makeSession('a', 'Session A'), makeSession('b', 'Session B')];
const noop = () => {};
const panelProps = {
  sessions,
  activeSessionId: 'b',
  onLoad: noop,
  onDelete: noop,
  onRename: noop,
  onTogglePin: noop,
  onClearAll: noop,
  onClose: noop,
  onNewChat: noop,
};

describe('SessionHistoryPanel run/unread indicators', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    resetAgentRunStoreForTests();
    localeSpy.renders = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  const runningIndicators = () => host.querySelectorAll('[data-testid="session-running-indicator"]');
  const unreadIndicators = () => host.querySelectorAll('[data-testid="session-unread-indicator"]');

  it('shows a spinner for a running session and an unread dot after it finishes in the background', async () => {
    setActiveSession('b');
    await act(async () => {
      root.render(<SessionHistoryPanel {...panelProps} />);
    });
    expect(runningIndicators()).toHaveLength(0);
    expect(unreadIndicators()).toHaveLength(0);

    // Session a starts running (active session is b) → exactly one spinner.
    await act(async () => {
      startRun('a', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 3 });
    });
    expect(runningIndicators()).toHaveLength(1);
    expect(unreadIndicators()).toHaveLength(0);

    // While running, an unread mark must not show a second indicator.
    await act(async () => { markUnread('a'); });
    expect(runningIndicators()).toHaveLength(1);
    expect(unreadIndicators()).toHaveLength(0);
    await act(async () => { clearUnread('a'); });

    // Background completion: spinner becomes the amber unread dot.
    await act(async () => { endRun('a'); });
    expect(runningIndicators()).toHaveLength(0);
    expect(unreadIndicators()).toHaveLength(1);

    // Opening the session clears the mark (loadSession calls clearUnread).
    await act(async () => { clearUnread('a'); });
    expect(unreadIndicators()).toHaveLength(0);
  });

  it('does not mark the active session unread when its run ends in the foreground', async () => {
    setActiveSession('b');
    await act(async () => {
      root.render(<SessionHistoryPanel {...panelProps} />);
    });
    await act(async () => {
      startRun('b', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 3 });
    });
    expect(runningIndicators()).toHaveLength(1);
    await act(async () => { endRun('b'); });
    expect(runningIndicators()).toHaveLength(0);
    expect(unreadIndicators()).toHaveLength(0);
  });

  it('reconciles at most twice while 200 chunks stream (initial + run state changes only)', async () => {
    setActiveSession('b');
    setMessages('a', [{ role: 'user', content: 'go', timestamp: 1 }], { skipPersist: true });

    // The harness mimics ChatContent: it subscribes to the streaming session's
    // messages, so every chunk re-renders the parent around the panel.
    let harnessRenders = 0;
    function Harness() {
      useSessionMessages('a');
      harnessRenders += 1;
      return <SessionHistoryPanel {...panelProps} />;
    }
    await act(async () => { root.render(<Harness />); });
    await act(async () => {
      startRun('a', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 3 });
    });
    const panelRendersBeforeChunks = localeSpy.renders;
    const harnessRendersBeforeChunks = harnessRenders;

    for (let i = 1; i <= 200; i++) {
      // Each chunk in its own act → its own commit, like real streaming.
      await act(async () => {
        replaceLastMessage('a', { role: 'assistant', content: `chunk ${i}`, timestamp: 1 }, { requireRun: true });
      });
    }

    // The parent re-rendered per chunk; the history panel did not reconcile at all.
    expect(harnessRenders - harnessRendersBeforeChunks).toBeGreaterThanOrEqual(200);
    expect(localeSpy.renders - panelRendersBeforeChunks).toBe(0);

    // Run completion is a summary change → exactly one more panel render.
    await act(async () => { endRun('a'); });
    expect(localeSpy.renders - panelRendersBeforeChunks).toBe(1);
  });
});
