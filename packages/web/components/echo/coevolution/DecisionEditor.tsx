"use client";
import { useState } from "react";
import { compactWorkspaceText } from "./workspace-model";
import {
  DraftForm,
  Field,
  EvidenceFields,
  EvidenceView,
  evidenceFrom,
  control,
  note,
  say,
  type EditorProps,
} from "./editor-shared";

export function DecisionEditor({
  task,
  locale,
  busy,
  mutate,
  selectedRecordId,
  onSelectRecord,
}: EditorProps & {
  selectedRecordId?: string;
  onSelectRecord?: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const decision =
    task.decisions.find((d) => d.id === (selectedRecordId ?? selected)) ??
    task.decisions.at(-1);
  const hasCompletedOutput = !!decision?.choice && task.runs.some(run => run.status === 'completed' && run.output.trim() && (run.completedAt ?? 0) >= Date.parse(decision.choice!.recordedAt));
  return (
    <div className="space-y-5">
      {task.decisions.length > 1 ? (
        <label className="block space-y-2 text-sm">
          <span>{say(locale, "回看判断", "Revisit a decision")}</span>
          <select
            className={control}
            value={decision?.id}
            onChange={(e) => {
              setSelected(e.target.value);
              onSelectRecord?.(e.target.value);
            }}
          >
            {task.decisions.map((d, i) => (
              <option key={d.id} value={d.id}>
                {i + 1}. {d.question}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!decision ? (
        <p className={note}>
          {say(
            locale,
            "开始任务后，Agent 会把值得你参与的取舍带到这里。你也可以先记下一处正在犹豫的选择。",
            "Start a task and the Agent can bring important tradeoffs here. You can also add a decision you are considering.",
          )}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {decision.actor.kind === "agent"
              ? say(locale, "Agent 提出的取舍", "Tradeoff proposed by Agent")
              : say(locale, "你记录的取舍", "Tradeoff recorded by you")}
          </p>
          <h3 className="font-display text-xl leading-8">
            {compactWorkspaceText(decision.question, 72)}
          </h3>
          {Array.from(decision.question).length > 72 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {say(locale, "展开完整问题", "Read the full question")}
              </summary>
              <p className="mt-3 whitespace-pre-wrap leading-6">
                {decision.question}
              </p>
            </details>
          )}
          {!decision.choice ? (
            <DraftForm
              key={decision.id}
              id={task.id + ":" + decision.id}
              busy={busy}
              locale={locale}
              submitLabel={say(locale, "记下我的选择", "Save my choice")}
              initial={{ confidence: "50" }}
              onSubmit={async (v) => {
                if (!decision.options.some((o) => o.id === v.optionId))
                  return false;
                return mutate({
                  action: "choose-decision",
                  decisionId: decision.id,
                  optionId: v.optionId,
                  prediction: v.prediction,
                  confidence: Number(v.confidence ?? 50),
                  ...(v.reason?.trim() ? { reason: v.reason } : {}),
                });
              }}
            >
              {(v, change) => (
                <>
                  <fieldset className="space-y-2">
                    <legend className="sr-only">
                      {say(locale, "选择路线", "Choose a route")}
                    </legend>
                    {decision.options.map((o, i) => (
                      <button
                        key={o.id}
                        type="button"
                        aria-pressed={v.optionId === o.id}
                        onClick={() => change({ ...v, optionId: o.id })}
                        className={
                          "w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                          (v.optionId === o.id
                            ? "border-[var(--amber)] bg-muted/50"
                            : "border-border hover:bg-muted/30")
                        }
                      >
                        <span className="text-sm font-medium">
                          {String.fromCharCode(65 + i)} · {o.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {o.tradeoff}
                        </span>
                      </button>
                    ))}
                    <input
                      aria-label={say(locale, "已选路线", "Selected route")}
                      className="sr-only"
                      tabIndex={-1}
                      value={v.optionId ?? ""}
                      required
                      onChange={() => {}}
                    />
                  </fieldset>
                  <Field
                    name="prediction"
                    label={say(
                      locale,
                      "你预计接下来会怎样？",
                      "What do you expect to happen?",
                    )}
                    value={v}
                    change={change}
                  />
                  <label className="block space-y-2 text-sm">
                    <span>
                      {say(locale, "有多大把握", "How confident are you?")} ·{" "}
                      {v.confidence ?? 50}%
                    </span>
                    <input
                      className="w-full accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                      name="confidence"
                      type="range"
                      min={0}
                      max={100}
                      step={10}
                      value={v.confidence ?? 50}
                      onChange={(e) =>
                        change({ ...v, confidence: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </DraftForm>
          ) : (
            <>
              <div className="space-y-3 rounded-lg bg-muted/40 p-4">
                <p className="text-xs text-muted-foreground">
                  {say(locale, "你的选择与预测", "Your choice and prediction")}
                </p>
                <p className="text-sm font-medium">
                  {
                    decision.options.find(
                      (o) => o.id === decision.choice!.optionId,
                    )?.label
                  }
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {decision.choice.prediction}
                </p>
                <p className="text-xs text-muted-foreground">
                  {say(locale, "当时把握", "Confidence at the time")}{" "}
                  {decision.choice.confidence}%
                </p>
              </div>
              {decision.outcome ? (
                <section className="space-y-3">
                  <h4 className="text-sm font-medium">
                    {say(locale, "实际结果", "Actual result")}
                  </h4>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {decision.outcome.observation}
                  </p>
                  <EvidenceView
                    evidence={decision.outcome.evidence}
                    locale={locale}
                  />
                  <p className={note}>
                    {say(
                      locale,
                      "对照预测：哪条证据改变了你的判断？",
                      "Compare with your prediction: which evidence changed your judgment?",
                    )}
                  </p>
                </section>
              ) : (
                <>
                  <p role="status" className={note}>
                    {hasCompletedOutput ? say(locale, '已有实际输出，反馈仍待核对。展开下方，可直接引用输出并对照预测。', 'An actual output is available; feedback still needs review. Open below to quote it and compare your prediction.') : say(
                      locale,
                      "等待真实证据。可以继续任务，完成后再对照。",
                      "Waiting for evidence. Continue the task, then compare.",
                    )}
                  </p>
                  <details>
                    <summary className="cursor-pointer py-3 text-sm font-medium">
                      {say(
                        locale,
                        "已有结果，记录观察",
                        "Record an observed result",
                      )}
                    </summary>
                    <DraftForm
                      id={task.id + ":" + decision.id + ":outcome"}
                      busy={busy}
                      locale={locale}
                      submitLabel={say(
                        locale,
                        "保存结果与证据",
                        "Save result and evidence",
                      )}
                      onSubmit={(v) =>
                        mutate({
                          action: "observe-decision",
                          decisionId: decision.id,
                          observation: v.observation,
                          evidence: evidenceFrom(v),
                        })
                      }
                    >
                      {(v, change) => (
                        <>
                          <Field
                            name="observation"
                            label={say(
                              locale,
                              "实际发生了什么，与预测有何不同",
                              "What happened, and how did it differ?",
                            )}
                            value={v}
                            change={change}
                            max={4000}
                          />
                          <EvidenceFields
                            value={v}
                            change={change}
                            locale={locale}
                            runs={task.runs}
                            after={decision.choice!.recordedAt}
                          />
                        </>
                      )}
                    </DraftForm>
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
      <details className="border-t border-border pt-2">
        <summary className="cursor-pointer py-3 text-sm">
          {say(locale, "添加一处取舍", "Add a decision")}
        </summary>
        <DraftForm
          id={task.id + ":new-decision"}
          busy={busy}
          locale={locale}
          submitLabel={say(locale, "留下这个分岔点", "Add this decision")}
          onSubmit={(v) =>
            mutate({
              action: "add-decision",
              question: v.question,
              options: [
                { id: "a", label: v.a, tradeoff: v.aCost },
                { id: "b", label: v.b, tradeoff: v.bCost },
              ],
            })
          }
        >
          {(v, change) => (
            <>
              <Field
                name="question"
                label={say(locale, "正在犹豫什么", "What needs a decision?")}
                value={v}
                change={change}
                max={2000}
              />
              <div className="space-y-3 border-l-2 border-border pl-3">
                <Field
                  name="a"
                  label={say(locale, "路线 A", "Route A")}
                  value={v}
                  change={change}
                  max={200}
                  rows={1}
                />
                <Field
                  name="aCost"
                  label={say(
                    locale,
                    "A 的收益与代价",
                    "Benefits and costs of A",
                  )}
                  value={v}
                  change={change}
                />
              </div>
              <div className="space-y-3 border-l-2 border-border pl-3">
                <Field
                  name="b"
                  label={say(locale, "路线 B", "Route B")}
                  value={v}
                  change={change}
                  max={200}
                  rows={1}
                />
                <Field
                  name="bCost"
                  label={say(
                    locale,
                    "B 的收益与代价",
                    "Benefits and costs of B",
                  )}
                  value={v}
                  change={change}
                />
              </div>
            </>
          )}
        </DraftForm>
      </details>
    </div>
  );
}
