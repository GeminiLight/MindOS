import { expect, it } from "vitest";
import { groupViewWorkspaces } from "@/lib/views/view-workspaces";
const view = (id: string, collectionId: string, extra = {}) =>
  ({
    id,
    collectionId,
    name: id,
    folder: "Projects/" + collectionId,
    template: "tasks",
    availability: "ready",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    version: 1,
    ...extra,
  }) as any;
it("groups table and board under one source without merging equally named independent sources", () => {
  const a = view("table", "a"),
    b = view("board", "a", { createdAt: "2026-10-02" }),
    c = view("table", "b");
  const groups = groupViewWorkspaces([b, c, a]);
  expect(groups).toHaveLength(2);
  expect(groups.find((g) => g.id === "a")!.views).toHaveLength(2);
  expect(groups.find((g) => g.id === "a")!.primary.id).toBe("table");
  expect([b, c, a].map((v) => v.id)).toEqual(["board", "table", "table"]);
});
it("keeps legacy folders separate, orders pinned workspaces first and does not hide missing views", () => {
  expect(groupViewWorkspaces([])).toEqual([]);
  const groups = groupViewWorkspaces([
    view("a", "x", {
      collectionId: undefined,
      folder: "A",
      availability: "missing",
    }),
    view("b", "x", { collectionId: undefined, folder: "B", pinned: true }),
  ]);
  expect(groups).toHaveLength(2);
  expect(groups[0].primary.id).toBe("b");
  expect(groups[1].primary.availability).toBe("missing");
});
