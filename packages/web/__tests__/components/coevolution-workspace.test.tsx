// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoevolutionTask } from "@geminilight/mindos/knowledge";
import { CoEvolutionWorkspace } from "@/components/echo/coevolution/CoEvolutionWorkspace";
vi.mock("@/components/echo/coevolution/WorkspaceCanvas", () => ({
  WorkspaceCanvas: ({ onContinue }: { onContinue: () => void }) => (
    <button onClick={onContinue}>Canvas continue</button>
  ),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
});
const task: CoevolutionTask = {
  schemaVersion: 1,
  creationHash: "a".repeat(64),
  modeHistory: [],
  commands: [],
  id: "task-1",
  version: 1,
  title: "An actual task",
  goal: "Make a decision",
  mode: "together",
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  archived: false,
  decisions: [],
  corrections: [],
  applications: [],
  agreements: [],
  preparations: [],
  runs: [],
};
const props = () => ({
  task,
  tasks: [task],
  activeFeature: "decision" as const,
  onFeatureChange: vi.fn(),
  onSelectTask: vi.fn(),
  onCreateTask: vi.fn(),
  onModeChange: vi.fn(),
  editor: (
    <label>
      Prediction
      <input aria-label="Prediction" />
    </label>
  ),
  locale: "en",
});

describe("coevolution workspace frame", () => {
  it("continues the real task after reviewing a decision result", async () => {
    const onStartTask = vi.fn();
    const completedTask = {
      ...task,
      decisions: [
        {
          id: "decision-complete",
          question: "Which route?",
          actor: { kind: "human" },
          createdAt: task.createdAt,
          options: [
            { id: "a", label: "Check first", tradeoff: "Extra time" },
            { id: "b", label: "Proceed", tradeoff: "Less evidence" },
          ],
          choice: {
            optionId: "a",
            prediction: "Fewer surprises",
            confidence: 70,
            recordedAt: task.createdAt,
          },
          outcome: {
            observation: "Found a missing entry",
            recordedAt: task.createdAt,
            evidence: {
              kind: "manual",
              sourceLabel: "Walkthrough",
              quote: "One entry was missing",
            },
          },
        },
      ],
    } as CoevolutionTask;
    await act(async () =>
      root.render(
        <CoEvolutionWorkspace
          {...props()}
          task={completedTask}
          onStartTask={onStartTask}
        />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Canvas continue")!
        .click(),
    );
    expect(onStartTask).toHaveBeenCalledOnce();
  });
  it("keeps one action panel while making every collaboration tool reachable", async () => {
    const value = props();
    await act(async () => root.render(<CoEvolutionWorkspace {...value} />));
    expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(6);
    expect(
      host.querySelector('button[aria-label="Task brief"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="Shared trail"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("Decide");
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[3].click(),
    );
    expect(value.onFeatureChange).toHaveBeenCalledWith("disagreement");
  });

  it("offers an actionable first visit and does not display fabricated task content", async () => {
    const value = props();
    await act(async () =>
      root.render(<CoEvolutionWorkspace {...value} task={null} tasks={[]} />),
    );
    expect(host.textContent).toContain("Bring in a real piece of work");
    expect(host.querySelector('[role="tabpanel"]')).toBeNull();
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Start from real work"))!
        .click(),
    );
    expect(value.onCreateTask).toHaveBeenCalledOnce();
  });

  it("preserves the task while reporting an error and offering retry", async () => {
    const retry = vi.fn();
    await act(async () =>
      root.render(
        <CoEvolutionWorkspace
          {...props()}
          error="Unable to refresh"
          onRetry={retry}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to refresh",
    );
    expect(host.textContent).toContain("An actual task");
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Try again"))!
        .click(),
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not let mode changes race with a pending save", async () => {
    const value = props();
    await act(async () =>
      root.render(<CoEvolutionWorkspace {...value} saving />),
    );
    const group = host.querySelector(
      '[aria-label="How shall we work on this?"]',
    );
    expect(group?.querySelectorAll("button:disabled")).toHaveLength(3);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Saving",
    );
  });
});
