// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readViewDraft,
  writeViewDraft,
  clearViewDraft,
} from "@/lib/views/drafts";
const scope = {
  rootId: "root-a",
  viewId: "view-a",
  personId: "person-a",
  kind: "interaction",
};
const draft = {
  revision: "old-version",
  operationId: "operation-a",
  values: { text: "尚未保存 🌿", date: "2026-10-12" },
  updatedAt: 100,
};
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("view drafts belong to one library and original person", () => {
  it("restores the full draft and the base revision", () => {
    expect(writeViewDraft(scope, draft)).toBe(true);
    expect(readViewDraft(scope)).toEqual(draft);
  });
  it("never reads a different person or knowledge library draft", () => {
    writeViewDraft(scope, draft);
    expect(readViewDraft({ ...scope, rootId: "root-b" })).toBeNull();
    expect(readViewDraft({ ...scope, personId: "person-b" })).toBeNull();
  });
  it("clears only the saved operation draft", () => {
    writeViewDraft(scope, draft);
    writeViewDraft({ ...scope, kind: "person" }, draft);
    clearViewDraft(scope);
    expect(readViewDraft(scope)).toBeNull();
    expect(readViewDraft({ ...scope, kind: "person" })).toEqual(draft);
  });
  it("reports unavailable storage instead of claiming a save", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Quota");
    });
    expect(writeViewDraft(scope, draft)).toBe(false);
  });
});
