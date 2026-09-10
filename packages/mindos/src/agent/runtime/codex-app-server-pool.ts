import { createHash } from 'node:crypto';
import { deleteProcessGlobal, getProcessGlobal } from '../global-state.js';
import {
  createCodexAppServerClient,
  createCodexAppServerStdioTransport,
  type CodexAppServerClient,
} from './codex-app-server.js';
import {
  createProcessPool,
  resolveIdleTtlMs,
  type ProcessPool,
  type ProcessPoolLease,
  type ProcessPoolStats,
} from './process-supervisor.js';

/**
 * Codex app-server pools on top of the process supervisor.
 *
 * - `turn` pool: exclusive leases keyed by (command, cwd, env). A turn owns
 *   the whole notification stream of its app-server, so two concurrent turns
 *   on one key get two processes; the process outlives the turn and is closed
 *   after `CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS` of idleness.
 * - `threads` pool: shared leases keyed by (command, env) for the thread /
 *   model HTTP routes, which only issue request/response calls.
 *
 * Both hand out clients that already completed `initialize`; a failed
 * initialize closes the client and rejects the acquire.
 */

export const CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS = 60_000;
export const CODEX_APP_SERVER_IDLE_TTL_ENV = 'MINDOS_CODEX_APP_SERVER_IDLE_TTL_MS';
export const CODEX_TURN_APP_SERVER_MAX_TOTAL = 4;
export const CODEX_THREAD_APP_SERVER_MAX_TOTAL = 2;

export type CodexAppServerClientFactoryInput = {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type CodexAppServerClientFactory = (input: CodexAppServerClientFactoryInput) => CodexAppServerClient;

export type AcquireCodexAppServerInput = CodexAppServerClientFactoryInput & {
  signal?: AbortSignal;
  /** Tests inject a fake; the default spawns `codex app-server` over stdio. */
  createClient?: CodexAppServerClientFactory;
};

export type CodexAppServerLease = ProcessPoolLease<CodexAppServerClient>;

type CodexAppServerPools = {
  turn: ProcessPool<CodexAppServerClient>;
  threads: ProcessPool<CodexAppServerClient>;
};

const CODEX_APP_SERVER_POOLS_KEY = Symbol.for('mindos.codexAppServerPools');

/** Stable key: the env hash hides secret values while still separating distinct environments. */
export function codexAppServerPoolKey(input: CodexAppServerClientFactoryInput): string {
  const digest = createHash('sha256');
  const entries = Object.entries(input.env ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  digest.update(JSON.stringify(entries));
  return `${input.command}|${input.cwd ?? ''}|${digest.digest('hex').slice(0, 16)}`;
}

function createDefaultCodexClient(input: CodexAppServerClientFactoryInput): CodexAppServerClient {
  return createCodexAppServerClient(createCodexAppServerStdioTransport({
    command: input.command,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env ? { env: input.env } : {}),
  }));
}

function idleTtlMs(): number {
  return resolveIdleTtlMs(CODEX_APP_SERVER_IDLE_TTL_ENV, CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS);
}

function createCodexPool(label: string, sharing: 'exclusive' | 'shared', maxTotal: number): ProcessPool<CodexAppServerClient> {
  return createProcessPool<CodexAppServerClient>({
    label,
    sharing,
    maxTotal,
    idleTtlMs: idleTtlMs(),
    destroy: (client) => client.close?.(),
    isAlive: (client) => client.isAlive?.() ?? true,
  });
}

function pools(): CodexAppServerPools {
  return getProcessGlobal<CodexAppServerPools>(CODEX_APP_SERVER_POOLS_KEY, () => ({
    turn: createCodexPool('codex-app-server:turn', 'exclusive', CODEX_TURN_APP_SERVER_MAX_TOTAL),
    threads: createCodexPool('codex-app-server:threads', 'shared', CODEX_THREAD_APP_SERVER_MAX_TOTAL),
  }));
}

function acquireFrom(pool: ProcessPool<CodexAppServerClient>, key: string, input: AcquireCodexAppServerInput): Promise<CodexAppServerLease> {
  const factory = input.createClient ?? createDefaultCodexClient;
  return pool.acquire(key, {
    signal: input.signal,
    create: async (_key, { signal }) => {
      const client = factory({
        command: input.command,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.env ? { env: input.env } : {}),
      });
      try {
        await client.initialize({ signal });
      } catch (error) {
        // The pool never saw this client, so it cannot close it for us.
        try {
          await client.close?.();
        } catch {
          // Best effort: the initialize failure is the error worth reporting.
        }
        throw error;
      }
      return client;
    },
  });
}

/** One initialized app-server for a turn; released back to the pool when the turn ends. */
export function acquireCodexAppServerForTurn(input: AcquireCodexAppServerInput): Promise<CodexAppServerLease> {
  return acquireFrom(pools().turn, codexAppServerPoolKey(input), input);
}

/** Shared initialized app-server for thread / model request-response routes. */
export function acquireCodexAppServerForThreads(input: Omit<AcquireCodexAppServerInput, 'cwd'>): Promise<CodexAppServerLease> {
  return acquireFrom(pools().threads, codexAppServerPoolKey({ command: input.command, env: input.env }), input);
}

/** Closes every pooled app-server (server shutdown, tests). */
export function closePooledCodexAppServerClients(): void {
  const current = pools();
  current.turn.closeAll();
  current.threads.closeAll();
}

export function codexAppServerPoolStatsForTest(): { turn: ProcessPoolStats; threads: ProcessPoolStats } {
  const current = pools();
  return { turn: current.turn.stats(), threads: current.threads.stats() };
}

export function resetCodexAppServerClientPoolForTest(): void {
  const current = pools();
  current.turn.dispose();
  current.threads.dispose();
  deleteProcessGlobal(CODEX_APP_SERVER_POOLS_KEY);
}
