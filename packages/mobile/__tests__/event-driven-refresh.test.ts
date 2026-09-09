import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const store = {
    state: 'connected' as string,
    handlers,
    subscribeServerEvents: vi.fn((type: string, handler: (event: unknown) => void) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
        if (set?.size === 0) handlers.delete(type);
      };
    }),
    getServerEventsState: vi.fn(() => store.state),
    emit(event: { type: string } & Record<string, unknown>) {
      const targets = [...(handlers.get(event.type) ?? []), ...(handlers.get('*') ?? [])];
      for (const handler of targets) handler(event);
    },
    handlerCount() {
      let count = 0;
      for (const set of handlers.values()) count += set.size;
      return count;
    },
    reset() {
      handlers.clear();
      store.state = 'connected';
      store.subscribeServerEvents.mockClear();
      store.getServerEventsState.mockClear();
    },
  };
  return store;
});

const appState = vi.hoisted(() => ({ currentState: 'active' as string }));

vi.mock('@/lib/server-events', () => ({
  subscribeServerEvents: bus.subscribeServerEvents,
  getServerEventsState: bus.getServerEventsState,
}));
vi.mock('react-native', () => ({ AppState: appState }));

import { startEventDrivenRefresh } from '@/lib/event-driven-refresh';

function agentRunEvent(chatSessionId: string, type = 'tool_started', category = 'tool') {
  return {
    type: 'agent-run.event',
    runId: 'run-1',
    chatSessionId,
    event: { id: 'e1', runId: 'run-1', type, category, status: 'running', ts: 1 },
  };
}

