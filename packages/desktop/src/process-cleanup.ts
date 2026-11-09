/**
 * Orphan and port cleanup: making sure a previous session's processes are
 * gone before a new one starts.
 *
 * Split out of process-manager.ts. Two safety nets, in order:
 *   1. PID files — the Desktop's own (desktop-children.pid) and the CLI's
 *      (mindos.pid), written while running and read on the next launch;
 *   2. the ports themselves — when PID files are missing or stale.
 * Both only ever kill a process whose command line proves it belongs to
 * MindOS (isMindosOwnedCommandLine), never whatever happens to hold a port.
 */
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { desktopTelemetry } from './telemetry';
import { getDesktopConfigDir } from './desktop-home';
import { isMindosOwnedCommandLine, terminatePid } from './process-kill';

const execFileAsync = promisify(execFile);

function childPidFile(): string {
  return path.join(getDesktopConfigDir(), 'desktop-children.pid');
}

/** Record child PIDs so the next launch can clean up if this one dies. */
export function writeChildPidList(pids: number[]): void {
  try {
    const pidFile = childPidFile();
    const dir = path.dirname(pidFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(pidFile, pids.join('\n'), 'utf-8');
  } catch { /* best effort */ }
}

/** Remove the PID file on clean shutdown. */
export function clearChildPidFile(): void {
  const pidFile = childPidFile();
  try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch { /* best effort */ }
}

/**
 * Kill orphaned child processes from a previous Desktop session that didn't shut down cleanly.
 * Call once at app startup before creating a new ProcessManager.
 */
export async function cleanupOrphanedChildren(): Promise<void> {
  try {
    const pidFile = childPidFile();
    if (!existsSync(pidFile)) return;
    const raw = readFileSync(pidFile, 'utf-8').trim();
    if (!raw) return;
    const pids = raw.split('\n').map(Number).filter(p => p > 0 && !isNaN(p));
    for (const pid of pids) {
      await killIfNodeProcess(pid, 'orphaned child');
    }
    unlinkSync(pidFile);
  } catch { /* non-critical */ }
}

/**
 * Kill orphaned CLI-started processes (mindos.pid) from a previous `mindos start` session.
 * Desktop and CLI use separate PID files — both must be cleaned up on reinstall.
 */
export async function cleanupCliPidFile(): Promise<void> {
  const cliPidPath = path.join(getDesktopConfigDir(), 'mindos.pid');
  try {
    if (!existsSync(cliPidPath)) return;
    const raw = readFileSync(cliPidPath, 'utf-8').trim();
    if (!raw) return;
    const pids = raw.split('\n').map(Number).filter(p => p > 0 && !isNaN(p));
    for (const pid of pids) {
      await killIfNodeProcess(pid, 'orphaned CLI');
    }
    unlinkSync(cliPidPath);
  } catch { /* non-critical */ }
}

/**
 * Kill processes holding a specific port (fallback when PID files are missing/stale).
 * Only kills node/next processes to avoid harming unrelated services.
 * Uses platform-specific tools with cascading fallbacks:
 *   macOS:   lsof → fuser
 *   Linux:   lsof → ss → fuser
 *   Windows: Get-NetTCPConnection (PowerShell)
 */
export async function killProcessesOnPort(port: number): Promise<void> {
  try {
    const pids = await findPidsOnPort(port);
    for (const pid of pids) {
      await killIfNodeProcess(pid, `port ${port} occupant`);
    }
  } catch { /* best effort */ }
}

/** Find PIDs listening on a given port — cross-platform with fallbacks */
async function findPidsOnPort(port: number): Promise<number[]> {
  const timeout = 3000;

  if (process.platform === 'win32') {
    const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'powershell' });
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
      ], { encoding: 'utf-8', timeout, windowsHide: true });
      const pids = (stdout as string).trim().split(/\r?\n/).map(Number).filter((p: number) => p > 0 && !isNaN(p));
      stop({ port, method: 'powershell', pidCount: pids.length, success: true });
      return pids;
    } catch {
      stop({ port, method: 'powershell', pidCount: 0, success: false });
      return [];
    }
  }

  // Unix: try lsof → ss → fuser
  {
    const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'lsof' });
    try {
      const { stdout } = await execFileAsync('lsof', [`-ti:${port}`], { encoding: 'utf-8', timeout, windowsHide: true });
      if (stdout.trim()) {
        const pids = stdout.trim().split('\n').map(Number).filter((p: number) => p > 0 && !isNaN(p));
        stop({ port, method: 'lsof', pidCount: pids.length, success: true });
        return pids;
      }
      stop({ port, method: 'lsof', pidCount: 0, success: true });
    } catch {
      stop({ port, method: 'lsof', pidCount: 0, success: false });
    }
  }

  // Fallback: ss (Linux modern — not on macOS)
  if (process.platform === 'linux') {
    const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'ss' });
    try {
      const { stdout } = await execFileAsync('ss', ['-tlnp', 'sport', '=', `:${port}`], { encoding: 'utf-8', timeout, windowsHide: true });
      const pids: number[] = [];
      for (const match of (stdout as string).matchAll(/pid=(\d+)/g)) {
        const p = parseInt(match[1], 10);
        if (p > 0) pids.push(p);
      }
      if (pids.length > 0) {
        stop({ port, method: 'ss', pidCount: pids.length, success: true });
        return pids;
      }
      stop({ port, method: 'ss', pidCount: 0, success: true });
    } catch {
      stop({ port, method: 'ss', pidCount: 0, success: false });
    }
  }

  // Fallback: fuser (available on most Unix)
  const stop = desktopTelemetry.startTimer('desktop.port.find_pids', { port, method: 'fuser' });
  try {
    let output = '';
    let fuserSucceeded = true;
    try {
      const { stdout, stderr } = await execFileAsync('fuser', [`${port}/tcp`], { encoding: 'utf-8', timeout, windowsHide: true });
      output = `${stdout}${stderr}`;
    } catch (err) {
      fuserSucceeded = false;
      const e = err as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    const pids = output.match(/\d+/g)?.map(Number).filter((p: number) => p > 0 && p !== port) ?? [];
    if (pids.length > 0) {
      stop({ port, method: 'fuser', pidCount: pids.length, success: true });
      return pids;
    }
    stop({ port, method: 'fuser', pidCount: 0, success: fuserSucceeded });
  } catch {
    stop({ port, method: 'fuser', pidCount: 0, success: false });
  }

  return [];
}

