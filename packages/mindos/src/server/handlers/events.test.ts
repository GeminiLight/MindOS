import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMindosServerEventBus } from '../events/bus.js';
import {
  MINDOS_SERVER_EVENTS_HEARTBEAT_MS,
  encodeMindosServerEventFrame,
  handleEventsStream,
  parseLastEventId,
  parseServerEventTypesFilter,
  type MindosServerEventStreamResponse,
} from './events.js';

type ParsedFrame = { id?: number; event?: string; data: Record<string, unknown> };

function parseFrame(raw: string): ParsedFrame {
  expect(raw.endsWith('\n\n')).toBe(true);
  const parsed: ParsedFrame = { data: {} };
  for (const line of raw.trimEnd().split('\n')) {
    if (line.startsWith('id: ')) parsed.id = Number(line.slice(4));
    else if (line.startsWith('event: ')) parsed.event = line.slice(7);
    else if (line.startsWith('data: ')) parsed.data = JSON.parse(line.slice(6)) as Record<string, unknown>;
    else throw new Error(`unexpected SSE line: ${line}`);
  }
  return parsed;
}

function okBody(response: MindosServerEventStreamResponse): AsyncIterator<string> {
  if (!response.ok) throw new Error(`expected stream, got ${response.status}`);
  expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
  expect(response.headers['Cache-Control']).toContain('no-store');
  return response.body[Symbol.asyncIterator]();
}

