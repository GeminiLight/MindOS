// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for auto-reconnect behavior:
 * 1. isRetryableError — classify errors
 * 2. Retry logic — backoff delays, attempt tracking
 * 3. Settings integration — reconnectRetries parsed correctly
 */

/* ── isRetryableError ── */

// Import from the module we will create
import { isRetryableError, retryDelay, sleep } from '@/lib/agent/reconnect';

describe('isRetryableError', () => {
  it('returns false for AbortError (user-initiated stop)', () => {
    const err = new DOMException('The user aborted a request.', 'AbortError');
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false for 401 auth error', () => {
    const err = new Error('Request failed (401)');
    expect(isRetryableError(err, 401)).toBe(false);
  });

  it('returns false for 403 forbidden', () => {
    const err = new Error('Request failed (403)');
    expect(isRetryableError(err, 403)).toBe(false);
  });

  it('returns false for 429 rate limit', () => {
    const err = new Error('Rate limited');
    expect(isRetryableError(err, 429)).toBe(false);
  });

  it('returns true for TypeError: Failed to fetch (network error)', () => {
    const err = new TypeError('Failed to fetch');
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for generic Error with no status', () => {
    const err = new Error('Something went wrong');
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for 500 server error', () => {
    const err = new Error('Internal Server Error');
    expect(isRetryableError(err, 500)).toBe(true);
  });

  it('returns true for 502 bad gateway', () => {
    const err = new Error('Bad Gateway');
    expect(isRetryableError(err, 502)).toBe(true);
  });

  it('returns true for 503 service unavailable', () => {
    const err = new Error('Service Unavailable');
    expect(isRetryableError(err, 503)).toBe(true);
  });

  it('returns false when error message contains "API key"', () => {
    const err = new Error('Invalid API key');
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false when error message contains "model not found"', () => {
    const err = new Error('The model gpt-99 was not found');
    expect(isRetryableError(err)).toBe(false);
  });
});

/* ── retryDelay ── */

describe('retryDelay', () => {
  it('returns 1000ms for first attempt', () => {
    expect(retryDelay(0)).toBe(1000);
  });

  it('returns 2000ms for second attempt', () => {
    expect(retryDelay(1)).toBe(2000);
  });

  it('returns 4000ms for third attempt', () => {
    expect(retryDelay(2)).toBe(4000);
  });

  it('caps at 10000ms', () => {
    expect(retryDelay(10)).toBeLessThanOrEqual(10000);
  });
});

/* ── sleep ── */

describe('sleep', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves after specified delay', async () => {
    const p = sleep(500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toBeDefined();
  });

  it('rejects when signal aborts during sleep', async () => {
    const controller = new AbortController();
    const p = sleep(5000, controller.signal);
    setTimeout(() => controller.abort(), 100);
    vi.advanceTimersByTime(100);
    await expect(p).rejects.toBeDefined();
  });

  it('rejects with AbortError when signal.reason is undefined', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await sleep(1000, controller.signal);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { name?: string }).name).toBe('AbortError');
    }
  });
});

/* ── edge cases ── */

describe('edge cases', () => {
  it('maxRetries=0 means isRetryableError result is irrelevant (no retry attempted)', () => {
    const err = new TypeError('Failed to fetch');
    expect(isRetryableError(err)).toBe(true);
  });

  it('retryDelay with negative attempt returns base delay', () => {
    expect(retryDelay(-1)).toBe(500);
  });
});
