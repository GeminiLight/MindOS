import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  find: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@geminilight/mindos/knowledge", () => ({
  consumeCoevolutionDraft: mocks.consume,
  findCoevolutionTaskBySession: mocks.find,
  coevolutionContext: mocks.context,
}));
import { resolveCoevolutionTurnContext } from "@/lib/agent/coevolution-context";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.consume.mockReturnValue(null);
  mocks.find.mockReturnValue(null);
  mocks.context.mockReturnValue("Together, with evidence first.");
});
const input = {
  mindRoot: "/local",
  chatSessionId: "chat-1",
  prompt: "Current task",
  interactiveTools: true,
};
describe("workspace context at the actual Agent boundary", () => {
  it("excludes only the latest task-level adjusted or rejected methods from automatic recall", async () => {
    const application = (learningId: string, path: string, disposition: string) => ({
      method: { learningId, attemptIndex: -1, path }, disposition,
    });
    mocks.find.mockReturnValue({ id: "one", applications: [
      application("adjusted", "方法/原来的步骤.md", "adjust"),
      application("rejected", "methods/rejected.md", "reject"),
      application("restored", "methods/restored.md", "reject"),
      application("restored", "methods/restored.md", "adopt"),
      application("shared-path", "methods/rejected.md", "adjust"),
    ] });
    expect(await resolveCoevolutionTurnContext(input)).toMatchObject({
      context: expect.stringContaining("Together, with evidence first."),
      excludePaths: ["方法/原来的步骤.md", "methods/rejected.md"],
    });
  });
  it("does not leave recall exclusions behind for an archived or unbound task", async () => {
    mocks.find.mockReturnValue({ id: "archived", applications: [{ method: { learningId: "old", attemptIndex: -1, path: "methods/old.md" }, disposition: "reject" }] });
    mocks.context.mockReturnValue("");
    expect(await resolveCoevolutionTurnContext(input)).toEqual({ context: "", excludePaths: [] });
    mocks.find.mockReturnValue(null);
    expect(await resolveCoevolutionTurnContext(input)).toEqual({ context: "", excludePaths: [] });
  });
  it("injects current settings and rechecks active standards for a bound session", async () => {
    const task = { id: "one", chatSessionId: "chat-1", applications: [] };
    mocks.find.mockReturnValue(task);
    expect((await resolveCoevolutionTurnContext(input)).context).toContain(
      "Together, with evidence first.",
    );
    expect(mocks.context).toHaveBeenCalledWith(task, "/local");
    expect((await resolveCoevolutionTurnContext(input)).context).toContain("echo_decide");
    expect(mocks.find).toHaveBeenCalledTimes(2);
  });
  it("uses the exact prepared draft binding and passes the same collaboration contract to native runtimes", async () => {
    mocks.consume.mockReturnValue({ id: "one", chatSessionId: "chat-1", applications: [] });
    const { context } = await resolveCoevolutionTurnContext({
      ...input,
      prompt: "[coevolution-task: verified]",
      interactiveTools: false,
    });
    expect(context).toContain("Together, with evidence first.");
    expect(context).not.toContain("call echo_decide");
  });
  it.each([undefined, ""])(
    "does not attach global settings when no conversation is identified",
    async (chatSessionId) => {
      expect(
        await resolveCoevolutionTurnContext({ ...input, chatSessionId }),
      ).toEqual({ context: "", excludePaths: [] });
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(mocks.find).not.toHaveBeenCalled();
    },
  );
  it("keeps unrelated conversations free of another task’s settings", async () => {
    expect(await resolveCoevolutionTurnContext(input)).toEqual({ context: "", excludePaths: [] });
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("fails visibly when a workspace draft was altered or has expired", async () => {
    await expect(
      resolveCoevolutionTurnContext({
        ...input,
        prompt: "[coevolution-task: changed]",
      }),
    ).rejects.toThrow(/changed|expired/);
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
