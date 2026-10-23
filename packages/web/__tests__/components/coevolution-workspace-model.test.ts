import { describe, expect, it } from "vitest";
import type { CoevolutionTask } from "@geminilight/mindos/knowledge";
import {
  buildWorkspaceProjection,
  compactWorkspaceText,
  nextWorkspaceFeature,
} from "@/components/echo/coevolution/workspace-model";

const task = (): CoevolutionTask => ({
  schemaVersion: 1,
  creationHash: "a".repeat(64),
  modeHistory: [],
  commands: [],
  id: "task-1",
  version: 1,
  title: "Compare two implementations",
  goal: "Choose a smaller change",
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
});

describe("coevolution workspace projection", () => {
  it("does not call an empty inquiry a running test", () => {
    const value = task();
    value.inquiryId = 'inquiry-test';
    const projection = buildWorkspaceProjection(value, 'disagreement', 'zh');
    expect(projection.action.state).toBe('ready');
    expect(projection.action.detail).not.toMatch(/已经开始/);
  });

  it("shows the newest run regardless of server ordering", () => {
    const value = task();
    const base = { chatSessionId: 's', runtimeId: 'mindos', status: 'completed' as const, capturedAt: value.createdAt, outputHash: 'a'.repeat(64) };
    value.runs = [{ ...base, runId: 'new', output: 'Newest result', startedAt: 2 }, { ...base, runId: 'old', output: 'Old result', startedAt: 1 }];
    expect(buildWorkspaceProjection(value, 'handoff', 'en').result.body).toBe('Newest result');
  });
  it("starts with a concrete next action and does not invent outcomes for a fresh task", () => {
    const projection = buildWorkspaceProjection(task(), "decision", "zh");
    expect(projection.source.title).toBe("Compare two implementations");
    expect(projection.source.body).toBe("Choose a smaller change");
    expect(projection.result.pending).toBe(true);
    expect(projection.result.evidenceLabel).toBeUndefined();
    expect(projection.action.title).toBeTruthy();
    expect(projection.features.map((item) => item.id)).toHaveLength(6);
    expect(nextWorkspaceFeature(task())).toBe("decision");
  });

  it("keeps a prediction separate from a recorded result and resumes the waiting decision", () => {
    const value = task();
    value.decisions.push({
      id: "d1",
      createdAt: value.createdAt,
      question: "Which fix?",
      actor: { kind: "human" },
      options: [
        { id: "a", label: "Small fix", tradeoff: "Less time; limited reach" },
        { id: "b", label: "Redesign", tradeoff: "More time; wider reach" },
      ],
      choice: {
        optionId: "a",
        prediction: "This should fix it",
        confidence: 70,
        recordedAt: value.createdAt,
      },
    });
    const projection = buildWorkspaceProjection(value, "decision", "en");
    expect(projection.action.title).toBe("Which fix?");
    expect(projection.action.detail).toContain("Small fix");
    expect(projection.result.pending).toBe(true);
    expect(projection.result.body).not.toContain("This should fix it");
    expect(nextWorkspaceFeature(value)).toBe("decision");
  });

  it("shows available output awaiting review without inventing an observed outcome", () => {
    const value = task();
    value.decisions.push({
      id: "d", question: "Which route?", createdAt: value.createdAt,
      actor: { kind: "human" },
      options: [{ id: "a", label: "A", tradeoff: "Faster" }, { id: "b", label: "B", tradeoff: "Broader" }],
      choice: { optionId: "a", prediction: "A should help", confidence: 60, recordedAt: value.createdAt },
    });
    const base = { runId: "r", chatSessionId: "s", runtimeId: "mindos", status: "completed" as const, startedAt: Date.parse(value.createdAt), capturedAt: value.createdAt, outputHash: "a".repeat(64) };
    value.runs = [{ ...base, completedAt: base.startedAt + 1, output: "A real draft, not yet assessed" }];
    const available = buildWorkspaceProjection(value, "decision", "zh");
    expect(available.result.title).toBe("输出已回来，待你核对");
    expect(available.result.pending).toBe(true);
    expect(available.result.evidenceQuote).toBe(value.runs[0].output);
    expect(available.action.cta).toBe("对照预测");
    value.runs[0].completedAt = base.startedAt - 1;
    expect(buildWorkspaceProjection(value, "decision", "zh").result.evidenceQuote).toBeUndefined();
    value.runs[0].completedAt = base.startedAt + 1;
    value.runs[0].output = " ";
    expect(buildWorkspaceProjection(value, "decision", "zh").result.evidenceQuote).toBeUndefined();
    value.runs[0].output = "Partial output";
    value.runs[0].status = "failed";
    expect(buildWorkspaceProjection(value, "decision", "zh").result.evidenceQuote).toBeUndefined();
  });

  it("does not present a confirmed standard as measured improvement", () => {
    const value = task();
    value.corrections.push({
      id: "c1",
      createdAt: value.createdAt,
      actor: { kind: "human" },
      before: "Long introduction",
      after: "State the decision first",
      behavior: "Lead with the decision",
      scope: "Project proposals",
      check: "Decision appears before the context",
      status: "confirmed",
    });
    const projection = buildWorkspaceProjection(value, "correction", "zh");
    expect(projection.action.detail).toContain("Lead with the decision");
    expect(projection.result.pending).toBe(true);
    expect(projection.result.body).toMatch(/使用|验证|观察/);
    expect(
      projection.features.find((item) => item.id === "correction")?.count,
    ).toBe(1);
  });

  it("distinguishes local notes from a linked original session", () => {
    const value = task();
    value.source = {
      sessionId: "source-1",
      messageIndex: 2,
      messageHash: "digest",
      title: "Original session",
      quote: "Actual source evidence",
    };
    const projection = buildWorkspaceProjection(value, "decision", "en");
    expect(projection.source.body).toBe("Actual source evidence");
    expect(projection.source.provenance).toBe("session");
    expect(projection.source.sourceTitle).toBe("Original session");
  });

  it("shows only the selected judgment and its evidence when revisiting a prior record", () => {
    const value = task();
    const base = {
      actor: { kind: "human" as const },
      createdAt: value.createdAt,
      options: [
        { id: "a", label: "A", tradeoff: "Faster" },
        { id: "b", label: "B", tradeoff: "Broader" },
      ],
    };
    value.decisions.push({
      ...base,
      id: "d1",
      question: "The first judgment",
      choice: {
        optionId: "a",
        prediction: "First prediction",
        confidence: 50,
        recordedAt: value.createdAt,
      },
      outcome: {
        observation: "Observed first result",
        evidence: {
          kind: "manual",
          sourceLabel: "User test",
          quote: "First evidence",
        },
        recordedAt: value.createdAt,
      },
    });
    value.decisions.push({ ...base, id: "d2", question: "A later judgment" });
    expect(
      buildWorkspaceProjection(value, "decision", "en").result.pending,
    ).toBe(true);
    const earlier = buildWorkspaceProjection(
      value,
      "decision",
      "en",
      null,
      "d1",
    );
    expect(earlier.action.title).toBe("The first judgment");
    expect(earlier.result.body).toBe("Observed first result");
    expect(earlier.result.evidenceQuote).toBe("First evidence");
    expect(earlier.result.evidenceLabel).toBe("Human observation");
  });

  it("exposes a failed handoff as a failed run, not a successful result", () => {
    const value = task();
    value.runs.push({
      runId: "r1",
      chatSessionId: "s1",
      runtimeId: "codex",
      status: "failed",
      output: "",
      error: "Provider is unavailable",
      startedAt: 1,
      capturedAt: value.createdAt,
      outputHash: "a".repeat(64),
    });
    const projection = buildWorkspaceProjection(value, "handoff", "en");
    expect(projection.result.failed).toBe(true);
    expect(projection.result.body).toBe("Provider is unavailable");
    expect(projection.action.state).not.toBe("complete");
  });

  it("does not attribute an Agent-proposed edit or agreement to the human", () => {
    const value = task();
    const actor = { kind: "agent" as const, runId: "r1", chatSessionId: "s1" };
    value.corrections.push({
      id: "c2",
      createdAt: value.createdAt,
      actor,
      before: "Original",
      after: "Proposed revision",
      behavior: "Lead with a decision",
      scope: "Proposals",
      check: "Decision appears first",
      status: "draft",
    });
    const correction = buildWorkspaceProjection(value, "correction", "zh");
    expect(correction.source.provenance).toBe("proposal");
    expect(correction.source.sourceTitle).toContain("Agent");
    expect(correction.source.sourceTitle).not.toContain("你修改");
    value.agreements.push({
      id: "g1",
      createdAt: value.createdAt,
      actor,
      behavior: "Pause before applying edits",
      scope: "This task",
      check: "The user chooses first",
      status: "proposed",
      observations: [],
    });
    const agreement = buildWorkspaceProjection(value, "experiment", "zh");
    expect(agreement.action.state).toBe("ready");
    expect(agreement.action.detail).toContain("待你确认");
    expect(agreement.result.body).toContain("确认后");
    expect(agreement.result.pending).toBe(true);
  });

  it("attributes an extracted human quotation to its source without attributing Agent paraphrases to the human", () => {
    const value = task();
    value.source = { sessionId: "source", messageIndex: 1, messageHash: "digest", title: "Original session", quote: "Opening", excerpts: [{ messageId: "m2", role: "user", quote: "Please let me choose the branch before revealing the outcome." }] };
    value.corrections.push({ id: "c", createdAt: value.createdAt, actor: { kind: "agent", runId: "r", chatSessionId: "s" }, before: "Use cards", after: "let me choose the branch before revealing the outcome", behavior: "Offer a decision first", scope: "This task", check: "No early answer", status: "draft" });
    const verified = buildWorkspaceProjection(value, "correction", "zh");
    expect(verified.source.provenance).toBe("session");
    expect(verified.source.sourceTitle).toBe("你在原会话中的要求");
    value.corrections[0].after = "You prefer branches in every task";
    expect(buildWorkspaceProjection(value, "correction", "zh").source.provenance).toBe("proposal");
    value.corrections[0].after = "let me choose the branch before revealing the outcome";
    value.source.excerpts![0].role = "assistant";
    expect(buildWorkspaceProjection(value, "correction", "zh").source.provenance).toBe("proposal");
  });

  it("keeps long Unicode previews bounded without destroying emoji", () => {
    expect(compactWorkspaceText("🌱".repeat(50), 5)).toBe("🌱🌱🌱🌱🌱…");
    expect(compactWorkspaceText("  a\n  b  ", 10)).toBe("a b");
    expect(compactWorkspaceText("", 10)).toBe("");
  });
});

it('shows a carried standard with its actual output instead of waiting forever for first use',()=>{
 const value=task();value.corrections.push({id:'c',before:'Original',after:'Actual edit',behavior:'Show the choices first',scope:'This task',check:'No early answer',actor:{kind:'human'},status:'confirmed',createdAt:value.createdAt,resolvedAt:value.createdAt});
 value.runs.push({runId:'r',chatSessionId:'s',runtimeId:'mindos',status:'completed',startedAt:Date.parse(value.createdAt)+1,completedAt:Date.parse(value.createdAt)+2,output:'Here are two choices and their costs.',capturedAt:value.createdAt,outputHash:'a'.repeat(64),collaboration:{taskId:value.id,taskVersion:2,mode:'guide',context:'用户已确认用于本任务的标准：\nShow the choices first\n适用范围：This task',contextHash:'a'.repeat(64)}});
 const view=buildWorkspaceProjection(value,'correction','zh');expect(view.action.title).not.toContain('等待');expect(view.result.evidenceQuote).toBe('Here are two choices and their costs.');expect(view.result.body).toContain('核对');
});
