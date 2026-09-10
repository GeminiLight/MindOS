import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexAppServerClient } from './codex-app-server.js';
import {
  CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS,
  acquireCodexAppServerForThreads,
  acquireCodexAppServerForTurn,
  closePooledCodexAppServerClients,
  codexAppServerPoolKey,
  codexAppServerPoolStatsForTest,
  resetCodexAppServerClientPoolForTest,
} from './codex-app-server-pool.js';
import { resetProcessSupervisorForTest } from './process-supervisor.js';

function fakeClientFactory() {
  const events: string[] = [];
  let constructed = 0;
  const alive = new Set<number>();
  const createClient = (input: { command: string; cwd?: string; env?: NodeJS.ProcessEnv }): CodexAppServerClient => {
    constructed += 1;
    const id = constructed;
    alive.add(id);
    events.push(`construct#${id} ${input.command} ${input.cwd ?? '-'} ${input.env?.CODEX_HOME ?? '-'}`);
    return {
      initialize: async () => { events.push(`initialize#${id}`); },
      startThread: vi.fn(),
      resumeThread: vi.fn(),
      listModels: vi.fn(),
      listThreads: vi.fn(),
      readThread: vi.fn(),
      forkThread: vi.fn(),
      archiveThread: vi.fn(),
      unarchiveThread: vi.fn(),
      startTurn: vi.fn(),
      isAlive: () => alive.has(id),
      close: async () => {
        alive.delete(id);
        events.push(`close#${id}`);
      },
    } as unknown as CodexAppServerClient;
  };
  return { events, createClient, alive, constructed: () => constructed };
}

afterEach(() => {
  vi.useRealTimers();
  resetCodexAppServerClientPoolForTest();
  resetProcessSupervisorForTest();
});

describe('codexAppServerPoolKey', () => {
  it('hashes the environment so equal env maps share a key regardless of insertion order', () => {
    const a = codexAppServerPoolKey({ command: '/bin/codex', cwd: '/mind', env: { A: '1', B: '2' } });
    const b = codexAppServerPoolKey({ command: '/bin/codex', cwd: '/mind', env: { B: '2', A: '1' } });
    const c = codexAppServerPoolKey({ command: '/bin/codex', cwd: '/mind', env: { A: '1', B: '3' } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(codexAppServerPoolKey({ command: '/bin/codex', cwd: '/other', env: { A: '1', B: '2' } }));
    expect(a).not.toContain('1');
  });

  it('ignores undefined env values and treats a missing env like an empty one', () => {
    expect(codexAppServerPoolKey({ command: 'codex', env: { A: undefined } }))
      .toBe(codexAppServerPoolKey({ command: 'codex' }));
  });
});

describe('Codex app-server pools', () => {
  it('turn pool initializes a fresh client once and hands the same client to the next turn', async () => {
    const fixture = fakeClientFactory();
    const input = { command: '/bin/codex', cwd: '/mind', env: { CODEX_HOME: '/home' }, createClient: fixture.createClient };

    const first = await acquireCodexAppServerForTurn(input);
    first.release();
    const second = await acquireCodexAppServerForTurn(input);
    second.release();

    expect(first.resource).toBe(second.resource);
    expect(fixture.events).toEqual(['construct#1 /bin/codex /mind /home', 'initialize#1']);
    expect(codexAppServerPoolStatsForTest().turn).toMatchObject({ created: 1, entries: 1, busy: 0, idle: 1 });
  });

  it('turn pool is exclusive: two concurrent turns on one key get two app-servers', async () => {
    const fixture = fakeClientFactory();
    const input = { command: '/bin/codex', cwd: '/mind', createClient: fixture.createClient };

    const [a, b] = await Promise.all([acquireCodexAppServerForTurn(input), acquireCodexAppServerForTurn(input)]);
    expect(a.resource).not.toBe(b.resource);
    expect(fixture.constructed()).toBe(2);
    a.release();
    b.release();
  });

  it('thread pool is shared: concurrent requests reuse one initializing client', async () => {
    const fixture = fakeClientFactory();
    const input = { command: '/bin/codex', env: { CODEX_HOME: '/home' }, createClient: fixture.createClient };

    const leases = await Promise.all([1, 2, 3].map(() => acquireCodexAppServerForThreads(input)));
    expect(new Set(leases.map((lease) => lease.resource)).size).toBe(1);
    expect(fixture.events.filter((event) => event.startsWith('initialize'))).toHaveLength(1);
    for (const lease of leases) lease.release();
  });

  it('closes an idle app-server after the TTL and drops one whose turn failed immediately', async () => {
    vi.useFakeTimers();
    const fixture = fakeClientFactory();
    const input = { command: '/bin/codex', cwd: '/mind', createClient: fixture.createClient };

    (await acquireCodexAppServerForTurn(input)).release();
    await vi.advanceTimersByTimeAsync(CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS - 1);
    expect(fixture.events).not.toContain('close#1');
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.events).toContain('close#1');

    (await acquireCodexAppServerForTurn(input)).release({ failed: true });
    expect(fixture.events).toContain('close#2');
    expect(codexAppServerPoolStatsForTest().turn.entries).toBe(0);
  });

  it('skips a pooled app-server that died while idle', async () => {
    const fixture = fakeClientFactory();
    const input = { command: '/bin/codex', cwd: '/mind', createClient: fixture.createClient };

    (await acquireCodexAppServerForTurn(input)).release();
    fixture.alive.delete(1);
    const next = await acquireCodexAppServerForTurn(input);
    expect(fixture.constructed()).toBe(2);
    next.release();
  });

  it('closePooledCodexAppServerClients closes both pools', async () => {
    const fixture = fakeClientFactory();
    (await acquireCodexAppServerForTurn({ command: '/bin/codex', cwd: '/mind', createClient: fixture.createClient })).release();
    (await acquireCodexAppServerForThreads({ command: '/bin/codex', createClient: fixture.createClient })).release();

    closePooledCodexAppServerClients();

    expect(fixture.events.filter((event) => event.startsWith('close'))).toHaveLength(2);
    expect(codexAppServerPoolStatsForTest()).toMatchObject({ turn: { entries: 0 }, threads: { entries: 0 } });
  });

  it('rejects the acquire and leaves no entry when initialize fails', async () => {
    const createClient = (): CodexAppServerClient => ({
      initialize: async () => { throw new Error('codex signed out'); },
      close: async () => {},
    } as unknown as CodexAppServerClient);

    await expect(acquireCodexAppServerForTurn({ command: '/bin/codex', cwd: '/mind', createClient })).rejects.toThrow('codex signed out');
    expect(codexAppServerPoolStatsForTest().turn.entries).toBe(0);
  });
});
