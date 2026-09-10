/**
 * ACP shutdown hooks — make sure ACP agent processes (and the terminals
 * they spawned) die with the MindOS process instead of being orphaned.
 *
 * Signal handlers can only do synchronous work reliably, so the hook kills
 * the process trees directly (`killAllAgents`); the graceful `session/close`
 * path belongs to `MindosHttpServer.close()`, which awaits `closeAllSessions`.
 */

import { killAllAgents } from './subprocess.js';

type ShutdownTarget = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  listenerCount(event: string): number;
  platform?: NodeJS.Platform;
};

export type AcpShutdownHookOptions = {
  /** Event source; defaults to `process`. Injectable for tests. */
  target?: ShutdownTarget;
  /** Synchronous tree-kill of every tracked agent; defaults to `killAllAgents`. */
  killAll?: () => void;
  /** Re-delivers the signal to ourselves once nobody else handles it. */
  killSelf?: (signal: NodeJS.Signals) => void;
};

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
const registeredTargets = new WeakSet<object>();

/**
 * Register once per process: `exit` always kills the agents; `SIGINT` /
 * `SIGTERM` kill them and then re-raise the signal only when this hook was
 * the sole listener, so hosts with their own graceful shutdown (start.js,
 * the Next dev server) keep owning the exit.
 */
export function registerAcpShutdownHooks(options: AcpShutdownHookOptions = {}): void {
  const target: ShutdownTarget = options.target ?? process;
  if (registeredTargets.has(target)) return;
  registeredTargets.add(target);

  const killAll = options.killAll ?? killAllAgents;
  const killSelf = options.killSelf ?? defaultKillSelf(target);
  const killAllSafely = () => {
    try {
      killAll();
    } catch (error) {
      console.warn('[ACP] shutdown: failed to kill agent processes:', error instanceof Error ? error.message : error);
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
