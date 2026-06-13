// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachedFetch,
  fetchAllFilePaths,
  invalidateClientCache,
  resetClientCacheForTests,
} from '@/lib/client-cache';
import { FILES_CHANGED_EVENT } from '@/lib/files-changed';

describe('cachedFetch', () => {
  beforeEach(() => {
    resetClientCacheForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent calls into a single fetcher invocation (single-flight)', async () => {
    let resolveFetch: (value: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((resolve) => { resolveFetch = resolve; }));

    const promises = Array.from({ length: 5 }, () => cachedFetch('key', fetcher, { ttlMs: 1000 }));
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch('value');
    const results = await Promise.all(promises);
    expect(results).toEqual(['value', 'value', 'value', 'value', 'value']);
  });

  it('serves from TTL cache until expiry, then refetches', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => 'v');

    await cachedFetch('key', fetcher, { ttlMs: 5000 });
    await cachedFetch('key', fetcher, { ttlMs: 5000 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5001);
    await cachedFetch('key', fetcher, { ttlMs: 5000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache when ttlMs is 0 (single-flight only)', async () => {
    const fetcher = vi.fn(async () => 'v');
    await cachedFetch('key', fetcher);
    await cachedFetch('key', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejected fetches and allows retry', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    await expect(cachedFetch('key', fetcher, { ttlMs: 5000 })).rejects.toThrow('boom');
    await expect(cachedFetch('key', fetcher, { ttlMs: 5000 })).resolves.toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keys are independent', async () => {
    const fetcherA = vi.fn(async () => 'a');
    const fetcherB = vi.fn(async () => 'b');
    await expect(cachedFetch('a', fetcherA, { ttlMs: 1000 })).resolves.toBe('a');
    await expect(cachedFetch('b', fetcherB, { ttlMs: 1000 })).resolves.toBe('b');
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  it('invalidateClientCache clears cached values', async () => {
    const fetcher = vi.fn(async () => 'v');
    await cachedFetch('key', fetcher, { ttlMs: 60_000 });
    invalidateClientCache();
    await cachedFetch('key', fetcher, { ttlMs: 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidateClientCache with prefix only clears matching keys', async () => {
    const filesFetcher = vi.fn(async () => 'files');
    const otherFetcher = vi.fn(async () => 'other');
    await cachedFetch('/api/files', filesFetcher, { ttlMs: 60_000 });
    await cachedFetch('/api/other', otherFetcher, { ttlMs: 60_000 });

    invalidateClientCache('/api/files');
    await cachedFetch('/api/files', filesFetcher, { ttlMs: 60_000 });
    await cachedFetch('/api/other', otherFetcher, { ttlMs: 60_000 });

    expect(filesFetcher).toHaveBeenCalledTimes(2);
    expect(otherFetcher).toHaveBeenCalledTimes(1);
  });

  it('a files-changed event invalidates cached values', async () => {
    const fetcher = vi.fn(async () => 'v');
    await cachedFetch('key', fetcher, { ttlMs: 60_000 });
    window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
    await cachedFetch('key', fetcher, { ttlMs: 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a files-changed event during an in-flight fetch prevents caching the stale result', async () => {
    let resolveFetch: (value: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((resolve) => { resolveFetch = resolve; }));

    const first = cachedFetch('key', fetcher, { ttlMs: 60_000 });
    window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
    resolveFetch('stale');
    await expect(first).resolves.toBe('stale');

    // The stale result must not have been written into the TTL cache.
    const second = cachedFetch('key', fetcher, { ttlMs: 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveFetch('fresh');
    await expect(second).resolves.toBe('fresh');
  });
});

describe('fetchAllFilePaths', () => {
  beforeEach(() => {
    resetClientCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches /api/files once for concurrent callers and caches the list', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ['a.md', 'b.md'],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([fetchAllFilePaths(), fetchAllFilePaths()]);
    expect(first).toEqual(['a.md', 'b.md']);
    expect(second).toEqual(['a.md', 'b.md']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/files');

    await fetchAllFilePaths(); // TTL hit
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects on non-OK response without caching', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ['a.md'] });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAllFilePaths()).rejects.toThrow();
    await expect(fetchAllFilePaths()).resolves.toEqual(['a.md']);
  });

  it('returns an empty list for a non-array response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ error: 'x' }) })));
    await expect(fetchAllFilePaths()).resolves.toEqual([]);
  });
});
