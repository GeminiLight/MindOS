import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMindosHttpServer, type MindosHttpServer } from './http.js';
import { getMindosServerEventBus, resetMindosServerEventBusForTest } from './events/bus.js';
import { isAgentRunLedgerBridgeInstalled } from './events/ledger-bridge.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  resetMindosServerEventBusForTest();
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mindos-http-events-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function startServer(root: string, settings: Record<string, unknown> = {}): Promise<{ app: MindosHttpServer; base: string }> {
  resetMindosServerEventBusForTest();
  const app = createMindosHttpServer({
    hostname: '127.0.0.1',
    port: 0,
    runtime: {
      homeDir: root,
      readSettings: () => ({ mindRoot: root, ...settings }),
    },
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => app.close());
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP server address');
  return { app, base: `http://127.0.0.1:${address.port}` };
}

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

  async next(timeoutMs = 3_000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const queued = this.queue.shift();
      if (queued) return queued;
      const result = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => reject(new Error('timed out waiting for SSE frame')), Math.max(1, deadline - Date.now()));
        }),
      ]);
      if (result.done) throw new Error('stream ended');
      this.buffer += this.decoder.decode(result.value, { stream: true });
      this.drain();
    }
    throw new Error('no frame within timeout');
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => {});
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

describe('GET /api/events over the standalone HTTP server', () => {
  it('serves text/event-stream with a ready frame carrying the tree version', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const { base } = await startServer(root);
    const treeVersion = ((await (await fetch(`${base}/api/tree-version`)).json()) as { v: number }).v;

    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    const reader = new FrameReader(response);
    const ready = await reader.next();
    expect(ready.event).toBe('ready');
    expect(ready.data).toMatchObject({ type: 'ready', resync: false, treeVersion });
    controller.abort();
    await reader.cancel();
  });

  it('pushes tree.changed after an internal write instead of waiting for a poll', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const { base } = await startServer(root);

    const controller = new AbortController();
    const response = await fetch(`${base}/api/events?types=tree`, { signal: controller.signal });
    const reader = new FrameReader(response);
    const ready = await reader.next();
    expect(ready.event).toBe('ready');

    const write = await fetch(`${base}/api/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'create_file', path: 'b.md', content: 'b' }),
    });
    expect(write.status).toBe(200);

    const changed = await reader.next(5_000);
    expect(changed.event).toBe('tree.changed');
    expect(typeof changed.id).toBe('number');
    expect(changed.data.version).not.toBe(ready.data.treeVersion);
    controller.abort();
    await reader.cancel();
  });

  it('requires the bearer token when one is configured', async () => {
    const root = makeRoot();
    const { base } = await startServer(root, { authToken: 'secret-token' });

    expect((await fetch(`${base}/api/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/events`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);

    const controller = new AbortController();
    const ok = await fetch(`${base}/api/events`, {
      headers: { authorization: 'Bearer secret-token' },
      signal: controller.signal,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();
    await ok.body?.cancel().catch(() => {});
  });

  it('answers 400 for an unknown types filter without opening a stream', async () => {
    const root = makeRoot();
    const { base } = await startServer(root);
    const response = await fetch(`${base}/api/events?types=bogus`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown event types: bogus' });
    expect(getMindosServerEventBus().subscriberCount()).toBe(0);
  });

  it('keeps serving after a client disconnects and releases its subscription', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const { base } = await startServer(root);
    const bus = getMindosServerEventBus();

    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = new FrameReader(response);
    await reader.next();
    expect(bus.subscriberCount()).toBe(1);

    controller.abort();
    await reader.cancel();

    const deadline = Date.now() + 3_000;
    while (bus.subscriberCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(bus.subscriberCount()).toBe(0);

    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await (await fetch(`${base}/api/files?limit=10`)).json())).toMatchObject({ files: ['a.md'] });
  });

  it('honours Last-Event-ID and replays what the client missed', async () => {
    const root = makeRoot();
    const { base } = await startServer(root);
    const bus = getMindosServerEventBus();
    bus.emit({ type: 'skills.changed' });
    bus.emit({ type: 'mcp.changed' });

    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      headers: { 'last-event-id': '1' },
      signal: controller.signal,
    });
    const reader = new FrameReader(response);
    expect(await reader.next()).toMatchObject({ id: 2, event: 'mcp.changed' });
    expect(await reader.next()).toMatchObject({ id: 2, event: 'ready', data: { resync: false } });
    controller.abort();
    await reader.cancel();
  });

  it('installs the agent run ledger bridge on the process bus', async () => {
    const root = makeRoot();
    await startServer(root);
    expect(isAgentRunLedgerBridgeInstalled(getMindosServerEventBus())).toBe(true);
  });
});
