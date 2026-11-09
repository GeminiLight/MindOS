/**
 * Bounded-output command runner for the long-running setup commands
 * (`npm install`, `next build`, `npm install -g …`).
 *
 * These used to go through promisify(exec) with no maxBuffer, i.e. Node's 1 MB
 * default. A real `npm install` + `next build` prints well past 1 MB, so the
 * child was killed mid-build and the UI reported "build failed: maxBuffer
 * length exceeded" for a build that was actually fine. spawn() streams instead,
 * and only the tail is retained for diagnostics.
 */
import { spawn } from 'child_process';
import { resolveExecTarget } from './exec-target';

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** How many trailing output lines to keep for error reporting. */
  tailLines?: number;
  signal?: AbortSignal;
}

export interface RunCommandResult {
  ok: boolean;
  code: number | null;
  /** Trailing stdout lines (bounded). */
  stdout: string;
  /** Trailing stderr lines (bounded). */
  stderr: string;
  /** Set when the command never exited in time or was aborted. */
  timedOut?: boolean;
  aborted?: boolean;
  /** Spawn-level failure (ENOENT etc.). */
  error?: string;
}

const DEFAULT_TAIL_LINES = 40;
const DEFAULT_TIMEOUT_MS = 300_000;

/** Keeps only the last `max` lines of a stream without unbounded growth. */
export class TailBuffer {
  private lines: string[] = [];
  private partial = '';

  constructor(private readonly max: number) {}

  push(chunk: string): void {
    const text = this.partial + chunk;
    const parts = text.split('\n');
    this.partial = parts.pop() ?? '';
    for (const line of parts) {
      this.lines.push(line);
    }
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  toString(): string {
    const all = this.partial ? [...this.lines, this.partial] : this.lines;
    return all.slice(-this.max).join('\n').trim();
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref();
    } else {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* not a group leader */ }
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  } catch { /* already gone */ }
}

/** Run one command to completion. Never rejects — failures are returned. */
export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const tailLines = options.tailLines ?? DEFAULT_TAIL_LINES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const stdout = new TailBuffer(tailLines);
    const stderr = new TailBuffer(tailLines);
    const target = resolveExecTarget(command, args);

    let child;
    try {
      child = spawn(target.command, target.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: err instanceof Error ? err.message : String(err) });
      return;
    }

    let settled = false;
    const finish = (result: RunCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const timer = setTimeout(() => {
      killTree(child.pid);
      finish({ ok: false, code: null, stdout: stdout.toString(), stderr: stderr.toString(), timedOut: true });
    }, timeoutMs);
    timer.unref?.();

    const onAbort = () => {
      killTree(child.pid);
      finish({ ok: false, code: null, stdout: stdout.toString(), stderr: stderr.toString(), aborted: true });
    };
    if (options.signal?.aborted) { onAbort(); return; }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    child.on('error', (err: Error) => {
      finish({ ok: false, code: null, stdout: stdout.toString(), stderr: stderr.toString(), error: err.message });
    });
    child.on('close', (code: number | null) => {
      finish({ ok: code === 0, code, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/** Run commands in order, stopping at the first failure. */
export async function runCommandSequence(
  steps: Array<{ command: string; args: string[]; cwd?: string }>,
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  let last: RunCommandResult = { ok: true, code: 0, stdout: '', stderr: '' };
  for (const step of steps) {
    last = await runCommand(step.command, step.args, { ...options, cwd: step.cwd ?? options.cwd });
    if (!last.ok) return last;
  }
  return last;
}

/** One-line reason for a failed run, suitable for appending to a localized prefix. */
export function describeFailure(result: RunCommandResult): string {
  if (result.aborted) return 'cancelled';
  if (result.timedOut) return 'timed out';
  if (result.error) return result.error;
  const tail = result.stderr || result.stdout;
  return tail ? tail.split('\n').slice(-3).join('\n') : `exit code ${result.code}`;
}
