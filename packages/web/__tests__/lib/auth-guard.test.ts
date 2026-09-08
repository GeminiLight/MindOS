import { describe, expect, it } from 'vitest';
import { AuthRateLimiter, clientIpFromHeaders, passwordsMatch } from '@/lib/api/auth-guard';

describe('passwordsMatch', () => {
  it('accepts identical passwords', () => {
    expect(passwordsMatch('secret', 'secret')).toBe(true);
  });

  it('rejects different passwords regardless of length', () => {
    expect(passwordsMatch('secret', 'secret2')).toBe(false);
    expect(passwordsMatch('', 'secret')).toBe(false);
    expect(passwordsMatch('x'.repeat(5000), 'secret')).toBe(false);
  });

  it('rejects non-string candidates without throwing', () => {
    expect(passwordsMatch(undefined, 'secret')).toBe(false);
    expect(passwordsMatch(null, 'secret')).toBe(false);
    expect(passwordsMatch(123, 'secret')).toBe(false);
    expect(passwordsMatch({ toString: () => 'secret' }, 'secret')).toBe(false);
  });

  it('handles unicode passwords', () => {
    expect(passwordsMatch('密码🔐', '密码🔐')).toBe(true);
    expect(passwordsMatch('密码🔐', '密码')).toBe(false);
  });
});

describe('AuthRateLimiter', () => {
  function makeLimiter(start = 1_000_000) {
    let now = start;
    const limiter = new AuthRateLimiter({
      maxFailures: 5,
      windowMs: 15 * 60_000,
      baseLockMs: 30_000,
      maxLockMs: 15 * 60_000,
      now: () => now,
    });
    return { limiter, advance: (ms: number) => { now += ms; } };
  }

  it('allows requests until the failure threshold is reached', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1');
    expect(limiter.check('1.1.1.1')).toEqual({ allowed: true });
  });

  it('locks the client after five failures within the window and reports Retry-After', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('1.1.1.1');
    expect(limiter.check('1.1.1.1')).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(limiter.check('2.2.2.2')).toEqual({ allowed: true });
  });

  it('doubles the lock duration on each further failure up to the cap', () => {
    const { limiter, advance } = makeLimiter();
    const retryAfter = () => {
      const decision = limiter.check('ip');
      return decision.allowed ? null : decision.retryAfterSeconds;
    };
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    expect(retryAfter()).toBe(30);
    advance(30_000);
    expect(limiter.check('ip')).toEqual({ allowed: true });
    limiter.recordFailure('ip');
    expect(retryAfter()).toBe(60);
    advance(60_000);
    limiter.recordFailure('ip');
    expect(retryAfter()).toBe(120);
    for (let i = 0; i < 10; i++) {
      advance(14 * 60_000);
      limiter.recordFailure('ip');
    }
    const capped = limiter.check('ip');
    expect(capped.allowed).toBe(false);
    expect(capped.allowed === false && capped.retryAfterSeconds).toBe(15 * 60);
  });

  it('forgets failures once the window has elapsed', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
    advance(15 * 60_000 + 1);
    limiter.recordFailure('ip');
    expect(limiter.check('ip')).toEqual({ allowed: true });
  });

  it('resets the counter on success', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
    limiter.reset('ip');
    limiter.recordFailure('ip');
    expect(limiter.check('ip')).toEqual({ allowed: true });
  });

  it('bounds memory by evicting the oldest entries past the cap', () => {
    let now = 0;
    const limiter = new AuthRateLimiter({ maxEntries: 3, now: () => now });
    for (const ip of ['a', 'b', 'c', 'd']) {
      now += 1;
      limiter.recordFailure(ip);
    }
    expect(limiter.size).toBe(3);
  });
});

describe('clientIpFromHeaders', () => {
  it('prefers the first x-forwarded-for hop', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip and then to a stable unknown bucket', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });

  it('bounds the key length and strips embedded whitespace from spoofable header values', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '9'.repeat(200) })).length).toBeLessThanOrEqual(64);
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.9 evil' }))).toBe('203.0.113.9evil');
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': ',10.0.0.1' }))).toBe('unknown');
  });
});
