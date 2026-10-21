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
