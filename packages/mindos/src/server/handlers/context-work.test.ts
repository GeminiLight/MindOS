import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMindosApp } from "../app.js";
import { createDefaultMindosHttpServices } from "../services.js";
import { mindRootIdentity } from "../root-identity.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});
function setup(token?: string) {
  const root = mkdtempSync(join(tmpdir(), "mindos-context-work-"));
  mkdirSync(join(root, "项目"));
  mkdirSync(join(root, "另一个项目"));
  writeFileSync(join(root, "项目", "方向.md"), "# 方向\n\n从当前内容继续。");
  writeFileSync(join(root, "另一个项目", "私人.md"), "OTHER_PROJECT_PRIVATE");
  const changed: unknown[] = [];
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    readSettings: () => ({ mindRoot: root, authToken: token }),
  });
  const app = createMindosApp({
    services: {
      ...services,
      knowledgeWrites: { onChanged: (x) => changed.push(x) },
    },
    staticFallback: false,
  });
  cleanup.push(() => {
    services.dispose?.();
    rmSync(root, { recursive: true, force: true });
  });
  const rootId = mindRootIdentity(root);
  const get = (args: Record<string, string> = {}) =>
    app.fetch(
      new Request(
        "http://localhost/api/context-work?" +
          new URLSearchParams({ rootId, folder: "项目", ...args }),
      ),
    );
  const post = (body: Record<string, unknown>) =>
    app.fetch(
      new Request("http://localhost/api/context-work", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRootId: rootId,
          folder: "项目",
          ...body,
        }),
      }),
    );
  return { root, rootId, get, post, changed };
}
describe("working with real Context files", () => {
  it("lists only the chosen folder and reads a revisioned original", async () => {
    const { get } = setup();
    const list = await get();
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toContain("no-store");
    const result = await list.json();
    expect(result.files.map((f: { path: string }) => f.path)).toEqual([
      "项目/方向.md",
    ]);
    const file = await (await get({ op: "read", path: "项目/方向.md" })).json();
    expect(file.content).toContain("当前内容");
    expect(file.revision).toMatch(/^[a-f0-9]{64}$/);
  });
  it("saves progress to real Markdown and safely replays the same request once", async () => {
    const { post, root, get, changed } = setup();
    const body = {
      op: "progress",
      operationId: randomUUID(),
      text: "先接上背景，再让 Agent 参与。",
      source: "Codex",
    };
    const a = await post(body);
    expect(a.status).toBe(200);
    const first = await a.json();
    const second = await (await post(body)).json();
    expect(second.path).toBe(first.path);
    expect(readFileSync(join(root, first.path), "utf8")).toContain(
      "先接上背景",
    );
    expect(changed).toHaveLength(1);
    expect((await (await get()).json()).progress).toHaveLength(1);
    expect(
      (await post({ ...body, text: "不同内容不能冒用同一请求" })).status,
    ).toBe(409);
  });
  it("prepares only selected documents and rejects stale source revisions", async () => {
    const { get, post, root } = setup();
    const doc = await (await get({ op: "read", path: "项目/方向.md" })).json();
    const body = {
      op: "prepare",
      target: "Codex",
      goal: "核对下一步",
      selected: [{ path: doc.path, revision: doc.revision }],
    };
    const ready = await post(body);
    expect(ready.status).toBe(200);
    const { text } = await ready.json();
    expect(text).toContain("从当前内容继续");
    expect(text).not.toContain("OTHER_PROJECT_PRIVATE");
    writeFileSync(join(root, doc.path), "新版本");
    expect((await post(body)).status).toBe(409);
  });
  it("rejects blank, oversized, malformed and cross-folder input before writing", async () => {
    const { post, get, changed } = setup();
    for (const text of ["", "  ", null, "文".repeat(4001)])
      expect(
        (
          await post({
            op: "progress",
            operationId: randomUUID(),
            text,
            source: "自己整理",
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await post({
          op: "progress",
          operationId: "../outside",
          text: "有效内容",
          source: "自己整理",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          op: "prepare",
          target: "Codex",
          goal: "继续",
          selected: [],
        })
      ).status,
    ).toBe(400);
    expect((await get({ op: "read", path: "另一个项目/私人.md" })).status).toBe(
      403,
    );
    expect((await get({ folder: "../outside" })).status).toBe(400);
    expect(changed).toHaveLength(0);
  });
  it("refuses stale roots and requires authentication", async () => {
    const { get, post } = setup();
    expect((await get({ rootId: "old" })).status).toBe(409);
    expect(
      (
        await post({
          op: "progress",
          expectedRootId: "old",
          operationId: randomUUID(),
          text: "进展",
          source: "自己整理",
        })
      ).status,
    ).toBe(409);
    expect((await setup("secret").get()).status).toBe(401);
  });
  it("reports deleted or unreadable documents and refuses symlinks", async () => {
    const { root, get } = setup();
    expect((await get({ op: "read", path: "项目/已删除.md" })).status).toBe(
      404,
    );
    symlinkSync(
      join(root, "另一个项目", "私人.md"),
      join(root, "项目", "link.md"),
    );
    expect((await get({ op: "read", path: "项目/link.md" })).status).toBe(403);
    writeFileSync(join(root, "项目", "乱码.md"), Buffer.from([0xff, 0xfe]));
    expect((await get({ op: "read", path: "项目/乱码.md" })).status).toBe(422);
  });
});
it("concurrent retries create a single progress file and a single change event", async () => {
  const { post, get, changed } = setup();
  const body = {
    op: "progress",
    operationId: randomUUID(),
    text: "同一条进展",
    source: "我的记录",
  };
  const responses = await Promise.all([post(body), post(body)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(changed).toHaveLength(1);
  expect((await (await get()).json()).progress).toHaveLength(1);
});
