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
  const path = checkedPath(root, ".mindos/views/index.json");
  const fingerprint = () => {
    try {
      if (statSync(path).size > 1024 * 1024) return "oversized";
      return documentRevision(readFileSync(path, "utf8"));
    } catch {
      return "unavailable";
    }
  };
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
