/**
 * Client-side request cache with single-flight deduplication and opt-in TTL.
 *
 * Multiple components fetching the same endpoint at the same time share one
 * network request; endpoints with a TTL serve the cached value until expiry.
 * All cached values are invalidated when `mindos:files-changed` fires, so
 * staleness is bounded by the TTL *and* cleared eagerly on known mutations.
 *
 * This cache is intentionally tiny and explicit: callers opt in per call site
 * with a key + fetcher. Errors are never cached.
 */

import { FILES_CHANGED_EVENT } from './files-changed';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const valueCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
// Bumped on every invalidation so in-flight fetches started before the
// invalidation do not write their (potentially stale) result into the cache.
let generation = 0;
let invalidationWired = false;

function ensureInvalidationListener(): void {
  if (invalidationWired || typeof window === 'undefined') return;
  invalidationWired = true;
  window.addEventListener(FILES_CHANGED_EVENT, () => invalidateClientCache());
}

/**
 * Drop cached values (all of them, or only keys starting with `prefix`).
 * In-flight requests are left to complete but will not populate the cache.
 */
export function invalidateClientCache(prefix?: string): void {
  generation += 1;
  if (prefix === undefined) {
    valueCache.clear();
    return;
  }
  for (const key of valueCache.keys()) {
    if (key.startsWith(prefix)) valueCache.delete(key);
  }
}

export interface CachedFetchOptions {
  /** Cache the resolved value for this long. 0 (default) = single-flight only. */
  ttlMs?: number;
}

/**
 * Fetch with single-flight dedup (concurrent callers share one promise) and
 * optional TTL caching of the resolved value. Rejections are propagated to all
 * waiters and never cached.
 */
export function cachedFetch<T>(key: string, fetcher: () => Promise<T>, options: CachedFetchOptions = {}): Promise<T> {
  ensureInvalidationListener();
  const ttlMs = options.ttlMs ?? 0;

  const cached = valueCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
    valueCache.delete(key);
  }

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const startGeneration = generation;
  const promise = fetcher().then(
    (value) => {
      inFlight.delete(key);
      if (ttlMs > 0 && generation === startGeneration) {
        valueCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    },
    (err: unknown) => {
      inFlight.delete(key);
      throw err;
    },
  );
  inFlight.set(key, promise);
  return promise;
}

export const FILES_LIST_CACHE_KEY = '/api/files';
// Short TTL: the full file list is the heaviest idle endpoint. 8s is below the
// 5s tree-version poll + refresh path that would surface new files anyway, and
// the files-changed invalidation clears it eagerly on known mutations.
export const FILES_LIST_TTL_MS = 8_000;

/**
 * Shared fetch for the full vault file list (`/api/files`).
 * Single-flighted and cached for a few seconds so simultaneous consumers
 * (mention picker, plugin panels, ...) issue one request instead of N.
 * Rejects on network/HTTP errors — callers keep their own fallbacks.
 */
export function fetchAllFilePaths(): Promise<string[]> {
  return cachedFetch<string[]>(
    FILES_LIST_CACHE_KEY,
    async () => {
      const res = await fetch('/api/files');
      if (!res.ok) throw new Error(`GET /api/files failed (${res.status})`);
      const data = await res.json();
      return Array.isArray(data) ? (data as string[]) : [];
    },
    { ttlMs: FILES_LIST_TTL_MS },
  );
}

/** Test-only: clear all cache state. */
export function resetClientCacheForTests(): void {
  valueCache.clear();
  inFlight.clear();
  generation = 0;
}
