import { expect, test } from "@playwright/test";
import { pageFixture } from "../helpers/pages-fixture";

for (const { theme, width } of [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 1440 },
  { theme: "light", width: 390 },
  { theme: "dark", width: 320 },
] as const) {
  test.describe(`${theme} ${width}px`, () => {
    test.beforeEach(async ({ page, context, baseURL, request }) => {
      if (process.env.MINDOS_VIEWS_ISOLATED === "1") await pageFixture(request);
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies([
        { name: "locale", value: "zh", url: baseURL! },
      ]);
      await page.addInitScript((theme) => {
        localStorage.setItem("locale", "zh");
        localStorage.setItem("theme", theme);
      }, theme);
    });
    test("Home capsules keep rounded focus and menu feedback inside their bounds", async ({
      page,
    }) => {
      await page.goto("/");
      const mode = page.getByRole("button", { name: "模式", exact: true });
      await mode.waitFor();
      const bounds = await mode.boundingBox();
      const normal = await mode.evaluate(
        (el) => getComputedStyle(el, "::before").backgroundColor,
      );
      await mode.hover();
      await expect
        .poll(() =>
          mode.evaluate(
            (el) => getComputedStyle(el, "::before").backgroundColor,
          ),
        )
        .not.toBe(normal);
      expect(await mode.boundingBox()).toEqual(bounds);
      await page.keyboard.press("Tab");
      await mode.focus();
      const focus = await mode.evaluate((el) => {
        const s = getComputedStyle(el),
          paint = getComputedStyle(el, "::before");
        return {
          outline: s.outlineStyle,
          ring: s.getPropertyValue("--tw-ring-shadow"),
          paint: paint.outlineStyle,
          radius: parseFloat(paint.borderRadius),
        };
      });
      expect(focus.outline).toBe("none");
      expect(focus.paint).toBe("solid");
      expect(focus.radius).toBeGreaterThan(8);
      expect(focus.ring).not.toMatch(/[1-9]\d*px/);
      await mode.press("Enter");
      const menu = page.getByRole("listbox", { name: "模式", exact: true });
      await expect(menu).toBeVisible();
      await page.keyboard.press("ArrowDown");
      const option = menu.getByRole("option", { name: /计划/ });
      await expect(option).toBeFocused();
      const edge = await option.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          offset: s.outlineOffset,
          ring: s.getPropertyValue("--tw-ring-shadow"),
          radius: parseFloat(s.borderRadius),
        };
      });
      expect(edge.offset).toBe("-2px");
      expect(edge.ring).not.toMatch(/[1-9]\d*px/);
      expect(edge.radius).toBeGreaterThanOrEqual(6);
      await expect(menu.getByRole("option", { selected: true })).toHaveCount(1);
      const mb = await menu.boundingBox();
      expect(mb!.x).toBeGreaterThanOrEqual(0);
      expect(mb!.x + mb!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: `/tmp/mindos-controls-home-menu-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(mode).toBeFocused();
      await page.locator("textarea.ask-composer-input").first().click();
      expect(
        await page
          .locator("textarea.ask-composer-input")
          .first()
          .evaluate((el) => getComputedStyle(el).outlineStyle),
      ).toBe("none");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    });
    test("Studio fields, selects and buttons have quiet hover, focus and press states", async ({
      page,
    }) => {
      await page.goto("/studio/pages/new");
      const title = page.getByRole("textbox", {
        name: "页面标题",
        exact: true,
      });
      await title.waitFor();
      const border = await title.evaluate(
        (el) => getComputedStyle(el).borderTopColor,
      );
      await title.hover();
      await expect
        .poll(() => title.evaluate((el) => getComputedStyle(el).borderTopColor))
        .not.toBe(border);
      const columns = page.getByRole("combobox", {
        name: "页面分栏",
        exact: true,
      });
      const bounds = await columns.boundingBox();
      await page.keyboard.press("Tab");
      await columns.focus();
      const edge = await columns.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          offset: s.outlineOffset,
          ring: s.getPropertyValue("--tw-ring-shadow"),
          width: s.outlineWidth,
        };
      });
      expect(edge.offset).toBe("-1px");
      expect(edge.width).toBe("2px");
      expect(edge.ring).not.toMatch(/[1-9]\d*px/);
      expect(await columns.boundingBox()).toEqual(bounds);
      // Native popup keyboard handling belongs to the host platform. Verify
      // selection through Playwright's native-select API; Tab focus is checked
      // above and custom popup Arrow/Escape behavior is exercised separately.
      await columns.selectOption("1");
      await expect(columns).toHaveValue("1");
      await columns.selectOption("2");
      await expect(columns).toHaveValue("2");
      const task = page.getByRole("button", { name: "任务", exact: true });
      await task.hover();
      await task.evaluate((el) => {
        getComputedStyle(el).backgroundColor;
        return Promise.all(el.getAnimations().map((a) => a.finished));
      });
      const hover = await task.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        ),
        box = await task.boundingBox();
      await page.mouse.down();
      await expect
        .poll(() => task.evaluate((el) => getComputedStyle(el).backgroundColor))
        .not.toBe(hover);
      expect(await task.boundingBox()).toEqual(box);
      await page.mouse.move(1, 1);
      await page.mouse.up();
      await page.screenshot({
        path: `/tmp/mindos-controls-studio-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.goto("/studio/projects");
      await page
        .getByRole("button", { name: "新建项目", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新建项目",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const name = dialog.getByLabel("项目名称", { exact: true });
      await name.click();
      expect(
        await name.evaluate((el) => getComputedStyle(el).outlineOffset),
      ).toBe("-1px");
      const db = await dialog.boundingBox();
      expect(db!.x).toBeGreaterThanOrEqual(0);
      expect(db!.x + db!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: `/tmp/mindos-controls-project-dialog-${theme}-${width}.png`,
        animations: "disabled",
      });
      await dialog
        .getByRole("button", { name: "取消", exact: true })
        .filter({ hasText: /^取消$/ })
        .click();
      await expect(dialog).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    });
    test("Studio overview, views, automation and context controls keep a single keyboard cue", async ({
      page,
    }) => {
      for (const path of [
        "/studio",
        "/studio/views",
        "/studio/automation",
        "/studio/context",
      ]) {
        await page.goto(path);
        const surface = page
          .locator('[data-content-page-shell="studio"]')
          .first();
        await expect(surface).toBeVisible();
        const button = surface
          .locator(":is(button:not(:disabled), a[href]):visible")
          .first();
        await expect(button).toBeVisible();
        await page.keyboard.press("Tab");
        await button.focus();
        const cue = await button.evaluate((el) => ({
          ring: getComputedStyle(el).getPropertyValue("--tw-ring-shadow"),
          outline: getComputedStyle(el).outlineStyle,
          paint: getComputedStyle(el, "::before").outlineStyle,
        }));
        expect(cue.ring).not.toMatch(/[1-9]\d*px/);
        expect(cue.outline === "solid" || cue.paint === "solid").toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          path,
        ).toBe(true);
      }
    });
  });
}

