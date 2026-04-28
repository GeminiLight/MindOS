/** Auto-reconnect utilities for Ask AI streaming connections. */

const NON_RETRYABLE_STATUS = new Set([401, 403, 429]);

const NON_RETRYABLE_PATTERNS = [
  /api.?key/i,
  /model.*not.?found/i,
  /authentication/i,
  /unauthorized/i,
  /forbidden/i,
];

export function isRetryableError(err: unknown, httpStatus?: number): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (httpStatus && NON_RETRYABLE_STATUS.has(httpStatus)) return false;

  if (err instanceof Error) {
    const msg = err.message;
    if (NON_RETRYABLE_PATTERNS.some(p => p.test(msg))) return false;
  }

  return true;
}

const BASE_DELAY = 1000;
const MAX_DELAY = 10_000;

/** Exponential backoff: 1s, 2s, 4s, 8s... capped at 10s */
export function retryDelay(attempt: number): number {
  return Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortReason = () => signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    if (signal?.aborted) { reject(abortReason()); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortReason()); }, { once: true });
  });
}
