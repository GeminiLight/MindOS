import { expect, test } from "@playwright/test";

for (const { theme, width } of [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 390 },
] as const) {
  test(`page editing uses one close focus edge in ${theme} at ${width}px`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: "locale", value: "zh", url: baseURL! }]);
    await page.addInitScript((theme) => {
      localStorage.setItem("locale", "zh");
      localStorage.setItem("theme", theme);
    }, theme);
    await page.goto("/studio/pages/new");
    const input = page.getByRole("textbox", {
      name: "描述页面调整",
      exact: true,
    });
    await input.waitFor();
    const before = await input.boundingBox();
    await input.click();
    await expect(input).toBeFocused();
    const edge = await input.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: parseFloat(style.outlineWidth),
        offset: parseFloat(style.outlineOffset),
        ring: style.getPropertyValue("--tw-ring-shadow").trim(),
        outline: style.outlineStyle,
      };
    });
    expect(edge.outline).toBe("solid");
    expect(edge.width).toBe(2);
    expect(edge.offset).toBe(-1);
    // Tailwind's ring may coexist with the global outline, but must not paint a second halo.
    expect(edge.ring).not.toMatch(/(?:[1-9]\d*px)/);
    const after = await input.boundingBox();
    expect(after).toEqual(before);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    await expect
      .poll(() => input.evaluate((el) => getComputedStyle(el).outlineStyle))
      .toBe("solid");
    const title = page.getByRole("textbox", { name: "页面标题", exact: true });
    await title.click();
    expect(
      await title.evaluate((el) =>
        parseFloat(getComputedStyle(el).outlineOffset),
      ),
    ).toBe(-1);
    await input.click();
    await page.screenshot({
      path: `/tmp/mindos-input-focus-${theme}-${width}.png`,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}

test("focus keeps invalid borders and disabled controls safe without changing checkbox feedback", async ({
  page,
}) => {
  await page.goto("/studio/pages/new");
  const prompt = page.locator("#page-prompt");
  await prompt.waitFor();
  // Exercise the shared CSS on real text-field markup in controlled semantic states.
  await prompt.evaluate((el) => {
    const invalid = el.cloneNode(false) as HTMLTextAreaElement;
    invalid.id = "focus-invalid";
    invalid.setAttribute("aria-invalid", "true");
    invalid.classList.add("border-error");
    el.parentElement!.append(invalid);
    const disabled = invalid.cloneNode(false) as HTMLTextAreaElement;
    disabled.id = "focus-disabled";
    disabled.disabled = true;
    el.parentElement!.append(disabled);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "focus-checkbox";
    el.parentElement!.append(checkbox);
  });
  const invalid = page.locator("#focus-invalid");
  const border = await invalid.evaluate(
    (el) => getComputedStyle(el).borderTopColor,
  );
  await invalid.focus();
  await expect(invalid).toBeFocused();
  expect(
    await invalid.evaluate((el) => getComputedStyle(el).borderTopColor),
  ).toBe(border);
  expect(
    await invalid.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("solid");
  const disabled = page.locator("#focus-disabled");
  await expect(disabled).toBeDisabled();
  expect(
    await disabled.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("none");
  const checkbox = page.locator("#focus-checkbox");
  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  expect(
    await checkbox.evaluate((el) => getComputedStyle(el).outlineOffset),
  ).toBe("2px");
});
