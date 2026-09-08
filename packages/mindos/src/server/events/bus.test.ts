import { describe, expect, it, vi } from 'vitest';
import {
  createMindosServerEventBus,
  getMindosServerEventBus,
  resetMindosServerEventBusForTest,
  type MindosServerEventEnvelope,
} from './bus.js';

describe('mindos server event bus', () => {
  it('assigns strictly increasing ids and delivers events in emit order', () => {
    const bus = createMindosServerEventBus();
    const seen: MindosServerEventEnvelope[] = [];
    bus.subscribe((envelope) => seen.push(envelope));

    bus.emit({ type: 'tree.changed', version: 1 });
    bus.emit({ type: 'skills.changed' });
    bus.emit({ type: 'mcp.changed' });

    expect(seen.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(seen.map((entry) => entry.event.type)).toEqual(['tree.changed', 'skills.changed', 'mcp.changed']);
    expect(bus.lastEventId()).toBe(3);
    for (const entry of seen) expect(typeof entry.ts).toBe('number');
  });

  it('replays only events newer than lastEventId and reports the replay as complete', () => {
    const bus = createMindosServerEventBus();
    for (let index = 0; index < 5; index += 1) bus.emit({ type: 'tree.changed', version: index });

    const replay = bus.replaySince(2);
    expect(replay.complete).toBe(true);
    expect(replay.events.map((entry) => entry.id)).toEqual([3, 4, 5]);
    expect(bus.replaySince(5)).toEqual({ events: [], complete: true });
  });

  it('marks the replay incomplete when the ring no longer covers lastEventId', () => {
    const bus = createMindosServerEventBus({ ringSize: 3 });
    for (let index = 0; index < 6; index += 1) bus.emit({ type: 'tree.changed', version: index });

    // Ring keeps ids 4..6; a client that last saw id 1 missed ids 2 and 3.
    const replay = bus.replaySince(1);
    expect(replay.complete).toBe(false);
    expect(replay.events.map((entry) => entry.id)).toEqual([4, 5, 6]);

    // A client that last saw id 3 is exactly at the ring boundary: nothing missed.
    expect(bus.replaySince(3).complete).toBe(true);
  });

  it('marks the replay incomplete when the client id is ahead of the bus (server restarted)', () => {
    const bus = createMindosServerEventBus();
    bus.emit({ type: 'sync.changed' });
    const replay = bus.replaySince(57);
    expect(replay).toEqual({ events: [], complete: false });
  });

  it('treats a replay from id 0 as complete when the ring still holds the first event', () => {
    const bus = createMindosServerEventBus();
    bus.emit({ type: 'sync.changed' });
    expect(bus.replaySince(0)).toMatchObject({ complete: true });
    expect(bus.replaySince(0).events).toHaveLength(1);
  });

  it('stops delivering to a listener after unsubscribe and tolerates repeated unsubscribe', () => {
    const bus = createMindosServerEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    bus.emit({ type: 'skills.changed' });
    unsubscribe();
    unsubscribe();
    bus.emit({ type: 'skills.changed' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.subscriberCount()).toBe(0);
  });

  it('isolates a throwing listener from the others and from the emitter', () => {
    const bus = createMindosServerEventBus();
    const healthy = vi.fn();
    bus.subscribe(() => {
      throw new Error('listener bug');
    });
    bus.subscribe(healthy);
    expect(() => bus.emit({ type: 'mcp.changed' })).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('starts lazy sources on the first subscriber and stops them after the last one leaves', () => {
    const bus = createMindosServerEventBus();
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    bus.addSource(start);
    expect(start).not.toHaveBeenCalled();

    const unsubscribeA = bus.subscribe(() => {});
    const unsubscribeB = bus.subscribe(() => {});
    expect(start).toHaveBeenCalledTimes(1);

    unsubscribeA();
    expect(stop).not.toHaveBeenCalled();
    unsubscribeB();
    expect(stop).toHaveBeenCalledTimes(1);

    // Next subscriber cycle starts the source again.
    const unsubscribeC = bus.subscribe(() => {});
    expect(start).toHaveBeenCalledTimes(2);
    unsubscribeC();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('starts a source immediately when subscribers already exist and removing it stops it', () => {
    const bus = createMindosServerEventBus();
    const unsubscribe = bus.subscribe(() => {});
    const stop = vi.fn();
    const remove = bus.addSource(() => stop);
    remove();
    expect(stop).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps one process-wide singleton until reset', () => {
    resetMindosServerEventBusForTest();
    const first = getMindosServerEventBus();
    first.emit({ type: 'sync.changed' });
    expect(getMindosServerEventBus()).toBe(first);
    expect(getMindosServerEventBus().lastEventId()).toBe(1);
    resetMindosServerEventBusForTest();
    expect(getMindosServerEventBus()).not.toBe(first);
    expect(getMindosServerEventBus().lastEventId()).toBe(0);
  });

  it('rejects ring sizes below one and events without a known type', () => {
    expect(() => createMindosServerEventBus({ ringSize: 0 })).toThrow(/ringSize/);
    const bus = createMindosServerEventBus();
    expect(() => bus.emit({ type: 'nope' } as never)).toThrow(/Unknown server event type/);
  });
});
