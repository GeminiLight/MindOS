import type { ViewSummary } from "./api";
export type ViewWorkspace = {
  id: string;
  primary: ViewSummary;
  resume: ViewSummary;
  views: ViewSummary[];
  pinned: boolean;
  touched: string;
};
/** Collections are navigation objects. Saved projections never duplicate the source entry. */
export function groupViewWorkspaces(views: ViewSummary[]): ViewWorkspace[] {
  const groups = new Map<string, ViewSummary[]>();
  for (const view of views) {
    const key = view.collectionId ?? `${view.template}:${view.folder}`;
    groups.set(key, [...(groups.get(key) ?? []), view]);
  }
  return [...groups.entries()]
    .map(([id, items]) => {
      const sorted = [...items].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      const primary = sorted[0];
      const resume =
        [...sorted]
          .filter((v) => v.availability === "ready")
          .sort((a, b) =>
            (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""),
          )[0] ?? primary;
      return {
        id,
        primary,
        resume,
        views: sorted,
        pinned: sorted.some((v) => v.pinned),
        touched:
          sorted
            .map((v) => v.lastOpenedAt ?? v.updatedAt)
            .sort()
            .at(-1) ?? "",
      };
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.touched.localeCompare(a.touched) ||
        a.id.localeCompare(b.id),
    );
}
export function layoutLabel(layout: string | undefined, locale: string, template = "people") {
  const zh = locale === "zh";
  return layout === "board"
    ? zh
      ? "看板"
      : "Board"
    : layout === "table"
      ? zh
        ? "表格"
        : "Table"
      : template === "tasks"
        ? zh ? "卡片" : "Cards"
        : zh ? "人物详情" : "People details";
}
