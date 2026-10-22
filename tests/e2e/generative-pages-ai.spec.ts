import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { PageSpec } from "@geminilight/mindos/knowledge/views";
import { chinesePage, pageFixture } from "../helpers/pages-fixture";

test.use({ actionTimeout: 15_000 });

test.skip(
  process.env.MINDOS_VIEWS_REAL_AI !== "1",
  "Real provider calls require the --real-ai runner option",
);
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Use the isolated Views runner",
);

async function generate(page: Page, prompt: string): Promise<PageSpec> {
  const started = Date.now();
  console.info("[real-ai] Opening AI and requesting page preview");
  await expect
    .poll(
      async () =>
        (await page.getByLabel("描述页面调整").isVisible()) ||
        (await page
          .getByRole("button", { name: "用 AI 调整", exact: true })
          .isVisible()),
      { timeout: 15_000 },
    )
    .toBe(true);
  if (!(await page.getByLabel("描述页面调整").isVisible())) {
    await page.getByRole("button", { name: "用 AI 调整", exact: true }).click();
  }
  await page.getByLabel("描述页面调整").fill(prompt);
  const responsePromise = page.waitForResponse(
    (response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === "/api/views/v2" &&
        request.method() === "POST" &&
        request.postDataJSON()?.op === "page.generate"
      );
    },
    { timeout: 105_000 },
  );
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  const response = await responsePromise;
  const body = await response.json();
  console.info(
    `[real-ai] Generation returned HTTP ${response.status()} after ${Date.now() - started} ms`,
  );
  expect(
    response.status(),
    JSON.stringify({ error: body.error, message: body.message }),
  ).toBe(200);
  await expect(
    page.getByRole("region", { name: "调整预览", exact: true }),
  ).toBeVisible();
  return body.spec;
}

