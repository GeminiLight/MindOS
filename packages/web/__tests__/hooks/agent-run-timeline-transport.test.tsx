// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  TIMELINE_EVENT_DEBOUNCE_MS,
  TIMELINE_FALLBACK_POLL_MS,
  useAgentRunTimeline,
} from '@/hooks/useAgentRunTimeline';
import { resetServerEventsForTests } from '@/lib/server-events';
import type { Message } from '@/lib/types';
import { MockEventSource, setDocumentVisibility } from '../fixtures/mock-event-source';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ pollMs }: { pollMs?: number }) {
  useAgentRunTimeline({
    chatSessionId: 'chat-1',
    visible: true,
    isLoading: true,
    messages: [] as Message[],
    setMessages: () => {},
    ...(pollMs !== undefined ? { pollMs } : {}),
  });
  return null;
}

function agentRunEvent(chatSessionId: string | undefined, id: number) {
  return {
    type: 'agent-run.event',
    runId: `run-${id}`,
    ...(chatSessionId ? { chatSessionId } : {}),
    event: { id: `evt-${id}`, runId: `run-${id}`, type: 'tool_started', category: 'tool', status: 'running', ts: id },
  };
}

describe('useAgentRunTimeline transport hygiene', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    resetServerEventsForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    setDocumentVisibility('visible');
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ runs: [], events: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container.remove();
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mount(props: { pollMs?: number } = {}) {
    act(() => {
      root = createRoot(container);
      root.render(<Harness {...props} />);
    });
  }

  function timelineRequests(): number {
    return fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/agent-runs?')).length;
  }

  describe('with the shared server event stream', () => {
    beforeEach(() => {
      vi.stubGlobal('EventSource', MockEventSource);
    });

    it('fetches one initial snapshot and refreshes 150ms after a matching event, coalescing bursts', () => {
      mount();
      expect(MockEventSource.instances).toHaveLength(1);
      expect(timelineRequests()).toBe(1);
      const source = MockEventSource.last();
      source.ready({ lastEventId: 1 });

      act(() => {
        source.emit('agent-run.event', agentRunEvent('chat-1', 2), 2);
        source.emit('agent-run.event', agentRunEvent('chat-1', 3), 3);
        source.emit('agent-run.event', agentRunEvent('chat-1', 4), 4);
      });
      expect(timelineRequests()).toBe(1);
      act(() => { vi.advanceTimersByTime(TIMELINE_EVENT_DEBOUNCE_MS - 1); });
      expect(timelineRequests()).toBe(1);
      act(() => { vi.advanceTimersByTime(1); });
      expect(timelineRequests()).toBe(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('chatSessionId=chat-1');
    });

    it('ignores events for other chat sessions and events without a session', () => {
      mount();
      const source = MockEventSource.last();
      source.ready({ lastEventId: 1 });
      act(() => {
        source.emit('agent-run.event', agentRunEvent('chat-other', 2), 2);
        source.emit('agent-run.event', agentRunEvent(undefined, 3), 3);
      });
      act(() => { vi.advanceTimersByTime(TIMELINE_EVENT_DEBOUNCE_MS * 2); });
      expect(timelineRequests()).toBe(1);
    });

    it('does not poll while the stream is connected', () => {
      mount({ pollMs: 1000 });
      MockEventSource.last().ready({ lastEventId: 1 });
      act(() => { vi.advanceTimersByTime(35_000); });
      expect(timelineRequests()).toBe(1);
    });

    it('catches up once when the stream reconnects with a replay gap', () => {
      mount();
      MockEventSource.last().ready({ lastEventId: 1 });
      act(() => { MockEventSource.last().fail(); });
      act(() => { vi.advanceTimersByTime(1_000); });
      act(() => { MockEventSource.last().ready({ lastEventId: 900, resync: true }); });
      act(() => { vi.advanceTimersByTime(TIMELINE_EVENT_DEBOUNCE_MS); });
      expect(timelineRequests()).toBe(2);
    });

    it('polls at the fallback cadence while the stream is reconnecting', () => {
      mount({ pollMs: 1000 });
      const source = MockEventSource.last();
      source.ready({ lastEventId: 1 });
      act(() => { source.fail(); });
      // The replacement socket never opens in this test, so the hook stays in
      // the degraded path and the poll runs.
      act(() => { vi.advanceTimersByTime(3_000); });
      expect(timelineRequests()).toBe(1 + 3);
    });

    it('uses a 5s default fallback poll', () => {
      expect(TIMELINE_FALLBACK_POLL_MS).toBe(5_000);
    });
  });

  describe('polling visibility hygiene (no EventSource)', () => {
    beforeEach(() => {
      vi.stubGlobal('EventSource', undefined);
      delete (globalThis as { EventSource?: unknown }).EventSource;
    });

    it('polls on an interval while the tab is visible', () => {
      mount({ pollMs: 1000 });
      expect(timelineRequests()).toBe(1);
      act(() => { vi.advanceTimersByTime(3000); });
      expect(timelineRequests()).toBe(4);
    });

    it('pauses polling while the document is hidden and catches up on return', () => {
      mount({ pollMs: 1000 });
      const initialCalls = timelineRequests();

      act(() => { setDocumentVisibility('hidden'); });
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(timelineRequests()).toBe(initialCalls);

      act(() => { setDocumentVisibility('visible'); });
      expect(timelineRequests()).toBe(initialCalls + 1); // catch-up refresh
      act(() => { vi.advanceTimersByTime(2000); });
      expect(timelineRequests()).toBe(initialCalls + 3);
    });
  });
});
