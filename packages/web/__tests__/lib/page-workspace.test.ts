// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  movePageBlock,
  readPageDraft,
  writePageDraft,
  pageChanges,
  blankPage,
} from "@/lib/views/page-workspace";
afterEach(() => localStorage.clear());
describe("page workspace", () => {
  it('names the changed region and explains filter and layout edits',()=>{
    const before={...blankPage('zh'),blocks:[{id:'tasks',title:'下一步',kind:'tasks' as const,collectionId:'c-one',layout:'table' as const}]};
    const after={...before,blocks:[{...before.blocks[0],layout:'board' as const,filter:{all:[{field:'status',op:'neq' as const,value:'done'}]}}]};
    const changes=pageChanges(before,after,'zh').join(' ');expect(changes).toContain('下一步');expect(changes).toContain('筛选');expect(changes).toContain('布局');
  });
  it("moves only the requested block and preserves its source binding", () => {
    const spec = {
      ...blankPage("en"),
      blocks: [
        { id: "a", title: "A", kind: "tasks" as const, collectionId: "c-one" },
        { id: "b", title: "B", kind: "notes" as const, paths: ["Notes/a.md"] },
      ],
    };
    expect(movePageBlock(spec, "a", 1).blocks.map((b) => b.id)).toEqual([
      "b",
      "a",
    ]);
    expect(movePageBlock(spec, "a", 1).blocks[1].collectionId).toBe("c-one");
    expect(movePageBlock(spec, "a", -1)).toEqual(spec);
    expect(movePageBlock(spec, "missing", 1)).toEqual(spec);
  });
  it("restores page drafts only within their library and retains original base version", () => {
    writePageDraft("root-a", "p-one", {
      spec: blankPage("en"),
      baseVersion: 3,
    });
    expect(readPageDraft("root-a", "p-one")?.baseVersion).toBe(3);
    expect(readPageDraft("root-b", "p-one")).toBeNull();
    expect(readPageDraft("root-a", "p-other")).toBeNull();
  });
  it("rejects corrupted drafts and reports local storage failure", () => {
    localStorage.setItem(
      "mindos:page-draft:" + JSON.stringify(["root", "new"]),
      "broken",
    );
    expect(readPageDraft("root", "new")).toBeNull();
  });
  it("summarizes local changes without treating data as changed", () => {
    const before = blankPage("en");
    const after = {
      ...before,
      title: "Weekly focus",
      blocks: [
        {
          id: "a",
          title: "Tasks",
          kind: "tasks" as const,
          collectionId: "c-one",
        },
      ],
    };
    expect(pageChanges(before, after, "en")).toContain("1 block added");
    expect(pageChanges(before, after, "en")).toContain("Title updated");
    expect(pageChanges(after, after, "en")).toEqual([]);
  });
});
it("rejects corrupted block and filter shapes rather than crashing the editor", () => {
  const key = "mindos:page-draft:" + JSON.stringify(["root", "new"]);
  for (const blocks of [
    [null],
    [{ id: "a", title: "A", kind: "tasks", filter: { all: "broken" } }],
  ]) {
    localStorage.setItem(
      key,
      JSON.stringify({ baseVersion: 0, spec: { ...blankPage("en"), blocks } }),
    );
    expect(readPageDraft("root", "new")).toBeNull();
  }
});
