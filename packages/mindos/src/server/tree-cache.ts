import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import {
  MINDOS_ALLOWED_FILE_EXTENSIONS,
  MINDOS_IGNORED_DIRS,
  collectFileStatsFromMindRoot,
  type MindosRuntimeFileStat,
} from './mind-root-files.js';
import { MINDOS_IGNORE_FILE, createCachedMindosSearchIgnoreMatcher } from './search-ignore.js';

/**
 * Cached view over the mind root file tree shared by the standalone
 * (CLI/Desktop) server and the Web `lib/fs.ts` facade. Without this cache
 * every `/api/tree-version` read walked the entire library with a recursive
 * readdir + per-file stat. The cache rebuilds only when:
 *   - a recursive fs.watch event fires (darwin/win32, Linux on Node >= 20), or
 *   - `invalidate()` is called (internal structural writes), or
 *   - a safety TTL expires (short fallback TTL when no watcher is available,
 *     long TTL as a missed-event safety net when the watcher is active).
 *
 * Single-file changes never rebuild the whole tree: write paths call
 * `refreshPath()` and watcher events are batched (500ms) and applied per path
 * through the same routine. Only directory events, unknown filenames, an
 * oversized batch or a `.mindosignore` edit fall back to a full stat walk.
 *
 * Reads stay lazy. Push consumers (`GET /api/events`) call `subscribe()`; only
 * while at least one subscriber exists does the cache actively detect changes:
 * watcher events / `invalidate()` schedule a debounced rebuild and a periodic
 * sweep covers missed events. With zero subscribers no background work runs.
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
  /** Debounce between a change signal and the push rebuild. Default 300ms. */
  pushDebounceMs?: number;
  /**
   * While subscribers exist, rebuild on this cadence to catch watcher misses
   * (or the complete absence of a watcher). Default 30s, matching the watched
   * TTL so push mode costs no more than the polling it replaces.
   */
  sweepMs?: number;
  /** Debounce for batching raw watcher events before applying them. Default 500ms. */
  watchBatchDebounceMs?: number;
  /** Above this many distinct paths per batch a full rescan is cheaper. Default 50. */
  watchBatchLimit?: number;
};

export type TreeCachePathChange = 'added' | 'changed' | 'removed' | 'unchanged' | 'unknown';

export type TreeCacheFlushResult = {
  /** `none`: nothing relevant; `incremental`: per-path updates applied; `full`: marked dirty. */
  kind: 'none' | 'incremental' | 'full';
  changed: Array<{ path: string; change: Exclude<TreeCachePathChange, 'unchanged' | 'unknown'> }>;
};

export type MindRootTreeCache = {
  readonly root: string;
  getTreeVersion(): number;
  collectAllFiles(): string[];
  /** Cached per-file stats (path, mtime, size) for incremental consumers. */
  collectFileStats(): MindosRuntimeFileStat[];
  /** Cached stat of one file, or null when it is not part of the tree. */
  getFileStat(relativePath: string): MindosRuntimeFileStat | null;
  getRecentlyModified(limit?: number): Array<{ path: string; mtime: number }>;
  /** Mark the cache dirty; the next read rebuilds. Cheap and synchronous. */
  invalidate(): void;
  /**
   * Re-stat one relative path and patch the cached tree in place. Directories
   * (contents unknown) and unreadable paths mark the cache dirty instead.
   */
  refreshPath(relativePath: string): TreeCachePathChange;
  /**
   * Record a raw watcher event (relative path, or null when the platform did
   * not report one). Events are debounced and applied by `flushWatcherChanges`.
   */
  handleWatcherEvent(filename: string | Buffer | null | undefined): void;
  /** Apply the pending watcher batch now (also runs automatically after the debounce). */
  flushWatcherChanges(): TreeCacheFlushResult;
  /**
   * Receive the new tree version whenever a rebuild changes it. Subscribing
   * turns on active change detection (debounced rebuild + periodic sweep);
   * the returned function unsubscribes and, for the last subscriber, turns it
   * off again.
   */
  subscribe(listener: (version: number) => void): () => void;
  isWatching(): boolean;
  /** Start (or restart) the recursive watcher if the environment supports it. */
  startWatcher(): void;
  /** Stop the watcher and drop pending events; reads fall back to the TTL until `startWatcher()`. */
  stopWatcher(): void;
  /** Stop the watcher and push timers for good. The cache keeps working through the fallback TTL. */
  dispose(): void;
};

