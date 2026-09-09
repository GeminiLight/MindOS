import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appState = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    currentState: 'active' as string,
    addEventListener: vi.fn((_type: string, handler: (state: string) => void) => {
      listeners.add(handler);
      return { remove: () => listeners.delete(handler) };
    }),
    set(state: string) {
      this.currentState = state;
      for (const listener of Array.from(listeners)) listener(state);
    },
    listenerCount: () => listeners.size,
    reset() {
      listeners.clear();
      this.currentState = 'active';
      this.addEventListener.mockClear();
    },
  };
});

const client = vi.hoisted(() => ({
  baseUrl: 'http://127.0.0.1:4567',
  authToken: 'secret-token',
}));

const transport = vi.hoisted(() => ({
  fetch: undefined as unknown,
}));

vi.mock('react-native', () => ({ AppState: appState }));
vi.mock('@/lib/api-client', () => ({ mindosClient: client }));
vi.mock('expo/fetch', () => ({
  get fetch() {
    return transport.fetch;
  },
}));

import {
  SERVER_EVENTS_PATH,
  SERVER_EVENTS_RECONNECT_MAX_MS,
  SERVER_EVENTS_RECONNECT_MIN_MS,
  SERVER_EVENTS_STALL_MS,
  getServerEventsLastEventId,
  getServerEventsState,
  isServerEventsConnected,
  resetServerEventsForTests,
  subscribeServerEvents,
  subscribeServerEventsState,
  type ServerEvent,
} from '@/lib/server-events';

const encoder = new TextEncoder();

type ReadResult = { value?: Uint8Array; done: boolean };

/** One `expo/fetch` call: resolve / reject the response, then push bytes into the body. */
class FakeConnection {
  static instances: FakeConnection[] = [];

  readonly url: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal | null;
  readonly response: Promise<unknown>;
  readCount = 0;
  cancelled = false;

  private resolveResponse!: (value: unknown) => void;
  private rejectResponse!: (reason: unknown) => void;
  private responded = false;
  private queue: Array<{ result?: ReadResult; error?: unknown }> = [];
  private waiting: { resolve: (r: ReadResult) => void; reject: (e: unknown) => void } | null = null;

