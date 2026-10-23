"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DraftForm,
  Field,
  MethodFields,
  EvidenceFields,
  EvidenceView,
  evidenceFrom,
  control,
  note,
  say,
  type EditorProps,
} from "./editor-shared";
export function ExperimentEditor({
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
  const current =
    task.agreements.find((a) => a.id === (selectedRecordId ?? selected)) ??
    task.agreements.at(-1);
  return (
    <div className="space-y-5">
      {task.agreements.length > 1 ? (
        <label className="block space-y-2 text-sm">
          <span>{say(locale, "回看协作约定", "Review an agreement")}</span>
          <select
            className={control}
            value={current?.id}
            onChange={(e) => {
              setSelected(e.target.value);
              onSelectRecord?.(e.target.value);
            }}
          >
            {task.agreements.map((a, i) => (
              <option key={a.id} value={a.id}>
                {i + 1}. {a.behavior}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className={note}>
        {say(
          locale,
          "试一种更适合你的合作方式。让它进入真实任务，再根据观察决定是否保留。",
          "Try a way of working together. Use it in a real task, then decide whether to keep it.",
        )}
      </p>
      {(current ? [current] : []).map((a) => (
        <section key={a.id} className="space-y-3 border-b border-border pb-5">
          <p className="text-xs text-muted-foreground">
            {a.status === "proposed"
              ? say(
                  locale,
                  "Agent 建议 · 待你决定",
                  "Agent proposal · your decision",
                )
              : a.status === "trying"
                ? say(locale, "正在试行", "Trying now")
                : a.status === "kept"
                  ? say(locale, "已保留", "Kept")
                  : a.status === "revised"
                    ? say(locale, "已由新约定接替", "Replaced by a revision")
                    : say(locale, "已停止", "Stopped")}
          </p>
          <h3 className="text-sm font-medium leading-6">{a.behavior}</h3>
          <p className={note}>{a.scope}</p>
          <details>
            <summary className="cursor-pointer py-1 text-xs text-muted-foreground">
              {say(locale, "如何检验", "How to evaluate")}
            </summary>
            <p className={note}>{a.check}</p>
          </details>
          {a.status === "proposed" ? (
            <Button
              disabled={busy}
              onClick={() =>
                void mutate({ action: "try-agreement", agreementId: a.id })
              }
            >
              {say(locale, "同意试一次", "Try this agreement")}
            </Button>
          ) : null}
          {a.observations.length ? (
            <details>
              <summary className="cursor-pointer py-2 text-sm">
                {say(locale, "实际观察", "Observed evidence")} ·{" "}
                {a.observations.length}
              </summary>
              <div className="space-y-4">
                {a.observations.map((o) => (
                  <div className="space-y-2" key={o.id}>
                    <p className="text-sm leading-6">{o.observation}</p>
                    <EvidenceView evidence={o.evidence} locale={locale} />
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {a.status === "trying" ? (
            <details>
              <summary className="cursor-pointer py-2 text-sm font-medium">
                {say(locale, "记下这次试行效果", "Record how the trial went")}
              </summary>
              <DraftForm
                id={task.id + ":" + a.id + ":observe"}
                busy={busy}
                locale={locale}
                initial={{ outcome: "uncertain" }}
                submitLabel={say(locale, "保存观察", "Save observation")}
                onSubmit={(v) =>
                  mutate({
                    action: "observe-agreement",
                    agreementId: a.id,
                    outcome: v.outcome,
                    observation: v.observation,
                    evidence: evidenceFrom(v),
                  })
                }
              >
                {(v, change) => (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {(
                        ["helped", "mixed", "unhelpful", "uncertain"] as const
                      ).map((o) => (
                        <Button
                          key={o}
                          type="button"
                          variant={v.outcome === o ? "secondary" : "ghost"}
                          aria-pressed={v.outcome === o}
                          onClick={() => change({ ...v, outcome: o })}
                        >
                          {o === "helped"
                            ? say(locale, "有帮助", "Helpful")
                            : o === "mixed"
                              ? say(locale, "有好有坏", "Mixed")
                              : o === "unhelpful"
                                ? say(locale, "没帮助", "Unhelpful")
                                : say(locale, "还不确定", "Uncertain")}
                        </Button>
                      ))}
                    </div>
                    <Field
                      name="observation"
                      label={say(
                        locale,
                        "具体发生了什么",
                        "What actually happened?",
                      )}
                      value={v}
                      change={change}
                      max={4000}
                    />
                    <EvidenceFields
                      value={v}
                      change={change}
                      runs={task.runs}
                      startedAfter={a.trialStartedAt ?? a.createdAt}
                      locale={locale}
                    />
                  </>
                )}
              </DraftForm>
            </details>
          ) : null}
          {["proposed", "trying", "kept"].includes(a.status) ? (
            <details>
              <summary className="cursor-pointer py-2 text-sm">
                {say(locale, "保留、调整或停止", "Keep, revise, or stop")}
              </summary>
              <DraftForm
                id={task.id + ":" + a.id + ":resolve"}
                locale={locale}
                busy={busy}
                initial={{
                  resolution:
                    a.status === "trying" && a.observations.length
                      ? "keep"
                      : "withdraw",
                  behavior: a.behavior,
                  scope: a.scope,
                  check: a.check,
                }}
                submitLabel={say(locale, "保存决定", "Save decision")}
                onSubmit={(v) =>
                  mutate({
                    action: "resolve-agreement",
                    agreementId: a.id,
                    resolution: v.resolution,
                    reason: v.reason,
                    ...(v.resolution === "revise"
                      ? {
                          revision: {
                            behavior: v.behavior,
                            scope: v.scope,
                            check: v.check,
                          },
                        }
                      : {}),
                  })
                }
              >
                {(v, change) => (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {(["keep", "revise", "withdraw"] as const).map((r) => (
                        <Button
                          key={r}
                          type="button"
                          disabled={
                            r === "keep" &&
                            (!a.observations.length || a.status !== "trying")
                          }
                          variant={v.resolution === r ? "secondary" : "ghost"}
                          aria-pressed={v.resolution === r}
                          onClick={() => change({ ...v, resolution: r })}
                        >
                          {r === "keep"
                            ? say(locale, "保留", "Keep")
                            : r === "revise"
                              ? say(locale, "调整", "Revise")
                              : say(locale, "停止", "Stop")}
                        </Button>
                      ))}
                    </div>
                    {!a.observations.length ? (
                      <p className={note}>
                        {say(
                          locale,
                          "先留下一条实际观察，再决定长期保留。",
                          "Record an observation before keeping it for the future.",
                        )}
                      </p>
                    ) : null}
                    <Field
                      name="reason"
                      label={say(
                        locale,
                        "为什么这样决定",
                        "Reason for this decision",
                      )}
                      value={v}
                      change={change}
                    />
                    {v.resolution === "revise" ? (
                      <MethodFields value={v} change={change} locale={locale} />
                    ) : null}
                  </>
                )}
              </DraftForm>
            </details>
          ) : null}
          {a.resolution ? <p className={note}>{a.resolution.reason}</p> : null}
        </section>
      ))}
      <details>
        <summary className="cursor-pointer py-3 text-sm font-medium">
          {say(locale, "试一个新的协作约定", "Try a new working agreement")}
        </summary>
        <DraftForm
          id={task.id + ":agreement"}
          busy={busy}
          locale={locale}
          submitLabel={say(locale, "开始试行", "Start trial")}
          onSubmit={(v) =>
            mutate({
              action: "start-agreement",
              behavior: v.behavior,
              scope: v.scope,
              check: v.check,
            })
          }
        >
          {(v, change) => (
            <MethodFields value={v} change={change} locale={locale} />
          )}
        </DraftForm>
      </details>
    </div>
  );
}
