import { describe, expect, it } from "vitest";
import {
  newPerson,
  parsePerson,
  patchFields,
  patchFollowup,
  appendInteraction,
  personMaterials,
  exportPeopleCsv,
} from "./markdown.js";
const id = "p-12345678-1234-1234-1234-123456789abc";
const fields = {
  name: "叶遥 🌿",
  background: "独立研究者\n在读书会认识。",
  focus: "学习与判断",
};
const legacy =
  "# 林若舟\n\n## 背景\n设计师\n\n## 私人反思\nPRIVATE_ONLY\n\n## 互动记录\n- 2026-10-01：讨论了资料。\n\n## 其他资料\n不要改这一段。\n";
describe("people Markdown is the only record source", () => {
  it("creates an ordinary readable Markdown record with a stable identity", () => {
    const raw = newPerson(id, fields);
    const p = parsePerson(raw, "生活/人物/叶遥.md");
    expect(raw).toContain("# 叶遥 🌿");
    expect(p).toMatchObject({ ...fields, id, managed: true });
  });
  it("reads legacy people without promoting private or unknown sections", () => {
    const p = parsePerson(legacy, "人脉/人物/林.md");
    expect(p.name).toBe("林若舟");
    expect(p.background).toBe("设计师");
    expect(p.interactionCount).toBe(1);
    expect(p.sources).not.toContain("PRIVATE_ONLY");
  });
  it("changes fields while preserving private notes, unknown sections and old interactions", () => {
    const next = patchFields(legacy, fields);
    expect(next).toContain("## 私人反思\nPRIVATE_ONLY");
    expect(next).toContain("不要改这一段。");
    expect(next).toContain("- 2026-10-01：讨论了资料。");
    expect(parsePerson(next, "x.md").name).toBe(fields.name);
  });
  it("preserves CRLF records and treats heading-like field text as literal content", () => {
    const raw = legacy.replaceAll("\n", "\r\n");
    const next = patchFields(raw, {
      ...fields,
      background: "第一行\n## 私人内容\n仍然属于背景",
    });
    expect(next).toContain("\r\n");
    expect(next.replaceAll("\r\n", "")).not.toContain("\n");
    expect(parsePerson(next, "x.md").background).toContain("## 私人内容");
    expect(next).toContain("PRIVATE_ONLY");
  });
  it("updates followup without disturbing the other sections", () => {
    const next = patchFollowup(legacy, {
      text: "一起核对资料\n整理问题",
      date: "2026-10-15",
      completed: true,
    });
    expect(parsePerson(next, "x.md").followup).toEqual({
      text: "一起核对资料\n整理问题",
      date: "2026-10-15",
      completed: true,
    });
    expect(next).toContain("PRIVATE_ONLY");
  });
  it("appends one interaction and recognizes an identical retry by its id", () => {
    const entry = {
      id: "12345678-1234-1234-1234-123456789abc",
      date: "2026-10-12",
      text: "讨论视图与资料。",
      source: "Codex 会话",
    };
    const next = appendInteraction(legacy, entry);
    expect(appendInteraction(next, entry)).toBe(next);
    const p = parsePerson(next, "x.md");
    expect(
      p.interactions.some(
        (r) =>
          r.id === entry.id &&
          r.text === entry.text &&
          r.source === entry.source,
      ),
    ).toBe(true);
    expect(p.interactionCount).toBe(2);
  });
  it("rejects reuse of an interaction id with changed content", () => {
    const entry = {
      id: "12345678-1234-1234-1234-123456789abc",
      date: "2026-10-12",
      text: "原始记录",
      source: "",
    };
    expect(() =>
      appendInteraction(appendInteraction(legacy, entry), {
        ...entry,
        text: "另一条",
      }),
    ).toThrow();
  });
  it.each([
    ["empty", { ...fields, name: " " }],
    ["long", { ...fields, name: "人".repeat(81) }],
    ["control", { ...fields, name: "姓名\u0000" }],
  ])("rejects %s fields", (_label, input) =>
    expect(() => newPerson(id, input)).toThrow(),
  );
  it("rejects impossible dates and empty interactions", () => {
    expect(() =>
      patchFollowup(legacy, {
        text: "下一步",
        date: "2026-02-30",
        completed: false,
      }),
    ).toThrow();
    expect(() =>
      appendInteraction(legacy, {
        id: "12345678-1234-1234-1234-123456789abc",
        date: "2026-10-12",
        text: " ",
        source: "",
      }),
    ).toThrow();
  });
  it("only exports explicitly selected fields to Agent materials", () => {
    const p = parsePerson(legacy, "人物/林.md");
    const items = personMaterials(p, ["background", "interactions", "private"]);
    expect(items.map((i) => i.id)).toEqual(["background", "interactions"]);
    expect(JSON.stringify(items)).not.toContain("PRIVATE_ONLY");
    expect(JSON.stringify(items)).not.toContain("不要改这一段");
  });
  it("does not treat fenced private examples as shared sections", () => {
    const raw =
      "# Person\n\n## 私人反思\n```md\n## 背景\nPRIVATE_EXAMPLE\n```\n\n## 背景\nPublic background\n";
    const p = parsePerson(raw, "人物/a.md");
    expect(p.background).toBe("Public background");
    const changed = patchFields(raw, { background: "Updated public" });
    expect(changed).toContain("PRIVATE_EXAMPLE");
    expect(JSON.stringify(personMaterials(p, ["background"]))).not.toContain(
      "PRIVATE_EXAMPLE",
    );
  });
  it("exports a quoted CSV and neutralizes spreadsheet formulas", () => {
    const p = parsePerson(
      newPerson(id, { ...fields, name: "=SUM(1,2)" }),
      "人物/a.md",
    );
    const csv = exportPeopleCsv([p]);
    expect(csv).toContain("'=SUM(1,2)");
    expect(csv).not.toContain("叶");
  });
});
