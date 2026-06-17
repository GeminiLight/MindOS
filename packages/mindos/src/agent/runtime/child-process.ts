export const CHILD_KILL_GRACE_MS = 5000;
export const CHILD_LOG_BUFFER_MAX_LENGTH = 32 * 1024;

export type KillableChildProcess = {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: () => void): unknown;
};

/**
 * SIGTERM the child, then SIGKILL it if it has not exited within the grace
 * period. A child that traps or ignores SIGTERM would otherwise keep the
 * turn (and its pipes) alive forever.
 */
export function killChildWithEscalation(
  child: KillableChildProcess,
  graceMs: number = CHILD_KILL_GRACE_MS,
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, graceMs);
  (timer as { unref?: () => void }).unref?.();
  child.once('exit', () => clearTimeout(timer));
}

/**
 * Append a chunk to a diagnostic log buffer, keeping only the most recent
 * output. stderr from a crashing child can be arbitrarily large; only the
 * tail is useful in error messages.
 */
export function appendBoundedLog(
  current: string,
  chunk: unknown,
  maxLength: number = CHILD_LOG_BUFFER_MAX_LENGTH,
): string {
  const next = current + String(chunk);
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}
