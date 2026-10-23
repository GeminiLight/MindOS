import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  sessions: [] as unknown[],
  stories: [] as unknown[],
}));
const delivery = vi.hoisted(() => vi.fn(() => ({ status: "not-waiting" })));
vi.mock("@geminilight/mindos/server", async (original) => ({
  ...(await original<object>()),
  handleAgentSessionsGet: () => ({ body: state.sessions }),
}));
vi.mock("@geminilight/mindos/agent", async (original) => ({
  ...(await original<object>()),
  listAgentRuns: () => [],
}));
vi.mock("@geminilight/mindos/knowledge/branch-replay/store", () => ({
  listBranchStories: () => state.stories,
}));
vi.mock("@geminilight/mindos/agent/tool", () => ({
  resolveCoevolutionDecisionBridge: delivery,
}));
vi.mock("@/lib/runtime-auth-config", () => ({
  readRuntimeAuthConfig: vi.fn(() => ({ webSessionSecret: "" })),
}));
import { readRuntimeAuthConfig } from "@/lib/runtime-auth-config";
import { GET, POST, PATCH } from "@/app/api/echo/coevolution/route";
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "co-api-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  state.sessions = [
    {
      id: "session-1",
      title: "A real task",
      messages: [
        { role: "user", content: "What should we check?" },
        { role: "assistant", content: "Compare the request ownership." },
      ],
    },
  ];
  state.stories = [];
  vi.mocked(readRuntimeAuthConfig).mockReturnValue({ webSessionSecret: "" });
  delivery.mockReset();
  delivery.mockReturnValue({ status: "not-waiting" });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
