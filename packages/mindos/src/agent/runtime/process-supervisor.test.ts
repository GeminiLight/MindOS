import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProcessPool,
  killAllSupervisedProcesses,
  listSupervisedProcesses,
  registerProcessSupervisorShutdownHooks,
  resetProcessSupervisorForTest,
  spawnSupervisedProcess,
} from './process-supervisor.js';

type FakeProcess = EventEmitter & { platform: NodeJS.Platform };

function fakeProcess(platform: NodeJS.Platform = 'darwin'): FakeProcess {
  return Object.assign(new EventEmitter(), { platform });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met in time');
}

/** A pool over plain objects so the lifecycle can be observed without real processes. */
function createFakeResourcePool(options: {
  sharing?: 'exclusive' | 'shared';
  idleTtlMs?: number;
  maxTotal?: number;
  enabled?: boolean;
  createDelayMs?: number;
} = {}) {
  const events: string[] = [];
  let created = 0;
  const alive = new Set<number>();
  const pool = createProcessPool<{ id: number }>({
    label: 'fake',
    sharing: options.sharing ?? 'exclusive',
    idleTtlMs: options.idleTtlMs ?? 1_000,
    maxTotal: options.maxTotal ?? 4,
    enabled: options.enabled,
    create: async (key) => {
      created += 1;
      const id = created;
      if (options.createDelayMs) await new Promise((resolve) => setTimeout(resolve, options.createDelayMs));
      events.push(`create#${id} ${key}`);
      alive.add(id);
      return { id };
    },
    destroy: (resource) => {
      alive.delete(resource.id);
      events.push(`destroy#${resource.id}`);
    },
    isAlive: (resource) => alive.has(resource.id),
  });
  return { pool, events, alive, createdCount: () => created };
}

afterEach(() => {
  vi.useRealTimers();
  resetProcessSupervisorForTest();
});

