"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, FileText, LockKeyhole, Plus } from "lucide-react";
import type {
  PageSpec,
  PageBlockData,
  WorkRecord,
} from "@geminilight/mindos/knowledge/views";
import { workRequest, type WorkViewData } from "@/lib/views/work-api";
import type { PageSources } from "@/lib/views/page-api";
import { encodePath } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import WorkRecordView from "../views/WorkRecordView";
import WorkRecordEditor from "../views/WorkRecordEditor";
import CustomPageFrame from "./CustomPageFrame";
import styles from "./PageCanvas.module.css";
export default function PageCanvas({
  spec,
  blocks,
  rootId,
  sources,
  locale,
  selectedId,
  onSelect,
  refresh,
  preview = false,
}: {
  spec: PageSpec;
  blocks: PageBlockData[];
  rootId: string;
  sources: PageSources;
  locale: string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  refresh: () => void;
  preview?: boolean;
}) {
  const zh = locale === "zh";
  const active = useRef(true),
    pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
    };
  }, []);
  const [editing, setEditing] = useState<{
    data: WorkViewData;
    record?: WorkRecord;
  }>();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function edit(data: PageBlockData["data"], record?: WorkRecord) {
    if (!data || pending.current || preview) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(record?.id ?? "new");
    setError("");
    try {
      const latest = await workRequest<WorkViewData>(
        "read",
        {
          rootId,
          ...(data.view
            ? { viewId: data.view.id }
            : { collectionId: data.collection.id }),
        },
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      const actions = latest.view?.spec.actions ?? data.spec.actions;
      if (!actions.includes(record ? "record.update" : "record.create"))
        throw new Error(
          zh
            ? "页面操作权限已变化，请刷新后重试。"
            : "Available actions changed. Refresh and retry.",
        );
      if (latest.rootId !== rootId)
        throw new Error(
          zh
            ? "资料库已切换，请重新打开页面。"
            : "Library changed. Reopen this page.",
        );
      const current = record
        ? latest.records.find((r) => r.id === record.id)
        : undefined;
      if (record && !current)
        throw new Error(
          zh
            ? "这条记录已变化，请刷新后重试。"
            : "This record changed. Refresh and retry.",
        );
      setEditing({
        data: {
          ...latest,
          spec: data.spec,
          view: data.view ? { ...data.view, spec: data.spec } : undefined,
        },
        record: current,
      });
    } catch (e) {
      if (active.current && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      if (pending.current === controller) pending.current = undefined;
      if (active.current) setBusy("");
    }
  }
  async function status(
    data: NonNullable<PageBlockData["data"]>,
    record: WorkRecord,
    value: "todo" | "done",
  ) {
    if (pending.current || preview) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(record.id);
    setError("");
    try {
      if (data.view) {
        const current = await workRequest<WorkViewData>(
          "read",
          { rootId, viewId: data.view.id },
          controller.signal,
        );
        if (!active.current || controller.signal.aborted) return;
        if (
          current.rootId !== rootId ||
          !current.view?.spec.actions.includes("record.update") ||
          !current.records.some((r) => r.id === record.id)
        )
          throw new Error(
            zh
              ? "任务或视图已变化，请刷新后重试。"
              : "The task or view changed. Refresh and retry.",
          );
      }
      await workRequest("mutate", {
        expectedRootId: rootId,
        collectionId: data.collection.id,
        recordId: record.id,
        action: "record.update",
        operationId: crypto.randomUUID(),
        expectedRevision: record.source.revision,
        expectedSchemaRevision: record.schemaRevision,
        input: { status: value },
      });
      if (active.current) refresh();
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (pending.current === controller) pending.current = undefined;
      if (active.current) setBusy("");
    }
  }
  return (
    <>
      <div aria-live="polite">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-error/30 p-3 text-sm text-error"
          >
            {error}
          </p>
        )}
      </div>
      <div
        className={`grid min-w-0 items-start gap-5 ${spec.layout.columns === 2 ? "lg:grid-cols-2" : ""}`}
      >
        {spec.blocks.map((block) => {
          const result = blocks.find((x) => x.blockId === block.id),
            data = result?.data;
          const shownSpec = data
            ? {
                ...data.spec,
                actions: preview
                  ? data.spec.actions.filter(
                      (a) => !["record.update", "record.create"].includes(a),
                    )
                  : data.spec.actions,
              }
            : undefined;
          return (
            <section
              key={block.id}
              data-page-block={block.id}
              className={`min-w-0 overflow-hidden rounded-xl border bg-background ${selectedId === block.id ? "border-[var(--amber)] ring-1 ring-[var(--amber)]" : "border-border"} ${spec.layout.density === "compact" ? "p-4" : "p-5 sm:p-6"}`}
              aria-label={block.title}
            >
              <header className="mb-4 flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="break-words text-base font-semibold">
                      {block.title}
                    </h2>
                    {block.locked && (
                      <LockKeyhole
                        size={12}
                        aria-label={zh ? "已锁定" : "Locked"}
                        className="shrink-0 text-muted-foreground"
                      />
                    )}
                  </div>
                  {data && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {data.collection.folder}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {onSelect && (
                    <Button
                      variant={selectedId === block.id ? "outline" : "ghost"}
                      size="sm"
                      aria-pressed={selectedId === block.id}
                      onClick={() => onSelect(block.id)}
                    >
                      {zh ? "调整" : "Adjust"}
                    </Button>
                  )}
                  {data?.spec.actions.includes("record.create") &&
                    !preview &&
                    block.kind !== "summary" &&
                    block.kind !== "html" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        aria-label={(zh ? "添加：" : "Add: ") + block.title}
                        onClick={() => void edit(data)}
                      >
                        <Plus size={14} aria-hidden />
                      </Button>
                    )}
                </div>
              </header>
              {result?.error ? (
                <div role="alert" className="rounded-lg bg-muted/50 p-4">
                  <p className="text-sm">
                    {zh
                      ? "这个模块暂时无法读取"
                      : "This block could not be loaded"}
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {result.error.message}
                  </p>
                  <Button variant="ghost" size="sm" onClick={refresh}>
                    {zh ? "重试" : "Retry"}
                  </Button>
                </div>
              ) : block.kind === "html" ? (
                <CustomPageFrame
                  html={block.html ?? ""}
                  readOnly={preview}
                  data={
                    data && shownSpec
                      ? {
                          ...data,
                          spec: shownSpec,
                          view: data.view
                            ? { ...data.view, spec: shownSpec }
                            : undefined,
                        }
                      : data
                  }
                  title={block.title}
                  rootId={rootId}
                  onChanged={refresh}
                />
              ) : block.kind === "notes" ? (
                <div className="space-y-3">
                  {result?.notes?.length ? (
                    result.notes.map((note) => (
                      <Link
                        key={note.path}
                        href={"/view/" + encodePath(note.path)}
                        className="block rounded-lg border border-border p-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <FileText size={14} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">
                            {note.title}
                          </span>
                          <ArrowUpRight size={13} aria-hidden />
                        </span>
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
                          {note.content}
                        </p>
                      </Link>
                    ))
                  ) : (
                    <p className="py-5 text-sm text-muted-foreground">
                      {zh
                        ? "这里还没有笔记。调整模块，选择已有资料夹。"
                        : "No notes here yet. Choose an existing folder in block settings."}
                    </p>
                  )}
                </div>
              ) : block.kind === "summary" && data ? (
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {zh ? "已载入记录" : "Loaded records"}
                    </dt>
                    <dd className="mt-2 font-display text-3xl">
                      {data.records.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {data.collection.template === "tasks"
                        ? zh
                          ? "未完成"
                          : "Open tasks"
                        : zh
                          ? "待跟进"
                          : "Follow-ups"}
                    </dt>
                    <dd className="mt-2 font-display text-3xl">
                      {
                        data.records.filter((r) =>
                          data.collection.template === "tasks"
                            ? r.fields.status !== "done"
                            : !!r.fields.followup &&
                              r.fields.followupState !== "done",
                        ).length
                      }
                    </dd>
                  </div>
                </dl>
              ) : data && shownSpec ? (
                <div className={styles.records}>
                  <WorkRecordView
                    records={data.records}
                    spec={shownSpec}
                    locale={locale}
                    onEdit={(record) => void edit(data, record)}
                    onStatusChange={
                      data.collection.template === "tasks" && !preview
                        ? (record, value) => void status(data, record, value)
                        : undefined
                    }
                    statusBusy={!!busy}
                  />
                </div>
              ) : (
                <p role="status" className="py-6 text-sm text-muted-foreground">
                  {zh
                    ? "选择资料来源后，这里会呈现真实内容。"
                    : "Choose a source to see live content here."}
                </p>
              )}
              {block.kind === "people" &&
                data &&
                data.spec.fields.includes("name") &&
                (() => {
                  const personView = sources.views.find(
                    (v) =>
                      v.collectionId === data.collection.id &&
                      (v.spec?.layout ?? "list-detail") === "list-detail" &&
                      !v.spec?.filter?.all.length &&
                      (!v.spec ||
                        (v.spec.fields.join(",") === "name,background,focus" &&
                          !Object.keys(v.spec.labels ?? {}).length &&
                          [
                            "record.create",
                            "record.update",
                            "interaction.add",
                            "followup.update",
                            "source.open",
                          ].every((action) =>
                            v.spec!.actions.includes(
                              action as (typeof v.spec.actions)[number],
                            ),
                          ))),
                  );
                  return personView ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                      <span className="text-xs text-muted-foreground">
                        {zh ? "人物档案：" : "Profiles:"}
                      </span>
                      {data.records.map((record) => (
                        <Link
                          key={record.id}
                          href={`/studio/views/${personView.id}?person=${encodeURIComponent(record.id)}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {record.fields.name}
                          <ArrowUpRight size={12} aria-hidden />
                        </Link>
                      ))}
                    </div>
                  ) : null;
                })()}
              {result?.limited && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {zh
                    ? "当前显示部分资料，打开来源可查看完整内容。"
                    : "Showing a limited selection. Open the source for all records."}
                </p>
              )}
            </section>
          );
        })}
      </div>
      {!spec.blocks.length && (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <h2 className="font-medium">
            {zh
              ? "先放进一件你正在做的事"
              : "Start with work already in motion"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">
            {zh
              ? "添加任务、人物或笔记模块，也可以告诉 AI 想要怎样的页面。"
              : "Add tasks, people or notes, or describe the page you need to AI."}
          </p>
        </div>
      )}
      {editing && (
        <WorkRecordEditor
          data={editing.data}
          record={editing.record}
          locale={locale}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      )}
    </>
  );
}
