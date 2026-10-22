// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import PersonField from "@/components/studio/views/WorkPersonField";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/views/work-api", () => ({ workRequest: api.request }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => api.request.mockReset());
it("offers names from the chosen collection without silently replacing an unavailable link", async () => {
  api.request.mockImplementation(async (op) =>
    op === "list"
      ? {
          rootId: "root",
          collections: [
            { id: "people", folder: "My people", template: "people" },
          ],
        }
      : { rootId: "root", records: [{ id: "p1", fields: { name: "林悦" } }] },
  );
  const host = document.createElement("div"),
    root = createRoot(host),
    change = vi.fn();
  await act(async () =>
    root.render(
      <PersonField
        id="person"
        rootId="root"
        value="people/deleted"
        onChange={change}
        zh={false}
      />,
    ),
  );
  expect(host.textContent).toContain("林悦");
  expect(host.textContent).toContain("Keep current link");
  expect(change).not.toHaveBeenCalled();
  const select = host.querySelector(
    '[aria-label="Choose a person"]',
  ) as HTMLSelectElement;
  await act(async () => {
    select.value = "people/p1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(change).toHaveBeenCalledWith("people/p1");
  await act(async () => root.unmount());
});
it("does not show people from a switched library and exposes retry while preserving the selected value", async () => {
  api.request.mockResolvedValue({
    rootId: "other-root",
    collections: [
      { id: "private", folder: "Other library", template: "people" },
    ],
  });
  const host = document.createElement("div"),
    root = createRoot(host),
    change = vi.fn();
  await act(async () =>
    root.render(
      <PersonField
        id="person"
        rootId="root"
        value="people/p1"
        onChange={change}
        zh={false}
      />,
    ),
  );
  expect(host.textContent).toContain("Library changed");
  expect(host.textContent).not.toContain("Other library");
  expect(change).not.toHaveBeenCalled();
  expect(host.querySelector("button")!.textContent).toBe("Retry");
  await act(async () => root.unmount());
});
