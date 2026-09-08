import { describe, expect, it, vi } from 'vitest';
import {
  MCP_SESSION_IDLE_TIMEOUT_MS,
  createMcpSessionRegistry,
  isJsonRpcInitializeRequest,
} from './session-registry.js';

function fakeTransport() {
  return { close: vi.fn(async () => {}) };
}

describe('createMcpSessionRegistry', () => {
  it('records lastSeenAt on add and refreshes it on touch', () => {
    let now = 1_000;
    const registry = createMcpSessionRegistry<ReturnType<typeof fakeTransport>, string>({ now: () => now });
    registry.add('s1', fakeTransport(), 'server');
    expect(registry.get('s1')?.lastSeenAt).toBe(1_000);

    now = 5_000;
    expect(registry.touch('s1')).toBe(true);
    expect(registry.get('s1')?.lastSeenAt).toBe(5_000);
    expect(registry.touch('missing')).toBe(false);
    expect(registry.size).toBe(1);
  });

  it('sweeps only sessions idle for longer than the timeout and closes their transports', async () => {
    let now = 0;
    const registry = createMcpSessionRegistry<ReturnType<typeof fakeTransport>, string>({
      idleTimeoutMs: 1_000,
      now: () => now,
    });
    const stale = fakeTransport();
    const fresh = fakeTransport();
    const boundary = fakeTransport();
    registry.add('stale', stale, 'a');
    now = 500;
    registry.add('boundary', boundary, 'b');
    now = 1_200;
    registry.add('fresh', fresh, 'c');

    now = 1_500; // stale idle 1500 (> 1000), boundary idle exactly 1000 (not > 1000), fresh idle 300
    await expect(registry.sweep()).resolves.toEqual(['stale']);

    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(boundary.close).not.toHaveBeenCalled();
    expect(fresh.close).not.toHaveBeenCalled();
    expect(registry.has('stale')).toBe(false);
    expect(registry.has('boundary')).toBe(true);
    expect(registry.has('fresh')).toBe(true);
  });

  it('keeps a session alive as long as requests keep touching it', async () => {
    let now = 0;
    const registry = createMcpSessionRegistry<ReturnType<typeof fakeTransport>, string>({
      idleTimeoutMs: 1_000,
      now: () => now,
    });
    registry.add('s1', fakeTransport(), 'a');
    for (let i = 0; i < 10; i += 1) {
      now += 900;
      registry.touch('s1');
      await expect(registry.sweep()).resolves.toEqual([]);
    }
    expect(registry.size).toBe(1);
  });

  it('removes the session even when transport.close throws', async () => {
    let now = 0;
    const registry = createMcpSessionRegistry<{ close(): Promise<void> }, string>({
      idleTimeoutMs: 10,
      now: () => now,
    });
    registry.add('broken', { close: async () => { throw new Error('boom'); } }, 'a');
    now = 100;
    await expect(registry.sweep()).resolves.toEqual(['broken']);
    expect(registry.size).toBe(0);
  });

  it('tolerates a transport.onclose-style delete racing the sweep', async () => {
    let now = 0;
    const registry = createMcpSessionRegistry<{ close(): Promise<void> }, string>({
      idleTimeoutMs: 10,
      now: () => now,
    });
    registry.add('racy', { close: async () => { registry.delete('racy'); } }, 'a');
    now = 100;
    await expect(registry.sweep()).resolves.toEqual(['racy']);
    expect(registry.size).toBe(0);
  });

  it('returns an empty list when nothing is registered', async () => {
    const registry = createMcpSessionRegistry();
    await expect(registry.sweep()).resolves.toEqual([]);
  });

  it('defaults to a 30 minute idle timeout', async () => {
    expect(MCP_SESSION_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
    let now = 0;
    const registry = createMcpSessionRegistry<ReturnType<typeof fakeTransport>, string>({ now: () => now });
    registry.add('s1', fakeTransport(), 'a');
    now = 29 * 60 * 1000;
    await expect(registry.sweep()).resolves.toEqual([]);
    now = 30 * 60 * 1000 + 1;
    await expect(registry.sweep()).resolves.toEqual(['s1']);
  });

  it('runs the periodic sweeper on an unref-ed interval and reports closed ids', async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const registry = createMcpSessionRegistry<ReturnType<typeof fakeTransport>, string>({
        idleTimeoutMs: 1_000,
        now: () => now,
      });
      const transport = fakeTransport();
      registry.add('s1', transport, 'a');
      const swept: string[][] = [];
      const stop = registry.startSweeper(100, (ids) => swept.push(ids));

      await vi.advanceTimersByTimeAsync(100);
      expect(swept).toEqual([]);

      now = 5_000;
      await vi.advanceTimersByTimeAsync(100);
      expect(swept).toEqual([['s1']]);
      expect(transport.close).toHaveBeenCalledTimes(1);

      stop();
      registry.add('s2', fakeTransport(), 'b');
      now = 50_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(registry.has('s2')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isJsonRpcInitializeRequest', () => {
  it('accepts a single initialize request and a batch containing one', () => {
    expect(isJsonRpcInitializeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).toBe(true);
    expect(isJsonRpcInitializeRequest([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} },
    ])).toBe(true);
  });

  it('rejects other methods, malformed envelopes, empty batches and non-objects', () => {
    expect(isJsonRpcInitializeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
    expect(isJsonRpcInitializeRequest({ id: 1, method: 'initialize' })).toBe(false);
    expect(isJsonRpcInitializeRequest({ jsonrpc: '1.0', method: 'initialize' })).toBe(false);
    expect(isJsonRpcInitializeRequest([])).toBe(false);
    expect(isJsonRpcInitializeRequest(null)).toBe(false);
    expect(isJsonRpcInitializeRequest(undefined)).toBe(false);
    expect(isJsonRpcInitializeRequest('initialize')).toBe(false);
    expect(isJsonRpcInitializeRequest(42)).toBe(false);
  });
});
