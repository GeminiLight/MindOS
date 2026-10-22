import type { PageSpec } from "@geminilight/mindos/knowledge/views";
export function blankPage(locale: string): PageSpec {
  return {
    specVersion: 1,
    title: locale === "zh" ? "我的工作页面" : "My workspace",
    description: "",
    layout: { columns: 2, density: "comfortable" },
    blocks: [],
  };
}
export function movePageBlock(
  spec: PageSpec,
  id: string,
  direction: -1 | 1,
): PageSpec {
  const index = spec.blocks.findIndex((b) => b.id === id),
    next = index + direction;
  if (index < 0 || next < 0 || next >= spec.blocks.length) return spec;
  const blocks = [...spec.blocks];
  [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
  return { ...spec, blocks };
}
export type PageDraft = { spec: PageSpec; baseVersion: number };
const key = (rootId: string, pageId: string) =>
  "mindos:page-draft:" + JSON.stringify([rootId, pageId]);
function isDraftBlock(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  if (
    typeof b.id !== "string" ||
    typeof b.title !== "string" ||
    !["tasks", "people", "notes", "summary", "html"].includes(String(b.kind))
  )
    return false;
  for (const k of ["html", "folder", "viewId", "collectionId"])
    if (b[k] !== undefined && typeof b[k] !== "string") return false;
  for (const k of ["paths", "fields"])
    if (
      b[k] !== undefined &&
      (!Array.isArray(b[k]) ||
        !(b[k] as unknown[]).every((v) => typeof v === "string"))
    )
      return false;
  if (b.locked !== undefined && typeof b.locked !== "boolean") return false;
  if (
    b.layout !== undefined &&
    !["list-detail", "table", "board"].includes(String(b.layout))
  )
    return false;
  if (b.filter !== undefined) {
    if (
      !b.filter ||
      typeof b.filter !== "object" ||
      !Array.isArray((b.filter as { all?: unknown }).all)
    )
      return false;
    if (
      !(b.filter as { all: unknown[] }).all.every(
        (f) =>
          f &&
          typeof f === "object" &&
          typeof (f as { field?: unknown }).field === "string" &&
          typeof (f as { op?: unknown }).op === "string",
      )
    )
      return false;
  }
  return true;
}
export function readPageDraft(
  rootId: string,
  pageId: string,
): PageDraft | null {
  try {
    const raw = localStorage.getItem(key(rootId, pageId));
    if (!raw || raw.length > 150000) return null;
    const value = JSON.parse(raw);
    if (
      value?.spec?.specVersion !== 1 ||
      typeof value.spec.title !== "string" ||
      !Array.isArray(value.spec.blocks) ||
      value.spec.blocks.length > 12 ||
      !value.spec.blocks.every(isDraftBlock) ||
      ![1, 2].includes(value.spec.layout?.columns) ||
      !["comfortable", "compact"].includes(value.spec.layout?.density) ||
      (value.spec.description !== undefined &&
        typeof value.spec.description !== "string") ||
      !Number.isInteger(value.baseVersion) ||
      value.baseVersion < 0
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function writePageDraft(
  rootId: string,
  pageId: string,
  draft: PageDraft,
): boolean {
  try {
    localStorage.setItem(key(rootId, pageId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function clearPageDraft(rootId: string, pageId: string) {
  try {
    localStorage.removeItem(key(rootId, pageId));
  } catch {}
}
export function pageChanges(
  before: PageSpec,
  after: PageSpec,
  locale: string,
): string[] {
  const zh = locale === "zh",
    changes: string[] = [];
  if (before.title !== after.title)
    changes.push(zh ? "更新页面标题" : "Title updated");
  if (before.description !== after.description)
    changes.push(zh ? "更新页面说明" : "Description updated");
  if (JSON.stringify(before.layout) !== JSON.stringify(after.layout))
    changes.push(zh ? "调整页面布局" : "Layout adjusted");
  const added = after.blocks.filter(
    (b) => !before.blocks.some((a) => a.id === b.id),
  ).length;
  const removed = before.blocks.filter(
    (b) => !after.blocks.some((a) => a.id === b.id),
  ).length;
  const changed = after.blocks.filter((b) =>
    before.blocks.some(
      (a) => a.id === b.id && JSON.stringify(a) !== JSON.stringify(b),
    ),
  ).length;
  if (added)
    changes.push(
      zh
        ? `新增 ${added} 个模块`
        : `${added} block${added > 1 ? "s" : ""} added`,
    );
  if (removed)
    changes.push(
      zh
        ? `移除 ${removed} 个模块`
        : `${removed} block${removed > 1 ? "s" : ""} removed`,
    );
  if (changed)
    changes.push(
      zh
        ? `调整 ${changed} 个模块`
        : `${changed} block${changed > 1 ? "s" : ""} adjusted`,
    );
  if (
    !added &&
    !removed &&
    before.blocks.map((b) => b.id).join() !==
      after.blocks.map((b) => b.id).join()
  )
    changes.push(zh ? "调整模块顺序" : "Block order adjusted");
  return changes;
}