/**
 * Verify a PID belongs to MindOS before killing it — prevents harming
 * unrelated Node/Next processes when PID files are stale or ports collide.
 * On Windows: uses PowerShell/wmic to check command line before killing.
 * On Unix: uses ps -p to check command line.
 */
async function killIfNodeProcess(pid: number, label: string): Promise<void> {
  const stop = desktopTelemetry.startTimer('desktop.port.kill_verify', { pid, label });
  try {
    process.kill(pid, 0); // check alive
    const timeout = 3000;

    if (process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue).CommandLine`,
        ], { encoding: 'utf-8', timeout, windowsHide: true });
        if (!isMindosOwnedCommandLine((stdout as string).trim())) {
          stop({ pid, label, verifiedMindosProcess: false, success: true });
          return;
        }
      } catch {
        try {
          const { stdout } = await execFileAsync('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/format:value'], { encoding: 'utf-8', timeout, windowsHide: true });
          if (!isMindosOwnedCommandLine((stdout as string).trim())) {
            stop({ pid, label, verifiedMindosProcess: false, success: true });
            return;
          }
        } catch {
          stop({ pid, label, verifiedMindosProcess: false, success: false });
          return;
        }
      }
    } else {
      try {
        const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf-8', timeout: 2000, windowsHide: true });
        if (!isMindosOwnedCommandLine((stdout as string).trim())) {
          stop({ pid, label, verifiedMindosProcess: false, success: true });
          return;
        }
      } catch {
        stop({ pid, label, verifiedMindosProcess: false, success: false });
        return;
      }
    }

    console.warn(`[MindOS] Killing ${label} process (PID ${pid})`);
    await terminatePid(pid);
    stop({ pid, label, verifiedMindosProcess: true, success: true });
  } catch {
    stop({ pid, label, verifiedMindosProcess: false, success: false });
  }
}
