/**
 * Shared contract for the `mindos:files-changed` window event.
 *
 * Event detail is `{ paths?: string[] }` (CustomEvent). A plain Event (or an
 * empty/malformed paths array) means "anything may have changed" and listeners
 * must assume relevance. Listeners are expected to coalesce bursts (~300ms)
 * and skip work when paths are present but none are relevant to them.
 */

export const FILES_CHANGED_EVENT = 'mindos:files-changed';

export interface FilesChangedDetail {
  paths?: string[];
}

function normalizeChangedPaths(paths: readonly string[] | undefined): string[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  const normalized = paths
    .filter((p): p is string => typeof p === 'string')
    .map(p => p.trim())
    .filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

/**
 * Emit the shared `mindos:files-changed` event.
 *
 * Pass affected vault-relative paths when known so listeners can skip
 * unrelated refreshes. Omit paths to preserve the legacy "anything changed"
 * behavior.
 */
export function notifyFilesChanged(paths?: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeChangedPaths(paths);
  window.dispatchEvent(
    normalized
      ? new CustomEvent<FilesChangedDetail>(FILES_CHANGED_EVENT, { detail: { paths: normalized } })
      : new Event(FILES_CHANGED_EVENT),
  );
}

/**
 * Extract changed paths from a files-changed event.
 * Returns undefined when the event carries no usable path information,
 * which listeners must treat as "anything changed".
 */
export function getFilesChangedPaths(event: Event): string[] | undefined {
  const detail = (event as CustomEvent<FilesChangedDetail>).detail;
  if (!detail || !Array.isArray(detail.paths)) return undefined;
  const paths = detail.paths.filter((p): p is string => typeof p === 'string' && p.length > 0);
  return paths.length > 0 ? paths : undefined;
}

function normalizeVaultPath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

/** True when any changed path refers to the given vault-relative file. */
export function isPathAffected(paths: string[], target: string): boolean {
  const normalizedTarget = normalizeVaultPath(target);
  return paths.some((p) => normalizeVaultPath(p) === normalizedTarget);
}

/**
 * True when any changed path is the given directory or lives under it.
 * Case-insensitive so emitters with different casing conventions still match
 * (false positives only cause an extra refetch, never a missed update).
 */
export function isAnyPathUnder(paths: string[], dir: string): boolean {
  const normalizedDir = normalizeVaultPath(dir).replace(/\/+$/, '').toLowerCase();
  const prefix = `${normalizedDir}/`;
  return paths.some((p) => {
    const normalized = normalizeVaultPath(p).toLowerCase();
    return normalized === normalizedDir || normalized.startsWith(prefix);
  });
}

export interface FilesChangedSubscriptionOptions {
  /** Coalescing window for bursts of events (default 300ms, trailing edge). */
  debounceMs?: number;
  /**
   * Relevance filter, consulted only when every coalesced event carried paths.
   * Return false to skip the callback for that burst. Detail-less events
   * always fire the callback (backward compatible "anything changed").
   */
  isRelevant?: (paths: string[]) => boolean;
}

/**
 * Subscribe to `mindos:files-changed` with burst coalescing and optional
 * path-relevance filtering. Returns an unsubscribe function.
 *
 * The callback receives the union of paths seen during the coalescing window,
 * or undefined when at least one event did not declare paths.
 */
export function subscribeFilesChanged(
  onChange: (paths: string[] | undefined) => void,
  options: FilesChangedSubscriptionOptions = {},
): () => void {
  const { debounceMs = 300, isRelevant } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sawUnknownPaths = false;
  let pendingPaths = new Set<string>();

  const flush = () => {
    timer = null;
    const paths = sawUnknownPaths ? undefined : Array.from(pendingPaths);
    sawUnknownPaths = false;
    pendingPaths = new Set();
    if (paths && isRelevant && !isRelevant(paths)) return;
    onChange(paths);
  };

  const handler = (event: Event) => {
    const paths = getFilesChangedPaths(event);
    if (paths) {
      for (const p of paths) pendingPaths.add(p);
    } else {
      sawUnknownPaths = true;
    }
    // Trailing edge from the first event of a burst: guarantees delivery
    // within debounceMs even under a continuous stream of events.
    if (timer === null) timer = setTimeout(flush, debounceMs);
  };

  window.addEventListener(FILES_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(FILES_CHANGED_EVENT, handler);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export interface TrailingCoalescerOptions {
  /** Trailing-edge delay from the first schedule of a burst. */
  delayMs: number;
  /** Minimum time between two consecutive runs (default: delayMs). */
  minSpacingMs?: number;
}

export interface TrailingCoalescer {
  schedule: () => void;
  cancel: () => void;
}

/**
 * Coalesce rapid calls into a single trailing-edge invocation, with a minimum
 * spacing between consecutive runs. Used to throttle expensive work such as
 * `router.refresh()` (which re-serializes the whole RSC payload).
 */
export function createTrailingCoalescer(fn: () => void, options: TrailingCoalescerOptions): TrailingCoalescer {
  const { delayMs, minSpacingMs = options.delayMs } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRunAt = 0;

  const run = () => {
    timer = null;
    lastRunAt = Date.now();
    fn();
  };

  return {
    schedule() {
      if (timer !== null) return; // already pending — coalesce
      const sinceLastRun = Date.now() - lastRunAt;
      const delay = lastRunAt === 0 ? delayMs : Math.max(delayMs, minSpacingMs - sinceLastRun);
      timer = setTimeout(run, delay);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
