import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { MINDOS_IGNORED_DIRS, collectFileStatsFromMindRoot } from './runtime.js';
import { MINDOS_IGNORE_FILE, createMindosSearchIgnoreMatcher } from './search-ignore.js';

/**
 * Cached view over the mind root file tree for the standalone (CLI/Desktop)
 * server. The frontend polls `/api/tree-version` every ~5s; without this cache
 * every poll walked the entire library with a recursive readdir + per-file
 * stat. The cache rebuilds only when:
 *   - a recursive fs.watch event fires (darwin/win32, Linux on Node >= 20), or
 *   - `invalidate()` is called (internal writes via the HTTP server), or
 *   - a safety TTL expires (short fallback TTL when no watcher is available,
 *     long TTL as a missed-event safety net when the watcher is active).
 */

export type MindRootTreeCacheOptions = {
  /** Refresh interval when no recursive watcher could be installed. Default 2s. */
  fallbackTtlMs?: number;
  /** Safety refresh interval while the watcher is active. Default 30s. */
  watchedTtlMs?: number;
  /** Set false to disable the fs watcher (tests, constrained environments). Default true. */
  watch?: boolean;
  /** Clock injection for deterministic TTL tests. */
  now?: () => number;
};

export type MindRootTreeCache = {
  getTreeVersion(): number;
  collectAllFiles(): string[];
  /** Cached per-file stats (path, mtime, size) for incremental consumers. */
  collectFileStats(): Array<{ path: string; mtime: number; size: number }>;
  getRecentlyModified(limit?: number): Array<{ path: string; mtime: number }>;
  /** Mark the cache dirty; the next read rebuilds. Cheap and synchronous. */
  invalidate(): void;
  isWatching(): boolean;
  /** Stop the watcher. The cache keeps working through the fallback TTL. */
  dispose(): void;
};

type TreeCacheState = {
  stats: Array<{ path: string; mtime: number; size: number }>;
  files: string[];
  signature: string;
  version: number;
  builtAt: number;
};

const DEFAULT_FALLBACK_TTL_MS = 2_000;
const DEFAULT_WATCHED_TTL_MS = 30_000;

export function createMindRootTreeCache(
  mindRoot: string,
  options: MindRootTreeCacheOptions = {},
): MindRootTreeCache {
  const root = resolve(mindRoot);
  const fallbackTtlMs = options.fallbackTtlMs ?? DEFAULT_FALLBACK_TTL_MS;
  const watchedTtlMs = options.watchedTtlMs ?? DEFAULT_WATCHED_TTL_MS;
  const now = options.now ?? Date.now;
  const watchEnabled = options.watch !== false;

  let state: TreeCacheState | null = null;
  let dirty = false;
  let watcher: FSWatcher | null = null;
  let watcherBroken = false;
  let disposed = false;

  function onWatchEvent(filename: string | Buffer | null): void {
    if (typeof filename === 'string' && isIgnoredPath(root, filename)) return;
    dirty = true;
  }

  function ensureWatcher(): void {
    if (!watchEnabled || disposed || watcherBroken || watcher) return;
    if (!existsSync(root)) return; // retried on the next rebuild once the root exists
    try {
      watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        onWatchEvent(filename);
      });
      watcher.on('error', () => {
        // Watcher died (root removed, fd exhaustion, ...) — fall back to TTL refreshes.
        closeWatcher();
        watcherBroken = true;
        dirty = true;
      });
      watcher.unref?.();
    } catch {
      // Recursive watch unsupported (e.g. older Linux) — fall back to TTL refreshes.
      watcher = null;
      watcherBroken = true;
    }
  }

  function closeWatcher(): void {
    try {
      watcher?.close();
    } catch {
      // Closing an already-dead watcher must never break request handling.
    }
    watcher = null;
  }

  function ensure(): TreeCacheState {
    ensureWatcher();
    const ttl = watcher ? watchedTtlMs : fallbackTtlMs;
    if (state && !dirty && now() - state.builtAt < ttl) return state;

    const stats = collectFileStatsFromMindRoot(root);
    const files = stats.map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
    const signature = stats
      .map((entry) => `${entry.path}\0${entry.mtime}`)
      .sort()
      .join('\n');

    let maxMtime = 0;
    for (const entry of stats) maxMtime = Math.max(maxMtime, Math.floor(entry.mtime));

    // First build matches the uncached semantics (max mtime, 0 for empty/missing
    // roots). Later rebuilds stay monotonic: deletions and renames must bump the
    // version even though they can lower the max mtime.
    const version = !state
      ? maxMtime
      : state.signature === signature
        ? state.version
        : Math.max(maxMtime, state.version + 1);

    dirty = false;
    state = { stats, files, signature, version, builtAt: now() };
    return state;
  }

  return {
    getTreeVersion() {
      return ensure().version;
    },
    collectAllFiles() {
      return [...ensure().files];
    },
    collectFileStats() {
      return ensure().stats.map((entry) => ({ ...entry }));
    },
    getRecentlyModified(limit = 10) {
      const boundedLimit = Math.max(1, Math.min(limit, 30));
      return [...ensure().stats]
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, boundedLimit)
        .map((entry) => ({ ...entry }));
    },
    invalidate() {
      dirty = true;
    },
    isWatching() {
      return watcher !== null;
    },
    dispose() {
      disposed = true;
      closeWatcher();
    },
  };
}

// The matcher re-reads .mindosignore; this runs once per fs event, and a git
// pull touching thousands of files would otherwise re-read it thousands of
// times on the event loop. Cache per root, keyed by the ignore file's mtime.
const ignoreMatcherCache = new Map<string, { key: string; matcher: (relativePath: string) => boolean }>();

function ignoreMatcherFor(root: string): (relativePath: string) => boolean {
  let key = 'missing';
  try {
    const stat = statSync(join(root, MINDOS_IGNORE_FILE));
    key = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    // No ignore file: only the built-in directory list applies.
  }
  const cached = ignoreMatcherCache.get(root);
  if (cached && cached.key === key) return cached.matcher;
  const matcher = createMindosSearchIgnoreMatcher(root, MINDOS_IGNORED_DIRS);
  ignoreMatcherCache.set(root, { key, matcher });
  return matcher;
}

function isIgnoredPath(root: string, filename: string): boolean {
  if (filename === MINDOS_IGNORE_FILE) return false;
  const normalized = filename.split(sep).join('/');
  try {
    return ignoreMatcherFor(root)(normalized);
  } catch {
    // Fallback keeps watcher noise bounded even if the root disappears.
  }
  const firstSegment = filename.split(sep)[0]?.split('/')[0] ?? '';
  return MINDOS_IGNORED_DIRS.has(firstSegment);
}
