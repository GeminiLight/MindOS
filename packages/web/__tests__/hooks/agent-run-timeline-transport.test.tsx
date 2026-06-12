// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AGENT_RUN_STREAM_RECONNECT_DELAYS_MS,
  useAgentRunTimeline,
} from '@/hooks/useAgentRunTimeline';
import type { Message } from '@/lib/types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emitError() {
    this.onerror?.();
  }
  emitMessage(data: string) {
    this.onmessage?.({ data });
  }
}

function setDocumentVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

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

describe('useAgentRunTimeline transport hygiene', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mount(props: { pollMs?: number } = {}) {
    act(() => {
      root = createRoot(container);
      root.render(<Harness {...props} />);
    });
  }

  describe('SSE reconnect with backoff', () => {
    beforeEach(() => {
      vi.stubGlobal('EventSource', MockEventSource);
    });

    it('reconnects after an error following the backoff schedule', () => {
      mount();
      expect(MockEventSource.instances).toHaveLength(1);

      // 1st error → reconnect after 1s
      act(() => { MockEventSource.instances[0].emitError(); });
      expect(MockEventSource.instances).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(AGENT_RUN_STREAM_RECONNECT_DELAYS_MS[0]); });
      expect(MockEventSource.instances).toHaveLength(2);

      // 2nd error → reconnect after 5s (not earlier)
      act(() => { MockEventSource.instances[1].emitError(); });
      act(() => { vi.advanceTimersByTime(AGENT_RUN_STREAM_RECONNECT_DELAYS_MS[1] - 1000); });
      expect(MockEventSource.instances).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(MockEventSource.instances).toHaveLength(3);

      // 3rd error → reconnect after 15s
      act(() => { MockEventSource.instances[2].emitError(); });
      act(() => { vi.advanceTimersByTime(AGENT_RUN_STREAM_RECONNECT_DELAYS_MS[2]); });
      expect(MockEventSource.instances).toHaveLength(4);
    });

    it('downgrades to polling after exhausting reconnect attempts', () => {
      mount({ pollMs: 900 });
      // Initial connect + 3 reconnects, each erroring out.
      for (const delay of AGENT_RUN_STREAM_RECONNECT_DELAYS_MS) {
        act(() => { MockEventSource.instances[MockEventSource.instances.length - 1].emitError(); });
        act(() => { vi.advanceTimersByTime(delay); });
      }
      act(() => { MockEventSource.instances[MockEventSource.instances.length - 1].emitError(); });

      const instancesAfterGivingUp = MockEventSource.instances.length;
      expect(instancesAfterGivingUp).toBe(1 + AGENT_RUN_STREAM_RECONNECT_DELAYS_MS.length);

      // No further reconnects...
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(MockEventSource.instances).toHaveLength(instancesAfterGivingUp);
      // ...and the polling fallback is now issuing requests.
      expect(fetchMock).toHaveBeenCalled();
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/agent-runs?');
    });

    it('a successful message resets the backoff budget', () => {
      mount();
      // Burn two attempts.
      act(() => { MockEventSource.instances[0].emitError(); });
      act(() => { vi.advanceTimersByTime(AGENT_RUN_STREAM_RECONNECT_DELAYS_MS[0]); });
      act(() => { MockEventSource.instances[1].emitError(); });
      act(() => { vi.advanceTimersByTime(AGENT_RUN_STREAM_RECONNECT_DELAYS_MS[1]); });
      expect(MockEventSource.instances).toHaveLength(3);

      // Stream delivers a frame — budget resets.
      act(() => { MockEventSource.instances[2].emitMessage(JSON.stringify({ runs: [], events: [] })); });

      // Next error starts back at the first delay.
      act(() => { MockEventSource.instances[2].emitError(); });
      act(() => { vi.advanceTimersByTime(AGENT_RUN_STREAM_RECONNECT_DELAYS_MS[0]); });
      expect(MockEventSource.instances).toHaveLength(4);
    });

    it('does not poll while the stream is healthy', () => {
      mount({ pollMs: 900 });
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('polling visibility hygiene (no EventSource)', () => {
    beforeEach(() => {
      // Force the polling fallback path.
      vi.stubGlobal('EventSource', undefined);
      delete (globalThis as { EventSource?: unknown }).EventSource;
    });

    it('polls on an interval while the tab is visible', () => {
      mount({ pollMs: 1000 });
      // Mount triggers an immediate refresh (the effect re-runs once while
      // streamUnavailable settles, so the exact count is 1-2).
      const initialCalls = fetchMock.mock.calls.length;
      expect(initialCalls).toBeGreaterThanOrEqual(1);
      act(() => { vi.advanceTimersByTime(3000); });
      expect(fetchMock).toHaveBeenCalledTimes(initialCalls + 3);
    });

    it('pauses polling while the document is hidden and catches up on return', () => {
      mount({ pollMs: 1000 });
      const initialCalls = fetchMock.mock.calls.length;

      act(() => { setDocumentVisibility('hidden'); });
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(fetchMock).toHaveBeenCalledTimes(initialCalls);

      act(() => { setDocumentVisibility('visible'); });
      expect(fetchMock).toHaveBeenCalledTimes(initialCalls + 1); // catch-up refresh
      act(() => { vi.advanceTimersByTime(2000); });
      expect(fetchMock).toHaveBeenCalledTimes(initialCalls + 3);
    });
  });
});
