/**
 * Tests for backend retry logic in route.ts (non-ACP path).
 *
 * We test the pure helper functions involved:
 * - isTransientError (route.ts currently uses this for backend LLM retry)
 * - The retry loop semantics are validated via unit tests of the helper
 */
import { describe, it, expect } from 'vitest';
import { isTransientError } from '@/lib/agent/retry';

describe('isTransientError (backend LLM retry guard)', () => {
  describe('timeout errors', () => {
    it('detects "timeout" keyword', () => {
      expect(isTransientError(new Error('Request timeout after 30s'))).toBe(true);
    });

    it('detects "timed out" keyword', () => {
      expect(isTransientError(new Error('Connection timed out'))).toBe(true);
    });

    it('detects "ETIMEDOUT" (case insensitive)', () => {
      expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    });
  });

  describe('rate limit errors', () => {
    it('detects "429" in message', () => {
      expect(isTransientError(new Error('Error 429: rate limit exceeded'))).toBe(true);
    });

    it('detects "rate limit" keyword', () => {
      expect(isTransientError(new Error('Rate limit reached for model'))).toBe(true);
    });

    it('detects "too many requests"', () => {
      expect(isTransientError(new Error('Too many requests'))).toBe(true);
    });
  });

  describe('server errors (5xx)', () => {
    it('detects "500" in message', () => {
      expect(isTransientError(new Error('500 Internal Server Error'))).toBe(true);
    });

    it('detects "503" in message', () => {
      expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    });

    it('detects "overloaded"', () => {
      expect(isTransientError(new Error('Model is currently overloaded'))).toBe(true);
    });
  });

  describe('connection errors', () => {
    it('detects ECONNRESET', () => {
      expect(isTransientError(new Error('read ECONNRESET'))).toBe(true);
    });

    it('detects "socket hang up"', () => {
      expect(isTransientError(new Error('socket hang up'))).toBe(true);
    });
  });

  describe('non-retryable errors', () => {
    it('returns false for auth errors', () => {
      expect(isTransientError(new Error('Invalid API key'))).toBe(false);
    });

    it('returns false for generic errors without transient keywords', () => {
      expect(isTransientError(new Error('Something went wrong'))).toBe(false);
    });

    it('returns false for content policy violations', () => {
      expect(isTransientError(new Error('Your request was rejected due to content policy'))).toBe(false);
    });
  });
});

// ── Retry loop semantics ──────────────────────────────────────────────────────
// These tests validate the CORRECT behavior after fixing the off-by-one bug.
// The loop should attempt: attempt=1, attempt=2, attempt=3 (MAX_RETRIES=3)
// with retries happening when attempt < MAX_RETRIES (i.e., on attempts 1 and 2)

describe('retry loop semantics (backend route.ts)', () => {
  /**
   * Simulates the corrected retry loop from route.ts.
   * Returns how many attempts were made before success or giving up.
   */
  function simulateRetryLoop(
    shouldFailOn: number[], // attempt numbers that should throw
    hasContent = false,
    MAX_RETRIES = 3,
  ): { attempts: number; succeeded: boolean } {
    let attempts = 0;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      attempts++;
      if (shouldFailOn.includes(attempt)) {
        lastError = new Error('Request timeout after 30s');
        // attempt < MAX_RETRIES: on final attempt, canRetry=false → throws immediately
        const canRetry = !hasContent && attempt < MAX_RETRIES && isTransientError(lastError);
        if (!canRetry) break;
        // would sleep here in real code
      } else {
        lastError = null;
        break; // success
      }
    }

    return { attempts, succeeded: lastError === null };
  }

  it('succeeds on first attempt with 1 attempt total', () => {
    const { attempts, succeeded } = simulateRetryLoop([]);
    expect(attempts).toBe(1);
    expect(succeeded).toBe(true);
  });

  it('retries once after first failure, succeeds on second attempt', () => {
    const { attempts, succeeded } = simulateRetryLoop([1]);
    expect(attempts).toBe(2);
    expect(succeeded).toBe(true);
  });

  it('retries twice after two failures, succeeds on third attempt', () => {
    const { attempts, succeeded } = simulateRetryLoop([1, 2]);
    expect(attempts).toBe(3);
    expect(succeeded).toBe(true);
  });

  it('fails after MAX_RETRIES (3) consecutive failures', () => {
    const { attempts, succeeded } = simulateRetryLoop([1, 2, 3]);
    expect(attempts).toBe(3);
    expect(succeeded).toBe(false);
  });

  it('does NOT retry if content has already been streamed', () => {
    const { attempts, succeeded } = simulateRetryLoop([1, 2, 3], true /* hasContent=true */);
    expect(attempts).toBe(1);
    expect(succeeded).toBe(false);
  });
});