  constructor(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal | null } = {}) {
    this.url = url;
    this.headers = { ...(init.headers ?? {}) };
    this.signal = init.signal ?? null;
    this.response = new Promise((resolve, reject) => {
      this.resolveResponse = resolve;
      this.rejectResponse = reject;
    });
    this.signal?.addEventListener('abort', () => {
      const error = Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (!this.responded) {
        this.responded = true;
        this.rejectResponse(error);
        return;
      }
      this.pushError(error);
    });
    FakeConnection.instances.push(this);
  }

  static last(): FakeConnection {
    return FakeConnection.instances[FakeConnection.instances.length - 1];
  }

  static reset(): void {
    FakeConnection.instances = [];
  }

  get aborted(): boolean {
    return this.signal?.aborted ?? false;
  }

  respond(options: { status?: number; body?: boolean } = {}): void {
    const status = options.status ?? 200;
    const hasBody = options.body ?? true;
    const reader = {
      read: () => this.read(),
      cancel: () => {
        this.cancelled = true;
        return Promise.resolve();
      },
      releaseLock: () => {},
    };
    this.responded = true;
    this.resolveResponse({
      ok: status >= 200 && status < 300,
      status,
      body: hasBody ? { getReader: () => reader } : null,
    });
  }

  reject(error: unknown = new Error('Network request failed')): void {
    this.responded = true;
    this.rejectResponse(error);
  }

  send(text: string): void {
    this.push({ result: { value: encoder.encode(text), done: false } });
  }

  frame(event: string, payload: unknown, id?: number): void {
    const lines = [] as string[];
    if (typeof id === 'number') lines.push(`id: ${id}`);
    lines.push(`event: ${event}`, `data: ${JSON.stringify(payload)}`);
    this.send(`${lines.join('\n')}\n\n`);
  }

  ready(lastEventId = 0, extra: Record<string, unknown> = {}): void {
    this.frame('ready', { type: 'ready', lastEventId, resync: false, ...extra }, lastEventId);
  }

  close(): void {
    this.push({ result: { done: true } });
  }

  fail(error: unknown = new Error('socket reset')): void {
    this.pushError(error);
  }

  private pushError(error: unknown): void {
    this.push({ error });
  }

  private push(entry: { result?: ReadResult; error?: unknown }): void {
    if (this.waiting) {
      const pending = this.waiting;
      this.waiting = null;
      if (entry.error) pending.reject(entry.error);
      else pending.resolve(entry.result as ReadResult);
      return;
    }
    this.queue.push(entry);
  }

  private read(): Promise<ReadResult> {
    this.readCount += 1;
    const next = this.queue.shift();
    if (next) {
      return next.error ? Promise.reject(next.error) : Promise.resolve(next.result as ReadResult);
    }
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

async function openConnection(connection: FakeConnection, lastEventId = 0): Promise<void> {
  connection.respond();
  await flush();
  connection.ready(lastEventId);
  await flush();
}

describe('mobile server events transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeConnection.reset();
    appState.reset();
    client.baseUrl = 'http://127.0.0.1:4567';
    client.authToken = 'secret-token';
    transport.fetch = (url: string, init: never) => new FakeConnection(url, init).response;
    resetServerEventsForTests();
  });

  afterEach(() => {
    resetServerEventsForTests();
    vi.useRealTimers();
  });

  it('opens one streaming fetch for the first subscriber with SSE and bearer headers', async () => {
    expect(getServerEventsState()).toBe('idle');
    const unsubscribeA = subscribeServerEvents('tree.changed', () => {});
    const unsubscribeB = subscribeServerEvents('mcp.changed', () => {});

    expect(FakeConnection.instances).toHaveLength(1);
    const connection = FakeConnection.last();
    expect(connection.url).toBe(`http://127.0.0.1:4567${SERVER_EVENTS_PATH}`);
    expect(connection.headers.Accept).toBe('text/event-stream');
    expect(connection.headers.Authorization).toBe('Bearer secret-token');
    expect(connection.headers['Last-Event-ID']).toBeUndefined();
    expect(getServerEventsState()).toBe('connecting');

    connection.respond();
    await flush();
    expect(getServerEventsState()).toBe('connected');
    expect(isServerEventsConnected()).toBe(true);

    unsubscribeA();
    expect(connection.aborted).toBe(false);
    unsubscribeB();
    unsubscribeB();
    expect(connection.aborted).toBe(true);
    expect(getServerEventsState()).toBe('idle');
    expect(FakeConnection.instances).toHaveLength(1);
    expect(appState.listenerCount()).toBe(0);
  });

  it('omits the Authorization header when the client has no token', () => {
    client.authToken = '';
    subscribeServerEvents('tree.changed', () => {});
    expect(FakeConnection.last().headers.Authorization).toBeUndefined();
  });

  it('dispatches typed frames to matching and wildcard handlers and remembers the last id', async () => {
    const tree = vi.fn();
    const skills = vi.fn();
    const all = vi.fn();
    subscribeServerEvents('tree.changed', tree);
    subscribeServerEvents('skills.changed', skills);
    subscribeServerEvents('*', all);
    const connection = FakeConnection.last();
    await openConnection(connection, 4);
    expect(getServerEventsLastEventId()).toBe(4);

    connection.frame('tree.changed', { type: 'tree.changed', version: 9 }, 12);
    await flush();

    expect(tree).toHaveBeenCalledWith({ type: 'tree.changed', version: 9 });
    expect(skills).not.toHaveBeenCalled();
    expect(all).toHaveBeenCalledTimes(2); // ready + tree.changed
    expect(all.mock.calls[0][0]).toEqual({ type: 'ready', lastEventId: 4, resync: false });
    expect(getServerEventsLastEventId()).toBe(12);
  });

  it('reassembles frames split across chunks before dispatching', async () => {
    const handler = vi.fn();
    subscribeServerEvents('agent-run.event', handler);
    const connection = FakeConnection.last();
    await openConnection(connection);

    const payload = JSON.stringify({
      type: 'agent-run.event',
      runId: 'run-1',
      chatSessionId: 'chat-1',
      event: { id: 'e1', runId: 'run-1', type: 'tool_started', category: 'tool', status: 'running', ts: 1 },
    });
    const wire = `id: 3\nevent: agent-run.event\ndata: ${payload}\n\n`;
    connection.send(wire.slice(0, 20));
    await flush();
    connection.send(wire.slice(20, 61));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    connection.send(wire.slice(61));
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'agent-run.event', runId: 'run-1' });
  });

  it('ignores unknown event types and malformed JSON, and isolates handler errors', async () => {
    const good = vi.fn();
    subscribeServerEvents('*', () => {
      throw new Error('consumer bug');
    });
    subscribeServerEvents('*', good);
    const connection = FakeConnection.last();
    await openConnection(connection);
    good.mockClear();

    connection.frame('bogus', { type: 'bogus' }, 20);
    connection.send('event: tree.changed\ndata: {not json\n\n');
    connection.frame('mcp.changed', { type: 'mcp.changed' }, 21);
    await flush();

    expect(good).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledWith({ type: 'mcp.changed' });
    expect(getServerEventsLastEventId()).toBe(21);
    expect(getServerEventsState()).toBe('connected');
  });

  it('reconnects with exponential backoff capped at 30s and carries Last-Event-ID in header and query', async () => {
    subscribeServerEvents('tree.changed', () => {});
    const first = FakeConnection.last();
    await openConnection(first, 9);

    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    expect(expectedDelays[0]).toBe(SERVER_EVENTS_RECONNECT_MIN_MS);
    expect(expectedDelays[expectedDelays.length - 1]).toBe(SERVER_EVENTS_RECONNECT_MAX_MS);

    for (const [index, delay] of expectedDelays.entries()) {
      const connection = FakeConnection.last();
      // The server accepted the socket but never sent `ready`, so backoff keeps growing.
      if (index > 0) {
        connection.respond();
        await flush();
      }
      connection.close();
      await flush();
      expect(getServerEventsState()).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeConnection.instances).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeConnection.instances).toHaveLength(index + 2);
      const next = FakeConnection.last();
      expect(next.headers['Last-Event-ID']).toBe('9');
      expect(next.url).toBe(`http://127.0.0.1:4567${SERVER_EVENTS_PATH}?lastEventId=9`);
    }
  });

  it('reconnects after a read error and after a rejected fetch', async () => {
    subscribeServerEvents('tree.changed', () => {});
    const first = FakeConnection.last();
    first.reject(new Error('Network request failed'));
    await flush();
    expect(getServerEventsState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeConnection.instances).toHaveLength(2);

    const second = FakeConnection.last();
    second.respond();
    await flush();
    second.fail(new Error('socket reset'));
    await flush();
    expect(getServerEventsState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeConnection.instances).toHaveLength(3);
  });

  it('treats a non-2xx response as a failure and retries', async () => {
    subscribeServerEvents('tree.changed', () => {});
    FakeConnection.last().respond({ status: 401 });
    await flush();
    expect(getServerEventsState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeConnection.instances).toHaveLength(2);
  });

  it('resets the backoff once a ready frame arrives', async () => {
    subscribeServerEvents('tree.changed', () => {});
    FakeConnection.last().reject();
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    FakeConnection.last().reject();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeConnection.instances).toHaveLength(3);

    await openConnection(FakeConnection.last());
    expect(getServerEventsState()).toBe('connected');

    FakeConnection.last().close();
    await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeConnection.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeConnection.instances).toHaveLength(4);
  });

  it('reports unsupported when expo/fetch is missing and never retries', async () => {
    transport.fetch = undefined;
    subscribeServerEvents('tree.changed', () => {});
    expect(getServerEventsState()).toBe('unsupported');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeConnection.instances).toHaveLength(0);
  });

  it('reports unsupported when the response body cannot be streamed', async () => {
    subscribeServerEvents('tree.changed', () => {});
    const connection = FakeConnection.last();
    connection.respond({ body: false });
    await flush();

    expect(getServerEventsState()).toBe('unsupported');
    expect(connection.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeConnection.instances).toHaveLength(1);
  });

  it('pauses in the background and reconnects immediately on foreground', async () => {
    subscribeServerEvents('tree.changed', () => {});
    const first = FakeConnection.last();
    await openConnection(first, 5);

    appState.set('background');
    expect(first.aborted).toBe(true);
    expect(getServerEventsState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeConnection.instances).toHaveLength(1);

    appState.set('active');
    expect(FakeConnection.instances).toHaveLength(2);
    expect(FakeConnection.last().headers['Last-Event-ID']).toBe('5');
    expect(getServerEventsState()).toBe('reconnecting');
    await openConnection(FakeConnection.last(), 5);
    expect(getServerEventsState()).toBe('connected');
  });

  it('does not open a connection while backgrounded and cancels a pending retry on background', async () => {
    appState.currentState = 'background';
    subscribeServerEvents('tree.changed', () => {});
    expect(FakeConnection.instances).toHaveLength(0);
    expect(getServerEventsState()).toBe('reconnecting');

    appState.set('active');
    expect(FakeConnection.instances).toHaveLength(1);
    FakeConnection.last().reject();
    await flush();
    appState.set('background');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeConnection.instances).toHaveLength(1);
  });

  it('keeps the stream open through the inactive state', async () => {
    subscribeServerEvents('tree.changed', () => {});
    const connection = FakeConnection.last();
    await openConnection(connection);

    appState.set('inactive');
    expect(connection.aborted).toBe(false);
    expect(getServerEventsState()).toBe('connected');
  });

  it('drops a stalled stream after 60s without bytes, but heartbeats keep it alive', async () => {
    subscribeServerEvents('tree.changed', () => {});
    const connection = FakeConnection.last();
    await openConnection(connection);

    await vi.advanceTimersByTimeAsync(30_000);
    connection.frame('heartbeat', { type: 'heartbeat' });
    await flush();
    await vi.advanceTimersByTimeAsync(SERVER_EVENTS_STALL_MS - 1);
    expect(connection.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(connection.aborted).toBe(true);
    expect(getServerEventsState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeConnection.instances).toHaveLength(2);
  });

  it('waits with backoff when no server URL is configured yet', async () => {
    client.baseUrl = '';
    subscribeServerEvents('tree.changed', () => {});
    expect(FakeConnection.instances).toHaveLength(0);
    expect(getServerEventsState()).toBe('reconnecting');

    client.baseUrl = 'http://10.0.0.2:4567';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeConnection.instances).toHaveLength(1);
    expect(FakeConnection.last().url).toBe(`http://10.0.0.2:4567${SERVER_EVENTS_PATH}`);
  });

  it('notifies state listeners on every transition and tolerates listener errors', async () => {
    const states: string[] = [];
    subscribeServerEventsState(() => {
      throw new Error('listener bug');
    });
    const unsubscribeState = subscribeServerEventsState((state) => states.push(state));

    const unsubscribe = subscribeServerEvents('tree.changed', () => {});
    await openConnection(FakeConnection.last());
    FakeConnection.last().close();
    await flush();
    unsubscribe();
    unsubscribeState();

    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'idle']);
  });

  it('exposes the typed event map to handlers', async () => {
    const received: ServerEvent[] = [];
    subscribeServerEvents('ready', (event) => {
      received.push(event);
      expect(event.lastEventId).toBe(2);
    });
    await openConnection(FakeConnection.last(), 2);
    expect(received).toHaveLength(1);
  });
});