test("uses the configured AI to create, refine, lock, save and reopen a real working page", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const fixture = await pageFixture(request);
  await chinesePage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const listPages = async () =>
    (await (await request.get("/api/views/v2?op=page.list")).json()).pages;
  const initialPageCount = (await listPages()).length;
  const sourceBefore = (await fixture.read(fixture.tasks.collection.id))
    .records;
  await page.goto("/studio/pages/new");
  await expect(page.locator("[data-page-block]")).toHaveCount(0);

  // The first case has unique source names: users should not need internal IDs.
  const generated = await generate(
    page,
    `创建名为“我的项目工作台”的页面，两栏、舒展布局。恰好两个模块：` +
      "“本周推进”任务模块，使用名为“产品推进”的资料，展示 title、status、dueDate；" +
      "“协作伙伴”人物模块，使用名为“伙伴”的人物资料。" +
      "使用内置任务和人物模块，不添加其他模块，不筛选记录，不改变原始资料。",
  );
  expect(generated.title).toBe("我的项目工作台");
  expect(generated.layout).toEqual({ columns: 2, density: "comfortable" });
  expect(generated.blocks).toHaveLength(2);
  const taskBlock = generated.blocks.find((block) => block.kind === "tasks")!;
  const personBlock = generated.blocks.find(
    (block) => block.kind === "people",
  )!;
  expect(taskBlock?.collectionId).toBe(fixture.tasks.collection.id);
  expect(personBlock?.collectionId).toBe(fixture.people.collection.id);
  expect((await listPages()).length).toBe(initialPageCount);
  await expect(
    page.getByRole("button", { name: "保留此页面", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "应用调整", exact: true }).click();
  await expect(
    page.getByText("评审工作台原型", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("林悦", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "保留此页面", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/pages\/page-[^/?]+$/);
  const pageId = new URL(page.url()).pathname.split("/").at(-1)!;
  const readPage = async () =>
    (
      await (
        await request.get("/api/views/v2?op=page.read&pageId=" + pageId)
      ).json()
    ).page;
  await expect.poll(async () => (await readPage()).version).toBe(1);
  console.info("[real-ai] Initial page saved as version 1");

  await page
    .locator(`[data-page-block="${taskBlock.id}"]`)
    .getByRole("button", { name: "调整", exact: true })
    .click();
  const refined = await generate(
    page,
    "只调整选中的任务模块：标题改为“下一步行动”，展示方式改为表格（layout 为 table），保留 title、status、dueDate 字段，保留来源和所有记录。",
  );
  expect(
    refined.blocks.find((block) => block.id === taskBlock.id),
  ).toMatchObject({ title: "下一步行动", layout: "table" });
  expect(refined.blocks.filter((block) => block.id !== taskBlock.id)).toEqual(
    generated.blocks.filter((block) => block.id !== taskBlock.id),
  );
  expect({ ...refined, blocks: [] }).toEqual({ ...generated, blocks: [] });
  expect((await readPage()).spec).toEqual(generated);
  await page.getByRole("button", { name: "应用调整", exact: true }).click();
  await page.getByRole("button", { name: "保存调整", exact: true }).click();
  await expect.poll(async () => (await readPage()).version).toBe(2);
  console.info(
    "[real-ai] Selected task refinement saved as version 2; selecting people block",
  );

  await page
    .locator(`[data-page-block="${personBlock.id}"]`)
    .getByRole("button", { name: "调整", exact: true })
    .click();
  console.info("[real-ai] People block selected; locking it");
  await page
    .getByRole("complementary", { name: "页面设置", exact: true })
    .getByRole("button", { name: "锁定", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "已锁定", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  console.info("[real-ai] People block locked; clearing selected-block scope");
  await page
    .getByRole("region", { name: "用 AI 调整页面", exact: true })
    .getByRole("button", { name: /^仅调整：/ })
    .click();
  const adjusted = await generate(
    page,
    "将整页标题改为“每天推进一步”，布局改为一栏、紧凑（columns 为 1，density 为 compact）。保留现有两个模块、模块 ID 和数据来源，完全保留已经锁定的人物模块。",
  );
  expect(adjusted.title).toBe("每天推进一步");
  expect(adjusted.layout).toEqual({ columns: 1, density: "compact" });
  expect(adjusted.blocks).toHaveLength(2);
  expect(adjusted.blocks.find((block) => block.id === personBlock.id)).toEqual({
    ...personBlock,
    locked: true,
  });
  expect((await readPage()).version).toBe(2);
  await page.getByRole("button", { name: "应用调整", exact: true }).click();
  await page.getByRole("button", { name: "保存调整", exact: true }).click();
  await expect.poll(async () => (await readPage()).version).toBe(3);
  console.info(
    "[real-ai] Whole-page refinement saved as version 3; verifying reload",
  );

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "每天推进一步", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(`[data-page-block="${personBlock.id}"]`)
      .getByLabel("已锁定", { exact: true }),
  ).toBeVisible();
  expect((await readPage()).spec).toEqual(adjusted);
  expect((await fixture.read(fixture.tasks.collection.id)).records).toEqual(
    sourceBefore,
  );
  expect((await listPages()).length).toBe(initialPageCount + 1);
  await page.screenshot({
    path: "/tmp/mindos-generative-pages-real-ai.png",
    animations: "disabled",
  });
});

test("generates a custom page with working isolated interactions and confirmed task completion", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const fixture = await pageFixture(request);
  await chinesePage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio/pages/new");
  const generated = await generate(
    page,
    `给我做一张精致、克制的项目推进卡，页面标题叫“专属推进卡”。恰好一个 html 模块，标题也叫“专属推进卡”，` +
      `绑定产品推进集合 ${fixture.tasks.collection.id}，字段为 title、status，不设置筛选。` +
      "从真实 data.records 展示第一条任务标题和“待办总数：1”（只计算 status 不是 done 的未完成任务，不要硬编码；完成后随数据更新为0）。" +
      "另展示一个仅保存在页面局部 state 的计数，初始文字“本地计数：0”，提供名为“计数加一”的按钮；每点一次通过 worker event 更新 state 并重新 render。" +
      "提供名为“完成任务”的按钮，用宿主提供的 task.complete 动作和真实 record id 完成任务，需要宿主确认。" +
      '使用 HTML/CSS 与 <script type="mindos/page"> 的 data、state、event、render 接口实现。不要普通浏览器脚本、DOM、React、外部依赖或网络请求。',
  );
  await writeFile(
    "/tmp/mindos-real-ai-last-custom.json",
    JSON.stringify(generated, null, 2),
  );
  expect(generated.blocks).toHaveLength(1);
  const block = generated.blocks[0];
  expect(block).toMatchObject({
    kind: "html",
    collectionId: fixture.tasks.collection.id,
  });
  expect(block.html).toMatch(/<script\s+type=["']mindos\/page["']/);
  await page.getByRole("button", { name: "应用调整", exact: true }).click();
  await page.getByRole("button", { name: "保留此页面", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/pages\/page-[^/?]+$/);

  console.info(
    "[real-ai] Custom page saved; verifying Worker rendering and events",
  );
  const frame = page.frameLocator(`[data-page-block="${block.id}"] iframe`);
  try {
    await expect(frame.locator("body")).toContainText("评审工作台原型");
    // The model may separate a label/value with markup, spaces or punctuation.
    // Keep the exact number and successive state changes as the contract.
    await expect(frame.locator("body")).toContainText(
      /待办总数\s*[：:]?\s*1(?!\d)/,
    );
    await expect(frame.locator("body")).toContainText(
      /本地计数\s*[：:]?\s*0(?!\d)/,
    );
    await frame.getByRole("button", { name: "计数加一", exact: true }).click();
    await expect(frame.locator("body")).toContainText(
      /本地计数\s*[：:]?\s*1(?!\d)/,
    );
    await frame.getByRole("button", { name: "计数加一", exact: true }).click();
    await expect(frame.locator("body")).toContainText(
      /本地计数\s*[：:]?\s*2(?!\d)/,
    );
    console.info(
      "[real-ai] Worker counter advanced twice; checking confirmed task completion",
    );

    await frame.getByRole("button", { name: "完成任务", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "确认完成", exact: true }),
    ).toBeVisible();
    expect(
      (await fixture.read(fixture.tasks.collection.id)).records[0].fields
        .status,
    ).toBe("todo");
    await page.getByRole("button", { name: "确认完成", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await fixture.read(fixture.tasks.collection.id)).records[0].fields
            .status,
      )
      .toBe("done");
    await expect(frame.locator("body")).toContainText(
      /待办总数\s*[：:]?\s*0(?!\d)/,
    );
    await expect(frame.locator("body")).toContainText(
      /本地计数\s*[：:]?\s*2(?!\d)/,
    );
    console.info(
      "[real-ai] Custom task completion persisted; verifying reload",
    );
    await page.screenshot({
      path: "/tmp/mindos-generative-pages-real-ai-custom.png",
      animations: "disabled",
    });
    await page.reload();
    await expect(frame.locator("body")).toContainText("评审工作台原型");
    await expect(frame.locator("body")).toContainText(
      /待办总数\s*[：:]?\s*0(?!\d)/,
    );
    expect(
      (await fixture.read(fixture.tasks.collection.id)).records[0].fields
        .status,
    ).toBe("done");
  } catch (error) {
    const text = await frame
      .locator("body")
      .innerText({ timeout: 2_000 })
      .catch(() => "[frame unavailable]");
    console.info("[real-ai] Custom frame after failure:", text.slice(0, 500));
    throw error;
  }
});
