import type { AgentRunCapsule } from './types.js';

/**
 * Async write queue backing the capsule store (`store.ts`).
 *
 * Capsule persistence used to run structuredClone + JSON.stringify +
 * writeFileSync + link synchronously inside `createAgentRunCapsule`, before
 * the lane could emit the first SSE byte (10-25ms for a ~6MB chat). The public
 * store functions stay synchronous — lane callers do not await them — but the
 * disk work is queued here on a per-capsule promise chain:
 *
 *   create(id) ──▶ [ chain(id): serialize → mkdir → exclusive write → settle ]
 *   finalize(id) ─▶ [ chain(id): ... queued after create, same file ]
 *
 * While a write is pending, an in-memory overlay (`pendingCapsules`) serves
 * same-process reads (get/list/finalize/recovery plans) so read-after-write
 * semantics are unchanged. `flushCapsuleWrites(id)` awaits one chain (tests,
 * durability-sensitive callers); a `process.on('exit')` hook performs a
 * synchronous best-effort flush so a clean shutdown never drops a captured
 * capsule (SIGKILL cannot be covered — the loss window is the queue latency).

 * Capsule ids are unique per run, so chains are keyed by id alone; the jobs
 * close over their own mindRoot/file.
 */

export type PendingCapsuleEntry = {
  mindRootKey: string;
  file: string;
  /** Latest in-memory state for this capsule (create, then each finalize). */
  capsule: AgentRunCapsule;
  /** True once this exact state is known to be on disk (sync exit fallback). */
  landed: boolean;
};

const pendingCapsules = new Map<string, PendingCapsuleEntry>();
const capsuleWriteChains = new Map<string, Promise<void>>();
const capsuleWriteErrors = new Map<string, Error>();
const cancelledCapsuleWrites = new Set<string>();
let capsuleExitHookArmed = false;
let syncFallbackWriter: ((entry: PendingCapsuleEntry) => void) | undefined;

/** Registers the synchronous last-chance writer used by the `exit` hook. */
export function setCapsuleWriteSyncFallback(writer: (entry: PendingCapsuleEntry) => void): void {
  syncFallbackWriter = writer;
}

/**
 * Cancels the queued write for one capsule and drops its overlay state. Used
 * when the on-disk anchor was deleted behind the store's back (finalize then
 * fails with not-found): the in-flight write must not resurrect the capsule.
 */
export function cancelQueuedCapsuleWrite(id: string): void {
  cancelledCapsuleWrites.add(id);
  pendingCapsules.delete(id);
}

export function isCapsuleWriteCancelled(id: string): boolean {
  return cancelledCapsuleWrites.has(id);
}

export function clearCapsuleWriteCancel(id: string): void {
  cancelledCapsuleWrites.delete(id);
}

export function getPendingCapsule(id: string): PendingCapsuleEntry | undefined {
  return pendingCapsules.get(id);
}

export function setPendingCapsule(id: string, entry: PendingCapsuleEntry): void {
  pendingCapsules.set(id, entry);
}

/** Drops the overlay entry unless a newer state (later finalize) owns it. */
export function clearPendingCapsule(id: string, capsule: AgentRunCapsule): void {
  const current = pendingCapsules.get(id);
  if (current && current.capsule === capsule) pendingCapsules.delete(id);
}

/** Drops the overlay entry unconditionally (failed write: nothing is durable). */
export function dropPendingCapsule(id: string): void {
  pendingCapsules.delete(id);
}

export function pendingCapsuleEntries(): IterableIterator<[string, PendingCapsuleEntry]> {
  return pendingCapsules.entries();
}

export function enqueueCapsuleWrite(id: string, job: () => Promise<void>): void {
  const previous = capsuleWriteChains.get(id) ?? Promise.resolve();
  const tail = previous.then(job).catch((error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    capsuleWriteErrors.set(id, normalized);
    // A failed write must not keep being served from the overlay as if it were
    // durable: drop the pending state so reads fall back to disk.
    pendingCapsules.delete(id);
    console.error(`[agent-capsules] queued write failed for ${id}: ${normalized.message}`);
  });
  capsuleWriteChains.set(id, tail);
  void tail.then(() => {
    if (capsuleWriteChains.get(id) === tail) capsuleWriteChains.delete(id);
  });
  if (!capsuleExitHookArmed) {
    capsuleExitHookArmed = true;
    process.on('exit', () => {
      try {
        writePendingCapsuleWritesSync();
      } catch {
        // Best effort: the process is exiting.
      }
    });
  }
}

/**
 * Awaits every queued write for one capsule/run id. Rejects with the recorded
 * error when a queued write failed (and clears it), so tests and durability-
 * sensitive callers can assert on it.
 */
export async function flushCapsuleWrites(runId: string): Promise<void> {
  await (capsuleWriteChains.get(runId) ?? Promise.resolve());
  const error = capsuleWriteErrors.get(runId);
  if (error) {
    capsuleWriteErrors.delete(runId);
    throw error;
  }
}

/** Awaits every queued capsule write across all runs and roots (test helper). */
export async function flushAllCapsuleWrites(): Promise<void> {
  while (capsuleWriteChains.size > 0) {
    await Promise.allSettled([...capsuleWriteChains.values()]);
  }
  // Teardown helper: recorded failures were already logged; drop them so they
  // cannot leak into a later flushCapsuleWrites(id) for a recycled id.
  capsuleWriteErrors.clear();
}

/**
 * Process-exit fallback: synchronously writes every capsule state that has not
 * landed yet, best effort per entry.
 */
export function writePendingCapsuleWritesSync(): void {
  if (!syncFallbackWriter) return;
  for (const pending of pendingCapsules.values()) {
    if (pending.landed) continue;
    try {
      syncFallbackWriter(pending);
      pending.landed = true;
    } catch {
      // Best effort; the in-process overlay already served this state to reads.
    }
  }
}