type TreeCacheState = {
  byPath: Map<string, MindosRuntimeFileStat>;
  files: string[];
  signature: string;
  version: number;
  builtAt: number;
};

const DEFAULT_FALLBACK_TTL_MS = 2_000;
const DEFAULT_WATCHED_TTL_MS = 30_000;
const DEFAULT_PUSH_DEBOUNCE_MS = 300;
const DEFAULT_SWEEP_MS = 30_000;
const DEFAULT_WATCH_BATCH_DEBOUNCE_MS = 500;
const DEFAULT_WATCH_BATCH_LIMIT = 50;

function signatureOf(byPath: Map<string, MindosRuntimeFileStat>): string {
  const lines: string[] = [];
  for (const entry of byPath.values()) lines.push(`${entry.path}\0${entry.mtime}\0${entry.size}`);
  return lines.sort().join('\n');
}

function sortedPaths(byPath: Map<string, MindosRuntimeFileStat>): string[] {
  return [...byPath.keys()].sort((a, b) => a.localeCompare(b));
}

function normalizeRelative(input: string): string {
  return input.split(sep).join('/').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function createMindRootTreeCache(
  mindRoot: string,
  options: MindRootTreeCacheOptions = {},
): MindRootTreeCache {
  const root = resolve(mindRoot);
  const fallbackTtlMs = options.fallbackTtlMs ?? DEFAULT_FALLBACK_TTL_MS;
  const watchedTtlMs = options.watchedTtlMs ?? DEFAULT_WATCHED_TTL_MS;
  const now = options.now ?? Date.now;
  const watchEnabled = options.watch !== false;
  const pushDebounceMs = options.pushDebounceMs ?? DEFAULT_PUSH_DEBOUNCE_MS;
  const sweepMs = options.sweepMs ?? DEFAULT_SWEEP_MS;
  const watchBatchDebounceMs = options.watchBatchDebounceMs ?? DEFAULT_WATCH_BATCH_DEBOUNCE_MS;
  const watchBatchLimit = options.watchBatchLimit ?? DEFAULT_WATCH_BATCH_LIMIT;

  let state: TreeCacheState | null = null;
  let dirty = false;
  let watcher: FSWatcher | null = null;
  let watcherBroken = false;
  let watcherStopped = false;
  let disposed = false;
  const subscribers = new Set<(version: number) => void>();
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

  // Raw watcher events are batched so a git pull touching hundreds of files
  // becomes one rescan while a single external save stays a single stat.
  let pending: Set<string> | null = null;
  let overflow = false;
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  function notifyIfChanged(): void {
    if (disposed || subscribers.size === 0) return;
    const before = state?.version;
    let version: number;
    try {
      version = ensure().version;
    } catch {
      // A failing rebuild (root vanished mid-scan) is retried by the next signal.
      return;
    }
    if (version === before) return;
    notifySubscribers(version);
  }

  function notifySubscribers(version: number): void {
    for (const listener of Array.from(subscribers)) {
      try {
        listener(version);
      } catch {
        // Push listeners are observers; a throwing one must not break the cache.
      }
    }
  }

  function schedulePush(): void {
    if (disposed || subscribers.size === 0 || pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      notifyIfChanged();
    }, pushDebounceMs);
    pushTimer.unref?.();
  }

  function startSweep(): void {
    if (sweepTimer || disposed) return;
    sweepTimer = setInterval(() => {
      // ensure() decides whether a rescan is due (dirty or TTL expired); the
      // sweep only guarantees somebody asks while subscribers exist.
      notifyIfChanged();
    }, sweepMs);
    sweepTimer.unref?.();
  }

  function stopPushTimers(): void {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  function ensureWatcher(): void {
    if (!watchEnabled || disposed || watcherBroken || watcherStopped || watcher) return;
    if (!existsSync(root)) return; // retried on the next rebuild once the root exists
    try {
      watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        handleWatcherEvent(filename);
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

  function clearBatch(): void {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    pending = null;
    overflow = false;
  }

  function scheduleBatchFlush(): void {
    if (disposed) return;
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
      batchTimer = null;
      flushWatcherChanges();
    }, watchBatchDebounceMs);
    batchTimer.unref?.();
  }

  function handleWatcherEvent(filename: string | Buffer | null | undefined): void {
    if (disposed) return;
    if (filename == null) {
      overflow = true;
      scheduleBatchFlush();
      return;
    }
    const rel = normalizeRelative(String(filename));
    if (rel === MINDOS_IGNORE_FILE) {
      // Ignore rules changed: only a full rescan can apply them.
      overflow = true;
      scheduleBatchFlush();
      return;
    }
    if (!rel || isIgnoredPath(root, rel)) return;
    if (!pending) pending = new Set();
    pending.add(rel);
    if (pending.size > watchBatchLimit) overflow = true;
    scheduleBatchFlush();
  }

  function flushWatcherChanges(): TreeCacheFlushResult {
    const batch = pending;
    const full = overflow;
    clearBatch();
    if (!batch && !full) return { kind: 'none', changed: [] };
    if (full || !batch || !state) {
      markDirty();
      return { kind: 'full', changed: [] };
    }
    const changed: TreeCacheFlushResult['changed'] = [];
    for (const rel of batch) {
      const change = refreshPath(rel);
      if (change === 'unknown') {
        markDirty();
        return { kind: 'full', changed: [] };
      }
      if (change !== 'unchanged') changed.push({ path: rel, change });
    }
    return { kind: changed.length > 0 ? 'incremental' : 'none', changed };
  }

  function markDirty(): void {
    dirty = true;
    schedulePush();
  }

  function refreshPath(relativePath: string): TreeCachePathChange {
    const rel = normalizeRelative(relativePath);
    if (!rel || rel === '.') {
      markDirty();
      return 'unknown';
    }
    if (!state) {
      // Nothing cached yet: the first read builds from disk anyway.
      dirty = true;
      return 'unknown';
    }
    if (rel === MINDOS_IGNORE_FILE) {
      markDirty();
      return 'unknown';
    }
    if (isIgnoredPath(root, rel)) return 'unchanged';

    let stat: ReturnType<typeof statSync> | null = null;
    try {
      stat = statSync(join(root, rel));
    } catch {
      stat = null;
    }
    if (stat && !stat.isFile()) {
      // Directory (rename/move of a subtree) or special file: contents unknown.
      markDirty();
      return 'unknown';
    }
    const existing = state.byPath.get(rel);
    if (!stat || !MINDOS_ALLOWED_FILE_EXTENSIONS.has(extname(rel).toLowerCase())) {
      if (!existing) return 'unchanged';
      state.byPath.delete(rel);
      commitPatch(existing.mtime);
      return 'removed';
    }
    const next: MindosRuntimeFileStat = { path: rel, mtime: stat.mtimeMs, size: stat.size };
    if (existing && existing.mtime === next.mtime && existing.size === next.size) return 'unchanged';
    state.byPath.set(rel, next);
    commitPatch(next.mtime);
    return existing ? 'changed' : 'added';
  }

  /** Recompute derived state after a single-path patch; versions stay monotonic. */
  function commitPatch(mtime: number): void {
    if (!state) return;
    state.files = sortedPaths(state.byPath);
    state.signature = signatureOf(state.byPath);
    state.version = Math.max(Math.floor(mtime), state.version + 1);
    if (subscribers.size > 0) notifySubscribers(state.version);
  }

  function ensure(): TreeCacheState {
    ensureWatcher();
    const ttl = watcher ? watchedTtlMs : fallbackTtlMs;
    if (state && !dirty && now() - state.builtAt < ttl) return state;

    const byPath = new Map<string, MindosRuntimeFileStat>();
    let maxMtime = 0;
    for (const entry of collectFileStatsFromMindRoot(root)) {
      byPath.set(entry.path, entry);
      maxMtime = Math.max(maxMtime, Math.floor(entry.mtime));
    }
    const signature = signatureOf(byPath);

    // First build matches the uncached semantics (max mtime, 0 for empty/missing
    // roots). Later rebuilds stay monotonic: deletions and renames must bump the
    // version even though they can lower the max mtime.
    const version = !state
      ? maxMtime
      : state.signature === signature
        ? state.version
        : Math.max(maxMtime, state.version + 1);

    dirty = false;
    state = { byPath, files: sortedPaths(byPath), signature, version, builtAt: now() };
    return state;
  }

  return {
    root,
    getTreeVersion() {
      return ensure().version;
    },
    collectAllFiles() {
      return [...ensure().files];
    },
    collectFileStats() {
      return [...ensure().byPath.values()].map((entry) => ({ ...entry }));
    },
    getFileStat(relativePath) {
      const entry = ensure().byPath.get(normalizeRelative(relativePath));
      return entry ? { ...entry } : null;
    },
    getRecentlyModified(limit = 10) {
      const boundedLimit = Math.max(1, Math.min(limit, 30));
      return [...ensure().byPath.values()]
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, boundedLimit)
        .map((entry) => ({ path: entry.path, mtime: entry.mtime }));
    },
    invalidate() {
      markDirty();
    },
    refreshPath,
    handleWatcherEvent,
    flushWatcherChanges,
    subscribe(listener) {
      subscribers.add(listener);
      startSweep();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(listener);
        if (subscribers.size === 0) stopPushTimers();
      };
    },
    isWatching() {
      return watcher !== null;
    },
    startWatcher() {
      watcherStopped = false;
      ensureWatcher();
    },
    stopWatcher() {
      watcherStopped = true;
      clearBatch();
      closeWatcher();
    },
    dispose() {
      disposed = true;
      stopPushTimers();
      clearBatch();
      subscribers.clear();
      closeWatcher();
    },
  };
}

