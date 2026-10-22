// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import PageWorkspace from "@/components/studio/pages/PageWorkspace";
import { PageRequestError } from "@/lib/views/page-api";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/views/page-api", async () => ({
  ...(await vi.importActual("@/lib/views/page-api")),
  pageRequest: mocks.request,
}));
vi.mock("@/lib/stores/locale-store", () => ({
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...p }: any) => <a {...p}>{children}</a>,
}));
vi.mock("@/components/studio/StudioShell", () => ({
  StudioShell: ({ children }: any) => <main>{children}</main>,
}));
vi.mock("@/lib/server-events", () => ({
  subscribeServerEvents: () => () => {},
}));
vi.mock("@/lib/files-changed", () => ({
  subscribeFilesChanged: () => () => {},
}));
vi.mock("@/components/studio/pages/PageCanvas", () => ({
  default: ({ spec }: any) => <section data-canvas>{spec.title}</section>,
}));
vi.mock("@/components/studio/pages/PageInspector", () => ({
  default: ({ spec, change }: any) => (
    <button onClick={() => change({ ...spec, title: "My revision" })}>
      Change title
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const spec = {
  specVersion: 1,
  title: "Project focus",
  layout: { columns: 2, density: "comfortable" },
  blocks: [
    { id: "one", kind: "tasks", title: "Tasks", collectionId: "c-one12345" },
  ],
};
const page = {
  id: "page-one",
  version: 3,
  spec,
  history: [],
  createdAt: "2026-10-22",
  updatedAt: "2026-10-22",
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  mocks.request.mockReset();
  mocks.replace.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.request.mockImplementation(async (op: string, input: any) => {
    if (op === "list") return { rootId: "root-a", collections: [], views: [] };
    if (op === "page.read") return { rootId: "root-a", page, blocks: [] };
    if (op === "page.preview")
      return { rootId: "root-a", spec: input.spec, blocks: [] };
    if (op === "page.generate")
      return {
        rootId: "root-a",
        spec: { ...input.spec, title: "AI revision" },
        summary: "Title adjusted",
      };
    if (op === "page.save")
      return {
        rootId: "root-a",
        page: { ...page, version: 4, spec: input.spec },
      };
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
async function render() {
  await act(async () => root.render(<PageWorkspace pageId="page-one" />));
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function prompt(value: string) {
  if (!host.querySelector("textarea")) await click("Adjust with AI");
  await act(async () => {
    const el = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function generate() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("keeps local edits during source refresh and saves against the original page version", async () => {
  await render();
  await click("Customize");
  await click("Change title");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.querySelector("h1")?.textContent).toBe("My revision");
  await click("Save changes");
  expect(mocks.request).toHaveBeenCalledWith(
    "page.save",
    expect.objectContaining({
      expectedRootId: "root-a",
      expectedVersion: 3,
      spec: expect.objectContaining({ title: "My revision" }),
    }),
  );
  expect(mocks.request.mock.calls.some((c) => c[0] === "mutate")).toBe(false);
});
it("previews AI changes without persisting and applies them only on request", async () => {
  await render();
  await prompt("Make my title clearer");
  await generate();
  expect(host.textContent).toContain("Preview · not applied");
  expect(mocks.request.mock.calls.some((c) => c[0] === "page.save")).toBe(
    false,
  );
  await click("Keep original");
  expect(host.querySelector("h1")?.textContent).toBe("Project focus");
  await generate();
  await click("Apply changes");
  expect(host.querySelector("h1")?.textContent).toBe("AI revision");
  await click("Save changes");
  expect(mocks.request).toHaveBeenCalledWith(
    "page.save",
    expect.objectContaining({
      spec: expect.objectContaining({ title: "AI revision" }),
    }),
  );
});
it("ignores a late generated response after the user stops", async () => {
  let resolve!: (v: any) => void;
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((op, ...args) =>
    op === "page.generate"
      ? new Promise((r) => {
          resolve = r;
        })
      : original(op, ...args),
  );
  await render();
  await prompt("Change the title");
  await generate();
  await click("Stop");
  await act(async () =>
    resolve({ rootId: "root-a", spec: { ...spec, title: "Late result" } }),
  );
  expect(host.querySelector("h1")?.textContent).toBe("Project focus");
  expect(host.textContent).not.toContain("Review these changes");
});
it("keeps the request and manual editor usable when AI is unconfigured", async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((op, ...args) =>
    op === "page.generate"
      ? Promise.reject(
          new PageRequestError("Configure AI", "AI_NOT_CONFIGURED", 503),
        )
      : original(op, ...args),
  );
  await render();
  await prompt("Arrange my week");
  await generate();
  expect(host.querySelector("textarea")?.value).toBe("Arrange my week");
  expect(host.textContent).toContain("Open settings");
  await click("Customize");
  await click("Change title");
  expect(host.querySelector("h1")?.textContent).toBe("My revision");
});
it("discards an old library generation when the active library changes", async () => {
  let resolve!: (value: any) => void,
    library = "root-a";
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((op, ...args) =>
    op === "page.generate"
      ? new Promise((r) => {
          resolve = r;
        })
      : op === "list"
        ? Promise.resolve({ rootId: library, collections: [], views: [] })
        : op === "page.read"
          ? Promise.resolve({ rootId: library, page, blocks: [] })
          : original(op, ...args),
  );
  await render();
  await prompt("Change my layout");
  await generate();
  library = "root-b";
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () =>
    resolve({ rootId: "root-a", spec: { ...spec, title: "Wrong library" } }),
  );
  expect(host.querySelector("h1")?.textContent).toBe("Project focus");
  expect(host.textContent).not.toContain("Wrong library");
});

it("keeps saved pages focused on content and preserves the prompt when the AI editor is folded", async () => {
  await render();
  expect(host.querySelector("textarea")).toBeNull();
  await click("Adjust with AI");
  await prompt("Make it quieter");
  await click("Collapse");
  expect(host.querySelector("textarea")).toBeNull();
  await click("Adjust with AI");
  expect(host.querySelector("textarea")?.value).toBe("Make it quieter");
  await generate();
  expect(host.textContent).toContain("Preview · not applied");
  expect(host.querySelector("textarea")).not.toBeNull();
  expect(button("Collapse")).toBeUndefined();
});
it("opens the AI editor immediately for a new page", async () => {
  await act(async () => root.render(<PageWorkspace pageId="new" />));
  expect(host.querySelector("textarea")).not.toBeNull();
});
