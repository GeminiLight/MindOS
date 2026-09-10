import type { MindOSSSEvent } from './index.js';

/**
 * Turn-execution control primitives shared by every lane: transient-error
 * classification, retry backoff, cancellable sleep, the retry wrapper and the
 * two timeout helpers. Split out of `index.ts` so `acp-lane.ts` can depend on
 * them without importing back from the barrel (which would create a runtime
 * import cycle); `index.ts` re-exports all of them, so existing consumers are
 * unaffected.
 */

/**
 * Numeric HTTP status carried on the error object itself (fetch wrappers and
 * provider SDKs set `status` or `statusCode`). Preferred over message parsing.
 */
function mindosErrorHttpStatus(err: Error): number | undefined {
  const candidate = (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate < 600
    ? candidate
    : undefined;
}

/**
 * A 5xx number only counts as a server error when it reads as an HTTP status:
 * the message starts with it ("502 Bad Gateway"), it follows a status word
 * ("status 503", "HTTP 502", "Error 429", "status code: 504"), or it is
 * followed by a canonical reason phrase ("returned 502 bad gateway"). Bare
 * numbers such as "context length 512" or "line 503" must not trigger retries.
 */
const MINDOS_HTTP_5XX_PATTERNS = [
  /^\s*(?:\[?http\]?\s*)?5\d{2}\b/i,
  /\b(?:status(?:\s*code)?|http|code|error|err)\s*[:=#-]?\s*\(?5\d{2}\b/i,
  /\b5\d{2}\s+(?:internal server error|bad gateway|service unavailable|gateway time-?out|server error|overloaded)\b/i,
];

function mindosMessageMentionsHttp5xx(msg: string): boolean {
  return MINDOS_HTTP_5XX_PATTERNS.some((pattern) => pattern.test(msg));
}

/**
 * Transient-failure classifier for the ask turn retry loop
 * (`runMindosAgentTurnWithRetry`). Retries here re-issue an idempotent LLM
 * request with exponential backoff (`mindosRetryDelay`), so rate limits (429)
 * are worth waiting out and are treated as transient. This deliberately
 * differs from `isMindosRetryableError`, which guards client-side turn
 * resubmission where a 429 means "too many concurrent runs" and retrying
 * would duplicate the turn.
 */
export function isMindosTransientError(err: Error): boolean {
  const status = mindosErrorHttpStatus(err);
  if (status !== undefined) {
    if (status === 429 || (status >= 500 && status < 600)) return true;
    if (status >= 400 && status < 500) return false;
  }
  const msg = err.message.toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return true;
  if (/\b429\b/.test(msg) || msg.includes('rate limit') || msg.includes('too many requests')) return true;
  if (mindosMessageMentionsHttp5xx(msg) || msg.includes('internal server error') || msg.includes('service unavailable')) return true;
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('socket hang up')) return true;
  if (msg.includes('overloaded') || msg.includes('capacity')) return true;
  return false;
}

/**
 * Statuses that must not trigger a client-side turn resubmission. 401/403 need
 * user action; 429 is the server's concurrency cap (MAX_CONCURRENT_RUNS) and
 * re-POSTing the turn would either be rejected again or duplicate the run once
 * a slot frees up. Contrast with `isMindosTransientError`, where 429 on an
 * idempotent LLM call is retried with backoff.
 */
const MINDOS_NON_RETRYABLE_STATUS = new Set([401, 403, 429]);
const MINDOS_NON_RETRYABLE_PATTERNS = [
  /api.?key/i,
  /model.*not.?found/i,
  /authentication/i,
  /unauthorized/i,
  /forbidden/i,
];

export function isMindosRetryableError(err: unknown, httpStatus?: number): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (httpStatus && MINDOS_NON_RETRYABLE_STATUS.has(httpStatus)) return false;

  if (err instanceof Error) {
    const msg = err.message;
    if (MINDOS_NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(msg))) return false;
  }

  return true;
}

export function mindosRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000);
}

export function sleepMindos(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    const abortReason = () => signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    if (signal?.aborted) {
      reject(abortReason());
      return;
    }
    const timer = setTimeout(resolveSleep, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortReason());
    }, { once: true });
  });
}

export function resolveMindosAgentTimeoutMs(raw: string | undefined = undefined, defaultMs = 600_000): number {
  if (!raw) return defaultMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

export async function runMindosWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message) as Error & { code?: string };
      error.code = 'TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
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
