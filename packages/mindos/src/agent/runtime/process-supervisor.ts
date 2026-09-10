import { execFileSync, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { deleteProcessGlobal, getProcessGlobal } from '../global-state.js';
import { CHILD_KILL_GRACE_MS } from './child-process.js';

/**
 * Child-process supervisor shared by every runtime bridge that spawns a local
 * agent (Codex app-server, ACP agents and their terminals).
 *
 * One place owns: detached process groups so a whole tree can be signalled,
 * SIGTERM → SIGKILL escalation, per-key pooling with an idle TTL and a
 * concurrency cap, and a single shutdown hook that kills everything the host
 * spawned. State lives behind `Symbol.for` so the Next route bundles and the
 * Product Server share one registry (same reasoning as `agent/global-state.ts`).
 */

export type SupervisedProcessExit = { code: number | null; signal: NodeJS.Signals | null };

export type SupervisedProcessSpec = {
  /** Human-readable owner, e.g. `codex-app-server` or `acp:gemini`; surfaces in diagnostics. */
  label: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Windows needs a shell to put a detached child in its own process group;
   * on Unix `detached` alone creates the group. Defaults to `process.platform === 'win32'`.
   */
  shell?: boolean;
  /** Injectable for unit tests that must not fork. */
  spawn?: typeof nodeSpawn;
};

export type SupervisedProcess = {
  id: string;
  label: string;
  child: ChildProcess;
  pid: number | undefined;
  readonly alive: boolean;
  /** Settles on `exit` (or on a spawn `error`, with `code: null`). */
  exited: Promise<SupervisedProcessExit>;
  /** SIGTERM the process group, SIGKILL it after `graceMs` (default 5 s) if it is still alive. */
  kill(options?: { graceMs?: number }): void;
};

export type ProcessPoolSharing = 'exclusive' | 'shared';

export type ProcessPoolOptions<T> = {
  label: string;
  /** `exclusive`: one lease per resource at a time (default). `shared`: leases stack on one resource. */
  sharing?: ProcessPoolSharing;
  /** How long an unleased resource stays alive before `destroy`. */
  idleTtlMs: number;
  /** Upper bound on live resources across all keys (default 4). */
  maxTotal?: number;
  /** Pooling switch; when it yields false every release destroys the resource. Defaults to the env switch. */
  enabled?: boolean | (() => boolean);
  /** Default factory; `acquire` may pass its own (the caller usually knows command / env for the key). */
  create?: ProcessPoolFactory<T>;
  destroy(resource: T): void | Promise<void>;
  /** A resource that reports dead is dropped instead of being handed out again. */
  isAlive?(resource: T): boolean;
};

export type ProcessPoolFactory<T> = (key: string, context: { signal?: AbortSignal }) => Promise<T> | T;

export type ProcessPoolAcquireOptions<T> = {
  signal?: AbortSignal;
  /** Overrides the pool's default factory for this acquire. */
  create?: ProcessPoolFactory<T>;
};

export type ProcessPoolLease<T> = {
  key: string;
  resource: T;
  /** Return the resource. `failed` destroys it immediately (crashed process, broken transport). */
  release(options?: { failed?: boolean }): void;
};

export type ProcessPoolStats = { created: number; entries: number; busy: number; idle: number };

export type ProcessPool<T> = {
  acquire(key: string, options?: ProcessPoolAcquireOptions<T>): Promise<ProcessPoolLease<T>>;
  /** Destroy every resource under `key`, leased or not. */
  evict(key: string): void;
  closeAll(): void;
  stats(): ProcessPoolStats;
  /** `closeAll` and detach from the supervisor (tests, hot reload). */
  dispose(): void;
};

export const PROCESS_POOL_DEFAULT_MAX_TOTAL = 4;
export const PROCESS_POOL_ENV_SWITCH = 'MINDOS_RUNTIME_PROCESS_POOL';

/** `MINDOS_RUNTIME_PROCESS_POOL=0` turns every pool into "destroy on release" (the pre-supervisor behaviour). */
export function isProcessPoolingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[PROCESS_POOL_ENV_SWITCH]?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** Positive finite override from the environment, otherwise the default. */
export function resolveIdleTtlMs(envKey: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[envKey];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type SupervisorState = {
  processes: Map<string, SupervisedProcess>;
  pools: Set<ProcessPool<unknown>>;
};

const PROCESS_SUPERVISOR_KEY = Symbol.for('mindos.processSupervisor');

/**
 * Targets that already carry the shutdown hook. Kept outside the resettable
 * registry so test resets never stack a second `exit` listener on `process`.
 */
const registeredShutdownTargets = new WeakSet<object>();

function state(): SupervisorState {
  return getProcessGlobal<SupervisorState>(PROCESS_SUPERVISOR_KEY, () => ({
    processes: new Map(),
    pools: new Set(),
  }));
}

/**
 * Every host that spawns through the supervisor gets the shutdown hook, so
 * children of the Next.js dev server or a Desktop shell die with it even
 * though only the Product Server registers the hook explicitly.
 */
function ensureHostShutdownHooks(): void {
  registerProcessSupervisorShutdownHooks();
}

/* ── Processes ─────────────────────────────────────────────────────────── */

type KillableChild = Pick<ChildProcess, 'pid' | 'kill'>;

/**
 * Signal the whole tree rooted at `child`: the negative pid reaches the
 * detached process group on Unix, `taskkill /T` walks the tree on Windows.
 * Falls back to the direct child when the group is already gone.
 */
export function killSupervisedProcessTree(child: KillableChild, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (!pid) {
    try { child.kill(signal); } catch { /* already dead */ }
    return;
  }
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      try { child.kill(signal); } catch { /* already dead */ }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already dead */ }
  }
}

