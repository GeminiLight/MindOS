import { describe, it, expect } from 'vitest';
import { isTransientError } from '@/lib/agent/retry';

describe('isTransientError', () => {
  it('returns true for timeout errors', () => {
    expect(isTransientError(new Error('Request timeout'))).toBe(true);
    expect(isTransientError(new Error('connect ETIMEDOUT'))).toBe(true);
    expect(isTransientError(new Error('operation timed out after 30s'))).toBe(true);
  });

  it('returns true for rate limit errors', () => {
    expect(isTransientError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isTransientError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isTransientError(new Error('too many requests, please retry'))).toBe(true);
  });

  it('returns true for server errors (5xx)', () => {
    expect(isTransientError(new Error('500 Internal Server Error'))).toBe(true);
    expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
    expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransientError(new Error('service unavailable'))).toBe(true);
  });

  it('returns true for connection errors', () => {
    expect(isTransientError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientError(new Error('connect ECONNREFUSED'))).toBe(true);
    expect(isTransientError(new Error('socket hang up'))).toBe(true);
  });

  it('returns true for overload errors', () => {
    expect(isTransientError(new Error('API is overloaded'))).toBe(true);
    expect(isTransientError(new Error('at capacity, please retry'))).toBe(true);
  });

  it('returns false for auth errors', () => {
    expect(isTransientError(new Error('401 Unauthorized'))).toBe(false);
    expect(isTransientError(new Error('Invalid API key'))).toBe(false);
  });

  it('returns false for bad request errors', () => {
    expect(isTransientError(new Error('400 Bad Request'))).toBe(false);
    expect(isTransientError(new Error('Invalid input'))).toBe(false);
  });

  it('returns false for content policy errors', () => {
    expect(isTransientError(new Error('Content policy violation'))).toBe(false);
    expect(isTransientError(new Error('This request has been blocked'))).toBe(false);
  });
});
