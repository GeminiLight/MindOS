"use client";
import { useState } from "react";
import type { Inquiry, InquiryRun } from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import { useEchoDraft } from "../use-echo-draft";
import {
  InquiryActionForm,
  type InquiryFormKind,
} from "../inquiries/InquiryActionForm";
import { inquiryCopy } from "../inquiries/inquiry-copy";
import {
  DraftForm,
  Field,
  note,
  say,
  type EditorProps,
  type Mutation,
} from "./editor-shared";

export function DisagreementEditor({
  task,
  locale,
  busy,
  mutate,
  inquiry,
  runs,
  inquiryMutation,
}: EditorProps & {
  inquiry?: Inquiry | null;
  runs: InquiryRun[];
  inquiryMutation: Mutation;
}) {
  const [form, setForm] = useState<InquiryFormKind | null>(null);
  const [values, change] = useEchoDraft<Record<string, string>>(
    "coevolution:" + task.id + ":inquiry-form",
    {},
  );
  const p = inquiryCopy[locale === "zh" ? "zh" : "en"];
  const q = inquiry,
    frame = q?.frames.at(-1),
    plan = q?.plans.filter((p) => p.frameId === frame?.id).at(-1);
  const outcome = q?.decisions.filter((d) => d.frameId === frame?.id).at(-1);
  function open(kind: InquiryFormKind) {
    setForm(kind);
    change(
      kind === "observe"
        ? { kind: "manual", outcome: "uncertain" }
        : kind === "decide"
          ? { outcome: "open" }
          : {
              task: frame?.distinction ?? '',
              supportsA: frame && frame.explanationA.length <= 1500 ? say(locale, '实际证据支持：', 'Observed evidence supports: ') + frame.explanationA : '',
              supportsB: frame && frame.explanationB.length <= 1500 ? say(locale, '实际证据支持：', 'Observed evidence supports: ') + frame.explanationB : '',
              inconclusive: say(locale, '证据不足以区分两种解释，或两者都不成立。', 'Evidence cannot distinguish the explanations, or neither holds.'),
              scope: task.goal.slice(0, 1600),
              budget: say(
                locale,
                "先做一次最小验证，再决定是否扩大。",
                "Run one minimal check before expanding.",
              ),
            },
    );
  }
  return (
    <div className="space-y-5">
      {!q ? (
        <>
          <p className={note}>
            {say(
              locale,
              "意见不同时，先找能区分两种判断的证据。把问题留在这里，一起验证。",
              "When judgments differ, identify evidence that could distinguish them. Keep the question here and test it together.",
            )}
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void mutate({
                action: "create-inquiry",
                locale: locale === "zh" ? "zh" : "en",
              })
            }
          >
            {say(locale, "自己写下分歧", "Write the perspectives myself")}
          </Button>
        </>
      ) : q.draft ? (
        <>
        {q.draft.explanationA && q.draft.explanationB && <section className="space-y-3">
          <h3 className="font-display text-lg">{q.draft.question}</h3>
          {[q.draft.explanationA, q.draft.explanationB].map((text, i) => <div key={i} className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{say(locale, "待核对的观点", "Proposed perspective")} {i === 0 ? "A" : "B"}</p><p className="mt-1 text-sm leading-6">{text}</p></div>)}
          <p className={note}>{q.draft.distinction}</p>
          <Button disabled={busy || !Object.values(q.draft).every(v => v.trim())} onClick={() => void inquiryMutation({ action: "commit-frame" })}>{say(locale, "确认观点，进入验证", "Confirm perspectives and test")}</Button>
        </section>}
        <details><summary className="cursor-pointer py-2 text-sm">{say(locale, "自己补充或修改观点", "Add or edit perspectives yourself")}</summary>
        <DraftForm
          key={q.version}
          id={q.id + ":frame"}
          locale={locale}
          busy={busy}
          initial={{ ...q.draft, question: q.draft.question || task.goal }}
          submitLabel={say(locale, "保存这两个观点", "Save these perspectives")}
          onSubmit={(v) =>
            inquiryMutation({
              action: "save-draft",
              draft: {
                question: v.question,
                explanationA: v.explanationA,
                explanationB: v.explanationB,
                distinction: v.distinction,
                capability: v.capability,
              },
            })
          }
        >
          {(v, set) => (
            <>
              <Field
                name="question"
                label={say(
                  locale,
                  "我们在判断什么",
                  "What are we trying to decide?",
                )}
                value={v}
                change={set}
                max={4000}
              />
              <Field
                name="explanationA"
                label={say(locale, "观点 A 与理由", "Perspective A and why")}
                value={v}
                change={set}
                max={4000}
              />
              <Field
                name="explanationB"
                label={say(locale, "观点 B 与理由", "Perspective B and why")}
                value={v}
                change={set}
                max={4000}
              />
              <Field
                name="distinction"
                label={say(
                  locale,
                  "什么证据能区分这两个观点",
                  "What evidence could distinguish them?",
                )}
                value={v}
                change={set}
                max={4000}
              />
              <Field
                name="capability"
                label={say(
                  locale,
                  "这次想练习哪一种判断",
                  "What judgment do you want to practice?",
                )}
                value={v}
                change={set}
              />

            </>
          )}
        </DraftForm>
        </details>
        </>
      ) : frame ? (
        <>
          <h3 className="font-display text-lg leading-7">{frame.question}</h3>
          <div className="space-y-2">
            {[frame.explanationA, frame.explanationB].map((text, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {say(locale, "观点", "Perspective")} {i === 0 ? "A" : "B"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                  {text}
                </p>
              </div>
            ))}
          </div>
          <p className={note}>{frame.distinction}</p>
          {plan ? (
            <div className="space-y-2 rounded-lg bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                {say(locale, "这次验证", "Current test")}
              </p>
              <p className="text-sm leading-6">{plan.task}</p>
              <Button
                variant="outline"
                disabled={busy || !!form}
                onClick={() =>
                  void inquiryMutation({
                    action: "prepare",
                    kind: "test",
                    frameId: frame.id,
                    planId: plan.id,
                  })
                }
              >
                {say(locale, "让 Agent 执行验证", "Prepare an Agent test")}
              </Button>
            </div>
          ) : null}
          {outcome ? (
            <div className="space-y-2 border-l-2 border-[var(--amber)] pl-3">
              <p className="text-xs text-muted-foreground">
                {say(locale, "更新后的判断", "Updated judgment")}
              </p>
              <p className="text-sm leading-6">{outcome.reason}</p>
              <p className={note}>{p[outcome.outcome as "open"]}</p>
            </div>
          ) : null}
          {!form ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => open(plan ? "observe" : "plan")}
              >
                {plan
                  ? say(locale, "加入验证证据", "Add evidence")
                  : say(locale, "设计一个小验证", "Plan a small test")}
              </Button>
              {plan ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => open("decide")}
                >
                  {say(locale, "更新判断", "Update judgment")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void inquiryMutation({ action: "revise", frameId: frame.id })
                }
              >
                {say(locale, "重看问题", "Reframe")}
              </Button>
            </div>
          ) : null}
          {form ? (
            <InquiryActionForm
              reviewPlan
              kind={form}
              q={q}
              runs={runs}
              p={p}
              values={values}
              change={change}
              busy={busy}
              submit={(command) => {
                void inquiryMutation(command).then((ok) => {
                  if (ok) {
                    setForm(null);
                    change({});
                  }
                });
              }}
              close={() => setForm(null)}
            />
          ) : null}
          {q.observations.length ? (
            <details>
              <summary className="cursor-pointer py-2 text-sm">
                {say(locale, "查看证据", "Review evidence")} ·{" "}
                {q.observations.length}
              </summary>
              <div className="space-y-4">
                {q.observations.map((o) => (
                  <div
                    key={o.id}
                    className="space-y-1 border-l border-border pl-3"
                  >
                    <p className="text-xs text-muted-foreground">
                      {o.kind === "manual"
                        ? say(locale, "人工记录 · ", "Human record · ") +
                          o.sourceLabel
                        : say(locale, "真实 Agent 运行", "Actual Agent run")}
                    </p>
                    <blockquote className="whitespace-pre-wrap text-sm leading-6">
                      {o.quote}
                    </blockquote>
                    <p className={note}>{o.interpretation}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
