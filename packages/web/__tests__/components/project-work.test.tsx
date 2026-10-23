// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import ProjectWorkPanel from "@/components/studio/projects/ProjectWorkPanel";
const { request, push } = vi.hoisted(() => ({
  request: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/views/page-api", async () => ({
  ...(await vi.importActual("@/lib/views/page-api")),
  pageRequest: request,
}));
vi.mock("@/lib/stores/locale-store", () => ({
  useLocale: () => ({ locale: "zh" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/useSmoothRouterPush", () => ({
  useSmoothRouterPush: () => push,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock("@/lib/server-events", () => ({
  subscribeServerEvents: () => () => {},
}));
vi.mock("@/lib/files-changed", () => ({
  subscribeFilesChanged: () => () => {},
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const project = {
  id: "launch",
  title: "产品发布",
  goal: "准备评审",
  taskCollectionIds: ["c-tasks1234"],
  personRefs: ["c-people123/p-person123"],
  version: 1,
  updatedAt: "2026-10-23T00:00:00Z",
};
const snapshot = {
  rootId: "root-a",
  project,
  pageId: "page-test12345",
  people: [
    {
      ref: project.personRefs[0],
      name: "林悦",
      path: "People/林悦.md",
      revision: "rev1",
      schemaRevision: "schema",
      href: "/studio/views/v-person123?person=p-person123",
    },
  ],
  activity: [],
  incomplete: false,
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  request.mockReset();
  push.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  request.mockImplementation(async (op: string) => {
    if (op === "list") return { rootId: "root-a", collections: [], views: [] };
    if (op === "project.list") return { rootId: "root-a", projects: [project] };
    if (op === "project.read") return snapshot;
    if (op === "project.page") return { page: { id: "page-test12345" } };
    if (op === "project.interact") return {};
    throw Error("unexpected " + op);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
async function click(label: string) {
  await act(async () => button(label).click());
}
async function text(value: string) {
  await act(async () => {
    const el = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("shows durable relationships and writes communication with original person revisions", async () => {
  await act(async () => root.render(<ProjectWorkPanel projectId="launch" />));
  expect(host.textContent).toContain("林悦");
  await click("记录沟通");
  await text("原型评审通过");
  await submit();
  expect(request).toHaveBeenCalledWith(
    "project.interact",
    expect.objectContaining({
      projectId: "launch",
      personRef: project.personRefs[0],
      text: "原型评审通过",
      expectedRevision: "rev1",
      expectedVersion: 1,
      expectedRootId: "root-a",
    }),
  );
});
it("preserves communication input after write failure and retries the same operation identity", async () => {
  request.mockImplementation(async (op: string) => {
    if (op === "list") return { rootId: "root-a", collections: [], views: [] };
    if (op === "project.list") return { projects: [project] };
    if (op === "project.read") return snapshot;
    if (op === "project.interact") throw Error("资料已更新，请刷新");
  });
  await act(async () => root.render(<ProjectWorkPanel projectId="launch" />));
  await click("记录沟通");
  await text("保持我的草稿");
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "资料已更新",
  );
  expect(host.querySelector("textarea")?.value).toBe("保持我的草稿");
  await submit();
  const calls = request.mock.calls.filter((c) => c[0] === "project.interact");
  expect(calls).toHaveLength(2);
  expect(calls[0][1].operationId).toBe(calls[1][1].operationId);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<ProjectWorkPanel projectId="launch" />));
  await submit();
  const reloaded = request.mock.calls.filter(
    (c) => c[0] === "project.interact",
  );
  expect(reloaded[2][1].operationId).toBe(calls[0][1].operationId);
});
it("keeps preview communication read-only and displays existing records", async () => {
  request.mockImplementation(async (op: string) =>
    op === "list"
      ? { rootId: "root-a", collections: [], views: [] }
      : op === "project.list"
        ? { projects: [project] }
        : {
            ...snapshot,
            activity: [
              {
                id: "i-1",
                date: "2026-10-23",
                text: "已经确认",
                personName: "林悦",
                personRef: project.personRefs[0],
                path: "People/林悦.md",
                source: "",
              },
            ],
          },
  );
  await act(async () =>
    root.render(<ProjectWorkPanel projectId="launch" readOnly />),
  );
  expect(host.textContent).toContain("已经确认");
  expect(button("记录沟通")).toBeUndefined();
});
it("prepares the canonical page before navigating, including the first open", async () => {
  await act(async () => root.render(<ProjectWorkPanel projectId="launch" />));
  await click("打开工作页面");
  expect(request).toHaveBeenCalledWith("project.page", {
    projectId: "launch",
    expectedRootId: "root-a",
  });
  expect(push).toHaveBeenCalledWith("/studio/pages/page-test12345");
});
