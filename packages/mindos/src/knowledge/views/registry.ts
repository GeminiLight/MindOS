import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { checkedPath, safeFolder } from "./paths.js";
import { documentRevision, validateId, validateText } from "./markdown.js";
import {
  ViewError,
  type ViewDefinition,
  type CollectionDefinition,
} from "./types.js";
export type ViewRegistry = {
  schemaVersion: 2;
  views: ViewDefinition[];
  collections: CollectionDefinition[];
};
function normalize(registry: ViewRegistry): ViewRegistry {
  registry.collections ??= [];
  for (const v of registry.views) {
    let c = registry.collections.find(
      (c) => c.folder === v.folder && c.template === v.template,
    );
    if (!c) {
      c = {
        id: "c-" + documentRevision(v.template + ":" + v.folder).slice(0, 24),
        folder: v.folder,
        template: v.template,
        schemaVersion: 1,
      };
      registry.collections.push(c);
    }
    v.collectionId = c.id;
    if (v.spec) v.spec.collectionId = c.id;
  }
  return registry;
}
const REGISTRY = ".mindos/views/index.json";
const LOCK = ".mindos/views/registry.lock";
export function readRegistry(root: string): ViewRegistry {
  const file = checkedPath(root, REGISTRY);
  if (!existsSync(file))
    return { schemaVersion: 2, views: [], collections: [] };
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error();
    const raw = JSON.parse(readFileSync(file, "utf8")) as ViewRegistry;
    if (
      ![1, 2].includes(raw.schemaVersion) ||
      !Array.isArray(raw.views) ||
      raw.views.length > 500
    )
      throw new Error();
    const seen = new Set<string>();
    for (const v of raw.views) {
      validateId(v.id);
      validateText(v.name, "View name", 80, true, true);
      safeFolder(root, v.folder, false);
      if (
        !["people", "tasks"].includes(v.template) ||
        !Number.isInteger(v.version) ||
        v.version < 1 ||
        seen.has(v.id) ||
        !Number.isFinite(Date.parse(v.createdAt)) ||
        !Number.isFinite(Date.parse(v.updatedAt))
      )
        throw new Error();
      seen.add(v.id);
    }
    if (
      raw.schemaVersion === 2 &&
      (!Array.isArray(raw.collections) || raw.collections.length > 500)
    )
      throw new Error();
    for (const c of raw.collections ?? []) {
      validateId(c.id);
      safeFolder(root, c.folder, false);
      if (!["people", "tasks"].includes(c.template) || c.schemaVersion !== 1)
        throw new Error();
    }
    return normalize({ ...raw, schemaVersion: 2 });
  } catch {
    throw new ViewError(
      "REGISTRY_UNREADABLE",
      "The view registry is unreadable; the original was preserved",
      500,
    );
  }
}
function writeRegistry(root: string, registry: ViewRegistry): void {
  const file = checkedPath(root, REGISTRY);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  normalize(registry);
  const serialized = JSON.stringify(registry, null, 2) + "\n";
  if (Buffer.byteLength(serialized) > 1024 * 1024)
    throw new ViewError("REGISTRY_LIMIT", "View registry exceeds 1 MiB", 413);
  if (existsSync(file)) {
    const previous = readFileSync(file, "utf8");
    if (JSON.parse(previous).schemaVersion === 1) {
      const backup = checkedPath(root, ".mindos/views/registry-v1.backup.json");
      if (!existsSync(backup))
        writeFileSync(backup, previous, { flag: "wx", mode: 0o600 });
    }
  }
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, checkedPath(root, REGISTRY));
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Preserve the original state when no temporary file is present. */
    }
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
/** A bounded cross-process metadata lock. It never covers unrelated knowledge writes. */
export async function withRegistry<T>(
  root: string,
  operation: (registry: ViewRegistry) => Promise<T> | T,
): Promise<T> {
  const file = checkedPath(root, LOCK);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    try {
      writeFileSync(
        file,
        JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }),
        { flag: "wx", mode: 0o600 },
      );
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (!lstatSync(file).isFile())
          throw new ViewError(
            "ACCESS_DENIED",
            "The metadata lock is not an ordinary file",
            403,
          );
        const lock = JSON.parse(readFileSync(file, "utf8")) as {
          pid: number;
          createdAt: number;
        };
        if (
          Number.isInteger(lock.pid) &&
          !alive(lock.pid) &&
          Date.now() - lock.createdAt > 2000
        ) {
          unlinkSync(file);
          continue;
        }
      } catch (err) {
        if (err instanceof ViewError) throw err;
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      }
      if (Date.now() - started > 3000)
        throw new ViewError(
          "VIEW_BUSY",
          "Another process is updating views. Retry shortly",
          409,
        );
      await wait(15);
    }
  }
  try {
    const registry = readRegistry(root);
    const before = JSON.stringify(registry);
    const result = await operation(registry);
    if (JSON.stringify(registry) !== before) writeRegistry(root, registry);
    return result;
  } finally {
    try {
      const lock = JSON.parse(readFileSync(file, "utf8")) as { token?: string };
      if (lock.token === token) unlinkSync(file);
    } catch {
      /* Preserve the original state when no temporary file is present. */
    }
  }
}
