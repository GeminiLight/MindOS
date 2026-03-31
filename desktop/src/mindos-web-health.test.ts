import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyMindOsWebHealth, verifyMindOsWebListening } from './mindos-web-health';

describe('verifyMindOsWebHealth', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns true when /api/health responds ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    await expect(verifyMindOsWebHealth(3456)).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/health',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('returns false on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(verifyMindOsWebHealth(3456)).resolves.toBe(false);
  });

  it('returns false on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(verifyMindOsWebHealth(3456)).resolves.toBe(false);
  });
});

describe('verifyMindOsWebListening', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('succeeds on a later attempt', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error('down');
      return { ok: true };
    });

    await expect(
      verifyMindOsWebListening(3456, {
        attempts: 5,
        attemptTimeoutMs: 200,
        betweenMs: 5,
      }),
    ).resolves.toBe(true);
    expect(calls).toBe(3);
  });

  it('returns false after all attempts fail', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down'));
    await expect(
      verifyMindOsWebListening(3456, { attempts: 2, attemptTimeoutMs: 50, betweenMs: 5 }),
    ).resolves.toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
