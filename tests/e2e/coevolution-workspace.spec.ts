import { test, expect } from "@playwright/test";
import { workspaceFixture, fill, tool } from "./coevolution-fixture";
test.use({ viewport: { width: 1440, height: 960 }, actionTimeout: 30000 });
test.setTimeout(120000);
const method = {
  behavior: "先确认熟悉的入口是否还可达",
  scope: "导航改版时；不适用于纯文案修改",
  check: "三个常用入口都能在两步内找到",
};

test("first visit creates a task, preserves a failed choice, and compares prediction with observed evidence", async ({
  page,
  baseURL,
}) => {
  const f = await workspaceFixture(page, baseURL!, true);
  try {
    await page.goto("/echo/workspace", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "从真实任务开始", exact: true })
      .click();
    await fill(page, {
      title: "导航改版练习",
      goal: "比较两条路线，看看熟悉的入口能否保留。",
    });
    await page
      .getByRole("button", { name: "进入工作画布", exact: true })
      .click();
    await page.getByText("添加一处取舍", { exact: true }).click();
    await fill(page, {
      question: "先保留入口还是完全重做？",
      a: "完全重做",
      aCost: "统一设计，但改变使用习惯",
      b: "保留入口",
      bCost: "迁移更稳，但设计约束更多",
    });
    await page
      .getByRole("button", { name: "留下这个分岔点", exact: true })
      .click();
    await page.getByRole("button", { name: /B · 保留入口/ }).click();
    await fill(page, { prediction: "常用任务会更快完成，但布局会受约束。" });
    f.fail();
    await page
      .getByRole("button", { name: "记下我的选择", exact: true })
      .click();
    await expect(page.locator('[name="prediction"]')).toHaveValue(
      "常用任务会更快完成，但布局会受约束。",
    );
    await page.getByRole("button", { name: "再试一次", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("等待真实证据");
    await page.getByText("已有结果，记录观察", { exact: true }).click();
    await fill(page, {
      observation: "三条常用任务都保留了入口，但首次布局需要折中。",
      sourceLabel: "合成走查记录",
      quote: "三个入口均可在两步内找到。",
    });
    await page
      .getByRole("button", { name: "保存结果与证据", exact: true })
      .click();
    await expect(page.getByRole("tabpanel")).toContainText("实际结果");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tabpanel")).toContainText(
      "常用任务会更快完成",
    );
    expect(f.getTask()?.decisions).toHaveLength(1);
    await page.screenshot({ path: "/tmp/coevolution-decision-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("tab", { name: "做判断", exact: false }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const box = await page.locator(".co-workspace").boundingBox();
        return (
          !!box &&
          box.x >= 0 &&
          box.x < 40 &&
          box.width >= 350 &&
          box.x + box.width <= 391
        );
      })
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/tmp/coevolution-decision-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    f.cleanup();
  }
});

