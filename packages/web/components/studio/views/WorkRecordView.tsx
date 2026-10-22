"use client";
import React from "react";
import { taskDueState, localCalendarDay } from "@/lib/views/work-presentation";
import Link from "next/link";
import { Circle, CircleCheck, CircleDot, FileText, Inbox } from "lucide-react";
import type { WorkRecord, ViewSpec } from "@geminilight/mindos/knowledge/views";
const labels: Record<string, [string, string]> = {
  title: ["任务", "Task"],
  x_notes: ["备注", "Notes"],
  x_context: ["补充背景", "Context"],
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
  spec?.labels?.[key] ??
  labels[key]?.[locale === "zh" ? 0 : 1] ??
  key.replace(/^x_/, "").replaceAll("_", " ");
export const statusLabel = (value: string, locale: string) =>
  ({
    todo: locale === "zh" ? "待办" : "To do",
    doing: locale === "zh" ? "进行中" : "Doing",
    done: locale === "zh" ? "已完成" : "Done",
  })[value] ?? value;
export function StatusMark({ value }: { value: string }) {
  const Icon =
    value === "done" ? CircleCheck : value === "doing" ? CircleDot : Circle;
  return (
    <Icon
      size={14}
      aria-hidden
      className={
        value === "done"
          ? "shrink-0 text-success"
          : value === "doing"
            ? "shrink-0 text-[var(--amber)]"
            : "shrink-0 text-muted-foreground"
      }
    />
  );
}
const action =
  "rounded text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export default function WorkRecordView({
  records,
  spec,
  onEdit,
  locale,
  onStatusChange,
  statusBusy = false,
  today = localCalendarDay(),
}: {
  records: WorkRecord[];
  spec: ViewSpec;
  onEdit: (record: WorkRecord) => void;
  locale: string;
  onStatusChange?: (record: WorkRecord, status: "todo" | "done") => void;
  statusBusy?: boolean;
  today?: string;
}) {
  const zh = locale === "zh",
    hasSource = spec.actions.includes("source.open");
  if (!records.length)
    return (
      <div className="rounded-xl border border-dashed border-border px-5 py-14 text-center">
        <Inbox
          size={24}
          aria-hidden
          className="mx-auto mb-4 text-muted-foreground"
        />
        <p className="text-sm font-medium">
          {zh ? "暂无符合条件的记录" : "No matching records"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {zh
            ? "试试其他关键词，或添加第一条记录。"
            : "Try another search, or add your first record."}
        </p>
      </div>
    );
  const title = (r: WorkRecord) => r.fields.title ?? r.fields.name ?? r.id;
  const identityKey = spec.fields.find((k) => k === "title" || k === "name");
  const completion = (r: WorkRecord) =>
    onStatusChange &&
    r.fields.title !== undefined &&
    spec.actions.includes("record.update") &&
    spec.fields.includes("status") && (
      <button
        type="button"
        role="checkbox"
        aria-checked={r.fields.status === "done"}
        aria-label={
          (r.fields.status === "done"
            ? zh
              ? "重新打开："
              : "Reopen: "
            : zh
              ? "标记完成："
              : "Complete: ") + title(r)
        }
        disabled={statusBusy}
        onClick={() =>
          onStatusChange(r, r.fields.status === "done" ? "todo" : "done")
        }
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-40"
      >
        <StatusMark value={r.fields.status === "done" ? "done" : "todo"} />
      </button>
    );
  const cell = (r: WorkRecord, key: string) => {
    const value = r.fields[key];
    if (key === "personRef") {
      if (!value) return <span className="text-muted-foreground">—</span>;
      return r.personName ? (
        r.personHref ? (
          <Link href={r.personHref} className={action}>
            {r.personName}
          </Link>
        ) : (
          <span>{r.personName}</span>
        )
      ) : (
        <span className="text-muted-foreground">
          {zh ? "关联人物暂不可用" : "Linked person unavailable"}
        </span>
      );
    }
    if ((key === "status" || key === "followupState") && value)
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium">
          <StatusMark value={value} />
          {statusLabel(value, locale)}
        </span>
      );
    if (key.toLowerCase().endsWith("date") && value) {
      const due = key === "dueDate" ? taskDueState(r, today) : undefined;
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <time dateTime={value} className="whitespace-nowrap tabular-nums">
            {value}
          </time>
          {(due === "overdue" || due === "today") && (
            <span
              className={
                "rounded px-1.5 py-0.5 text-xs " +
                (due === "overdue"
                  ? "bg-destructive/10 text-error"
                  : "bg-[var(--amber-subtle)] text-[var(--amber-text)]")
              }
            >
              {due === "overdue"
                ? zh
                  ? "已逾期"
                  : "Overdue"
                : zh
                  ? "今天到期"
                  : "Due today"}
            </span>
          )}
        </span>
      );
    }
    return value || <span className="text-muted-foreground">—</span>;
  };
  const open = (r: WorkRecord) =>
    !spec.actions.includes("record.update") ? (
      <span>{title(r)}</span>
    ) : (
      <button
        className={action + " min-h-8 font-medium"}
        onClick={() => onEdit(r)}
      >
        {title(r)}
      </button>
    );
  const source = (r: WorkRecord) =>
    hasSource && (
      <Link
        className={
          action +
          " inline-flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground"
        }
        href={
          "/view/" + r.source.path.split("/").map(encodeURIComponent).join("/")
        }
      >
        <FileText size={13} aria-hidden />
        {zh ? "查看原文" : "Open source"}
      </Link>
    );
  if (spec.layout === "table")
    return (
      <div
        role="region"
        aria-label={
          zh ? "记录表格，可横向滚动" : "Records table, scroll horizontally"
        }
        tabIndex={0}
        className="max-w-full overflow-x-auto rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {spec.fields.map((k) => (
                <th
                  key={k}
                  scope="col"
                  className="whitespace-nowrap px-5 py-3 text-xs font-medium"
                >
                  {fieldLabel(k, locale, spec)}
                </th>
              ))}
              {!identityKey && spec.actions.includes("record.update") && (
                <th scope="col" className="px-5 py-3 text-xs">
                  {zh ? "编辑" : "Edit"}
                </th>
              )}
              {hasSource && (
                <th
                  scope="col"
                  className="whitespace-nowrap px-5 py-3 text-xs font-medium"
                >
                  {zh ? "原文" : "Source"}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr
                key={r.id}
                className="border-t border-border transition-colors duration-150 hover:bg-muted/20 focus-within:bg-muted/20"
              >
                {spec.fields.map((k) => (
                  <td
                    key={k}
                    className={
                      (k === identityKey
                        ? "min-w-40 "
                        : k.toLowerCase().endsWith("date") ||
                            k.endsWith("State") ||
                            k === "status"
                          ? ""
                          : "min-w-44 ") +
                      "max-w-sm whitespace-pre-wrap break-words px-5 py-4 leading-6"
                    }
                  >
                    {k === identityKey ? (
                      <div className="flex items-start gap-1">
                        {completion(r)}
                        {open(r)}
                      </div>
                    ) : (
                      cell(r, k)
                    )}
                  </td>
                ))}
                {!identityKey && spec.actions.includes("record.update") && (
                  <td className="min-w-40 px-5 py-4">{open(r)}</td>
                )}
                {hasSource && (
                  <td className="whitespace-nowrap px-5 py-4">{source(r)}</td>
                )}
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
        className="min-w-0 space-y-3 rounded-xl border border-border bg-background p-4 transition-shadow duration-150 hover:shadow-sm focus-within:shadow-sm"
      >
        <div className="flex items-start gap-1">
          {completion(r)}
          <h3 className="min-w-0 break-words text-sm leading-6">{open(r)}</h3>
        </div>
        <dl className="space-y-2.5">
          {spec.fields
            .filter(
              (k) =>
                !["title", "name"].includes(k) &&
                !(spec.layout === "board" && k === "status") &&
                r.fields[k],
            )
            .map((k) => (
              <div key={k} className="min-w-0 text-sm leading-5">
                <dt className="mb-1 text-xs text-muted-foreground">
                  {fieldLabel(k, locale, spec)}
                </dt>
                <dd className="whitespace-pre-wrap break-words">
                  {cell(r, k)}
                </dd>
              </div>
            ))}
        </dl>
        {source(r)}
      </article>
    ));
  if (spec.layout === "board")
    return (
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {["todo", "doing", "done"].map((status) => {
          const rows = records.filter((r) => r.fields.status === status);
          return (
            <section
              key={status}
              className="min-w-0 rounded-xl bg-muted/30 p-3"
            >
              <h2 className="mb-4 flex items-center gap-2 px-1 text-sm font-medium">
                <StatusMark value={status} />
                {statusLabel(status, locale)}{" "}
                <span className="ml-auto rounded-md bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {rows.length}
                </span>
              </h2>
              <div className="space-y-3">{cards(rows)}</div>
              {!rows.length && (
                <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                  {zh ? "暂无任务" : "No tasks yet"}
                </p>
              )}
            </section>
          );
        })}
      </div>
    );
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards(records)}
    </div>
  );
}