export function spawnSupervisedProcess(spec: SupervisedProcessSpec): SupervisedProcess {
  ensureHostShutdownHooks();
  const isWin = process.platform === 'win32';
  const spawn = spec.spawn ?? nodeSpawn;
  const child = spawn(spec.command, spec.args ?? [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    shell: spec.shell ?? isWin,
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    ...(spec.env ? { env: spec.env } : {}),
  });

  const id = `${spec.label}:${randomUUID()}`;
  let alive = true;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const registry = state();

  const settle = (): void => {
    alive = false;
    if (escalation) clearTimeout(escalation);
    escalation = undefined;
    registry.processes.delete(id);
  };
  const exited = new Promise<SupervisedProcessExit>((resolve) => {
    child.once('exit', (code, signal) => {
      settle();
      resolve({ code, signal });
    });
    child.once('error', () => {
      // ENOENT and friends never produce `exit`; treat the spawn failure as a dead process.
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
        settle();
        resolve({ code: child.exitCode, signal: child.signalCode });
      }
    });
  });

  const supervised: SupervisedProcess = {
    id,
    label: spec.label,
    child,
    pid: child.pid,
    get alive() {
      return alive;
    },
    exited,
    kill(options = {}) {
      if (!alive) return;
      killSupervisedProcessTree(child, 'SIGTERM');
      const graceMs = options.graceMs ?? CHILD_KILL_GRACE_MS;
      if (escalation) clearTimeout(escalation);
      escalation = setTimeout(() => {
        escalation = undefined;
        if (alive) killSupervisedProcessTree(child, 'SIGKILL');
      }, graceMs);
      escalation.unref?.();
    },
  };
  registry.processes.set(id, supervised);
  return supervised;
}

export function listSupervisedProcesses(): SupervisedProcess[] {
  return [...state().processes.values()];
}

/** Synchronous tree-kill of every tracked process; safe to call from a signal handler. */
export function killAllSupervisedProcesses(): void {
  for (const supervised of [...state().processes.values()]) {
    supervised.kill();
  }
}

/* ── Pools ─────────────────────────────────────────────────────────────── */

type PoolEntry<T> = {
  key: string;
  ready: Promise<T>;
  resource: T | undefined;
  leases: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  lastReleasedAt: number;
};

