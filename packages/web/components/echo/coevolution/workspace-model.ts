import type { CoevolutionTask, Inquiry } from "@geminilight/mindos/knowledge";
import {
  WORKSPACE_FEATURES,
  workspaceCopy,
  type WorkspaceFeature,
} from "./workspace-copy";

export type WorkspaceActionState = "ready" | "waiting" | "complete" | "empty";
export interface WorkspaceProjection {
  source: {
    title: string;
    body: string;
    provenance: "session" | "manual" | "run" | "proposal";
    sourceTitle?: string;
  };
  action: {
    title: string;
    body: string;
    detail?: string;
    state: WorkspaceActionState;
    cta: string;
  };
  result: {
    title: string;
    body: string;
    pending: boolean;
    evidenceLabel?: string;
    evidenceQuote?: string;
    failed?: boolean;
    closed?: boolean;
  };
  features: Array<{ id: WorkspaceFeature; count: number; pending: boolean }>;
  history: Array<{
    id: string;
    feature: WorkspaceFeature;
    title: string;
    createdAt: string;
  }>;
}

export function compactWorkspaceText(value: string, max = 100): string {
  const text = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  return characters.length > max
    ? characters.slice(0, max).join("") + "…"
    : text;
}

// An unresolved choice is more useful to return to than the most recently visited tab.
export function nextWorkspaceFeature(task: CoevolutionTask): WorkspaceFeature {
  if (task.decisions.some((decision) => !decision.outcome)) return "decision";
  if (task.corrections.some((correction) => correction.status === "draft"))
    return "correction";
  if (
    task.agreements.some(
      (agreement) =>
        agreement.status === "proposed" || agreement.status === "trying",
    )
  )
    return "experiment";
  if (task.decisions.length && !task.runs.length) return "handoff";
  return "decision";
}

