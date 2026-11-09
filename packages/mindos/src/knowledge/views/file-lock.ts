import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  lstatSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { checkedPath } from "./paths.js";
import { ViewError } from "./types.js";
const held = new AsyncLocalStorage<Set<string>>();
/** Reentrancy for the synchronous variant: a sync stack cannot interleave. */
const heldSync = new Set<string>();

/**
 * The lock file both variants contend on.
 *
 * Exported so a writer that cannot be async still competes for the *same* lock.
 * Two correct locks on different paths give no mutual exclusion at all, which is
 * how an agent capturing a preference could interleave with an Echo promotion
 * writing the same file.
 */
export function fileMutationLockPath(root: string, path: string): string {
  return checkedPath(
    root,
    ".mindos/views/locks/" +
      createHash("sha256").update(checkedPath(root, path)).digest("hex") +
      ".lock",
  );
}

/**
 * Synchronous counterpart of `withFileMutation`, for write paths that are sync
 * end to end (Echo promotion is, and making it async would ripple through three
 * callers). Same lock file, same stale-owner reclaim, so the two serialize
 * against each other.
 *
 * Must not be called while the async variant holds the same path in this
 * process: the spin here never yields, so it could not observe the release.
 */
export function withFileMutationSync<T>(root: string, path: string, fn: () => T): T {
  const key = checkedPath(root, path);
  if (heldSync.has(key)) return fn();
  const file = fileMutationLockPath(root, path);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const start = Date.now();
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify({ token, pid: process.pid, time: Date.now() }), { flag: "wx", mode: 0o600 });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (reclaimDeadOwner(file)) continue;
      if (Date.now() - start > 5000) {
        throw new ViewError("OPERATION_PENDING", "Another writer is active; retry the same operation", 409);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  heldSync.add(key);
  try {
    return fn();
  } finally {
    heldSync.delete(key);
    try {
      if (JSON.parse(readFileSync(file, "utf8")).token === token) unlinkSync(file);
    } catch {
      /* Retain unrelated lock. */
    }
  }
}

/** True when a stale lock was removed and the caller should retry immediately. */
function reclaimDeadOwner(file: string): boolean {
  try {
    if (!lstatSync(file).isFile()) throw new ViewError("ACCESS_DENIED", "Invalid mutation lock", 403);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  try {
    const lock = JSON.parse(readFileSync(file, "utf8"));
    if (Number.isInteger(lock.pid) && Date.now() - lock.time > 2000) {
      try {
        process.kill(lock.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") {
          unlinkSync(file);
          return true;
        }
      }
    }
  } catch {
    /* Malformed locks are retained for inspection. */
  }
  return false;
}
/** Reentrant only within this async operation; independent requests/processes contend. */
export async function withFileMutation<T>(
  root: string,
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = checkedPath(root, path);
  if (held.getStore()?.has(key)) return fn();
  const file = checkedPath(
    root,
    ".mindos/views/locks/" +
      createHash("sha256").update(key).digest("hex") +
      ".lock",
  );
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const token = randomUUID(),
    start = Date.now();
  for (;;) {
    try {
      writeFileSync(
        file,
        JSON.stringify({ token, pid: process.pid, time: Date.now() }),
        { flag: "wx", mode: 0o600 },
      );
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (!lstatSync(file).isFile())
          throw new ViewError("ACCESS_DENIED", "Invalid mutation lock", 403);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      try {
        const lock = JSON.parse(readFileSync(file, "utf8"));
        if (Number.isInteger(lock.pid) && Date.now() - lock.time > 2000) {
          try {
            process.kill(lock.pid, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ESRCH") {
              unlinkSync(file);
              continue;
            }
          }
        }
      } catch {
        /* Malformed locks are retained for inspection. */
      }
      if (Date.now() - start > 5000)
        throw new ViewError(
          "OPERATION_PENDING",
          "Another writer is active; retry the same operation",
          409,
        );
      await wait(15);
    }
  }
  try {
    return await held.run(new Set([...(held.getStore() ?? []), key]), fn);
  } finally {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).token === token)
        unlinkSync(file);
    } catch {
      /* Retain unrelated lock. */
    }
  }
}