describe('createProcessPool', () => {
  it('reuses one resource for consecutive acquires of the same key', async () => {
    const fixture = createFakeResourcePool();

    const first = await fixture.pool.acquire('k');
    first.release();
    const second = await fixture.pool.acquire('k');
    second.release();

    expect(fixture.createdCount()).toBe(1);
    expect(first.resource).toBe(second.resource);
    expect(fixture.events).toEqual(['create#1 k']);
  });

  it('keeps separate resources per key', async () => {
    const fixture = createFakeResourcePool();

    const a = await fixture.pool.acquire('a');
    const b = await fixture.pool.acquire('b');
    a.release();
    b.release();

    expect(fixture.createdCount()).toBe(2);
    expect(fixture.pool.stats()).toMatchObject({ entries: 2, idle: 2, busy: 0 });
  });

  it('destroys an idle resource once the idle TTL elapses and not before', async () => {
    vi.useFakeTimers();
    const fixture = createFakeResourcePool({ idleTtlMs: 1_000 });

    const lease = await fixture.pool.acquire('k');
    lease.release();
    await vi.advanceTimersByTimeAsync(999);
    expect(fixture.events).not.toContain('destroy#1');
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.events).toContain('destroy#1');

    const fresh = await fixture.pool.acquire('k');
    expect(fresh.resource.id).toBe(2);
    fresh.release();
  });

  it('cancels the idle timer when the resource is acquired again before the TTL', async () => {
    vi.useFakeTimers();
    const fixture = createFakeResourcePool({ idleTtlMs: 1_000 });

    (await fixture.pool.acquire('k')).release();
    await vi.advanceTimersByTimeAsync(900);
    const again = await fixture.pool.acquire('k');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fixture.events).not.toContain('destroy#1');
    again.release();
  });

  it('gives concurrent exclusive acquires distinct resources but shares one in shared mode', async () => {
    const exclusive = createFakeResourcePool({ sharing: 'exclusive' });
    const [a, b] = await Promise.all([exclusive.pool.acquire('k'), exclusive.pool.acquire('k')]);
    expect(a.resource).not.toBe(b.resource);
    a.release();
    b.release();

    const shared = createFakeResourcePool({ sharing: 'shared', createDelayMs: 5 });
    const leases = await Promise.all([shared.pool.acquire('k'), shared.pool.acquire('k'), shared.pool.acquire('k')]);
    expect(new Set(leases.map((lease) => lease.resource)).size).toBe(1);
    expect(shared.createdCount()).toBe(1);
    for (const lease of leases) lease.release();
  });

  it('destroys the resource when a lease is released as failed and rebuilds on the next acquire', async () => {
    const fixture = createFakeResourcePool();

    const lease = await fixture.pool.acquire('k');
    lease.release({ failed: true });
    expect(fixture.events).toContain('destroy#1');

    const next = await fixture.pool.acquire('k');
    expect(next.resource.id).toBe(2);
    next.release();
  });

  it('skips a pooled resource that died while idle and spawns a fresh one', async () => {
    const fixture = createFakeResourcePool();

    const lease = await fixture.pool.acquire('k');
    lease.release();
    fixture.alive.delete(1);

    const next = await fixture.pool.acquire('k');
    expect(next.resource.id).toBe(2);
    expect(fixture.events).toContain('destroy#1');
    next.release();
  });

  it('evicts the least recently used idle resource when the total cap is reached', async () => {
    const fixture = createFakeResourcePool({ maxTotal: 2 });

    const a = await fixture.pool.acquire('a');
    a.release();
    const b = await fixture.pool.acquire('b');
    b.release();
    const c = await fixture.pool.acquire('c');

    expect(fixture.events).toContain('destroy#1');
    expect(fixture.events).not.toContain('destroy#2');
    expect(fixture.pool.stats().entries).toBe(2);
    c.release();
  });

  it('waits for a release when every resource is busy and honours the abort signal', async () => {
    const fixture = createFakeResourcePool({ maxTotal: 1 });

    const busy = await fixture.pool.acquire('a');
    let acquired = false;
    const waiting = fixture.pool.acquire('a').then((lease) => {
      acquired = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acquired).toBe(false);

    busy.release();
    const lease = await waiting;
    expect(acquired).toBe(true);
    expect(lease.resource.id).toBe(1);

    const controller = new AbortController();
    const aborted = fixture.pool.acquire('a', { signal: controller.signal });
    controller.abort(new Error('turn canceled'));
    await expect(aborted).rejects.toThrow('turn canceled');
    lease.release();
  });

  it('destroys on release when pooling is disabled', async () => {
    const fixture = createFakeResourcePool({ enabled: false });

    (await fixture.pool.acquire('k')).release();
    (await fixture.pool.acquire('k')).release();

    expect(fixture.createdCount()).toBe(2);
    expect(fixture.events.filter((event) => event.startsWith('destroy'))).toHaveLength(2);
  });

  it('propagates a create failure to every waiter and leaves no entry behind', async () => {
    let attempts = 0;
    const pool = createProcessPool<{ id: number }>({
      label: 'failing',
      sharing: 'shared',
      idleTtlMs: 1_000,
      create: async () => {
        attempts += 1;
        throw new Error('spawn failed');
      },
      destroy: () => {},
    });

    await expect(Promise.all([pool.acquire('k'), pool.acquire('k')])).rejects.toThrow('spawn failed');
    expect(attempts).toBe(1);
    expect(pool.stats().entries).toBe(0);
  });

  it('closeAll destroys busy and idle resources alike', async () => {
    const fixture = createFakeResourcePool();

    const busy = await fixture.pool.acquire('a');
    (await fixture.pool.acquire('b')).release();
    fixture.pool.closeAll();

    expect(fixture.events.filter((event) => event.startsWith('destroy'))).toHaveLength(2);
    expect(fixture.pool.stats().entries).toBe(0);
    // Releasing a lease whose resource is already gone is a no-op.
    expect(() => busy.release()).not.toThrow();
  });
});