describe('startEventDrivenRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bus.reset();
    appState.currentState = 'active';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes once after the debounce window for a burst of matching events', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, debounceMs: 150 });

    bus.emit(agentRunEvent('chat-1'));
    bus.emit(agentRunEvent('chat-1'));
    bus.emit(agentRunEvent('chat-1'));
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(149);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    bus.emit(agentRunEvent('chat-1'));
    vi.advanceTimersByTime(150);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('subscribes to every requested type plus ready, and ignores other types', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: ['tree.changed', 'mcp.changed'], refresh, debounceMs: 10 });

    expect(bus.subscribeServerEvents.mock.calls.map((call) => call[0]).sort()).toEqual([
      'mcp.changed',
      'ready',
      'tree.changed',
    ]);
    bus.emit({ type: 'skills.changed' });
    vi.advanceTimersByTime(50);
    expect(refresh).not.toHaveBeenCalled();

    bus.emit({ type: 'tree.changed', version: 3 });
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('applies the accept filter before scheduling a refresh', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['agent-run.event'],
      accept: (event) => event.type === 'agent-run.event' && event.chatSessionId === 'chat-1',
      refresh,
      debounceMs: 10,
    });

    bus.emit(agentRunEvent('chat-2'));
    vi.advanceTimersByTime(50);
    expect(refresh).not.toHaveBeenCalled();

    bus.emit(agentRunEvent('chat-1'));
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('refreshes on ready.resync and not on a clean ready', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: ['tree.changed'], refresh, debounceMs: 10 });

    bus.emit({ type: 'ready', lastEventId: 3, resync: false });
    vi.advanceTimersByTime(50);
    expect(refresh).not.toHaveBeenCalled();

    bus.emit({ type: 'ready', lastEventId: 3, resync: true });
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('can opt out of resync refreshes', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['tree.changed'],
      refresh,
      debounceMs: 10,
      refreshOnResync: false,
    });

    bus.emit({ type: 'ready', lastEventId: 3, resync: true });
    vi.advanceTimersByTime(50);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it('never runs the fallback poll while the stream is connected', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, fallbackPollMs: 2_500 });

    vi.advanceTimersByTime(35_000);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it.each(['reconnecting', 'connecting', 'unsupported', 'idle'])(
    'runs the fallback poll at the configured interval while the stream is %s',
    (state) => {
      bus.state = state;
      const refresh = vi.fn();
      const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, fallbackPollMs: 2_500 });

      vi.advanceTimersByTime(2_499);
      expect(refresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(refresh).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10_000);
      expect(refresh).toHaveBeenCalledTimes(5);
      stop();
    },
  );

  it('stops polling as soon as the stream connects and resumes when it drops', () => {
    bus.state = 'reconnecting';
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, fallbackPollMs: 1_000 });

    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    bus.state = 'connected';
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    bus.state = 'reconnecting';
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it('skips fallback ticks while the app is not active', () => {
    bus.state = 'unsupported';
    appState.currentState = 'background';
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, fallbackPollMs: 1_000 });

    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();

    appState.currentState = 'active';
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('honours a custom isAppActive predicate', () => {
    bus.state = 'unsupported';
    appState.currentState = 'background';
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['agent-run.event'],
      refresh,
      fallbackPollMs: 1_000,
      isAppActive: () => true,
    });

    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('skips fallback ticks while shouldPoll returns false', () => {
    bus.state = 'unsupported';
    let shouldPoll = false;
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['agent-run.event'],
      refresh,
      fallbackPollMs: 1_000,
      shouldPoll: () => shouldPoll,
    });

    vi.advanceTimersByTime(3_000);
    expect(refresh).not.toHaveBeenCalled();
    shouldPoll = true;
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('still refreshes on events while the app is inactive', () => {
    appState.currentState = 'inactive';
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: ['tree.changed'], refresh, debounceMs: 10 });

    bus.emit({ type: 'tree.changed', version: 1 });
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs the connected poll only while connected, and the fallback poll only while not', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['agent-run.event'],
      refresh,
      fallbackPollMs: 1_000,
      connectedPollMs: 10_000,
    });

    vi.advanceTimersByTime(9_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    bus.state = 'reconnecting';
    vi.advanceTimersByTime(10_000);
    // 10 fallback ticks, and the connected interval fired once more but was skipped.
    expect(refresh).toHaveBeenCalledTimes(11);
    stop();
  });

  it('does not create intervals when both poll periods are zero', () => {
    bus.state = 'unsupported';
    const refresh = vi.fn();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const stop = startEventDrivenRefresh({ eventTypes: ['tree.changed'], refresh });

    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    stop();
    setIntervalSpy.mockRestore();
  });

  it('treats negative or non-finite poll periods as disabled', () => {
    bus.state = 'unsupported';
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['tree.changed'],
      refresh,
      fallbackPollMs: -5,
      connectedPollMs: Number.NaN,
    });

    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it('stop() unsubscribes, clears a pending debounce and stops all polling', () => {
    bus.state = 'unsupported';
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['tree.changed'],
      refresh,
      debounceMs: 100,
      fallbackPollMs: 1_000,
      connectedPollMs: 2_000,
    });
    expect(bus.handlerCount()).toBe(2);

    bus.emit({ type: 'tree.changed', version: 1 });
    stop();
    stop();
    expect(bus.handlerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps polling when a refresh throws or rejects', async () => {
    bus.state = 'unsupported';
    const refresh = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('sync failure');
      })
      .mockImplementationOnce(() => Promise.reject(new Error('async failure')))
      .mockImplementation(() => undefined);
    const stop = startEventDrivenRefresh({ eventTypes: ['tree.changed'], refresh, fallbackPollMs: 1_000 });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it('handles an empty eventTypes list by only listening for ready', () => {
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({ eventTypes: [], refresh, debounceMs: 10 });

    expect(bus.subscribeServerEvents.mock.calls.map((call) => call[0])).toEqual(['ready']);
    bus.emit({ type: 'ready', lastEventId: 1, resync: true });
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('tells the consumer why it is refreshing', () => {
    bus.state = 'unsupported';
    const refresh = vi.fn();
    const stop = startEventDrivenRefresh({
      eventTypes: ['tree.changed'],
      refresh,
      debounceMs: 10,
      fallbackPollMs: 1_000,
    });

    bus.emit({ type: 'tree.changed', version: 1 });
    vi.advanceTimersByTime(10);
    bus.emit({ type: 'ready', lastEventId: 1, resync: true });
    vi.advanceTimersByTime(10);
    vi.advanceTimersByTime(980);

    expect(refresh.mock.calls.map((call) => call[0])).toEqual(['event', 'resync', 'poll']);
    stop();
  });

  it('queues exactly one trailing refresh for events that arrive while a refresh is pending', async () => {
    let settle: (() => void) | null = null;
    const refresh = vi.fn(() => new Promise<void>((resolve) => {
      settle = resolve;
    }));
    const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, debounceMs: 10 });

    bus.emit(agentRunEvent('chat-1'));
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).toHaveBeenCalledTimes(1);

    bus.emit(agentRunEvent('chat-1'));
    await vi.advanceTimersByTimeAsync(10);
    bus.emit(agentRunEvent('chat-1'));
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).toHaveBeenCalledTimes(1);

    const first = settle as unknown as () => void;
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith('event');

    const second = settle as unknown as () => void;
    second();
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('skips poll ticks while a refresh is pending without queueing a rerun', async () => {
    bus.state = 'unsupported';
    let settle: (() => void) | null = null;
    const refresh = vi.fn(() => new Promise<void>((resolve) => {
      settle = resolve;
    }));
    const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, fallbackPollMs: 1_000 });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    (settle as unknown as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not run a queued rerun after stop()', async () => {
    let settle: (() => void) | null = null;
    const refresh = vi.fn(() => new Promise<void>((resolve) => {
      settle = resolve;
    }));
    const stop = startEventDrivenRefresh({ eventTypes: ['agent-run.event'], refresh, debounceMs: 0 });

    bus.emit(agentRunEvent('chat-1'));
    bus.emit(agentRunEvent('chat-1'));
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    (settle as unknown as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
