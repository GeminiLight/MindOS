/**
 * Coalesced emitter for the cross-component "mindos:files-changed" event.
 *
 * Event contract (shared with listeners in SidebarLayout / InboxView / panels):
 * CustomEvent detail is `{ paths?: string[] }`. Emitters include affected
 * paths when known and MUST coalesce bursts — during a streaming run, multiple
 * file writes become one event carrying all paths (debounced ~300ms and
 * flushed at run end). No detail/paths means "unknown, assume anything
 * changed" (backward compatible with the legacy plain Event emitters).
 */

export const FILES_CHANGED_EVENT = 'mindos:files-changed';

const FLUSH_DELAY_MS = 300;

let pendingPaths = new Set<string>();
let pendingUnknown = false;
let hasPending = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Queue a files-changed notification. Pass the affected paths when known;
 * omit (or pass an empty array) to signal "unknown, assume anything changed".
 * Bursts are batched into a single event after a short delay — call
 * {@link flushFilesChanged} at run end to deliver immediately.
 */
export function queueFilesChanged(paths?: readonly string[]): void {
  if (typeof window === 'undefined') return;
  hasPending = true;
  if (!paths || paths.length === 0) {
    pendingUnknown = true;
  } else if (!pendingUnknown) {
    for (const path of paths) {
      if (typeof path === 'string' && path.trim()) pendingPaths.add(path);
    }
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushFilesChanged();
    }, FLUSH_DELAY_MS);
  }
}

/** Deliver any queued notification immediately (one event for the whole batch). */
export function flushFilesChanged(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!hasPending || typeof window === 'undefined') return;
  // All-blank path batches degrade to "unknown" — never emit an empty list,
  // listeners would interpret it as "nothing changed".
  const detail = pendingUnknown || pendingPaths.size === 0
    ? undefined
    : { paths: Array.from(pendingPaths) };
  hasPending = false;
  pendingUnknown = false;
  pendingPaths = new Set();
  window.dispatchEvent(
    detail ? new CustomEvent(FILES_CHANGED_EVENT, { detail }) : new CustomEvent(FILES_CHANGED_EVENT),
  );
}

export function resetFilesChangedEmitterForTests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingPaths = new Set();
  pendingUnknown = false;
  hasPending = false;
}
