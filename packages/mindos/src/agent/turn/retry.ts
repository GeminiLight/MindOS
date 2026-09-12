import type { MindOSSSEvent } from './index.js';
import { armPausableTurnTimer, getCurrentTurnDeadline } from './turn-deadline.js';

/**
 * Turn-execution control primitives shared by every lane: transient-error
 * classification, retry backoff, cancellable sleep, the retry wrapper and the
 * two timeout helpers. Split out of `index.ts` so `acp-lane.ts` can depend on
 * them without importing back from the barrel (which would create a runtime
 * import cycle); `index.ts` re-exports all of them, so existing consumers are
 * unaffected.
 */

export * from './retry-policy.js';
import { isMindosTransientError, mindosRetryDelay, sleepMindos } from './retry-policy.js';

export function resolveMindosAgentTimeoutMs(raw: string | undefined = undefined, defaultMs = 600_000): number {
  if (!raw) return defaultMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

export async function runMindosWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  // When a turn deadline is active (lane caller), the race timer pauses with
  // it: bridge waits must not consume the turn budget (turn-deadline.ts).
  // Without a deadline this is the plain setTimeout race it always was.
  const deadline = getCurrentTurnDeadline();
  let disposeTimer: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    disposeTimer = armPausableTurnTimer({
      timeoutMs,
      ...(deadline ? { deadline } : {}),
      onTimeout: () => {
        const error = new Error(message) as Error & { code?: string };
        error.code = 'TIMEOUT';
        reject(error);
      },
    });
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    disposeTimer?.();
  }
}

export type MindosAgentTurnRetryOptions = {
  maxRetries?: number;
  signal?: AbortSignal;
  hasContent(): boolean;
  onVisibleContent?(): void;
  send(event: MindOSSSEvent): void;
  execute(attempt: number): Promise<void>;
  onAttemptError?(error: Error, attempt: number): Promise<void> | void;
  isTransientError?: (error: Error) => boolean;
  retryDelay?: (attempt: number) => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryMessage?: (attempt: number, maxRetries: number) => string;
};

export async function runMindosAgentTurnWithRetry(options: MindosAgentTurnRetryOptions): Promise<Error | null> {
  const maxRetries = options.maxRetries ?? 3;
  const isTransient = options.isTransientError ?? isMindosTransientError;
  const delayForAttempt = options.retryDelay ?? mindosRetryDelay;
  const wait = options.sleep ?? sleepMindos;
  const retryMessage = options.retryMessage ?? ((attempt, max) => `Request failed, retrying (${attempt}/${max})...`);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await options.execute(attempt);
      return null;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await options.onAttemptError?.(lastError, attempt);

      const canRetry = !options.hasContent() && attempt < maxRetries && isTransient(lastError);
      if (!canRetry) break;

      options.send({ type: 'status', message: retryMessage(attempt, maxRetries) });
      await wait(delayForAttempt(attempt), options.signal);
    }
  }

  return lastError;
}
