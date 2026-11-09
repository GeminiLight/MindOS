/**
 * Process termination primitives for the Desktop's child processes.
 *
 * Split out of process-manager.ts (1126 lines). These are the cross-platform
 * mechanics of ending a process — and they are where the platform bugs lived:
 * Windows needs `taskkill /T` to reach the grandchild that actually holds the
 * port (node spawned via cmd.exe), Unix needs a process-group kill, and both
 * need a confirmed exit before a port is reported free.
 */
import { ChildProcess, execFile } from 'child_process';

export const IS_WIN = process.platform === 'win32';
export const CHILD_PROCESS_TERM_TIMEOUT_MS = 5000;
export const PID_TERM_TIMEOUT_MS = 1500;
/** After SIGKILL, how long to wait for the kernel to report the child's exit before giving up. */
export const FORCE_KILL_CONFIRM_TIMEOUT_MS = 1500;

/**
 * Env vars that tell the MCP server (and any future child) it was launched by a
 * daemon supervisor. The MCP server disables its stdin parent-death watchdog when
 * either is set, so a Desktop started via systemd/GNOME autostart or launchd would
 * inherit them and leave an orphaned MCP behind when Desktop dies.
 */
export const DAEMON_SUPERVISOR_ENV_KEYS = ['INVOCATION_ID', 'LAUNCHED_BY_LAUNCHD'] as const;

export function sanitizeChildEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if ((DAEMON_SUPERVISOR_ENV_KEYS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  return env;
}

export function isMindosOwnedCommandLine(commandLine: string): boolean {
  const normalized = commandLine.replace(/\\/g, '/').toLowerCase();
  return [
    '/.mindos/runtime/',
    '/mindos-runtime/',
    '/node_modules/@geminilight/mindos/',
    '/@geminilight/mindos/',
    '/packages/mindos/bin/cli.js',
    '/packages/web/.next/standalone/server.js',
    '/dist/protocols/mcp-server/index.cjs',
  ].some((marker) => normalized.includes(marker));
}

export function forceKillChildProcess(proc: ChildProcess): void {
  try {
    if (IS_WIN && proc.pid) {
      execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
      proc.kill();
    } else if (proc.pid) {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* process may not own a group */ }
      proc.kill('SIGKILL');
    } else {
      if (IS_WIN) proc.kill();
      else proc.kill('SIGKILL');
    }
  } catch { /* already dead */ }
}

/**
 * SIGTERM → wait → SIGKILL → wait (bounded) for the exit event.
 * Resolves `true` when the child confirmed exit, `false` when it may still be
 * alive after force-kill (caller must keep its PID on record for the next boot).
 */
export function terminateChildProcess(
  proc: ChildProcess | null,
  timeoutMs = CHILD_PROCESS_TERM_TIMEOUT_MS,
  forceKillConfirmMs = FORCE_KILL_CONFIRM_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!proc || proc.killed) { resolve(true); return; }
    // Already exited (e.g. crashed before stop()): kill() is a no-op and 'exit'
    // will never fire again, so waiting would only produce a false "unclean" verdict.
    if (typeof proc.exitCode === 'number' || typeof proc.signalCode === 'string') { resolve(true); return; }

    let resolved = false;
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;
    const done = (confirmed: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(forceKillTimer);
      if (confirmTimer) clearTimeout(confirmTimer);
      resolve(confirmed);
    };

    const forceKillTimer = setTimeout(() => {
      forceKillChildProcess(proc);
      // Resolving here without the exit event let stop() clear the PID file for a
      // child that was still alive; give the kernel a moment to report the exit.
      confirmTimer = setTimeout(() => done(false), forceKillConfirmMs);
    }, timeoutMs);

    proc.once('exit', () => done(true));

    try {
      if (IS_WIN && proc.pid) {
        // proc.kill() on Windows only terminates the DIRECT child (cmd.exe for
        // shell-wrapped spawns); its exit clears the force-kill timer, so the
        // timeout taskkill never ran and grandchildren kept the port. Kill the
        // whole tree up front instead.
        execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
      }
      if (!IS_WIN && proc.pid) {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* process may not own a group */ }
      }
      proc.kill('SIGTERM');
    } catch {
      done(true);
    }
  });
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function terminatePid(pid: number, timeoutMs = PID_TERM_TIMEOUT_MS): Promise<void> {
  if (!isPidAlive(pid)) return;

  try {
    if (IS_WIN) {
      // Tree-kill first — killing only the direct PID leaves grandchildren
      // (node spawned via cmd.exe) holding the port. See terminateChildProcess.
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    return;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!isPidAlive(pid)) return;
  }

  try {
    if (IS_WIN) {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
      process.kill(pid);
    }
    else process.kill(pid, 'SIGKILL');
  } catch { /* already dead */ }
}

export const _terminateChildProcess_forTest = terminateChildProcess;
