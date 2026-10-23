import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createCoevolutionTask,
  updateCoevolutionTask,
  getCoevolutionTask,
  listCoevolutionTasks,
  coevolutionMethods,
  getLearningLoop,
  updateLearningLoop,
  getInquiry,
  createCoevolutionInquiry,
  updateInquiry,
  prepareCoevolutionTaskRun,
  consumeCoevolutionDraft,
} from "../../packages/mindos/dist/knowledge.js";

// Isolated synthetic content: real domain persistence behind the browser route,
// without publishing fixture standards to the user's knowledge base.
export async function workspaceFixture(
  page: Page,
  baseURL: string,
  empty = false,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coevolution-e2e-"));
  const privateDirectory = path.join(
    os.homedir(),
    ".mindos/private-learning",
    createHash("sha256")
      .update(fs.realpathSync(root))
      .digest("hex")
      .slice(0, 24),
  );
  let failNext = false;
  let task = empty
    ? undefined
    : createCoevolutionTask(root, {
        requestId: "fixture",
        title: "一次真实判断的练习",
        goal: "比较保留熟悉入口与整体重做的代价。合成体验测试。",
        mode: "together",
      });
  function view(id?: string) {
    const t = id ? getCoevolutionTask(root, id)! : task!;
    const ids = [
      ...t.corrections.map((c) => c.learningId),
      ...t.agreements.map((a) => a.learningId),
    ].filter(Boolean) as string[];
    return {
      task: t,
      methods: coevolutionMethods(root),
      runs: [],
      learningLoops: ids.map((id) => getLearningLoop(root, id)).filter(Boolean),
      inquiry: t.inquiryId ? getInquiry(root, t.inquiryId) : undefined,
    };
  }
  await page
    .context()
    .addCookies([{ name: "locale", value: "zh", url: baseURL }]);
  await page.addInitScript(() => {
    localStorage.setItem("locale", "zh");
    localStorage.setItem("theme", "light");
  });
  await page.route("**/api/echo/replays?*", (route) =>
    route.fulfill({ json: { stories: [], sources: [], sourceErrors: [] } }),
  );
  await page.route("**/api/echo/coevolution*", async (route) => {
    const req = route.request(),
      body = req.method() === "GET" ? null : req.postDataJSON();
    if (failNext && body) {
      failNext = false;
      await route.abort();
      return;
    }
    try {
      if (req.method() === "GET") {
        const id = new URL(req.url()).searchParams.get("id");
        await route.fulfill({
          json: id
            ? view(id)
            : {
                ...listCoevolutionTasks(root),
                methods: coevolutionMethods(root),
              },
        });
        return;
      }
      if (req.method() === "POST") task = createCoevolutionTask(root, body);
      else if (body.action === 'prepare') {
        const { id, action: _action, ...command } = body;
        const prepared = prepareCoevolutionTaskRun(root, id, command);
        task = prepared.task;
        await route.fulfill({json:{...view(task.id),draft:prepared.draft}});
        return;
      }
      else if (body.action === "create-inquiry") {
        const { id, action: _action, ...command } = body;
        task = createCoevolutionInquiry(root, id, command).task;
      } else {
        const { id, ...command } = body;
        task = updateCoevolutionTask(root, id, command);
      }
      await route.fulfill({ json: view(task!.id) });
    } catch (error) {
      await route.fulfill({
        status: 409,
        json: { code: "conflict", error: String(error) },
      });
    }
  });
  await page.route("**/api/echo/learning", async (route) => {
    const { id, ...command } = route.request().postDataJSON();
    try {
      await route.fulfill({
        json: { loop: updateLearningLoop(root, id, command) },
      });
    } catch (error) {
      await route.fulfill({
        status: 409,
        json: { code: "conflict", error: String(error) },
      });
    }
  });
  await page.route("**/api/echo/inquiries*", async (route) => {
    try {
      if (route.request().method() === "GET") {
        const id = new URL(route.request().url()).searchParams.get("id")!;
        await route.fulfill({
          json: { inquiry: getInquiry(root, id), runs: [] },
        });
      } else {
        const { id, ...command } = route.request().postDataJSON();
        await route.fulfill({
          json: { inquiry: updateInquiry(root, id, command), runs: [] },
        });
      }
    } catch (error) {
      await route.fulfill({
        status: 409,
        json: { code: "conflict", error: String(error) },
      });
    }
  });
  return {
    root,
    getTask: () => task && getCoevolutionTask(root, task.id)!,
    bindChat: (chatSessionId: string) => {
      const prepared = prepareCoevolutionTaskRun(root, task!.id, {version:task!.version, requestId:'bind-chat'});
      task = consumeCoevolutionDraft(root,{prompt:prepared.draft.prompt,chatSessionId})!;
    },
    fail: () => {
      failNext = true;
    },
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(privateDirectory, { recursive: true, force: true });
    },
  };
}
export async function fill(page: Page, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values))
    await page.locator(`[name="${name}"]:visible`).last().fill(value);
}
export async function tool(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: false }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
}
