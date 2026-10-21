import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ViewsStore } from "./store.js";
import { handleFilePost } from "../../server/handlers/file.js";
import { ViewError } from "./types.js";
const roots: string[] = [];
function make() {
  const root = mkdtempSync(join(tmpdir(), "mindos-views-"));
  roots.push(root);
  const changes: unknown[] = [];
  const store = new ViewsStore(root, async (op) => {
    const result = await handleFilePost(op, { mindRoot: root });
    if (result.status >= 400)
      throw new ViewError(
        result.status === 409 ? "REVISION_CONFLICT" : "WRITE_FAILED",
        "Write failed",
        result.status,
      );
    changes.push(result.changeEvent);
  });
  return { root, store, changes };
}
const createInput = (folder = "人脉") => ({
  name: "我的人脉",
  folder,
  mode: "new",
  operationId: randomUUID(),
});
const personInput = () => ({
  operationId: randomUUID(),
  fields: { name: "叶遥 🌿", background: "研究者", focus: "学习" },
});
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});
describe("views bind to original Markdown under the knowledge root", () => {
  it("starts empty, persists an empty native template and restores its binding", async () => {
    const { store, root } = make();
    expect(store.list()).toEqual([]);
    const view = await store.create(createInput());
    expect(view.folder).toBe("人脉");
    expect(store.read(view.id).people).toEqual([]);
    expect(
      readFileSync(join(root, "人脉", "INSTRUCTION.md"), "utf8"),
    ).toContain("会前");
    const again = new ViewsStore(root, store.write);
    expect(again.list()[0].id).toBe(view.id);
  });
  it("recovers the same create and person request without duplicate instances or files", async () => {
    const { store, root } = make();
    const input = createInput();
    const view = await store.create(input);
    expect((await store.create(input)).id).toBe(view.id);
    const request = personInput();
    const p = await store.addPerson(view.id, request);
    expect((await store.addPerson(view.id, request)).id).toBe(p.id);
    expect(store.read(view.id).people.length).toBe(1);
    expect(readdirSync(join(root, "人脉", "人物")).length).toBe(1);
  });
  it("associates legacy data and leaves existing CSV and private sections unchanged", async () => {
    const { store, root } = make();
    mkdirSync(join(root, "朋友", "人物"), { recursive: true });
    const content = "# 林若舟\n\n## 背景\n设计师\n\n## 私人反思\nPRIVATE\n";
    writeFileSync(join(root, "朋友", "人物", "林.md"), content);
    writeFileSync(
      join(root, "朋友", "关系总览.csv"),
      "姓名,自定义列\n林,重要\n",
    );
    const view = await store.create({
      ...createInput("朋友"),
      mode: "existing",
    });
    expect(store.read(view.id).people[0].name).toBe("林若舟");
    expect(readFileSync(join(root, "朋友", "人物", "林.md"), "utf8")).toBe(
      content,
    );
    expect(readFileSync(join(root, "朋友", "关系总览.csv"), "utf8")).toContain(
      "自定义列",
    );
  });
  it("retains unknown sections through edits and refuses an outdated file revision", async () => {
    const { store, root } = make();
    const view = await store.create(createInput());
    const p = await store.addPerson(view.id, personInput());
    const file = join(root, p.path);
    writeFileSync(file, readFileSync(file, "utf8") + "\n## 私人\nPRIVATE\n");
    const current = store.person(view.id, p.id);
    const saved = await store.updatePerson(view.id, p.id, {
      expectedRevision: current.revision,
      fields: { name: "叶遥", focus: "新方向" },
    });
    expect(readFileSync(file, "utf8")).toContain("PRIVATE");
    expect(saved.focus).toBe("新方向");
    await expect(
      store.updatePerson(view.id, p.id, {
        expectedRevision: current.revision,
        fields: { name: "过期覆盖" },
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(store.person(view.id, p.id).name).toBe("叶遥");
  });
  it("appends an interaction exactly once and returns current file data", async () => {
    const { store, root } = make();
    const view = await store.create(createInput());
    const p = await store.addPerson(view.id, personInput());
    const input = {
      operationId: randomUUID(),
      expectedRevision: p.revision,
      text: "讨论了下一步。",
      date: "2026-10-12",
      source: "",
    };
    const saved = await store.interaction(view.id, p.id, input);
    const retried = await store.interaction(view.id, p.id, input);
    expect(saved.interactionCount).toBe(1);
    expect(retried.interactionCount).toBe(1);
    expect(readFileSync(join(root, p.path), "utf8")).toContain("讨论了下一步");
  });
  it("updates followup and preserves source documents when removing the view", async () => {
    const { store, root } = make();
    const view = await store.create(createInput());
    const p = await store.addPerson(view.id, personInput());
    const saved = await store.followup(view.id, p.id, {
      expectedRevision: p.revision,
      text: "会前准备",
      date: "2026-10-15",
      completed: true,
    });
    expect(saved.followup.completed).toBe(true);
    await store.remove(view.id, view.version);
    expect(readFileSync(join(root, p.path), "utf8")).toContain("会前准备");
    expect(store.list()).toEqual([]);
    const next = await store.create({ ...createInput(), mode: "existing" });
    expect(store.read(next.id).people[0].name).toBe("叶遥 🌿");
  });
  it("serializes concurrent registry changes and reports configuration conflicts", async () => {
    const { store } = make();
    const [a, b] = await Promise.all([
      store.create(createInput("甲")),
      store.create(createInput("乙")),
    ]);
    expect(store.list().length).toBe(2);
    await store.rename(a.id, "新的名字", a.version);
    await expect(store.rename(a.id, "覆盖", a.version)).rejects.toMatchObject({
      code: "VIEW_CONFLICT",
    });
    expect(store.list().find((v) => v.id === b.id)?.folder).toBe("乙");
  });
  it.each(["../escape", "/absolute", ".mindos/private", "C:/private"])(
    "rejects unsafe binding %s before any directory is created",
    async (folder) => {
      const { store, root } = make();
      await expect(store.create(createInput(folder))).rejects.toBeDefined();
      expect(readdirSync(root).filter((n) => n !== ".mindos")).toEqual([]);
    },
  );
  it("rejects an escaping symlink and preserves a damaged registry", async () => {
    const { store, root } = make();
    const other = make().root;
    symlinkSync(other, join(root, "outside"));
    await expect(
      store.create({ ...createInput("outside"), mode: "existing" }),
    ).rejects.toBeDefined();
    mkdirSync(join(root, ".mindos", "views"), { recursive: true });
    writeFileSync(join(root, ".mindos", "views", "index.json"), "{broken");
    expect(() => store.list()).toThrow();
    expect(
      readFileSync(join(root, ".mindos", "views", "index.json"), "utf8"),
    ).toBe("{broken");
  });
  it("reports moved folders and allows an explicit rebind without moving files", async () => {
    const { store, root } = make();
    const view = await store.create(createInput());
    rmSync(join(root, "人脉"), { recursive: true, force: true });
    expect(store.list()[0].availability).toBe("missing");
    mkdirSync(join(root, "新的关系"));
    const next = await store.rebind(view.id, "新的关系", view.version);
    expect(next.folder).toBe("新的关系");
    expect(store.read(next.id).people).toEqual([]);
  });
  it("does not register a view when the knowledge writer refuses a template write", async () => {
    const { root } = make();
    const store = new ViewsStore(root, async () => {
      throw new ViewError("ACCESS_DENIED", "Denied", 403);
    });
    await expect(store.create(createInput())).rejects.toBeDefined();
    expect(store.list()).toEqual([]);
  });
});
