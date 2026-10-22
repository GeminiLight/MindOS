"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import type {
  RelatedWork,
  WorkRecord,
} from "@geminilight/mindos/knowledge/views";
import { workRequest, type WorkViewData } from "@/lib/views/work-api";
import { useViewResource } from "@/lib/views/hooks";
import { subscribeServerEvents } from "@/lib/server-events";
import { subscribeFilesChanged } from "@/lib/files-changed";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./ViewPrimitives";
import WorkRecordEditor from "./WorkRecordEditor";
import { statusLabel } from "./WorkRecordView";

/** Mounted with the person/root key: neither reads nor drafts cross contexts. */
export default function PersonTasks({
  rootId,
  collectionId,
  personId,
  locale,
}: {
  rootId: string;
  collectionId: string;
  personId: string;
  locale: string;
}) {
  const zh = locale === "zh",
    personRef = collectionId + "/" + personId;
  const read = useCallback(
    (signal: AbortSignal) =>
      workRequest<RelatedWork>(
        "related",
        { rootId, collectionId, personId },
        signal,
      ),
    [rootId, collectionId, personId],
  );
  const result = useViewResource(read);
  const data =
    result.data?.rootId === rootId && result.data.personRef === personRef
      ? result.data
      : undefined;
  const [target, setTarget] = useState(""),
    [showDone, setShowDone] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    data: WorkViewData;
    record?: WorkRecord;
  }>();
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(result.refresh, 100);
    };
    const stop = subscribeFilesChanged(refresh);
    const stopViews = subscribeServerEvents("views.changed", refresh);
    const stopReady = subscribeServerEvents("ready", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      stop();
      stopViews();
      stopReady();
      window.removeEventListener("focus", refresh);
    };
  }, [result.refresh]);
  const available = data?.groups.filter((g) => g.canCreate) ?? [];
  const selected = available.some((g) => g.viewId === target)
    ? target
    : available.length === 1
      ? available[0].viewId
      : "";
  async function open(viewId: string, recordId?: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const snapshot = await workRequest<WorkViewData>(
        "read",
        { rootId, viewId },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (snapshot.rootId !== rootId)
        throw new Error(
          zh
            ? "资料库已切换，请重新打开。"
            : "Library changed. Reopen this page.",
        );
      if (
        !snapshot.view?.spec.actions.includes(
          recordId ? "record.update" : "record.create",
        )
      )
        throw new Error(
          zh
            ? "这个视图已不允许此操作，请刷新。"
            : "This view no longer allows this action. Refresh it.",
        );
      const record = recordId
        ? snapshot.records.find(
            (r) => r.id === recordId && r.fields.personRef === personRef,
          )
        : undefined;
      if (recordId && !record)
        throw new Error(
          zh
            ? "任务关联或视图已变化，请刷新后重试。"
            : "The task link or view changed. Refresh and retry.",
        );
      setEditing({ data: snapshot, record });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  }
  const completed =
    data?.groups.reduce(
      (n, g) => n + g.records.filter((r) => r.fields.status === "done").length,
      0,
    ) ?? 0;
  const groups =
    data?.groups
      .map((g) => ({
        ...g,
        visible: g.records.filter(
          (r) => showDone || r.fields.status !== "done",
        ),
      }))
      .filter((g) => g.visible.length) ?? [];
  return (
    <section
      aria-label={zh ? "相关项目待办" : "Related project tasks"}
      className="mt-7 border-t border-border pt-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {zh ? "一起推进的事" : "Work together"}
        </h3>
        {completed > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone
              ? zh
                ? "收起已完成"
                : "Hide completed"
              : zh
                ? `查看已完成 · ${completed}`
                : `Show completed · ${completed}`}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs leading-6 text-muted-foreground">
        {zh
          ? "来自各项目待办的保存视图，按人物关联汇总。"
          : "Linked tasks from each project’s saved view."}
      </p>
      {result.loading && !data && (
        <p role="status" className="py-3 text-sm text-muted-foreground">
          {zh ? "正在查找关联任务…" : "Finding linked tasks…"}
        </p>
      )}
      {(result.error || error) && (
        <div role="alert" className="mt-3 text-sm text-error">
          {error ||
            (zh
              ? "关联任务暂时无法读取。"
              : "Linked tasks could not be loaded.")}
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              result.refresh();
            }}
          >
            {zh ? "重试" : "Retry"}
          </Button>
        </div>
      )}
      {data?.incomplete && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {zh
            ? "部分项目未能完整载入，以下仅显示已读取的关联。"
            : "Some projects could not be fully loaded. Showing available links."}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-success">
          {notice}
        </p>
      )}
      {data && !groups.length && !result.error && (
        <p className="py-4 text-sm text-muted-foreground">
          {completed
            ? zh
              ? "已读取的关联任务都已完成。"
              : "All loaded linked tasks are complete."
            : zh
              ? "还没有可显示的关联任务。可以为这位人物添加下一步。"
              : "No linked tasks to show. Add a next step for this person."}
        </p>
      )}
      <div className="mt-3 space-y-4">
        {groups.map((g) => (
          <section
            key={g.collectionId}
            className="rounded-lg border border-border p-3"
          >
            <Link
              href={`/studio/views/${g.viewId}`}
              className="inline-flex max-w-full items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">{g.name}</span>
              <ArrowUpRight size={13} aria-hidden />
            </Link>
            <ul className="mt-2 divide-y divide-border">
              {g.visible.map((r) => (
                <li
                  key={r.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2"
                >
                  {g.canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void open(g.viewId, r.id)}
                      className="min-h-10 min-w-0 flex-1 break-words text-left text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {r.fields.title}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 break-words text-sm">
                      {r.fields.title}
                    </span>
                  )}
                  <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {r.fields.status && (
                      <span>{statusLabel(r.fields.status, locale)}</span>
                    )}
                    {r.fields.dueDate && (
                      <time dateTime={r.fields.dueDate}>
                        {r.fields.dueDate}
                      </time>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!!available.length && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">
              {zh ? "选择项目待办" : "Choose project tasks"}
            </span>
            <select
              aria-label={zh ? "选择项目待办" : "Choose project tasks"}
              className={fieldClass}
              value={selected}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">
                {zh ? "选择项目待办" : "Choose project tasks"}
              </option>
              {available.map((g) => (
                <option key={g.viewId} value={g.viewId}>
                  {g.name} · {g.folder}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={!selected || busy}
            onClick={() => void open(selected)}
          >
            <Plus size={14} aria-hidden />
            {zh ? "添加关联任务" : "Add linked task"}
          </Button>
        </div>
      )}
      {data && !available.length && !data.incomplete && (
        <p className="mt-3 text-xs text-muted-foreground">
          {zh
            ? "在视图首页添加可编辑的项目待办，即可在这里建立关联。"
            : "Add an editable project task collection in Views to link work here."}
        </p>
      )}
      {editing && (
        <WorkRecordEditor
          key={
            rootId +
            editing.data.collection.id +
            (editing.record?.id ?? personRef)
          }
          data={editing.data}
          record={editing.record}
          initialPersonRef={editing.record ? undefined : personRef}
          locale={locale}
          close={() => setEditing(undefined)}
          saved={() => {
            setNotice(
              zh
                ? "已保存，人物和项目共用同一份任务。"
                : "Saved. This person and project share the same task.",
            );
            result.refresh();
          }}
        />
      )}
    </section>
  );
}