async function nextFrame(iterator: AsyncIterator<string>): Promise<ParsedFrame> {
  const result = await iterator.next();
  if (result.done) throw new Error('stream ended early');
  return parseFrame(result.value);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('handleEventsStream', () => {
  it('encodes frames with id, event and data lines', () => {
    const frame = encodeMindosServerEventFrame({ id: 7, event: { type: 'tree.changed', version: 3 } });
    expect(frame).toBe('id: 7\nevent: tree.changed\ndata: {"type":"tree.changed","version":3}\n\n');
    expect(encodeMindosServerEventFrame({ event: { type: 'heartbeat' } })).toBe('event: heartbeat\ndata: {"type":"heartbeat"}\n\n');
  });

  it('opens with a ready frame carrying the current tree version and last id', async () => {
    const bus = createMindosServerEventBus();
    bus.emit({ type: 'skills.changed' });
    const response = handleEventsStream(undefined, { events: bus, getTreeVersion: () => 42 });
    const iterator = okBody(response);

    const ready = await nextFrame(iterator);
    expect(ready).toEqual({
      id: 1,
      event: 'ready',
      data: { type: 'ready', lastEventId: 1, resync: false, treeVersion: 42 },
    });
    await iterator.return?.();
  });

  it('replays everything after Last-Event-ID before going live', async () => {
    const bus = createMindosServerEventBus();
    bus.emit({ type: 'tree.changed', version: 1 });
    bus.emit({ type: 'skills.changed' });
    bus.emit({ type: 'sync.changed' });
    const response = handleEventsStream(undefined, { events: bus }, { lastEventId: '1' });
    const iterator = okBody(response);

    expect(await nextFrame(iterator)).toMatchObject({ id: 2, event: 'skills.changed' });
    expect(await nextFrame(iterator)).toMatchObject({ id: 3, event: 'sync.changed' });
    expect(await nextFrame(iterator)).toMatchObject({ id: 3, event: 'ready', data: { resync: false } });

    const live = nextFrame(iterator);
    bus.emit({ type: 'mcp.changed' });
    expect(await live).toMatchObject({ id: 4, event: 'mcp.changed', data: { type: 'mcp.changed' } });
    await iterator.return?.();
  });

  it('asks the client to resync when the ring no longer covers its last id', async () => {
    const bus = createMindosServerEventBus({ ringSize: 2 });
    for (let index = 0; index < 5; index += 1) bus.emit({ type: 'tree.changed', version: index });
    const response = handleEventsStream(new URLSearchParams({ lastEventId: '1' }), { events: bus });
    const iterator = okBody(response);

    expect(await nextFrame(iterator)).toMatchObject({ id: 4 });
    expect(await nextFrame(iterator)).toMatchObject({ id: 5 });
    expect(await nextFrame(iterator)).toMatchObject({ event: 'ready', data: { resync: true, lastEventId: 5 } });
    await iterator.return?.();
  });

  it('asks the client to resync when its last id is ahead of a restarted server', async () => {
    const bus = createMindosServerEventBus();
    const response = handleEventsStream(undefined, { events: bus }, { lastEventId: 99 });
    const iterator = okBody(response);
    expect(await nextFrame(iterator)).toMatchObject({ id: 0, event: 'ready', data: { resync: true, lastEventId: 0 } });
    await iterator.return?.();
  });

  it('prefers the Last-Event-ID header over the query parameter', async () => {
    const bus = createMindosServerEventBus();
    bus.emit({ type: 'skills.changed' });
    bus.emit({ type: 'skills.changed' });
    const response = handleEventsStream(new URLSearchParams({ lastEventId: '0' }), { events: bus }, { lastEventId: '1' });
    const iterator = okBody(response);
    expect(await nextFrame(iterator)).toMatchObject({ id: 2 });
    expect(await nextFrame(iterator)).toMatchObject({ event: 'ready' });
    await iterator.return?.();
  });

  it('filters live and replayed events by ?types= while always sending ready and heartbeat', async () => {
    vi.useFakeTimers();
    const bus = createMindosServerEventBus();
    bus.emit({ type: 'skills.changed' });
    bus.emit({ type: 'tree.changed', version: 9 });
    const response = handleEventsStream(new URLSearchParams({ types: 'tree,agent-run', lastEventId: '0' }), { events: bus });
    const iterator = okBody(response);

    expect(await nextFrame(iterator)).toMatchObject({ id: 2, event: 'tree.changed' });
    expect(await nextFrame(iterator)).toMatchObject({ event: 'ready' });

    const pending = nextFrame(iterator);
    bus.emit({ type: 'mcp.changed' });
    bus.emit({ type: 'tree.changed', version: 10 });
    expect(await pending).toMatchObject({ id: 4, event: 'tree.changed', data: { version: 10 } });

    const heartbeat = nextFrame(iterator);
    vi.advanceTimersByTime(MINDOS_SERVER_EVENTS_HEARTBEAT_MS);
    expect(await heartbeat).toEqual({ event: 'heartbeat', data: { type: 'heartbeat' } });
    await iterator.return?.();
  });

  it('rejects a types filter that names no known event type', () => {
    const bus = createMindosServerEventBus();
    const response = handleEventsStream(new URLSearchParams({ types: 'bogus,nope' }), { events: bus });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    if (!response.ok) expect(response.body).toEqual({ error: 'Unknown event types: bogus, nope' });
    expect(bus.subscriberCount()).toBe(0);
  });

  it('emits a heartbeat every 25 seconds while idle', async () => {
    vi.useFakeTimers();
    const bus = createMindosServerEventBus();
    const response = handleEventsStream(undefined, { events: bus });
    const iterator = okBody(response);
    expect(await nextFrame(iterator)).toMatchObject({ event: 'ready' });

    const first = nextFrame(iterator);
    vi.advanceTimersByTime(MINDOS_SERVER_EVENTS_HEARTBEAT_MS - 1);
    vi.advanceTimersByTime(1);
    expect(await first).toMatchObject({ event: 'heartbeat' });

    const second = nextFrame(iterator);
    vi.advanceTimersByTime(MINDOS_SERVER_EVENTS_HEARTBEAT_MS);
    expect(await second).toMatchObject({ event: 'heartbeat' });
    await iterator.return?.();
  });

  it('ends the stream and drops the bus subscription when the request aborts', async () => {
    vi.useFakeTimers();
    const bus = createMindosServerEventBus();
    const controller = new AbortController();
    const response = handleEventsStream(undefined, { events: bus }, { signal: controller.signal });
    const iterator = okBody(response);
    expect(await nextFrame(iterator)).toMatchObject({ event: 'ready' });
    expect(bus.subscriberCount()).toBe(1);

    const pending = iterator.next();
    controller.abort();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(bus.subscriberCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    bus.emit({ type: 'skills.changed' });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it('cleans up when the consumer stops iterating early', async () => {
    vi.useFakeTimers();
    const bus = createMindosServerEventBus();
    const response = handleEventsStream(undefined, { events: bus });
    if (!response.ok) throw new Error('expected stream');
    for await (const frame of response.body) {
      expect(parseFrame(frame)).toMatchObject({ event: 'ready' });
      break;
    }
    expect(bus.subscriberCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('produces nothing for a request that was already aborted', async () => {
    const bus = createMindosServerEventBus();
    const controller = new AbortController();
    controller.abort();
    const response = handleEventsStream(undefined, { events: bus }, { signal: controller.signal });
    const iterator = okBody(response);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(bus.subscriberCount()).toBe(0);
  });

  it('omits treeVersion when the tree cache cannot answer', async () => {
    const bus = createMindosServerEventBus();
    const response = handleEventsStream(undefined, {
      events: bus,
      getTreeVersion: () => {
        throw new Error('mind root missing');
      },
    });
    const iterator = okBody(response);
    const ready = await nextFrame(iterator);
    expect(ready.data).toEqual({ type: 'ready', lastEventId: 0, resync: false });
    await iterator.return?.();
  });
});

describe('events stream query parsing', () => {
  it('parses last event ids from headers, arrays and query strings', () => {
    expect(parseLastEventId('12')).toBe(12);
    expect(parseLastEventId(' 7 ')).toBe(7);
    expect(parseLastEventId(['3', '4'])).toBe(3);
    expect(parseLastEventId(9)).toBe(9);
    expect(parseLastEventId(undefined)).toBeNull();
    expect(parseLastEventId(null)).toBeNull();
    expect(parseLastEventId('')).toBeNull();
    expect(parseLastEventId('abc')).toBeNull();
    expect(parseLastEventId('-1')).toBeNull();
    expect(parseLastEventId('1.5')).toBeNull();
    expect(parseLastEventId(String(Number.MAX_SAFE_INTEGER + 10))).toBeNull();
  });

  it('maps short aliases and full names to event types and ignores unknown entries', () => {
    expect(parseServerEventTypesFilter(undefined)).toEqual({ types: null, unknown: [] });
    expect(parseServerEventTypesFilter('')).toEqual({ types: null, unknown: [] });
    expect(parseServerEventTypesFilter('tree, agent-run')).toEqual({
      types: new Set(['tree.changed', 'agent-run.event']),
      unknown: [],
    });
    expect(parseServerEventTypesFilter('skills.changed,mcp,sync,bogus')).toEqual({
      types: new Set(['skills.changed', 'mcp.changed', 'sync.changed']),
      unknown: ['bogus'],
    });
    expect(parseServerEventTypesFilter('heartbeat')).toEqual({ types: new Set(), unknown: ['heartbeat'] });
  });
});