// The matcher re-reads .mindosignore; this runs once per fs event, and a git
// pull touching thousands of files would otherwise re-read it thousands of
// times on the event loop. The cache lives in search-ignore.ts and is keyed by
// the ignore file's mtime + size.
function isIgnoredPath(root: string, filename: string): boolean {
  if (filename === MINDOS_IGNORE_FILE) return false;
  const normalized = filename.split(sep).join('/');
  try {
    return createCachedMindosSearchIgnoreMatcher(root, MINDOS_IGNORED_DIRS)(normalized);
  } catch {
    // Fallback keeps watcher noise bounded even if the root disappears.
  }
  const firstSegment = filename.split(sep)[0]?.split('/')[0] ?? '';
  return MINDOS_IGNORED_DIRS.has(firstSegment);
}

// ── Per-root registry ───────────────────────────────────────────────────

const treeCaches = new Map<string, MindRootTreeCache>();

/**
 * Shared cache per resolved mind root so the Web facade and the search index
 * observe one tree. Options only apply when the instance is created.
 */
export function getMindRootTreeCache(mindRoot: string, options?: MindRootTreeCacheOptions): MindRootTreeCache {
  const root = resolve(mindRoot);
  let cache = treeCaches.get(root);
  if (!cache) {
    cache = createMindRootTreeCache(root, options);
    treeCaches.set(root, cache);
  }
  return cache;
}

export function resetMindRootTreeCachesForTests(): void {
  for (const cache of treeCaches.values()) cache.dispose();
  treeCaches.clear();
}
