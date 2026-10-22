import { watch, readFileSync, statSync, type FSWatcher } from "node:fs";
import { checkedPath } from "./paths.js";
import { documentRevision } from "./markdown.js";
/** Hidden metadata has its own bounded fingerprint fallback; tree watchers may ignore it. */
export function watchViews(
  root: string,
  emit: (event: {
    type: "views.changed";
    rootId: string;
    registryRevision: string;
  }) => void,
  interval = 1000,
) {
  const files = [
    { path: checkedPath(root, ".mindos/views/index.json"), max: 1024 * 1024 },
    {
      path: checkedPath(root, ".mindos/views/pages.json"),
      max: 16 * 1024 * 1024,
    },
  ];
  const cached = new Map<string, { stamp: string; revision: string }>();
  const fingerprint = () =>
    files
      .map(({ path, max }) => {
        try {
          const stat = statSync(path);
          if (stat.size > max) return "oversized";
          // Atomic replacements change inode; unchanged metadata avoids hashing large page histories every second.
          const stamp = [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(
            ":",
          );
          const previous = cached.get(path);
          if (previous?.stamp === stamp) return previous.revision;
          const revision = documentRevision(readFileSync(path, "utf8"));
          cached.set(path, { stamp, revision });
          return revision;
        } catch {
          cached.delete(path);
          return "unavailable";
        }
      })
      .join(":");
  let last = fingerprint(),
    watcher: FSWatcher | undefined;
  const check = () => {
    const next = fingerprint();
    if (next !== last) {
      last = next;
      emit({
        type: "views.changed",
        rootId: documentRevision(root).slice(0, 24),
        registryRevision: next,
      });
    }
  };
  try {
    watcher = watch(checkedPath(root, ".mindos/views"), check);
    watcher.on("error", () => watcher?.close());
  } catch {
    /* Directory can be created after subscription. */
  }
  const timer = setInterval(check, interval);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    watcher?.close();
  };
}
