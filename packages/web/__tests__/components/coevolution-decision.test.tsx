// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DecisionEditor } from "@/components/echo/coevolution/DecisionEditor";
import { MethodReview } from "@/components/echo/coevolution/CorrectionEditor";
import type {
  CoevolutionTask,
  LearningLoop,
} from "@geminilight/mindos/knowledge";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const decision = {
  id: "decision-1",
  question: "Publish now?",
  options: [
    { id: "a", label: "Publish", tradeoff: "Faster, less evidence" },
    { id: "b", label: "Verify", tradeoff: "Slower, clearer evidence" },
  ],
  actor: { kind: "human" },
  createdAt: new Date().toISOString(),
};
const task = {
  id: "coevolution-test",
  version: 1,
  decisions: [decision],
  runs: [],
} as unknown as CoevolutionTask;
async function click(text: string) {
  const b = [...host.querySelectorAll("button")].find((el) =>
    el.textContent?.includes(text),
  );
  expect(b).toBeDefined();
  await act(async () => b!.click());
}
async function fill(name: string, value: string) {
  const el = host.querySelector(`[name="${name}"]`) as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("requires a human prediction before saving a choice and retains it after a failed save", async () => {
  const mutate = vi.fn().mockResolvedValue(false);
  await act(async () =>
    root.render(
      <DecisionEditor task={task} locale="en" busy={false} mutate={mutate} />,
    ),
  );
  expect(host.textContent).not.toContain("Actual result");
  await click("Verify");
  await fill("prediction", "More evidence will clarify the claim.");
  await click("Save my choice");
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "choose-decision",
      optionId: "b",
      prediction: "More evidence will clarify the claim.",
    }),
  );
  expect(
    (host.querySelector('[name="prediction"]') as HTMLTextAreaElement).value,
  ).toBe("More evidence will clarify the claim.");
});
it("does not allow a result to be recorded before a choice and labels unobserved outcomes", async () => {
  const chosen = {
    ...task,
    decisions: [
      {
        ...decision,
        choice: {
          optionId: "b",
          prediction: "A clearer claim",
          confidence: 60,
          recordedAt: new Date().toISOString(),
        },
      },
    ],
  } as unknown as CoevolutionTask;
  await act(async () =>
    root.render(
      <DecisionEditor
        task={chosen}
        locale="en"
        busy={false}
        mutate={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("Waiting for evidence");
  expect(host.textContent).toContain("A clearer claim");
  expect(host.textContent).not.toContain("Succeeded");
});

it("keeps a long question concise while making the full wording available", async () => {
  const question =
    "A complex tradeoff with background and constraints. ".repeat(20);
  await act(async () =>
    root.render(
      <DecisionEditor
        task={{ ...task, decisions: [{ ...task.decisions[0], question }] }}
        locale="en"
        busy={false}
        mutate={vi.fn()}
      />,
    ),
  );
  expect(host.querySelector("h3")!.textContent!.length).toBeLessThan(100);
  const disclosure = [...host.querySelectorAll("details")].find(
    (item) =>
      item.querySelector("summary")?.textContent === "Read the full question",
  );
  expect(disclosure).toBeDefined();
  expect(disclosure!.open).toBe(false);
  expect(disclosure!.textContent).toContain(question);
});

it("keeps the earlier active standard visible and pausable after rejecting a revision", async () => {
  const mutate = vi.fn().mockResolvedValue(true);
  const loop = {
    id: "learning-review",
    version: 3,
    directMethod: {
      behavior: "Check familiar navigation first",
      scope: "Navigation changes",
      check: "Three entries remain reachable",
      review: { decision: "approved" },
      availability: "active",
      revisions: [
        {
          behavior: "Replace every entry",
          scope: "Navigation changes",
          check: "All routes replaced",
          review: { decision: "rejected" },
        },
      ],
    },
  } as unknown as LearningLoop;
  await act(async () =>
    root.render(
      <MethodReview loop={loop} locale="en" busy={false} mutate={mutate} />,
    ),
  );
  expect(host.textContent).toContain("Check familiar navigation first");
  await click("Pause earlier version");
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ action: "pause-agent", revisionIndex: 0 }),
  );
});
