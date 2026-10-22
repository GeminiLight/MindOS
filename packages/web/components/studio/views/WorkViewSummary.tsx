"use client";
import type { WorkViewData } from "@/lib/views/work-api";
export default function WorkViewSummary({
  data,
  locale,
}: {
  data: WorkViewData;
  locale: string;
}) {
  const zh = locale === "zh",
    spec = data.view?.spec ?? data.spec;
  if (spec?.page?.showSummary === false) return null;
  const people = data.collection.template === "people",
    records = data.records;
  const metrics = people
    ? [
        [zh ? "联系人" : "People", records.length],
        [
          zh ? "待跟进" : "Follow-ups",
          records.filter(
            (r) => r.fields.followup && r.fields.followupState !== "done",
          ).length,
        ],
        [
          zh ? "互动记录" : "Interactions",
          records.reduce(
            (n, r) => n + (Number(r.fields.interactionCount) || 0),
            0,
          ),
        ],
      ]
    : [
        [zh ? "任务总数" : "Tasks", records.length],
        [
          zh ? "待推进" : "Open",
          records.filter((r) => r.fields.status !== "done").length,
        ],
        [
          zh ? "已完成" : "Completed",
          records.filter((r) => r.fields.status === "done").length,
        ],
      ];
  return (
    <section aria-label={zh ? "当前视图概览" : "Current view summary"}>
      <dl className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-muted/20 py-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 px-3 sm:px-5">
            <dt className="text-xs text-muted-foreground" title={people && label === metrics[2][0] ? (zh ? "每人最近 200 条已载入的互动记录" : "Up to 200 loaded interactions per person") : undefined}>{label}</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