test("a human correction becomes a scoped method, can be adapted for the task, then paused", async ({
  page,
  baseURL,
}) => {
  const f = await workspaceFixture(page, baseURL!);
  try {
    await page.goto("/echo/workspace", { waitUntil: "domcontentloaded" });
    await tool(page, "留下标准");
    await page.getByText("从我的修改提炼标准", {exact:true}).click();
    await fill(page, {
      before: "整体替换导航",
      after: "先保留三个常用入口",
      ...method,
    });
    await page
      .getByRole("button", { name: "保存标准草稿", exact: true })
      .click();
    await expect(page.getByRole("tabpanel")).toContainText("尚未成为 Agent");
    await page
      .getByRole("button", { name: "确认这条标准", exact: true })
      .click();
    await expect(page.getByRole("tabpanel")).toContainText("已启用");
    await tool(page, "带入经验");
    await page.getByText("调整范围或补充理由", { exact: true }).click();
    await page.getByRole("button", { name: "调整后用", exact: true }).click();
    await fill(page, {
      reason: "手机屏幕更窄，需要额外检查抽屉入口",
      behavior: "先确认手机抽屉内的常用入口",
      scope: "只用于当前手机导航任务",
      check: "在手机上完成三个任务",
    });
    await page
      .getByRole("button", { name: "保存这次决定", exact: true })
      .click();
    await expect(page.getByRole("tabpanel")).toContainText("已按本任务调整");
    await tool(page, "留下标准");
    await page.getByText("调整或撤销", { exact: true }).click();
    await fill(page, { reason: "停止这次体验测试的标准" });
    await page.getByRole("button", { name: "保存调整", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("已暂停使用");
    await tool(page, "带入经验");
    await expect(page.getByRole("tabpanel")).toContainText(
      "还没有已启用的方法",
    );
  } finally {
    f.cleanup();
  }
});

test("a collaboration trial needs evidence before keeping and remains reversible", async ({
  page,
  baseURL,
}) => {
  const f = await workspaceFixture(page, baseURL!);
  try {
    await page.goto("/echo/workspace", { waitUntil: "domcontentloaded" });
    await tool(page, "分配角色");
    await page
      .getByRole("tabpanel")
      .getByRole("button", { name: /^让我试/ })
      .click();
    await expect.poll(() => f.getTask()?.mode).toBe("try");
    await tool(page, "试新合作");
    await page.getByText("试一个新的协作约定", {exact:true}).click();
    await fill(page, method);
    await page.getByRole("button", { name: "开始试行", exact: true }).click();
    await page.getByText("保留、调整或停止", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "保留", exact: true }),
    ).toBeDisabled();
    await page.getByText("记下这次试行效果", { exact: true }).click();
    await fill(page, {
      observation: "先检查入口帮助发现了一条被删除的路径",
      sourceLabel: "合成任务走查",
      quote: "第三个入口需要恢复。",
    });
    await page.getByRole("button", { name: "保存观察", exact: true }).click();
    await page.getByRole("button", { name: "保留", exact: true }).click();
    await fill(page, { reason: "实际发现遗漏，先在同类任务中保留。" });
    await page.getByRole("button", { name: "保存决定", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("已保留");
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await fill(page, { reason: "测试完成，停止试验。" });
    await page.getByRole("button", { name: "保存决定", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("已停止");
  } finally {
    f.cleanup();
  }
});

test("disagreement keeps two views and evidence before updating the judgment", async ({
  page,
  baseURL,
}) => {
  const f = await workspaceFixture(page, baseURL!);
  try {
    await page.goto("/echo/workspace", { waitUntil: "domcontentloaded" });
    await tool(page, "验证分歧");
    await page.getByRole("button", { name: "自己写下分歧", exact: true }).click();
    await page.getByText("自己补充或修改观点", {exact:true}).click();
    await fill(page, {
      question: "入口能否完全替换？",
      explanationA: "新导航更统一",
      explanationB: "旧入口更熟悉",
      distinction: "用同样三个任务看完成路径",
      capability: "识别迁移成本",
    });
    await page
      .getByRole("button", { name: "保存这两个观点", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认观点，进入验证", exact: true })
      .click();
    await page
      .getByRole("button", { name: "设计一个小验证", exact: true })
      .click();
    await page.getByText("修改验证条件", {exact:true}).click();
    await fill(page, {
      task: "分别走查两个版本的三个入口",
      supportsA: "新版均可找到",
      supportsB: "旧版路径更清楚",
      inconclusive: "差异不明显",
      scope: "仅三个常用任务",
      budget: "10分钟",
    });
    await page
      .getByRole("button", { name: "保存检验方案", exact: true })
      .click();
    await page
      .getByRole("button", { name: "加入验证证据", exact: true })
      .click();
    await fill(page, {
      sourceLabel: "合成走查",
      quote: "新版第三个入口找不到",
      interpretation: "这组任务支持保留熟悉入口",
    });
    await page.locator('select[name="outcome"]').selectOption("b");
    await page.getByRole("button", { name: /保存观察/ }).click();
    await page.getByRole("button", { name: "更新判断", exact: true }).click();
    await page.locator('select[name="outcome"]').selectOption("keep-b");
    await page.getByRole("checkbox").check();
    await fill(page, { reason: "目前证据支持保留入口，再逐步替换。" });
    await page.getByRole("button", { name: "保存决定", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("更新后的判断");
    await expect(page.getByRole("tabpanel")).toContainText(
      "目前证据支持保留入口",
    );
    await page.screenshot({
      path: "/tmp/coevolution-disagreement-desktop.png",
    });
  } finally {
    f.cleanup();
  }
});

test('a source-based request returns to its existing conversation with a reviewable draft', async({page,baseURL})=>{
 const f=await workspaceFixture(page,baseURL!);f.bindChat('co-navigation-test');
 await page.route('**/api/agent/sessions',route=>route.fulfill({json:[{id:'co-navigation-test',title:'Existing task conversation',updatedAt:Date.now(),messages:[{id:'existing-message',role:'user',content:'Keep this conversation',timestamp:Date.now()}]}]}));
 try {
  await page.goto('/echo/workspace',{waitUntil:'domcontentloaded'});
  await tool(page,'留下标准');
  await page.getByRole('tabpanel').getByRole('button',{name:'从经历找出我的纠偏',exact:true}).click();
  await expect(page).toHaveURL(/\/chat\/co-navigation-test$/);
  await expect(page.locator('textarea:visible').last()).toHaveValue(/echo_suggest/);
  await expect(page.locator('textarea:visible').last()).toHaveValue(/coevolution-task/);
  await page.screenshot({path:'/tmp/coevolution-return-to-conversation.png'});
 } finally {f.cleanup();}
});
