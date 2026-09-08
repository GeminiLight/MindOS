import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMindosServerEventBus,
  resetMindosServerEventBusForTest,
} from '@geminilight/mindos/server';
import { notifyTreeVersionChanged } from '@/lib/server-events-bridge';

vi.mock('@/lib/fs', () => ({
  getTreeVersion: () => 7,
}));

type Frame = { id?: number; event?: string; data: Record<string, unknown> };

class FrameReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private readonly queue: Frame[] = [];

  constructor(response: Response) {
    if (!response.body) throw new Error('missing stream body');
    this.reader = response.body.getReader();
  }

  async next(): Promise<Frame> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const queued = this.queue.shift();
      if (queued) return queued;
      const result = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => reject(new Error('timed out waiting for SSE frame')), 1_000);
        }),
      ]);
      if (result.done) throw new Error('stream ended');
      this.buffer += this.decoder.decode(result.value, { stream: true });
      this.drain();
    }
    throw new Error('no frame arrived');
  }

  async done(): Promise<boolean> {
    const result = await Promise.race([
      this.reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        setTimeout(() => reject(new Error('stream did not end')), 1_000);
      }),
    ]);
    return result.done;
  }

  private drain(): void {
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const frame: Frame = { data: {} };
      for (const line of block.split('\n')) {
        if (line.startsWith('id: ')) frame.id = Number(line.slice(4));
        else if (line.startsWith('event: ')) frame.event = line.slice(7);
        else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6)) as Record<string, unknown>;
      }
      this.queue.push(frame);
      boundary = this.buffer.indexOf('\n\n');
    }
  }
}

describe('GET /api/events (Next adapter)', () => {
  beforeEach(() => {
    resetMindosServerEventBusForTest();
  });

  it('streams text/event-stream and opens with a ready frame carrying the tree version', async () => {
    const { GET } = await import('@/app/api/events/route');
    const abort = new AbortController();
    const response = await GET(new Request('http://localhost/api/events', { signal: abort.signal }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('no-store');

    const reader = new FrameReader(response);
    const ready = await reader.next();
    expect(ready.event).toBe('ready');
    expect(ready.data).toMatchObject({ type: 'ready', resync: false, treeVersion: 7 });

    abort.abort();
    expect(await reader.done()).toBe(true);
  });

  it('forwards lib/fs tree version bumps through the bridge as tree.changed frames', async () => {
    const { GET } = await import('@/app/api/events/route');
    const abort = new AbortController();
    const response = await GET(new Request('http://localhost/api/events', { signal: abort.signal }));
    const reader = new FrameReader(response);
    expect((await reader.next()).event).toBe('ready');

    notifyTreeVersionChanged(1234);
    const changed = await reader.next();
    expect(changed).toMatchObject({ event: 'tree.changed', data: { type: 'tree.changed', version: 1234 } });
    expect(typeof changed.id).toBe('number');
    abort.abort();
  });

  it('rejects an unknown types filter with 400 and no open stream', async () => {
    const { GET } = await import('@/app/api/events/route');
    const response = await GET(new Request('http://localhost/api/events?types=bogus'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown event types: bogus' });
    expect(getMindosServerEventBus().subscriberCount()).toBe(0);
  });

  it('replays missed events for a Last-Event-ID header', async () => {
    const { GET } = await import('@/app/api/events/route');
    const bus = getMindosServerEventBus();
    bus.emit({ type: 'skills.changed' });
    bus.emit({ type: 'sync.changed' });

    const abort = new AbortController();
    const response = await GET(new Request('http://localhost/api/events', {
      headers: { 'last-event-id': '1' },
      signal: abort.signal,
    }));
    const reader = new FrameReader(response);
    expect(await reader.next()).toMatchObject({ id: 2, event: 'sync.changed' });
    expect(await reader.next()).toMatchObject({ id: 2, event: 'ready', data: { resync: false } });
    abort.abort();
  });

  it('releases the bus subscription when the client disconnects', async () => {
    const { GET } = await import('@/app/api/events/route');
    const bus = getMindosServerEventBus();
    const abort = new AbortController();
    const response = await GET(new Request('http://localhost/api/events', { signal: abort.signal }));
    const reader = new FrameReader(response);
    await reader.next();
    expect(bus.subscriberCount()).toBe(1);

    abort.abort();
    expect(await reader.done()).toBe(true);
    expect(bus.subscriberCount()).toBe(0);
  });
});