export function createProcessPool<T>(options: ProcessPoolOptions<T>): ProcessPool<T> {
  ensureHostShutdownHooks();
  const sharing = options.sharing ?? 'exclusive';
  const maxTotal = Math.max(1, options.maxTotal ?? PROCESS_POOL_DEFAULT_MAX_TOTAL);
  const isAlive = options.isAlive ?? (() => true);
  const enabled = (): boolean => {
    if (typeof options.enabled === 'function') return options.enabled();
    if (typeof options.enabled === 'boolean') return options.enabled;
    return isProcessPoolingEnabled();
  };
  const entries: PoolEntry<T>[] = [];
  const waiters = new Set<() => void>();
  let created = 0;

  const notifyWaiters = (): void => {
    for (const wake of [...waiters]) {
      waiters.delete(wake);
      wake();
    }
  };

  const drop = (entry: PoolEntry<T>): void => {
    if (entry.closed) return;
    entry.closed = true;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    const resource = entry.resource;
    if (resource !== undefined) {
      try {
        void Promise.resolve(options.destroy(resource)).catch(() => {});
      } catch {
        // Destroy is best-effort; the entry is already out of the pool.
      }
    }
    notifyWaiters();
  };

  const reusable = (entry: PoolEntry<T>): boolean => {
    if (entry.closed) return false;
    if (sharing === 'exclusive' && entry.leases > 0) return false;
    if (entry.resource !== undefined && !isAlive(entry.resource)) {
      drop(entry);
      return false;
    }
    return true;
  };

  const lease = (entry: PoolEntry<T>): void => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    entry.leases += 1;
  };

  const release = (entry: PoolEntry<T>, failed: boolean): void => {
    if (entry.closed) return;
    entry.leases = Math.max(0, entry.leases - 1);
    if (failed) {
      drop(entry);
      return;
    }
    if (entry.leases > 0) return;
    entry.lastReleasedAt = Date.now();
    if (!enabled()) {
      drop(entry);
      return;
    }
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.leases === 0) drop(entry);
    }, options.idleTtlMs);
    entry.idleTimer.unref?.();
    notifyWaiters();
  };

  const waitForRelease = (signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const wake = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      waiters.delete(wake);
      reject(abortReason(signal));
    };
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    waiters.add(wake);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  const toLease = async (entry: PoolEntry<T>): Promise<ProcessPoolLease<T>> => {
    lease(entry);
    let resource: T;
    try {
      resource = await entry.ready;
    } catch (error) {
      entry.leases = Math.max(0, entry.leases - 1);
      throw error;
    }
    let released = false;
    return {
      key: entry.key,
      resource,
      release(releaseOptions = {}) {
        if (released) return;
        released = true;
        release(entry, releaseOptions.failed === true);
      },
    };
  };

  const pool: ProcessPool<T> = {
    async acquire(key, acquireOptions = {}) {
      const signal = acquireOptions.signal;
      const create = acquireOptions.create ?? options.create;
      if (!create) throw new Error(`Process pool ${options.label} has no factory for key ${key}.`);
      // Bounded: each iteration either returns, creates, evicts, or awaits a release.
      while (true) {
        if (signal?.aborted) throw abortReason(signal);
        const existing = entries.find((entry) => entry.key === key && reusable(entry));
        if (existing) return toLease(existing);
        if (entries.length >= maxTotal) {
          const idle = entries
            .filter((entry) => entry.leases === 0 && entry.resource !== undefined)
            .sort((a, b) => a.lastReleasedAt - b.lastReleasedAt)[0];
          if (idle) {
            drop(idle);
            continue;
          }
          await waitForRelease(signal);
          continue;
        }
        created += 1;
        const entry: PoolEntry<T> = {
          key,
          ready: Promise.resolve(),
          resource: undefined,
          leases: 0,
          idleTimer: null,
          closed: false,
          lastReleasedAt: Date.now(),
        } as PoolEntry<T>;
        entry.ready = Promise.resolve()
          .then(() => create(key, { signal }))
          .then((resource) => {
            entry.resource = resource;
            return resource;
          })
          .catch((error) => {
            drop(entry);
            throw error;
          });
        // Keep the rejection observed even when nobody is awaiting `ready` yet.
        entry.ready.catch(() => {});
        entries.push(entry);
        return toLease(entry);
      }
    },
    evict(key) {
      for (const entry of entries.filter((candidate) => candidate.key === key)) drop(entry);
    },
    closeAll() {
      for (const entry of [...entries]) drop(entry);
    },
    stats() {
      const busy = entries.filter((entry) => entry.leases > 0).length;
      return { created, entries: entries.length, busy, idle: entries.length - busy };
    },
    dispose() {
      pool.closeAll();
      state().pools.delete(pool as ProcessPool<unknown>);
    },
  };
  state().pools.add(pool as ProcessPool<unknown>);
  return pool;
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Destroy every pooled resource of every live pool (server shutdown, tests). */
export function closeAllProcessPools(): void {
  for (const pool of [...state().pools]) pool.closeAll();
}

