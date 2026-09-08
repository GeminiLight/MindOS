// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_CHANGED_EVENT } from '@/lib/files-changed';
import {
  SERVER_EVENTS_RECONNECT_MAX_MS,
  SERVER_EVENTS_RECONNECT_MIN_MS,
  SERVER_EVENTS_URL,
  getServerEventsLastEventId,
  getServerEventsState,
  resetServerEventsForTests,
  subscribeServerEvents,
  subscribeServerEventsState,
  type ServerEvent,
} from '@/lib/server-events';
import { MockEventSource, setDocumentVisibility } from '../fixtures/mock-event-source';

describe('server events transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    resetServerEventsForTests();
    vi.stubGlobal('EventSource', MockEventSource);
    setDocumentVisibility('visible');
  });

  afterEach(() => {
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens one connection for the first subscriber and closes it after the last one leaves', () => {
    expect(getServerEventsState()).toBe('idle');
    const unsubscribeA = subscribeServerEvents('tree.changed', () => {});
    const unsubscribeB = subscribeServerEvents('mcp.changed', () => {});
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.last().url).toBe(SERVER_EVENTS_URL);
    expect(getServerEventsState()).toBe('connecting');

    MockEventSource.last().open();
    expect(getServerEventsState()).toBe('connected');

    unsubscribeA();
    expect(MockEventSource.last().closed).toBe(false);
    unsubscribeB();
    unsubscribeB();
    expect(MockEventSource.last().closed).toBe(true);
    expect(getServerEventsState()).toBe('idle');
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('dispatches typed frames to matching and wildcard handlers and remembers the last id', () => {
    const tree = vi.fn();
    const skills = vi.fn();
    const all = vi.fn();
    subscribeServerEvents('tree.changed', tree);
    subscribeServerEvents('skills.changed', skills);
    subscribeServerEvents('*', all);
    const source = MockEventSource.last();
    source.ready({ lastEventId: 4, treeVersion: 1 });

    source.emit('tree.changed', { type: 'tree.changed', version: 9 }, 12);
    expect(tree).toHaveBeenCalledWith({ type: 'tree.changed', version: 9 });
    expect(skills).not.toHaveBeenCalled();
    expect(all).toHaveBeenCalledTimes(2); // ready + tree.changed
    expect(getServerEventsLastEventId()).toBe(12);
  });

  it('bridges tree.changed onto the files-changed window event', () => {
    const filesChanged = vi.fn();
    window.addEventListener(FILES_CHANGED_EVENT, filesChanged);
    subscribeServerEvents('tree.changed', () => {});
    const source = MockEventSource.last();
    source.open();
    source.emit('tree.changed', { type: 'tree.changed', version: 2 }, 1);
    source.emit('mcp.changed', { type: 'mcp.changed' }, 2);
    expect(filesChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener(FILES_CHANGED_EVENT, filesChanged);
  });

  it('reconnects with exponential backoff capped at 30s and carries the last id in the URL', () => {
    subscribeServerEvents('tree.changed', () => {});
    const first = MockEventSource.last();
    first.open();
    first.emit('tree.changed', { type: 'tree.changed', version: 1 }, 9);

    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    expect(expectedDelays[0]).toBe(SERVER_EVENTS_RECONNECT_MIN_MS);
    expect(expectedDelays[expectedDelays.length - 1]).toBe(SERVER_EVENTS_RECONNECT_MAX_MS);

    for (const [index, delay] of expectedDelays.entries()) {
      MockEventSource.last().fail();
      expect(MockEventSource.last().closed).toBe(true);
      expect(getServerEventsState()).toBe('reconnecting');
      vi.advanceTimersByTime(delay - 1);
      expect(MockEventSource.instances).toHaveLength(index + 1);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(index + 2);
      expect(MockEventSource.last().url).toBe(`${SERVER_EVENTS_URL}?lastEventId=9`);
    }
  });

  it('resets the backoff once a connection becomes healthy again', () => {
    subscribeServerEvents('tree.changed', () => {});
    MockEventSource.last().fail();
    vi.advanceTimersByTime(1_000);
    MockEventSource.last().fail();
    vi.advanceTimersByTime(2_000);
    expect(MockEventSource.instances).toHaveLength(3);

    MockEventSource.last().ready();
    expect(getServerEventsState()).toBe('connected');

    MockEventSource.last().fail();
    vi.advanceTimersByTime(999);
    expect(MockEventSource.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(MockEventSource.instances).toHaveLength(4);
  });

  it('does not retry while the tab is hidden and reconnects immediately when it becomes visible', () => {
    subscribeServerEvents('tree.changed', () => {});
    MockEventSource.last().open();
    setDocumentVisibility('hidden');

    MockEventSource.last().fail();
    expect(getServerEventsState()).toBe('reconnecting');
    vi.advanceTimersByTime(120_000);
    expect(MockEventSource.instances).toHaveLength(1);

    setDocumentVisibility('visible');
    expect(MockEventSource.instances).toHaveLength(2);
    // A retry attempt is still "reconnecting" until the socket opens.
    expect(getServerEventsState()).toBe('reconnecting');
    MockEventSource.last().open();
    expect(getServerEventsState()).toBe('connected');
  });

  it('reports unsupported when EventSource is missing so consumers fall back to polling', () => {
    vi.stubGlobal('EventSource', undefined);
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const unsubscribe = subscribeServerEvents('sync.changed', () => {});
    expect(getServerEventsState()).toBe('unsupported');
    expect(MockEventSource.instances).toHaveLength(0);
    unsubscribe();
    expect(getServerEventsState()).toBe('idle');
  });

  it('notifies state listeners on every transition', () => {
    const states: string[] = [];
    subscribeServerEventsState((state) => states.push(state));
    const unsubscribe = subscribeServerEvents('tree.changed', () => {});
    MockEventSource.last().open();
    MockEventSource.last().fail();
    unsubscribe();
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'idle']);
  });

  it('ignores malformed frames and unknown event types', () => {
    const handler = vi.fn();
    subscribeServerEvents('*', handler);
    const source = MockEventSource.last();
    source.open();
    source.emit('tree.changed', 'not json{', 3);
    source.emit('message', { type: 'bogus' }, 4);
    source.emit('message', { noType: true }, 5);
    expect(handler).not.toHaveBeenCalled();
    // Ids are still tracked so a later reconnect does not replay the junk.
    expect(getServerEventsLastEventId()).toBe(5);

    source.emit('message', { type: 'sync.changed' }, 6);
    expect(handler).toHaveBeenCalledWith({ type: 'sync.changed' });
  });

  it('keeps delivering to other handlers when one throws', () => {
    const healthy = vi.fn<(event: ServerEvent) => void>();
    subscribeServerEvents('mcp.changed', () => {
      throw new Error('consumer bug');
    });
    subscribeServerEvents('mcp.changed', healthy);
    const source = MockEventSource.last();
    source.open();
    expect(() => source.emit('mcp.changed', { type: 'mcp.changed' }, 1)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('ignores callbacks from a socket that was already replaced', () => {
    const handler = vi.fn();
    subscribeServerEvents('skills.changed', handler);
    const stale = MockEventSource.last();
    stale.fail();
    vi.advanceTimersByTime(1_000);
    const fresh = MockEventSource.last();
    expect(fresh).not.toBe(stale);

    stale.emit('skills.changed', { type: 'skills.changed' }, 1);
    expect(handler).not.toHaveBeenCalled();
    fresh.open();
    fresh.emit('skills.changed', { type: 'skills.changed' }, 2);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
