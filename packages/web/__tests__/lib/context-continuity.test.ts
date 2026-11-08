// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  rememberContext,
  readContextPositions,
  contextHref,
  clearContinuityMemory,
} from "@/lib/context-work/continuity";
beforeEach(() => {
  localStorage.clear();
  clearContinuityMemory();
});
const project = {
  kind: "project" as const,
  id: "design",
  title: "产品设计",
  folder: "项目/产品",
  mode: "files" as const,
  file: "项目/产品/方向.md",
};
describe("Context continuity", () => {
  it("remembers each object independently and sorts by actual last use", () => {
    rememberContext("root-a", project);
    rememberContext("root-a", {
      kind: "view",
      id: "people",
      title: "人脉",
      folder: "生活/人脉",
      mode: "view",
      personId: "p-chen",
    });
    const entries = readContextPositions("root-a");
    expect(entries.map((p) => p.id)).toEqual(["people", "design"]);
    expect(entries[1].file).toBe(project.file);
    clearContinuityMemory();
    expect(readContextPositions("root-a")).toEqual(entries);
  });
  it("never carries positions to another knowledge library", () => {
    rememberContext("root-a", project);
    expect(readContextPositions("root-b")).toEqual([]);
  });
  it("does not navigate to a user-supplied URL or a file from another folder", () => {
    expect(() =>
      rememberContext("root-a", { ...project, file: "别处/秘密.md" }),
    ).toThrow();
    expect(() =>
      rememberContext("root-a", { ...project, folder: "../escape" }),
    ).toThrow();
    expect(contextHref(project)).toBe(
      "/studio/design?folder=%E9%A1%B9%E7%9B%AE%2F%E4%BA%A7%E5%93%81&mode=files&file=%E9%A1%B9%E7%9B%AE%2F%E4%BA%A7%E5%93%81%2F%E6%96%B9%E5%90%91.md",
    );
  });
  it("does not erase damaged storage while allowing this window to continue", () => {
    localStorage.setItem("mindos:context-positions:root-a", "{");
    expect(rememberContext("root-a", project)).toBe(false);
    expect(localStorage.getItem("mindos:context-positions:root-a")).toBe("{");
    expect(readContextPositions("root-a")[0].id).toBe("design");
  });
});