const req = (
  data?: unknown,
  method = "POST",
  query = "",
  headers: Record<string, string> = {},
) =>
  new NextRequest("http://localhost/api/echo/coevolution" + query, {
    method,
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
const input = {
  requestId: "test-workspace",
  title: "Review the decision",
  goal: "Understand which evidence matters",
  mode: "together",
};
it("keeps archived tasks out of the active workspace picker", async () => {
  const { task } = await (await POST(req(input))).json();
  const archived = await PATCH(
    req(
      {
        id: task.id,
        version: task.version,
        requestId: "archive-task",
        action: "archive",
        archived: true,
      },
      "PATCH",
    ),
  );
  expect(archived.status).toBe(200);
  const listed = await GET(req(undefined, "GET"));
  expect((await listed.json()).tasks).toEqual([]);
});
it("starts a private manual task, persists mode, prepares an actual Agent draft and creates a correctly attributed inquiry", async () => {
  const response = await POST(req(input));
  expect(response.status).toBe(200);
  let { task } = await response.json();
  expect(task.source).toBeUndefined();
  const prepared = await PATCH(
    req(
      {
        id: task.id,
        version: task.version,
        requestId: "prepare-1",
        action: "prepare",
      },
      "PATCH",
    ),
  );
  const data = await prepared.json();
  expect(prepared.status).toBe(200);
  expect(data.draft.prompt).toContain(task.id);
  task = data.task;
  const inquiryResponse = await PATCH(
    req(
      {
        id: task.id,
        version: task.version,
        requestId: "inquiry-1",
        action: "create-inquiry",
        locale: "zh",
      },
      "PATCH",
    ),
  );
  const inquiryData = await inquiryResponse.json();
  expect(inquiryResponse.status).toBe(200);
  expect(inquiryData.inquiry.source.kind).toBe("task");
  expect(inquiryData.inquiry.source.sessionId).toBeUndefined();
  const listed = await GET(req(undefined, "GET"));
  expect(listed.headers.get("cache-control")).toContain("no-store");
  expect((await listed.json()).tasks).toHaveLength(1);
});
it("reads imported Claude evidence from saved server stories and refuses client-authored quotes", async () => {
  state.stories = [
    {
      id: "replay-claude-real",
      title: "真实探索",
      source: {
        id: "real",
        runtime: "claude",
        title: "真实来源",
        messages: [
          { id: "u1", role: "user", text: "怎么解决竞态？" },
          {
            id: "a1",
            role: "assistant",
            text: "可以取消旧请求或校验项目归属。",
          },
          { id: "u2", role: "user", text: "只取消还不够，旧请求可能已经返回。" },
          { id: "a2", role: "assistant", text: "同时校验请求归属。" },
        ],
      },
    },
  ];
  const response = await POST(req({ ...input, storyId: "replay-claude-real" }));
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.task.source.kind).toBe("replay");
  expect(data.task.source.runtime).toBe("claude");
  expect(data.task.source.quote).toBe("可以取消旧请求或校验项目归属。");
  expect(data.task.source.excerpts).toContainEqual({ messageId: 'u2', role: 'user', quote: '只取消还不够，旧请求可能已经返回。' });
  expect(
    (
      await POST(
        req({
          ...input,
          requestId: "forged",
          source: {
            sessionId: "s",
            messageIndex: 1,
            messageHash: "a".repeat(64),
            quote: "FORGED",
          },
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await POST(
        req({
          ...input,
          requestId: "missing",
          storyId: "replay-claude-missing",
        }),
      )
    ).status,
  ).toBe(404);
});
it("verifies completed native sources and rejects stale versions, invalid bodies, cross-origin and shared bearer access", async () => {
  const source = {
    sessionId: "session-1",
    messageIndex: 1,
    messageHash: createHash("sha256")
      .update("Compare the request ownership.")
      .digest("hex"),
  };
  const response = await POST(req({ ...input, source }));
  const { task } = await response.json();
  expect(response.status).toBe(200);
  expect(task.source.quote).toBe("Compare the request ownership.");
  expect(
    (
      await POST(
        req({
          ...input,
          requestId: "changed",
          source: { ...source, messageHash: "a".repeat(64) },
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await PATCH(
        req(
          {
            id: task.id,
            version: 50,
            requestId: "stale",
            action: "set-mode",
            mode: "try",
          },
          "PATCH",
        ),
      )
    ).status,
  ).toBe(409);
  expect((await POST(req(null))).status).toBe(400);
  expect((await GET(req(undefined, "GET", "?id=../x"))).status).toBe(400);
  expect((await GET(req(undefined, "GET", "?unknown=1"))).status).toBe(400);
  expect(
    (await POST(req(input, "POST", "", { Origin: "https://other.example" })))
      .status,
  ).toBe(403);
  vi.mocked(readRuntimeAuthConfig).mockReturnValue({
    webSessionSecret: "secret",
    webPassword: "password",
  });
  expect(
    (
      await GET(
        req(undefined, "GET", "", { Authorization: "Bearer shared-agent" }),
      )
    ).status,
  ).toBe(401);
});
it("delivers a committed canvas choice on every retry and accepts an identical concurrent choice without rewriting it", async () => {
  let { task } = await (await POST(req(input))).json();
  ({ task } = await (
    await PATCH(
      req(
        {
          id: task.id,
          version: task.version,
          requestId: "decision",
          action: "add-decision",
          question: "Choose?",
          options: [
            { id: "a", label: "Inspect", tradeoff: "Slower but informative" },
            { id: "b", label: "Restart", tradeoff: "Fast but hides cause" },
          ],
        },
        "PATCH",
      ),
    )
  ).json());
  const command = {
    id: task.id,
    version: task.version,
    requestId: "canvas-choice",
    action: "choose-decision",
    decisionId: task.decisions[0].id,
    optionId: "a",
    prediction: "We will find the stale response",
    confidence: 70,
  };
  delivery.mockReturnValue({ status: "delivered" });
  const saved = await PATCH(req(command, "PATCH"));
  const data = await saved.json();
  expect(saved.status).toBe(200);
  expect(data.decisionDelivery.status).toBe("delivered");
  expect((await PATCH(req(command, "PATCH"))).status).toBe(200);
  expect(delivery).toHaveBeenCalledTimes(2);
  const concurrent = await PATCH(
    req({ ...command, requestId: "second-surface-choice" }, "PATCH"),
  );
  expect(concurrent.status).toBe(200);
  expect((await concurrent.json()).task.version).toBe(data.task.version);
  expect(
    (
      await PATCH(
        req(
          { ...command, requestId: "different-choice", optionId: "b" },
          "PATCH",
        ),
      )
    ).status,
  ).toBe(409);
});
