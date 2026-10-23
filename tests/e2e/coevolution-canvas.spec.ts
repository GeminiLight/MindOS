import { test, expect as baseExpect, type Locator } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 15_000,
  launchOptions: process.env.MINDOS_E2E_CHROME
    ? { executablePath: process.env.MINDOS_E2E_CHROME }
    : {},
});
test.setTimeout(90_000);

async function settledCanvas(canvas: Locator) {
  let previous = "";
  let settledSamples = 0;
  await expect
    .poll(
      async () => {
        const boxes = await Promise.all([
          canvas.boundingBox(),
          canvas.locator(".co-workspace-node-action").boundingBox(),
        ]);
        const sample = JSON.stringify(
          boxes.map((box) => box && Object.values(box).map(Math.round)),
        );
        settledSamples = sample === previous ? settledSamples + 1 : 0;
        previous = sample;
        return boxes.every(Boolean) && settledSamples >= 3;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBe(true);
}

// Deliberately synthetic task: canvas interaction should not depend on private session data.
const task = {
  schemaVersion: 1,
  id: "coevolution-aaaaaaaaaaaaaaaaaaaaaaaa",
  version: 1,
  creationHash: "a".repeat(64),
  title: "体验验证 · 一次产品取舍",
  goal: "比较直接改版与保留熟悉入口的取舍，再用实际观察对照预测。",
  mode: "together",
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  archived: false,
  decisions: [
    {
      id: "decision-1",
      question: "现在直接改版，还是保留熟悉入口？",
      actor: { kind: "human" },
      createdAt: "2026-10-23T00:00:00.000Z",
      options: [
        {
          id: "a",
          label: "直接改版",
          tradeoff: "整体更统一，但老用户要重新找入口。",
        },
        {
          id: "b",
          label: "保留熟悉入口",
          tradeoff: "迁移更平缓，但短期需要维护两套入口。",
        },
      ],
      choice: {
        optionId: "b",
        prediction: "老用户应该更容易找回常用操作。",
        confidence: 70,
        recordedAt: "2026-10-23T00:00:00.000Z",
      },
    },
  ],
  corrections: [],
  applications: [],
  agreements: [],
  preparations: [],
  runs: [],
  modeHistory: [],
  commands: [],
};

test.beforeEach(async ({ page, context, baseURL }, testInfo) => {
  const locale = testInfo.title.includes("English") ? "en" : "zh";
  await context.addCookies([{ name: "locale", value: locale, url: baseURL! }]);
  await page.addInitScript((locale) => {
    localStorage.setItem("locale", locale);
    localStorage.setItem("theme", "light");
  }, locale);
  await page.route("**/api/echo/coevolution*", (route) =>
    route.fulfill({
      json: { task, tasks: [task], methods: [], runs: [], learningLoops: [] },
    }),
  );
});

test("canvas buttons open the real source and the current form, including on a narrow screen", async ({
  page,
}) => {
  await page.goto("/echo/workspace?task=" + task.id, {
    waitUntil: "domcontentloaded",
  });
  const canvas = page.locator(".co-workspace-canvas");
  await expect(canvas).toHaveAttribute("data-camera-ready", "true");
  const action = canvas.getByRole("button", {
    name: "带回实际结果",
    exact: true,
  });
  // React Flow disables pointer events for entirely read-only nodes unless explicitly restored.
  await expect(action).toHaveCSS("pointer-events", "all");
  await action.click();
  await expect(
    page.getByRole("textbox", {
      name: "实际发生了什么，与预测有何不同",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "实际发生了什么，与预测有何不同",
      exact: true,
    }),
  ).toBeFocused();
  await canvas.getByRole("button", { name: "查看原文", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(task.goal, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const notification = page.getByRole("button", {
    name: "关闭提醒",
    exact: true,
  });
  if (await notification.isVisible()) await notification.click();
  await canvas.getByRole("button", { name: "看全貌", exact: true }).click();
  await settledCanvas(canvas);
  await expect
    .poll(async () => {
      const outer = await canvas.boundingBox();
      const nodes = await canvas.locator(".co-workspace-node").all();
      return (
        !!outer &&
        (
          await Promise.all(
            nodes.map(async (node) => {
              const box = await node.boundingBox();
              return (
                !!box &&
                box.x >= outer.x &&
                box.x + box.width <= outer.x + outer.width
              );
            }),
          )
        ).every(Boolean)
      );
    })
    .toBe(true);
  await page.screenshot({ path: "/tmp/coevolution-canvas-desktop.png" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: "/tmp/coevolution-canvas-desktop-dark.png",
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  await page.getByRole("tab", { name: "带入经验", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await settledCanvas(canvas);
  await expect
    .poll(async () => {
      const bounds = await page.locator(".co-workspace").boundingBox();
      return (
        !!bounds &&
        bounds.x >= 0 &&
        bounds.width >= 350 &&
        bounds.x + bounds.width <= 390
      );
    })
    .toBe(true);
  await expect
    .poll(async () => {
      const outer = await canvas.boundingBox();
      const current = await canvas
        .locator(".co-workspace-node-action")
        .boundingBox();
      return (
        !!outer &&
        !!current &&
        current.x >= outer.x + 3 &&
        current.x + current.width <= outer.x + outer.width - 3
      );
    })
    .toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: "/tmp/coevolution-canvas-mobile.png" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: "/tmp/coevolution-canvas-mobile-dark.png",
    animations: "disabled",
  });
});

test("long task material keeps source and evidence reachable on the canvas", async ({
  page,
}) => {
  const longText =
    "在保留用户熟悉入口的同时，逐步引入新的任务画布。需要考虑首次使用的理解成本、已有习惯的迁移和后续维护成本。".repeat(
      10,
    );
  const longTask = {
    ...task,
    goal: longText,
    source: {
      sessionId: "synthetic-session",
      messageIndex: 0,
      messageHash: "b".repeat(64),
      title: "体验验证 · 一段包含背景、约束和多轮取舍的长任务来源记录",
      quote: longText,
    },
    decisions: [
      {
        ...task.decisions[0],
        question: longText,
        outcome: {
          observation: longText,
          evidence: {
            kind: "manual",
            sourceLabel: "独立体验验证",
            quote: longText,
          },
          recordedAt: "2026-10-23T00:01:00.000Z",
        },
      },
    ],
  };
  await page.route("**/api/echo/coevolution*", (route) =>
    route.fulfill({
      json: {
        task: longTask,
        tasks: [longTask],
        methods: [],
        runs: [],
        learningLoops: [],
      },
    }),
  );
  await page.goto("/echo/workspace?task=" + task.id, {
    waitUntil: "domcontentloaded",
  });
  const canvas = page.locator(".co-workspace-canvas");
  await expect(canvas).toHaveAttribute("data-camera-ready", "true");
  await canvas.getByRole("button", { name: "看全貌", exact: true }).click();
  await settledCanvas(canvas);
  for (const button of await canvas
    .locator(".co-workspace-node button")
    .all()) {
    await expect(button).toBeInViewport();
  }
  await page.screenshot({ path: "/tmp/coevolution-canvas-long-desktop.png" });
  await canvas.locator(".co-workspace-node-result button").click();
  await expect(page.getByRole("dialog")).toContainText(longText);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await settledCanvas(canvas);
  await expect(canvas.locator(".co-node-continue")).toBeInViewport();
  await page.screenshot({ path: "/tmp/coevolution-canvas-long-mobile.png" });
  await expect
    .poll(async () => {
      const outer = await canvas.boundingBox();
      const node = await canvas
        .locator(".co-workspace-node-action")
        .boundingBox();
      const tools = await canvas.locator(".co-canvas-tools").boundingBox();
      return (
        !!outer &&
        !!node &&
        !!tools &&
        node.y >= outer.y + 35 &&
        node.y + node.height < tools.y - 6
      );
    })
    .toBe(true);
});

test("a phone opened directly receives the full workspace width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/echo/workspace?task=" + task.id, {
    waitUntil: "domcontentloaded",
  });
  const canvas = page.locator(".co-workspace-canvas");
  await expect(canvas).toHaveAttribute("data-camera-ready", "true");
  await settledCanvas(canvas);
  await expect
    .poll(async () => {
      const bounds = await page.locator(".co-workspace").boundingBox();
      const node = await canvas
        .locator(".co-workspace-node-action")
        .boundingBox();
      return (
        !!bounds &&
        !!node &&
        bounds.x >= 0 &&
        bounds.width >= 350 &&
        bounds.x + bounds.width <= 390 &&
        node.x >= 14 &&
        node.x + node.width <= 376
      );
    })
    .toBe(true);
  const rail = await page.locator(".co-workspace-features").boundingBox();
  for (const tab of await page.getByRole("tab").all()) {
    const bounds = await tab.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(rail!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      rail!.x + rail!.width,
    );
  }
  await page.screenshot({
    path: "/tmp/coevolution-canvas-mobile-cold.png",
    animations: "disabled",
  });
});

test("English phone navigation keeps all six actions visible and comfortably touchable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/echo/workspace?task=" + task.id, {
    waitUntil: "domcontentloaded",
  });
  const canvas = page.locator(".co-workspace-canvas");
  await expect(
    page.getByRole("tab", { name: "Test views", exact: true }),
  ).toBeVisible();
  await expect(canvas).toHaveAttribute("data-camera-ready", "true");
  await settledCanvas(canvas);
  const rail = await page.locator(".co-workspace-features").boundingBox();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(6);
  for (const tab of await tabs.all()) {
    const bounds = await tab.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(rail!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      rail!.x + rail!.width,
    );
  }
  await page.screenshot({
    path: "/tmp/coevolution-canvas-mobile-english.png",
    animations: "disabled",
  });
});
