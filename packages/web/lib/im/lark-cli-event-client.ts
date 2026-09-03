import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveSafeLarkCliExecutable } from '@geminilight/mindos/server';

export type LarkCliMessageEvent = {
  type?: string;
  event_id?: string;
  message_id?: string;
  id?: string;
  chat_id?: string;
  chat_type?: 'p2p' | 'group';
  sender_id?: string;
  sender_type?: 'user' | 'bot';
  content?: string;
  message_type?: string;
  mentions?: Array<{ id?: string; key?: string; name?: string }>;
  create_time?: string;
  timestamp?: string;
  root_id?: string;
  reply_to?: string;
  thread_id?: string;
};

type ChildLike = Pick<ChildProcessWithoutNullStreams, 'stdout' | 'stderr' | 'stdin' | 'once' | 'kill'>;
type SpawnProcess = (executablePath: string, args: string[]) => ChildLike;

export type LarkCliEventClientStatus = {
  running: boolean;
  startedAt?: string;
  lastError?: string;
};

export type LarkCliEventClientOptions = {
  executablePath: string;
  profile: string;
  onEvent(event: LarkCliMessageEvent): void | Promise<void>;
  spawnProcess?: SpawnProcess;
};

const READY_LINE = /^\[event\]\s+ready(?:\s|$)/;
const MAX_BUFFER = 1024 * 1024;
const STOP_GRACE_MS = 1_500;

export function createLarkCliEventClient(options: LarkCliEventClientOptions) {
  let child: ChildLike | null = null;
  let startPromise: Promise<void> | null = null;
  let resolveStart: (() => void) | null = null;
  let rejectStart: ((error: Error) => void) | null = null;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let startedAt: string | undefined;
  let running = false;
  let lastError: string | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;

  const status = (): LarkCliEventClientStatus => ({ running, startedAt, lastError });

  const start = (): Promise<void> => {
    if (running) return Promise.resolve();
    if (startPromise) return startPromise;
    validateOptions(options);
    const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    child = spawnProcess(options.executablePath, [
      '--profile', options.profile,
      'event', 'consume', 'im.message.receive_v1',
      '--as', 'bot',
    ]);
    lastError = undefined;
    startPromise = new Promise<void>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer = appendBounded(stdoutBuffer, chunk);
      stdoutBuffer = drainLines(stdoutBuffer, (line) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as LarkCliMessageEvent;
          if (event && typeof event === 'object') {
            void Promise.resolve(options.onEvent(event)).catch((error) => {
              lastError = safeMessage(error, 'Feishu event handler failed.');
            });
          }
        } catch {
          lastError = 'lark-cli returned an invalid event line; the stream remains active.';
        }
      });
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuffer = appendBounded(stderrBuffer, chunk);
      stderrBuffer = drainLines(stderrBuffer, (line) => {
        if (!READY_LINE.test(line.trim())) return;
        running = true;
        startedAt = new Date().toISOString();
        resolveStart?.();
        resolveStart = null;
        rejectStart = null;
      }, true);
    });
    child.once('error', (error: Error) => finish(error));
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const expected = !running && !rejectStart;
      const detail = safeCliFailure(stderrBuffer);
      const error = expected || code === 0
        ? undefined
        : new Error(detail || `lark-cli event consumer exited before ready (${signal ?? code ?? 'unknown'}).`);
      finish(error);
    });
    return startPromise;
  };

  const finish = (error?: Error) => {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = undefined;
    running = false;
    child = null;
    if (error) {
      lastError = safeMessage(error, 'lark-cli event consumer failed.');
      rejectStart?.(new Error(lastError));
    } else if (rejectStart) {
      rejectStart(new Error('lark-cli event consumer stopped before it became ready.'));
    }
    resolveStart = null;
    rejectStart = null;
    startPromise = null;
  };

  const stop = () => {
    const active = child;
    if (!active) return;
    running = false;
    active.stdin.end();
    stopTimer = setTimeout(() => {
      if (child === active) active.kill('SIGTERM');
    }, STOP_GRACE_MS);
    stopTimer.unref?.();
  };

  return { start, stop, status };
}

function defaultSpawnProcess(executablePath: string, args: string[]): ChildLike {
  return spawn(resolveSafeLarkCliExecutable(executablePath), args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

function validateOptions(options: LarkCliEventClientOptions): void {
  if (!options.executablePath.startsWith('/')) throw new Error('lark-cli executable path must be absolute.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(options.profile)) {
    throw new Error('lark-cli profile is invalid.');
  }
}

function appendBounded(buffer: string, chunk: Buffer | string): string {
  const next = buffer + String(chunk);
  if (next.length > MAX_BUFFER) return next.slice(-MAX_BUFFER);
  return next;
}

function drainLines(buffer: string, consume: (line: string) => void, retainHistory = false): string {
  const parts = buffer.split(/\r?\n/);
  const tail = parts.pop() ?? '';
  for (const line of parts) consume(line);
  if (!retainHistory) return tail;
  return [...parts.slice(-30), tail].join('\n').slice(-16_384);
}

function safeCliFailure(stderr: string): string | undefined {
  const candidate = stderr.trim();
  try {
    const parsed = JSON.parse(candidate) as { error?: { message?: unknown; hint?: unknown } };
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message : '';
    const hint = typeof parsed.error?.hint === 'string' ? parsed.error.hint : '';
    return redact(`${message}${message && hint ? ' — ' : ''}${hint}`) || undefined;
  } catch {
    const lines = candidate.split(/\r?\n/).filter((line) => /error|missing|scope|grant|failed/i.test(line));
    return redact(lines.slice(-3).join(' — ')) || undefined;
  }
}

function safeMessage(error: unknown, fallback: string): string {
  return redact(error instanceof Error ? error.message : fallback) || fallback;
}

function redact(value: string): string {
  return value
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|app[_-]?secret|authorization|cookie)["']?\s*[:=]\s*)[^\s,}\]]+/gi, '$1[REDACTED]')
    .slice(0, 2_000);
}
