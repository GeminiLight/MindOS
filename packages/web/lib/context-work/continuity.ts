"use client";
export type ContextPosition = {
  kind: "project" | "view";
  id: string;
  title: string;
  folder: string;
  mode: "files" | "view";
  file?: string;
  personId?: string;
  updatedAt: number;
};
export const CONTEXT_POSITION_CHANGED = "mindos:context-position-changed";
const memory = new Map<string, ContextPosition[]>();
const key = (root: string) => `mindos:context-positions:${root}`;
export const clearContinuityMemory = () => memory.clear();
function valid(p: ContextPosition) {
  return (
    p &&
    ["project", "view"].includes(p.kind) &&
    ["files", "view"].includes(p.mode) &&
    typeof p.id === "string" &&
    !!p.id &&
    p.id.length <= 160 &&
    typeof p.title === "string" &&
    p.title.length <= 200 &&
    typeof p.folder === "string" &&
    !!p.folder &&
    p.folder.length <= 1000 &&
    !p.folder.includes("\\") &&
    !p.folder.split("/").some((part) => !part || part.startsWith(".")) &&
    (!p.file ||
      (typeof p.file === "string" &&
        p.file.startsWith(p.folder + "/") &&
        !p.file.includes("\\") &&
        !p.file.split("/").some((part) => !part || part.startsWith(".")))) &&
    (!p.personId ||
      (typeof p.personId === "string" && p.personId.length <= 160)) &&
    Number.isFinite(p.updatedAt)
  );
}
function stored(root: string): ContextPosition[] {
  const raw = localStorage.getItem(key(root));
  if (!raw) return [];
  const entries = JSON.parse(raw);
  if (
    !Array.isArray(entries) ||
    entries.length > 40 ||
    entries.some((p) => !valid(p))
  )
    throw Error("Invalid continuity data");
  return entries;
}
export function readContextPositions(root: string): ContextPosition[] {
  if (!root) return [];
  try {
    const rows = stored(root);
    if (!memory.has(root)) return rows;
  } catch {
    /* Keep the original storage intact; this tab may still continue. */
  }
  return memory.get(root) ?? [];
}
export function rememberContext(
  root: string,
  position: Omit<ContextPosition, "updatedAt">,
): boolean {
  const next = { ...position, updatedAt: Date.now() };
  if (!root || !valid(next)) throw Error("Invalid Context position");
  const entries = [
    next,
    ...readContextPositions(root).filter(
      (p) => p.kind !== next.kind || p.id !== next.id,
    ),
  ].slice(0, 40);
  let persisted = true;
  try {
    stored(root);
    localStorage.setItem(key(root), JSON.stringify(entries));
    memory.delete(root);
  } catch {
    persisted = false;
    memory.set(root, entries);
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(CONTEXT_POSITION_CHANGED, { detail: { rootId: root } }),
    );
  return persisted;
}
export function contextHref(p: Omit<ContextPosition, "updatedAt">) {
  const params = new URLSearchParams();
  if (p.kind === "project") params.set("folder", p.folder);
  params.set("mode", p.mode);
  if (p.file) params.set("file", p.file);
  if (p.kind === "view" && p.personId) params.set("person", p.personId);
  return `/studio/${p.kind === "view" ? "views/" : ""}${encodeURIComponent(p.id)}?${params}`;
}
