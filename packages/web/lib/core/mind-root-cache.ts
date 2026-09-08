import path from 'path';
import { getMindRootTreeCache, type MindRootTreeCache } from '@geminilight/mindos/server';

/**
 * Web view of the core mind-root tree cache (`@geminilight/mindos/server`).
 * One instance per resolved root is shared by `lib/fs.ts` (file tree, versions,
 * watcher entry points) and `lib/core/search.ts` (file stats for the search
 * index), so both observe the same tree and the same version counter.
 */

/** Web keeps the TTLs it used before the cache moved into the core package. */
export const WEB_TREE_CACHE_OPTIONS = {
  /** No recursive watcher available: rescan at most every 30s on read. */
  fallbackTtlMs: 30_000,
  /** Watcher active: safety rescan every 5 minutes. */
  watchedTtlMs: 5 * 60_000,
  /** Push subscribers (SSE) get a missed-event sweep once a minute. */
  sweepMs: 60_000,
  /**
   * Read the clock at call time (not a captured `Date.now` reference) so
   * `vi.useFakeTimers()` / `vi.setSystemTime()` in the Web suites drive the TTLs.
   */
  now: () => Date.now(),
} as const;

/** Root-level files the Web search never indexes (system scaffolding). */
export const ROOT_SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md', 'CONFIG.json', 'CHANGELOG.md']);

export function isRootSystemFile(relativePath: string): boolean {
  return !relativePath.includes('/') && ROOT_SYSTEM_FILES.has(relativePath);
}

export function getWebTreeCache(mindRoot: string): MindRootTreeCache {
  return getMindRootTreeCache(path.resolve(mindRoot), WEB_TREE_CACHE_OPTIONS);
}
