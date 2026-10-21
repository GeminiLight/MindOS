"use client";
import React from "react";
import Link from "next/link";
import type { WorkRecord, ViewSpec } from "@geminilight/mindos/knowledge/views";
const labels: Record<string, [string, string]> = {
  title: ["任务", "Task"],
  status: ["状态", "Status"],
  dueDate: ["截止日期", "Due date"],
  personRef: ["相关人物", "Person"],
  sourcePath: ["来源", "Source"],
  name: ["姓名", "Name"],
  background: ["背景", "Background"],
  focus: ["关注方向", "Focus"],
  followup: ["跟进", "Follow-up"],
  followupDate: ["跟进日期", "Follow-up date"],
  followupState: ["跟进状态", "Follow-up status"],
  interactionCount: ["近期互动数", "Recent interactions"],
  lastInteraction: ["最近互动", "Latest interaction"],
  lastInteractionDate: ["互动日期", "Interaction date"],
};
export const fieldLabel = (key: string, locale: string, spec?: ViewSpec) =>
  spec?.labels?.[key] ?? labels[key]?.[locale === "zh" ? 0 : 1] ?? key;
export const statusLabel = (value: string, locale: string) =>
  ({
    todo: locale === "zh" ? "待办" : "To do",
    doing: locale === "zh" ? "进行中" : "Doing",
    done: locale === "zh" ? "已完成" : "Done",
  })[value] ?? value;
const action =
  "rounded text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export default function WorkRecordView({
  records,
  spec,
  onEdit,
  locale,
}: {
  records: WorkRecord[];
  spec: ViewSpec;
  onEdit: (record: WorkRecord) => void;
  locale: string;
}) {
  if (!records.length)
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
        {locale === "zh" ? "暂无符合条件的记录" : "No matching records"}
      </div>
    );
  const title = (r: WorkRecord) => r.fields.title ?? r.fields.name ?? r.id;
  const cell = (r: WorkRecord, key: string) =>
    key === "personRef" && r.personHref ? (
      <Link href={r.personHref} className={action}>
        {locale === "zh" ? "打开相关人物" : "Open person"}
      </Link>
    ) : key === "status" || key === "followupState" ? (
      statusLabel(r.fields[key] ?? "", locale)
    ) : (
      r.fields[key] || "—"
    );
  const open = (r: WorkRecord, label = title(r)) =>
    !spec.actions.includes("record.update") ? (
      <span>{label}</span>
    ) : (
      <button className={action} onClick={() => onEdit(r)}>
        {label}
      </button>
    );
  const source = (r: WorkRecord) =>
    spec.actions.includes("source.open") && (
      <Link
        className={action + " text-xs text-muted-foreground"}
        href={
          "/view/" + r.source.path.split("/").map(encodeURIComponent).join("/")
        }
      >
        {locale === "zh" ? "查看原文" : "Open source"}
      </Link>
    );
  if (spec.layout === "table")
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40">
            <tr>
              {spec.fields.map((k) => (
                <th key={k} scope="col" className="px-4 py-3 font-medium">
                  {fieldLabel(k, locale, spec)}
                </th>
              ))}
              <th scope="col" className="px-4 py-3">
                {locale === "zh" ? "原文" : "Source"}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-t border-border">
                {spec.fields.map((k, i) => (
                  <td
                    key={k}
                    className="max-w-sm whitespace-pre-wrap break-words px-4 py-3"
                  >
                    {i === 0 && k !== "personRef"
                      ? open(r, String(cell(r, k)))
                      : cell(r, k)}
                  </td>
                ))}
                <td className="px-4 py-3">{source(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const cards = (rows: WorkRecord[]) =>
    rows.map((r) => (
      <article
        key={r.id}
        className="space-y-3 rounded-lg border border-border bg-background p-4"
      >
        <h3 className="font-medium">{open(r)}</h3>
        {spec.fields
          .filter((k) => !["title", "name"].includes(k))
          .map((k) => (
            <p
              key={k}
              className="whitespace-pre-wrap break-words text-sm text-muted-foreground"
            >
              <span className="font-medium">
                {fieldLabel(k, locale, spec)} ·{" "}
              </span>
              {cell(r, k)}
            </p>
          ))}
        {source(r)}
      </article>
    ));
  if (spec.layout === "board")
    return (
      <div className="grid gap-5 md:grid-cols-3">
        {["todo", "doing", "done"].map((status) => (
          <section key={status} className="min-w-0 space-y-3">
            <h2 className="text-sm font-medium">
              {statusLabel(status, locale)}{" "}
              <span className="text-muted-foreground">
                {records.filter((r) => r.fields.status === status).length}
              </span>
            </h2>
            {cards(records.filter((r) => r.fields.status === status))}
          </section>
        ))}
      </div>
    );
  return <div className="grid gap-4 md:grid-cols-2">{cards(records)}</div>;
}
