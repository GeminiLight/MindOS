import { createHash, timingSafeEqual } from 'crypto';

/**
 * Constant-time password check for the Web login.
 *
 * Both sides are hashed to a fixed 32-byte digest first so timingSafeEqual
 * never throws on length mismatch and the comparison time does not depend on
 * how much of the candidate matches. Non-string candidates never match.
 */
export function passwordsMatch(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const a = createHash('sha256').update(candidate, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export interface AuthRateLimiterOptions {
  /** Failures within the window before a client is locked out. */
  maxFailures: number;
  /** A client's failure streak is forgotten this long after its last failure. */
  windowMs: number;
  /** Lock duration once the threshold is reached; doubles per further failure. */
  baseLockMs: number;
  /** Upper bound for the exponential backoff. */
  maxLockMs: number;
  /** Bound on tracked clients so a scan cannot grow the map without limit. */
  maxEntries: number;
  now: () => number;
}

export const AUTH_RATE_LIMIT_DEFAULTS: Readonly<Omit<AuthRateLimiterOptions, 'now'>> = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  baseLockMs: 30_000,
  maxLockMs: 15 * 60_000,
  maxEntries: 10_000,
};

type FailureEntry = {
  failures: number;
  lastFailureAt: number;
  lockedUntil: number;
};

export type AuthRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * In-memory per-client failure counter with exponential backoff.
 *
 * Process-local by design: MindOS runs as a single Web process, and a restart
 * clearing the counters is acceptable for a login brute-force brake. Keys are
 * client IPs taken from proxy headers; without a trusted reverse proxy every
 * client shares the `unknown` bucket, which still caps the total guess rate.
 */
export class AuthRateLimiter {
  private readonly entries = new Map<string, FailureEntry>();
  private readonly options: AuthRateLimiterOptions;

  constructor(options: Partial<AuthRateLimiterOptions> = {}) {
    this.options = { ...AUTH_RATE_LIMIT_DEFAULTS, now: Date.now, ...options };
  }

  get size(): number {
    return this.entries.size;
  }

  check(key: string): AuthRateLimitDecision {
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true };
    const now = this.options.now();
    if (entry.lockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)) };
    }
    if (this.isExpired(entry, now)) this.entries.delete(key);
    return { allowed: true };
  }

  recordFailure(key: string): void {
    const now = this.options.now();
    const previous = this.entries.get(key);
    const entry: FailureEntry = previous && !this.isExpired(previous, now)
      ? previous
      : { failures: 0, lastFailureAt: now, lockedUntil: 0 };

    entry.failures += 1;
    entry.lastFailureAt = now;
    if (entry.failures >= this.options.maxFailures) {
      const exponent = entry.failures - this.options.maxFailures;
      const lockMs = Math.min(this.options.baseLockMs * 2 ** exponent, this.options.maxLockMs);
      entry.lockedUntil = now + lockMs;
    }

    // Re-insert so Map iteration order doubles as least-recently-failed order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.evict(now);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private isExpired(entry: FailureEntry, now: number): boolean {
    return entry.lockedUntil <= now && now - entry.lastFailureAt > this.options.windowMs;
  }

  private evict(now: number): void {
    if (this.entries.size <= this.options.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry, now)) this.entries.delete(key);
      if (this.entries.size <= this.options.maxEntries) return;
    }
    for (const key of this.entries.keys()) {
      this.entries.delete(key);
      if (this.entries.size <= this.options.maxEntries) return;
    }
  }
}

/** Best-effort client identity for rate limiting, from proxy headers. */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0] ?? '';
  const raw = (forwarded.trim() || headers.get('x-real-ip') || '')
    .replace(/[^\x21-\x7e]/g, '')
    .slice(0, 64);
  return raw || 'unknown';
}

export const authRateLimiter = new AuthRateLimiter();

export function resetAuthRateLimiterForTests(): void {
  authRateLimiter.clear();
}