export function buildWorkspaceProjection(
  task: CoevolutionTask,
  feature: WorkspaceFeature,
  locale: string,
  inquiry?: Inquiry | null,
  selectedRecordId?: string,
): WorkspaceProjection {
  const copy = workspaceCopy(locale);
  const config = copy.features[feature];
  const result: WorkspaceProjection = {
    source: {
      title: task.title,
      body: task.source?.quote || task.goal,
      provenance: task.source ? "session" : "manual",
      sourceTitle: task.source?.title,
    },
    action: { title: config.empty, body: "", state: "empty", cta: config.cta },
    result: { title: copy.result, body: copy.noEvidence, pending: true },
    features: WORKSPACE_FEATURES.map((id) => ({
      id,
      count: 0,
      pending: false,
    })),
    history: [],
  };
  const counts: Record<WorkspaceFeature, number> = {
    decision: task.decisions.length,
    handoff: task.runs.length,
    correction: task.corrections.length,
    disagreement: task.inquiryId ? 1 : 0,
    transfer: task.applications.length,
    experiment: task.agreements.length,
  };
  const pending: Record<WorkspaceFeature, boolean> = {
    decision: task.decisions.some((item) => !item.outcome),
    handoff:
      task.preparations.some((item) => !item.consumedAt) ||
      task.runs.some((item) =>
        ["queued", "running", "streaming", "waiting_approval"].includes(
          item.status,
        ),
      ),
    correction: task.corrections.some((item) => item.status === "draft"),
    disagreement: !!inquiry?.plans.length && !inquiry?.decisions.length,
    transfer: false,
    experiment: task.agreements.some(
      (item) => item.status === "proposed" || item.status === "trying",
    ),
  };
  result.features = WORKSPACE_FEATURES.map((id) => ({
    id,
    count: counts[id],
    pending: pending[id],
  }));
  const recordEvidence = (
    observation: string,
    kind: "manual" | "run",
    title = copy.recorded,
    evidenceQuote?: string,
  ) => {
    result.result = {
      title,
      body: observation,
      pending: false,
      evidenceQuote,
      evidenceLabel: kind === "run" ? copy.evidenceRun : copy.evidenceManual,
    };
  };

  if (feature === "decision") {
    const decision =
      task.decisions.find((item) => item.id === selectedRecordId) ??
      task.decisions.at(-1);
    if (decision) {
      const choice = decision.options.find(
        (option) => option.id === decision.choice?.optionId,
      );
      result.action = {
        title: decision.question,
        body: copy.decision.options(decision.options.length),
        detail: choice
          ? `${copy.decision.chosen} · ${choice.label}`
          : undefined,
        state: decision.outcome
          ? "complete"
          : decision.choice
            ? "waiting"
            : "ready",
        cta: decision.outcome
          ? copy.continue
          : decision.choice
            ? copy.decision.observe
            : copy.decision.choose,
      };
      if (decision.outcome)
        recordEvidence(
          decision.outcome.observation,
          decision.outcome.evidence.kind,
          copy.decision.observed,
          decision.outcome.evidence.quote,
        );
      else if (decision.choice) {
        const chosenAt = Date.parse(decision.choice.recordedAt);
        const available = [...task.runs]
          .filter((run) => run.status === "completed" && run.output.trim() && (run.completedAt ?? 0) >= chosenAt)
          .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
        if (available) {
          result.action.cta = locale === "zh" ? "对照预测" : "Compare with your prediction";
          result.result = {
            title: locale === "zh" ? "输出已回来，待你核对" : "Output is ready for your review",
            body: locale === "zh"
              ? "看看这次实际做出了什么，再判断是否符合你的预测。"
              : "Review what was actually produced, then compare it with your prediction.",
            pending: true,
            evidenceLabel: copy.evidenceRun,
            evidenceQuote: available.output,
          };
        } else result.result.body = copy.decision.pending;
      }
    }
  } else if (feature === "handoff") {
    const run = [...task.runs].sort((a, b) => b.startedAt - a.startedAt)[0];
    result.action = {
      title: copy.modes[task.mode],
      body: copy.modeHelp[task.mode],
      state: task.preparations.length ? "waiting" : "ready",
      cta: copy.handoff.ready,
    };
    if (run?.status === "completed" && run.output.trim()) {
      result.action.state = "complete";
      recordEvidence(run.output, "run", copy.handoff.complete);
    } else if (
      run &&
      ["failed", "canceled", "timed_out"].includes(run.status)
    ) {
      result.result = {
        title: locale === "zh" ? "这次执行没有完成" : "This run did not finish",
        body:
          run.error ||
          (locale === "zh"
            ? "可以保留当前任务，再试一次交接。"
            : "Keep the current task and try the handoff again."),
        pending: false,
        evidenceLabel: copy.evidenceRun,
        failed: true,
      };
    } else {
      result.result.body = copy.handoff.pending;
      if (task.preparations.length)
        result.action.detail = copy.handoff.prepared;
    }
  } else if (feature === "correction") {
    const correction =
      task.corrections.find((item) => item.id === selectedRecordId) ??
      task.corrections.at(-1);
    if (correction) {
      const quotedHumanRequest = !!correction.after.trim() && task.source?.excerpts?.some(
        (excerpt) => excerpt.role === "user" && excerpt.quote.includes(correction.after),
      );
      result.source.body = correction.after;
      result.source.provenance =
        quotedHumanRequest ? "session" : correction.actor.kind === "agent" ? "proposal" : "manual";
      result.source.sourceTitle =
        quotedHumanRequest
          ? locale === "zh" ? "你在原会话中的要求" : "Your request in the original session"
          : correction.actor.kind === "agent"
          ? locale === "zh"
            ? "Agent 建议的修改"
            : "An edit proposed by Agent"
          : locale === "zh"
            ? "你修改后的产物"
            : "Your edited artifact";
      result.action = {
        title: copy.correction[correction.status],
        body: correction.scope,
        detail: correction.behavior,
        state: correction.status === "draft" ? "ready" : "complete",
        cta: copy.action,
      };
      result.result.body =
        correction.status === "rejected"
          ? locale === "zh"
            ? "修改仍保留在协作轨迹中，这条标准不会带入后续任务。"
            : "The edit stays in your trail. This standard will not be brought into later tasks."
          : copy.correction.pending;
      if (correction.status === "rejected") {
        result.result.title = copy.correction.rejected;
        result.result.closed = true;
      }
      const carried = correction.status === 'confirmed' && [...task.runs].sort((a,b)=>b.startedAt-a.startedAt).find(run => run.status === 'completed' && run.output && run.collaboration?.context.includes('用户已确认用于本任务的标准：\n' + correction.behavior));
      if (carried) {
        result.action.title = locale === 'zh' ? '已带入一次后续运行' : 'Carried into a later run';
        result.result = {title: locale === 'zh' ? '用实际输出核对' : 'Review the actual output', body: locale === 'zh' ? '这条标准已随一次完成的运行传入。请核对输出是否符合，效果仍需实际观察。' : 'This standard accompanied a completed run. Compare its output with the standard; effectiveness still needs observation.', pending:false,evidenceLabel:copy.evidenceRun,evidenceQuote:carried.output};
      }
    }
  } else if (feature === "disagreement") {
    const frame = inquiry?.frames.at(-1);
    if (frame) {
      result.action = {
        title: frame.question,
        body: frame.distinction,
        state: inquiry?.decisions.length ? "complete" : "ready",
        cta: copy.action,
      };
      result.action.detail =
        locale === "zh"
          ? "两种解释，等待同一份证据"
          : "Two explanations, tested against the same evidence";
      const observation = inquiry?.observations.at(-1);
      if (observation)
        recordEvidence(
          observation.interpretation,
          observation.kind,
          copy.recorded,
          observation.quote,
        );
    } else if (task.inquiryId) {
      result.action.state = "ready";
      result.action.detail = locale === 'zh' ? '观点草稿，待你核对' : 'Draft perspectives, ready for review';
    }
    if (result.result.pending) result.result.body = copy.disagreement.pending;
  } else if (feature === "transfer") {
    const application =
      task.applications.find((item) => item.id === selectedRecordId) ??
      task.applications.at(-1);
    if (application) {
      result.action = {
        title: copy.transfer[application.disposition],
        body: application.reason,
        detail: application.adjustment?.behavior || application.method.behavior,
        state: "complete",
        cta: copy.action,
      };
      result.result.body =
        application.disposition === "reject"
          ? locale === "zh"
            ? "已经留下不适用的理由，下次遇到相似情况时可以回看。"
            : "The reason it does not fit is recorded for the next similar task."
          : copy.transfer.pending;
      if (application.disposition === "reject") {
        result.result.title = copy.transfer.reject;
        result.result.closed = true;
      }
    }
  } else if (feature === "experiment") {
    const agreement =
      task.agreements.find((item) => item.id === selectedRecordId) ??
      task.agreements.at(-1);
    if (agreement) {
      result.action = {
        title: agreement.behavior,
        body: agreement.scope,
        detail: copy.experiment[agreement.status],
        state: ["proposed", "trying"].includes(agreement.status)
          ? "ready"
          : "complete",
        cta: copy.action,
      };
      const observation = agreement.observations.at(-1);
      if (observation)
        recordEvidence(
          observation.observation,
          observation.evidence.kind,
          copy.experiment.observations(agreement.observations.length),
          observation.evidence.quote,
        );
      else {
        result.result.body =
          agreement.status === "proposed"
            ? locale === "zh"
              ? "这是 Agent 的建议。由你确认后，才会成为本次合作的约定。"
              : "This is an Agent suggestion. It becomes a collaboration agreement only after your confirmation."
            : agreement.status === "withdrawn"
              ? locale === "zh"
                ? "这次尝试已经结束；目前没有记录实际观察。"
                : "This experiment has ended. No real observation was recorded."
              : copy.experiment.pending;
        if (agreement.status === "withdrawn") {
          result.result.title = copy.experiment.withdrawn;
          result.result.closed = true;
        }
      }
    }
  }

  result.history = [
    ...task.decisions.map((item) => ({
      id: item.id,
      feature: "decision" as const,
      title: item.question,
      createdAt: item.choice?.recordedAt || item.createdAt,
    })),
    ...task.corrections.map((item) => ({
      id: item.id,
      feature: "correction" as const,
      title: item.behavior,
      createdAt: item.createdAt,
    })),
    ...task.applications.map((item) => ({
      id: item.id,
      feature: "transfer" as const,
      title: item.adjustment?.behavior || item.method.behavior,
      createdAt: item.createdAt,
    })),
    ...task.agreements.map((item) => ({
      id: item.id,
      feature: "experiment" as const,
      title: item.behavior,
      createdAt: item.createdAt,
    })),
    ...task.preparations.map((item) => ({
      id: item.id,
      feature: "handoff" as const,
      title: copy.handoff.prepared,
      createdAt: item.preparedAt,
    })),
    ...(inquiry?.frames.map((item) => ({
      id: item.id,
      feature: "disagreement" as const,
      title: item.question,
      createdAt: item.createdAt,
    })) || []),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return result;
}
