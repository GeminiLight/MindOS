// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ViewsIndex from "@/components/studio/views/ViewsIndex";
vi.mock("@/lib/stores/locale-store", () => ({
  useLocale: () => ({ locale: "zh" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/studio/views",
}));
vi.mock("@/components/studio/StudioShell", () => ({
  StudioShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const response = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
async function render() {
  await act(async () => {
    root.render(<ViewsIndex />);
    await new Promise((r) => setTimeout(r, 0));
  });
}
describe("Views starts with real content states", () => {
  it("shows an empty workspace without sample contacts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ rootId: "a".repeat(64), views: [], folders: [] }),
        ),
    );
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("视图");
    expect(host.textContent).toContain("创建自己的第一个视图");
    expect(host.textContent).not.toContain("林若舟");
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("使用人脉模板"),
      ),
    ).toBe(true);
  });
  it("distinguishes failure from empty and allows retry", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network"))
      .mockResolvedValue(
        response({ rootId: "a".repeat(64), views: [], folders: [] }),
      );
    vi.stubGlobal("fetch", fetch);
    await render();
    const retry = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "重试",
    );
    expect(retry).toBeTruthy();
    expect(host.textContent).not.toContain("创建自己的第一个视图");
    await act(async () => {
      retry!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.textContent).toContain("创建自己的第一个视图");
  });
  it("continues at the last person with a visible original binding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          rootId: "a".repeat(64),
          folders: ["生活/人脉"],
          views: [
            {
              id: "v-abc12345",
              name: "重要的人",
              folder: "生活/人脉",
              template: "people",
              version: 1,
              createdAt: "2026-10-12T00:00:00Z",
              updatedAt: "2026-10-12T00:00:00Z",
              lastOpenedAt: "2026-10-12T01:00:00Z",
              lastPersonId: "p-abc12345",
              lastPersonName: "叶遥",
              availability: "ready",
            },
          ],
        }),
      ),
    );
    await render();
    expect(
      host.querySelector('a[aria-label="继续重要的人"]')?.getAttribute("href"),
    ).toContain("person=p-abc12345");
    expect(host.textContent).toContain("生活/人脉");
  });
});

it("presents one workspace card for a collection with multiple saved views", async () => {
  const common = {
    folder: "Projects/A",
    template: "tasks",
    collectionId: "c-one",
    version: 1,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    availability: "ready",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      response({
        rootId: "root",
        folders: [],
        views: [
          {
            ...common,
            id: "v-first",
            name: "项目主页",
            spec: { layout: "table" },
          },
          {
            ...common,
            id: "v-second",
            name: "推进看板",
            spec: { layout: "board" },
            createdAt: "2026-10-02",
          },
        ],
      }),
    ),
  );
  await render();
  expect(host.querySelectorAll("[data-view-workspace]")).toHaveLength(1);
  expect(host.textContent).toContain("项目主页");
  expect(host.textContent).toContain("2 种查看方式");
  expect(host.querySelector('a[href="/studio/views/v-second"]')).not.toBeNull();
});