/* ── Shutdown hooks ────────────────────────────────────────────────────── */

type ShutdownTarget = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  listenerCount(event: string): number;
  platform?: NodeJS.Platform;
};

export type ProcessSupervisorShutdownHookOptions = {
  /** Event source; defaults to `process`. Injectable for tests. */
  target?: ShutdownTarget;
  /** Synchronous teardown; defaults to closing every pool and tree-killing every tracked process. */
  killAll?: () => void;
  /** Re-delivers the signal to ourselves once nobody else handles it. */
  killSelf?: (signal: NodeJS.Signals) => void;
};

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/**
 * Extra synchronous teardowns run by the default killAll before the sweep of
 * supervised processes. A host that spawns processes the supervisor does not
 * itself pool but must still reap in the single shutdown (ACP terminals, which
 * are detached into their own process group) registers one here, so the hook
 * covers them even when the hook was already registered by an earlier spawn.
 */
const additionalShutdownTeardowns = new Set<() => void>();

export function addProcessSupervisorShutdownTeardown(teardown: () => void): () => void {
  additionalShutdownTeardowns.add(teardown);
  return () => {
    additionalShutdownTeardowns.delete(teardown);
  };
}

export function defaultSupervisorKillAll(): void {
  closeAllProcessPools();
  for (const teardown of [...additionalShutdownTeardowns]) {
    try {
      teardown();
    } catch {
      // Best-effort: one failing teardown must not block the others.
    }
  }
  killAllSupervisedProcesses();
}

/**
 * Register once per process: `exit` always kills the children; `SIGINT` /
 * `SIGTERM` kill them and then re-raise the signal only when this hook was
 * the sole listener, so hosts with their own graceful shutdown (start.js,
 * the Next dev server) keep owning the exit. Signal handlers can only do
 * synchronous work reliably, hence tree-kills rather than graceful closes.
 */
export function registerProcessSupervisorShutdownHooks(options: ProcessSupervisorShutdownHookOptions = {}): void {
  const target: ShutdownTarget = options.target ?? process;
  if (registeredShutdownTargets.has(target)) return;
  registeredShutdownTargets.add(target);

  const killAll = options.killAll ?? defaultSupervisorKillAll;
  const killSelf = options.killSelf ?? defaultKillSelf(target);
  const killAllSafely = () => {
    try {
      killAll();
    } catch (error) {
      console.warn('[process-supervisor] shutdown: failed to kill child processes:', error instanceof Error ? error.message : error);
    }
  };

  target.on('exit', killAllSafely);
  for (const signal of SHUTDOWN_SIGNALS) {
    target.once(signal, () => {
      killAllSafely();
      // Node removes a once-listener before invoking it, so a non-zero count
      // here means another handler owns the exit.
      if (target.listenerCount(signal) === 0) killSelf(signal);
    });
  }
}

function defaultKillSelf(target: ShutdownTarget): (signal: NodeJS.Signals) => void {
  return (signal) => {
    const platform = target.platform ?? process.platform;
    const exitCode = signal === 'SIGINT' ? 130 : 143;
    if (platform === 'win32') {
      process.exit(exitCode);
      return;
    }
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(exitCode);
    }
  };
}

/** Kill everything and forget the registry so the next access starts clean (tests only). */
export function resetProcessSupervisorForTest(): void {
  defaultSupervisorKillAll();
  deleteProcessGlobal(PROCESS_SUPERVISOR_KEY);
}