test("a pending review yields to a narrow project dialog and returns after closing", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await context.addCookies([{ name: "locale", value: "zh", url: baseURL! }]);
  await page.addInitScript(() => {
    localStorage.setItem("locale", "zh");
    localStorage.setItem("theme", "dark");
  });
  // Only the notification fixture is mocked; project screens keep their real API.
  await page.route("**/api/changes?*", (route) => {
    const op = new URL(route.request().url()).searchParams.get("op");
    return route.fulfill({
      json:
        op === "summary"
          ? { unreadCount: 1, totalCount: 1, lastSeenAt: null }
          : {
              events: [
                {
                  id: "controls-review-fixture",
                  ts: "2026-10-23T00:00:00.000Z",
                  op: "edit",
                  path: "controls-fixture.md",
                  source: "agent",
                  summary: "待复盘的资料变更",
                },
              ],
            },
    });
  });
  await page.goto("/studio/projects");
  const banner = page.locator('[data-changes-banner-kind="agent-review"]');
  await expect(banner).toBeVisible();
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "新建项目", exact: true });
  await expect(dialog).toBeVisible();
  await expect(banner).toBeHidden();
  await dialog
    .getByRole("button", { name: "取消", exact: true })
    .filter({ hasText: /^取消$/ })
    .click();
  await expect(banner).toBeVisible();
});

test("a disabled Agent menu row does not advertise a hover action", async ({
  page,
  request,
}) => {
  if (process.env.MINDOS_VIEWS_ISOLATED === "1") await pageFixture(request);
  await page.addInitScript(() => localStorage.setItem("locale", "zh"));
  await page.goto("/");
  await page.getByRole("button", { name: "切换 Agent", exact: true }).click();
  const row = page.getByRole("listbox").getByRole("option").first();
  await row.waitFor();
  // Exercise native disabled rendering on the actual menu row, without selecting an Agent.
  await row.evaluate((el) => ((el as HTMLButtonElement).disabled = true));
  await page.mouse.move(1, 1);
  await row.evaluate((el) => {
    getComputedStyle(el).backgroundColor;
    return Promise.all(el.getAnimations().map((a) => a.finished));
  });
  const before = await row.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await row.hover({ force: true });
  await row.evaluate((el) => {
    getComputedStyle(el).backgroundColor;
    return Promise.all(el.getAnimations().map((a) => a.finished));
  });
  expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    before,
  );
  await expect(row).toBeDisabled();
});
