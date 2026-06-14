import { apiFetch } from './api';
import { cachedFetch, invalidateClientCache } from './client-cache';
import type { BacklinkItem } from './types';

const BACKLINKS_CACHE_KEY_PREFIX = '/api/backlinks?path=';
const BACKLINKS_CACHE_TTL_MS = 30_000;

function backlinksCacheKey(filePath: string): string {
  return `${BACKLINKS_CACHE_KEY_PREFIX}${encodeURIComponent(filePath)}`;
}

export function fetchBacklinks(filePath: string): Promise<BacklinkItem[]> {
  const key = backlinksCacheKey(filePath);
  return cachedFetch<BacklinkItem[]>(
    key,
    async () => {
      const data = await apiFetch<BacklinkItem[]>(key);
      return Array.isArray(data) ? data : [];
    },
    { ttlMs: BACKLINKS_CACHE_TTL_MS },
  );
}

export function clearBacklinksCacheForTests(): void {
  invalidateClientCache(BACKLINKS_CACHE_KEY_PREFIX);
}
