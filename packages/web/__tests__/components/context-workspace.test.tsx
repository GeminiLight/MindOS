// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import Workspace from "@/components/studio/context/ProjectContextWorkspace";
import { clearContinuityMemory } from "@/lib/context-work/continuity";
import { ViewsApiError } from "@/lib/views/api";
import type { StudioProject } from "@/lib/studio-projects";
const mocks = vi.hoisted(() => ({
  query: "mode=files",
  read: vi.fn(),
  file: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/views/hooks", async (original) => ({
  ...(await original<any>()),
  useViewsIndex: () => ({
    data: { rootId: "root-a", folders: ["项目", "新目录"], views: [] },
    loading: false,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@/lib/context-work/api", async (original) => ({
  ...(await original<any>()),
  readContext: mocks.read,
  readContextFile: mocks.file,
}));
vi.mock("@/lib/studio-projects", async (original) => ({
  ...(await original<any>()),
  updateStudioProjectDefaults: mocks.update,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const project = {
  id: "one",
  title: "Project",
  goal: "",
  space: "项目",
  spaces: [{ path: "项目", source: "project-default" }],
  kits: [],
  workArea: "Mind",
  cadence: "",
  stage: "active",
  progress: 0,
  updated: "",
  nextAction: "",
  sessions: [],
  reviewItems: [],
  lessons: [],
} as StudioProject;
const progress = {
  id: "uuid",
  title: "核对文件与视图",
  text: "已核对",
  path: "项目/进展/uuid.md",
  source: "我的记录",
  createdAt: "2026-10-15T00:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearContinuityMemory();
  mocks.query = "mode=files";
  mocks.read.mockImplementation(async (_root, folder) => ({
    rootId: "root-a",
    folder,
    files: [
      { path: folder + "/brief.md", name: "brief.md", size: 12 },
      { path: progress.path, name: "uuid.md", size: 20 },
    ],
    progress: [progress],
    limited: false,
    skipped: 0,
  }));
  mocks.file.mockImplementation(async (_root, _folder, path) => ({
    rootId: "root-a",
    path,
    content: "# 原文",
    revision: "v1",
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(<Workspace project={project} locale="zh" />),
  );
}
async function search(text: string) {
  await act(async () => {
    const el = host.querySelector<HTMLInputElement>(
      'input[aria-label="查找文件"]',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("finds progress by the title the reader sees and can clear an empty result", async () => {
  await render();
  await search("核对文件");
  const nav = host.querySelector('nav[aria-label="Context 文件"]')!;
  expect(nav.textContent).toContain("核对文件与视图");
  expect(nav.textContent).not.toContain("brief.md");
  await search("不存在");
  expect(nav.textContent).toContain("没有找到文件");
  const clear = host.querySelector<HTMLButtonElement>(
    'button[aria-label="清除文件搜索"]',
  );
  expect(clear).not.toBeNull();
  await act(async () => clear!.click());
  expect(nav.textContent).toContain("brief.md");
});
it("clears the old search when the user changes Context folders", async () => {
  await render();
  await search("不存在");
  await act(async () =>
    root.render(
      <Workspace
        project={{
          ...project,
          spaces: [{ path: "新目录", source: "project-default" }],
        }}
        locale="zh"
      />,
    ),
  );
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="查找文件"]')?.value,
  ).toBe("");
  expect(host.querySelector("nav")?.textContent).toContain("brief.md");
});
it("keeps the handoff and the reading pane mounted across file and view changes", async () => {
  await render();
  const article = host.querySelector('article')!;
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '交给 Agent')!.click());
  const handoff = host.querySelector('section[aria-label="交给 Agent"]')!;
  expect(handoff).not.toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  const input = handoff.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '同一份 Context 的目标');
    input.dispatchEvent(new Event('input', { bubbles:true }));
  });
  mocks.query = 'mode=view&file=' + encodeURIComponent(progress.path);
  await render();
  expect(host.querySelector('article')).toBe(article);
  expect(host.querySelector('section[aria-label="交给 Agent"]')).toBe(handoff);
  expect(input.value).toBe('同一份 Context 的目标');
  expect(handoff.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
  expect(handoff.textContent).toContain('带上当前文件');
});
it.each(["files", "view"])("keeps %s readable while refreshing and explains a refresh failure", async (mode) => {
  mocks.query = `mode=${mode}`;
  await render();
  const content = mode === "files" ? "原文" : "已核对";
  expect(host.textContent).toContain(content);
  let failRefresh!: (error: Error) => void;
  mocks.read.mockImplementation(() => new Promise((_resolve, reject) => {
    failRefresh = reject;
  }));
  mocks.file.mockImplementation(() => new Promise(() => {}));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).toContain(content);
  expect(host.textContent).toContain("正在更新资料");
  const handoff = [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find(el => el.textContent === "交给 Agent");
  expect(handoff?.disabled).toBe(true);
  await act(async () => failRefresh(new ViewsApiError("NETWORK_ERROR", 503)));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).toContain("重新读取");
  expect(host.querySelector(mode === "files" ? "article" : "ol")).toBeNull();
});
it("offers an inline reconnection when the current folder was moved", async () => {
  mocks.read.mockRejectedValue(new ViewsApiError("FOLDER_MISSING", 404));
  await render();
  expect(
    host.querySelector('[role="combobox"][aria-label="关联资料文件夹"]'),
  ).not.toBeNull();
  expect(host.textContent).toContain("重新关联资料文件夹");
  expect(mocks.update).not.toHaveBeenCalled();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click(),
  );
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find((el) => el.textContent === "新目录")!.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((el) => el.textContent === "关联文件夹")!.click());
  expect(mocks.update).toHaveBeenCalledWith("one", {
    spaces: [{ path: "新目录", label: "新目录", source: "project-default" }],
  });
});
