// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ContextHandoff from "@/components/studio/context/ContextHandoff";
import ProgressDialog from "@/components/studio/context/ProgressDialog";
import { ViewsApiError } from "@/lib/views/api";
import { writeViewDraft } from "@/lib/views/drafts";
const mocks = vi.hoisted(() => ({ chat: vi.fn(), save: vi.fn() }));
vi.mock("@/hooks/useAskModal", () => ({ openAskModal: mocks.chat }));
vi.mock("@/lib/context-work/api", async (original) => ({
  ...(await original<typeof import("@/lib/context-work/api")>()),
  saveContextProgress: mocks.save,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const click = async (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === text)!
      .click();
  });
const fill = async (el: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const items = [
  { id: "brief", label: "项目简报.md", path: "项目/项目简报.md" },
  { id: "other", label: "其他资料.md", path: "项目/其他资料.md" },
];
const props = {
  rootId: "root-a",
  scopeId: "project-a",
  title: "MindOS",
  folder: "项目",
  items,
  defaults: ["brief"],
  initialGoal: "核对下一步",
  locale: "zh",
  close: vi.fn(),
};
it("hands off only checked materials directly into an unsent draft", async () => {
  const prepare = vi.fn().mockResolvedValue("核对下一步\n选中资料");
  await act(async () =>
    root.render(<ContextHandoff {...props} prepare={prepare} />),
  );
  await click("在 MindOS 中继续");
  expect(prepare).toHaveBeenCalledWith(
    ["brief"],
    "核对下一步",
    "MindOS",
    expect.any(AbortSignal),
  );
  expect(mocks.chat).toHaveBeenCalledWith(
    "核对下一步\n选中资料",
    "user",
    null,
    { newSession: true },
  );
});
it("lets the reader inspect a file inline without changing the selected material", async () => {
  const inspect = vi.fn();
  const prepare = vi.fn().mockResolvedValue("选中资料");
  const origin = { kind: "project" as const, id: "one", title: "MindOS", folder: "项目", mode: "files" as const, file: items[0].path };
  await act(async () => root.render(<ContextHandoff {...props} presentation="inline" position={origin} inspect={inspect} prepare={prepare} />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="查看 其他资料.md"]')!.click());
  expect(inspect).toHaveBeenCalledWith(items[1].path);
  expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
  await click("在 MindOS 中继续");
  expect(mocks.chat.mock.calls[0][3].handoffOrigin).toEqual({ rootId: "root-a", title: "MindOS", folder: "项目", position: origin, items: [items[0]] });
});
it("keeps explicit choices when browsing another file and adds it only on request", async () => {
  const prepare = vi.fn();
  await act(async () => root.render(<ContextHandoff {...props} activeItemId="brief" prepare={prepare} />));
  await fill(host.querySelector("textarea")!, "继续核对原来的判断");
  await act(async () => root.render(<ContextHandoff {...props} activeItemId="other" prepare={prepare} />));
  expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
  expect(host.querySelector("textarea")!.value).toBe("继续核对原来的判断");
  await click("带上当前文件");
  expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
});
it("recovers an earlier file-specific draft when moving to one shared Context handoff", async () => {
  writeViewDraft({ rootId: props.rootId, viewId: "old-file-scope", personId: props.folder, kind: "handoff" }, {
    revision: "", operationId: "", updatedAt: Date.now(), values: { goal: "之前未完成的目标", target: "Codex", "item:brief":true },
  });
  await act(async () => root.render(<ContextHandoff {...props} legacyScopeId="old-file-scope" prepare={vi.fn()} />));
  expect(host.querySelector('textarea')!.value).toBe('之前未完成的目标');
  expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
  expect(host.textContent).toContain('复制给 Codex');
});
it("keeps a goal on stale material and offers recovery", async () => {
  const prepare = vi
    .fn()
    .mockRejectedValue(new ViewsApiError("REVISION_CONFLICT", 409));
  await act(async () =>
    root.render(
      <ContextHandoff {...props} prepare={prepare} reload={vi.fn()} />,
    ),
  );
  await click("在 MindOS 中继续");
  expect(mocks.chat).not.toHaveBeenCalled();
  expect(host.textContent).toContain("资料已被修改");
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "核对下一步",
  );
  expect(host.textContent).toContain("重新读取资料");
});
it("prevents empty selection and restores unfinished input", async () => {
  const prepare = vi.fn();
  await act(async () =>
    root.render(<ContextHandoff {...props} prepare={prepare} />),
  );
  await fill(host.querySelector("textarea")!, "还没写完的目标");
  await act(async () =>
    (host.querySelector("input[type=checkbox]") as HTMLInputElement).click(),
  );
  expect(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "在 MindOS 中继续",
    )!.disabled,
  ).toBe(true);
  await act(async () => root.render(null));
  await act(async () =>
    root.render(<ContextHandoff {...props} prepare={prepare} />),
  );
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "还没写完的目标",
  );
  expect(prepare).not.toHaveBeenCalled();
});
it("retries failed progress with the same operation and reports actual success", async () => {
  const saved = vi.fn();
  mocks.save
    .mockRejectedValueOnce(new ViewsApiError("WRITE_FAILED"))
    .mockResolvedValue({ path: "项目/进展/n.md" });
  await act(async () =>
    root.render(
      <ProgressDialog
        rootId="root-a"
        scopeId="project-a"
        folder="项目"
        locale="zh"
        close={vi.fn()}
        saved={saved}
      />,
    ),
  );
  await fill(host.querySelector("textarea")!, "确认资料后再安排开发");
  await click("保存进展");
  expect(saved).not.toHaveBeenCalled();
  expect(host.textContent).toContain("保存未完成");
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "确认资料后再安排开发",
  );
  await click("保存进展");
  expect(saved).toHaveBeenCalledWith("项目/进展/n.md");
  expect(mocks.save.mock.calls[0][2].operationId).toBe(
    mocks.save.mock.calls[1][2].operationId,
  );
});
it("does not save blank progress", async () => {
  await act(async () =>
    root.render(
      <ProgressDialog
        rootId="root-a"
        scopeId="project-a"
        folder="项目"
        locale="zh"
        close={vi.fn()}
        saved={vi.fn()}
      />,
    ),
  );
  expect(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "保存进展",
    )!.disabled,
  ).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("does not auto-include a material that becomes available after reloading", async () => {
  const prepare = vi.fn().mockResolvedValue("选中资料");
  await act(async () =>
    root.render(
      <ContextHandoff
        {...props}
        defaults={["brief", "other"]}
        items={[items[0]!]}
        prepare={prepare}
      />,
    ),
  );
  await act(async () =>
    root.render(
      <ContextHandoff
        {...props}
        defaults={["brief", "other"]}
        items={items}
        prepare={prepare}
      />,
    ),
  );
  expect(host.querySelectorAll("input:checked")).toHaveLength(1);
});
it("ignores a prepared response after the library changes", async () => {
  let resolve!: (text: string) => void;
  const prepare = vi.fn(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  );
  await act(async () =>
    root.render(<ContextHandoff {...props} prepare={prepare} />),
  );
  await click("在 MindOS 中继续");
  await act(async () =>
    root.render(
      <ContextHandoff {...props} rootId="root-b" prepare={prepare} />,
    ),
  );
  await act(async () => resolve("迟到的旧资料"));
  expect(mocks.chat).not.toHaveBeenCalled();
  expect(host.textContent).toContain("知识库已切换");
});

it("filters materials without silently dropping selected files", async () => {
  const prepare = vi.fn().mockResolvedValue("only selected");
  await act(async () =>
    root.render(
      <ContextHandoff
        {...props}
        items={[
          ...items,
          ...Array.from({ length: 4 }, (_, n) => ({
            id: `extra${n}`,
            label: `附件${n}`,
            path: `项目/附件${n}.md`,
          })),
        ]}
        prepare={prepare}
      />,
    ),
  );
  const search = host.querySelector<HTMLInputElement>(
    'input[aria-label="查找交接资料"]',
  );
  expect(search).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "其他");
    search!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  expect(host.querySelector("footer")?.textContent).toContain("已选 1 份资料");
  await click("只看已选");
  expect(host.querySelector('input[aria-label="项目简报.md"]')).not.toBeNull();
  await click("在 MindOS 中继续");
  expect(prepare.mock.calls[0][0]).toEqual(["brief"]);
});
it("explains a blank goal next to the disabled handoff action", async () => {
  await act(async () =>
    root.render(<ContextHandoff {...props} initialGoal="" prepare={vi.fn()} />),
  );
  expect(host.querySelector("footer")?.textContent).toContain(
    "先写下希望 Agent 帮你做什么",
  );
});
it("stops at twelve materials but lets the user remove a selection", async () => {
  const many = Array.from({ length: 13 }, (_, n) => ({
    id: String(n),
    label: `材料 ${n}`,
    path: `项目/${n}.md`,
  }));
  await act(async () =>
    root.render(
      <ContextHandoff
        {...props}
        items={many}
        defaults={many.slice(0, 12).map((x) => x.id)}
        prepare={vi.fn()}
      />,
    ),
  );
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="材料 12"]')
      ?.disabled,
  ).toBe(true);
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[aria-label="材料 0"]')!.click(),
  );
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="材料 12"]')
      ?.disabled,
  ).toBe(false);
});
