import { describe, it, expect } from 'vitest';
import { isRetryableError, retryDelay, sleep } from '@/lib/agent/reconnect';

// ── isRetryableError ──────────────────────────────────────────────────────────

describe('isRetryableError', () => {
  describe('non-retryable: AbortError', () => {
    it('returns false for DOMException AbortError', () => {
      const err = new DOMException('The user aborted the request.', 'AbortError');
      expect(isRetryableError(err)).toBe(false);
    });
  });

  describe('non-retryable: auth / forbidden HTTP status', () => {
    it('returns false for HTTP 401', () => {
      expect(isRetryableError(new Error('Unauthorized'), 401)).toBe(false);
    });

    it('returns false for HTTP 403', () => {
      expect(isRetryableError(new Error('Forbidden'), 403)).toBe(false);
    });

    it('returns false for error message containing "api key"', () => {
      expect(isRetryableError(new Error('Invalid api key provided'))).toBe(false);
    });

    it('returns false for error message containing "authentication"', () => {
      expect(isRetryableError(new Error('Authentication failed'))).toBe(false);
    });

    it('returns false for "model not found" errors', () => {
      expect(isRetryableError(new Error('The model gpt-99 was not found'))).toBe(false);
    });
  });

  describe('retryable: transient network / server errors', () => {
    it('returns true for generic network error (no httpStatus)', () => {
      expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    });

    it('returns true for HTTP 500', () => {
      expect(isRetryableError(new Error('Internal Server Error'), 500)).toBe(true);
    });

    it('returns true for HTTP 503', () => {
      expect(isRetryableError(new Error('Service Unavailable'), 503)).toBe(true);
    });

    it('returns true for connection reset', () => {
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    });
  });

  describe('retryable: rate limit (429)', () => {
    it('returns false for HTTP 429 (rate limit — caller handles this specially)', () => {
      // reconnect.ts lists 429 as NON_RETRYABLE_STATUS.
      // The frontend retry loop decides not to retry 429 at HTTP level;
      // the backend should handle 429 via its own LLM-layer retry.
      expect(isRetryableError(new Error('Too Many Requests'), 429)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns true for non-Error values (unknown errors)', () => {
      expect(isRetryableError('some string error')).toBe(true);
      expect(isRetryableError(null)).toBe(true);
      expect(isRetryableError(undefined)).toBe(true);
    });
  });
});

// ── retryDelay ────────────────────────────────────────────────────────────────

describe('retryDelay', () => {
  it('returns 2000ms for attempt 1 (first retry)', () => {
    expect(retryDelay(1)).toBe(2000);
  });

  it('returns 4000ms for attempt 2', () => {
    expect(retryDelay(2)).toBe(4000);
  });

  it('returns 8000ms for attempt 3', () => {
    expect(retryDelay(3)).toBe(8000);
  });

  it('caps at 10000ms regardless of attempt number', () => {
    expect(retryDelay(10)).toBe(10000);
    expect(retryDelay(100)).toBe(10000);
  });

  it('returns 1000ms for attempt 0 (base case)', () => {
    expect(retryDelay(0)).toBe(1000);
  });
});

// ── sleep ─────────────────────────────────────────────────────────────────────

describe('sleep', () => {
  it('resolves after specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toThrow();
  });

  it('rejects early when signal is aborted during sleep', async () => {
    const controller = new AbortController();
    const start = Date.now();
    setTimeout(() => controller.abort(), 30);
    await expect(sleep(2000, controller.signal)).rejects.toThrow();
    // Should abort well before the full 2000ms
    expect(Date.now() - start).toBeLessThan(500);
  });
});
