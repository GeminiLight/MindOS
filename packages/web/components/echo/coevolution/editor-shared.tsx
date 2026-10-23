"use client";
import type { ReactNode } from "react";
import type {
  CoevolutionEvidence,
  CoevolutionRun,
  CoevolutionTask,
} from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import { EchoDraftNotice, useEchoDraft } from "../use-echo-draft";

export type Mutation = (command: Record<string, unknown>) => Promise<boolean>;
export type EditorProps = {
  task: CoevolutionTask;
  locale: string;
  busy: boolean;
  mutate: Mutation;
};
export const control =
  "w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const note = "text-sm leading-6 text-muted-foreground";
export const say = (locale: string, zh: string, en: string) =>
  locale === "zh" ? zh : en;
export function Field({
  name,
  label,
  value,
  change,
  placeholder,
  max = 1600,
  optional = false,
  rows = 2,
}: {
  name: string;
  label: string;
  value: Record<string, string>;
  change: (v: Record<string, string>) => void;
  placeholder?: string;
  max?: number;
  optional?: boolean;
  rows?: number;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        name={name}
        rows={rows}
        maxLength={max}
        required={!optional}
        className={control + " resize-y"}
        value={value[name] ?? ""}
        placeholder={placeholder}
        onChange={(e) => change({ ...value, [name]: e.target.value })}
      />
    </label>
  );
}
export function DraftForm({
  id,
  title,
  submitLabel,
  busy,
  locale,
  initial = {},
  onSubmit,
  children,
}: {
  id: string;
  title?: string;
  submitLabel: string;
  busy: boolean;
  locale: string;
  initial?: Record<string, string>;
  onSubmit: (v: Record<string, string>) => Promise<boolean>;
  children: (
    v: Record<string, string>,
    set: (v: Record<string, string>) => void,
  ) => ReactNode;
}) {
  const [values, setValues, storage] = useEchoDraft<Record<string, string>>(
    "coevolution:" + id,
    initial,
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!busy && (await onSubmit(values))) setValues(initial);
      }}
      className="space-y-4"
    >
      {title ? <h3 className="font-display text-lg">{title}</h3> : null}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {children(values, setValues)}
        <Button
          type="submit"
          className="min-h-11 bg-[var(--amber)] text-[var(--amber-foreground)]"
        >
          {busy ? say(locale, "正在保存…", "Saving…") : submitLabel}
        </Button>
      </fieldset>
      {storage.failed || storage.restored ? (
        <EchoDraftNotice
          locale={locale === "zh" ? "zh" : "en"}
          state={storage}
        />
      ) : null}
    </form>
  );
}
export function MethodFields({
  value,
  change,
  locale,
}: {
  value: Record<string, string>;
  change: (v: Record<string, string>) => void;
  locale: string;
}) {
  return (
    <>
      <Field
        name="behavior"
        label={say(locale, "下次具体怎么做", "What to do next time")}
        value={value}
        change={change}
      />
      <Field
        name="scope"
        label={say(
          locale,
          "什么时候适用，哪些情况除外",
          "When it applies, including exceptions",
        )}
        value={value}
        change={change}
      />
      <Field
        name="check"
        label={say(locale, "怎么判断做到了", "How to check it worked")}
        value={value}
        change={change}
      />
    </>
  );
}
export function EvidenceFields({
  value,
  change,
  locale,
  runs,
  after,
  startedAfter,
}: {
  value: Record<string, string>;
  change: (v: Record<string, string>) => void;
  locale: string;
  runs: CoevolutionRun[];
  after?: string;
  startedAfter?: string;
}) {
  const completed = runs.filter(
    (r) => r.status === "completed" && r.output.trim() && (!after || (r.completedAt ?? 0) >= Date.parse(after)) && (!startedAfter || r.startedAt >= Date.parse(startedAfter)),
  ).sort((a, b) => b.startedAt - a.startedAt);
  const run = completed.find((r) => r.runId === value.runId);
  return (
    <div className="space-y-3 border-t border-border pt-3">
      {completed[0] && <Button type="button" variant="outline" onClick={() => change({ ...value, evidenceKind: 'run', runId: completed[0].runId, quote: completed[0].output.slice(0, 4000) })}>
        {say(locale, '引用最近一次实际输出', 'Use the latest actual output')}
      </Button>}
      <label className="block space-y-1.5 text-sm">
        <span>{say(locale, "证据来源", "Evidence source")}</span>
        <select
          className={control}
          name="evidenceKind"
          value={value.evidenceKind ?? "manual"}
          onChange={(e) =>
            change({
              ...value,
              evidenceKind: e.target.value,
              runId: "",
              quote: "",
            })
          }
        >
          <option value="manual">
            {say(locale, "我的实际观察", "My observation")}
          </option>
          <option value="run" disabled={!completed.length}>
            {say(locale, "已完成的 Agent 运行", "Completed Agent run")}
          </option>
        </select>
      </label>
      {value.evidenceKind === "run" ? (
        <>
          <label className="block space-y-1.5 text-sm">
            <span>{say(locale, "选择运行", "Select a run")}</span>
            <select
              required
              className={control}
              name="runId"
              value={value.runId ?? ""}
              onChange={(e) =>
                change({ ...value, runId: e.target.value, quote: completed.find(r => r.runId === e.target.value)?.output.slice(0, 4000) ?? "" })
              }
            >
              <option value="">{say(locale, "请选择", "Choose a run")}</option>
              {completed.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.runtimeId} · {new Date(r.startedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {run ? (
            <details>
              <summary className="cursor-pointer py-2 text-sm">
                {say(locale, "查看实际输出", "Read actual output")}
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs leading-6">
                {run.output}
              </pre>
            </details>
          ) : null}
        </>
      ) : (
        <Field
          name="sourceLabel"
          label={say(locale, "在哪里观察到的", "Where you observed it")}
          placeholder={say(
            locale,
            "例如：文档第二页、这次用户测试",
            "For example: page 2, a user test",
          )}
          value={value}
          change={change}
          max={300}
        />
      )}
      <Field
        name="quote"
        label={say(
          locale,
          "留下原文或可核对的记录",
          "Quote or verifiable record",
        )}
        value={value}
        change={change}
        max={4000}
      />
    </div>
  );
}
export function evidenceFrom(v: Record<string, string>): CoevolutionEvidence {
  return v.evidenceKind === "run"
    ? { kind: "run", runId: v.runId, quote: v.quote }
    : { kind: "manual", sourceLabel: v.sourceLabel, quote: v.quote };
}
export function EvidenceView({
  evidence,
  locale,
}: {
  evidence: CoevolutionEvidence;
  locale: string;
}) {
  return (
    <details className="rounded-lg border border-border px-3">
      <summary className="cursor-pointer py-3 text-xs text-muted-foreground">
        {evidence.kind === "manual"
          ? say(locale, "人工记录 · ", "Human observation · ") +
            evidence.sourceLabel
          : say(locale, "核验过的运行引用", "Verified run quotation")}
      </summary>
      <blockquote className="mb-3 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm leading-6">
        {evidence.quote}
      </blockquote>
    </details>
  );
}