describe('spawnSupervisedProcess', () => {
  it('kills the whole process tree, including a grandchild the child forked', async () => {
    const supervised = spawnSupervisedProcess({
      label: 'tree-kill-test',
      command: process.execPath,
      args: ['-e', [
        "const { spawn } = require('node:child_process');",
        "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        'process.stdout.write(String(grandchild.pid) + "\\n");',
        'setInterval(() => {}, 1000);',
      ].join(' ')],
    });
    expect(listSupervisedProcesses().map((entry) => entry.id)).toContain(supervised.id);

    const grandchildPid = await new Promise<number>((resolve) => {
      supervised.child.stdout?.once('data', (chunk) => resolve(Number(String(chunk).trim())));
    });
    expect(isProcessAlive(grandchildPid)).toBe(true);

    supervised.kill({ graceMs: 500 });
    await supervised.exited;
    await waitFor(() => !isProcessAlive(grandchildPid));
    expect(supervised.alive).toBe(false);
    expect(listSupervisedProcesses().map((entry) => entry.id)).not.toContain(supervised.id);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const supervised = spawnSupervisedProcess({
      label: 'sigterm-ignoring',
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);"],
    });
    await new Promise<void>((resolve) => supervised.child.stdout?.once('data', () => resolve()));

    const startedAt = Date.now();
    supervised.kill({ graceMs: 200 });
    const exit = await supervised.exited;

    expect(exit.signal).toBe('SIGKILL');
    expect(Date.now() - startedAt).toBeLessThan(4_000);
  });

  it('forgets a process that exits on its own', async () => {
    const supervised = spawnSupervisedProcess({
      label: 'exits-alone',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
    });
    const exit = await supervised.exited;
    expect(exit.code).toBe(0);
    expect(supervised.alive).toBe(false);
    expect(listSupervisedProcesses().map((entry) => entry.id)).not.toContain(supervised.id);
  });

  it('killAllSupervisedProcesses tears down every tracked process synchronously', async () => {
    const first = spawnSupervisedProcess({ label: 'a', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] });
    const second = spawnSupervisedProcess({ label: 'b', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] });

    killAllSupervisedProcesses();

    await Promise.all([first.exited, second.exited]);
    expect(listSupervisedProcesses()).toHaveLength(0);
  });
});

describe('registerProcessSupervisorShutdownHooks', () => {
  it('registers once per target and closes pools plus processes on exit', async () => {
    const target = fakeProcess();
    const killSelf = vi.fn();
    const fixture = createFakeResourcePool();
    const lease = await fixture.pool.acquire('k');
    lease.release();
    const child = spawnSupervisedProcess({ label: 'hook', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] });

    registerProcessSupervisorShutdownHooks({ target, killSelf });
    registerProcessSupervisorShutdownHooks({ target, killSelf });
    expect(target.listenerCount('exit')).toBe(1);

    target.emit('exit', 0);

    expect(fixture.events).toContain('destroy#1');
    expect(fixture.pool.stats().entries).toBe(0);
    await child.exited;
    expect(listSupervisedProcesses()).toHaveLength(0);
  });

  it('re-raises SIGTERM only when it is the sole listener and never throws out of the hook', () => {
    const target = fakeProcess();
    const killAll = vi.fn(() => { throw new Error('boom'); });
    const killSelf = vi.fn();
    registerProcessSupervisorShutdownHooks({ target, killAll, killSelf });

    expect(() => target.emit('SIGTERM', 'SIGTERM')).not.toThrow();
    expect(killAll).toHaveBeenCalledTimes(1);
    expect(killSelf).toHaveBeenCalledWith('SIGTERM');

    const shared = fakeProcess();
    const sharedKillSelf = vi.fn();
    shared.on('SIGINT', () => {});
    registerProcessSupervisorShutdownHooks({ target: shared, killAll: vi.fn(), killSelf: sharedKillSelf });
    shared.emit('SIGINT', 'SIGINT');
    expect(sharedKillSelf).not.toHaveBeenCalled();
  });
});

describe('process group semantics', () => {
  it('spawns detached so the child has its own process group on Unix', async () => {
    if (process.platform === 'win32') return;
    const supervised = spawnSupervisedProcess({
      label: 'pgid',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok\\n"); setInterval(() => {}, 1000);'],
    });
    await new Promise<void>((resolve) => supervised.child.stdout?.once('data', () => resolve()));
    const pid = supervised.pid!;
    // A detached child leads its own group, so signalling -pid reaches it.
    expect(() => process.kill(-pid, 0)).not.toThrow();
    supervised.kill({ graceMs: 200 });
    await supervised.exited;
  });

  it('uses the standard spawn when a custom spawn function is injected', () => {
    const fakeChild = Object.assign(new EventEmitter(), { pid: 4321, stdout: null, stderr: null, stdin: null, kill: vi.fn(), exitCode: null, signalCode: null });
    const spawnMock = vi.fn(() => fakeChild as never) as unknown as typeof spawn;

    const supervised = spawnSupervisedProcess({ label: 'injected', command: 'agent', args: ['--acp'], spawn: spawnMock });

    expect(spawnMock).toHaveBeenCalledWith('agent', ['--acp'], expect.objectContaining({ detached: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    expect(supervised.pid).toBe(4321);
    fakeChild.emit('exit', 0, null);
    expect(supervised.alive).toBe(false);
  });
});
