"use client";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkRecord } from "@geminilight/mindos/knowledge/views";
import { useLocale } from "@/lib/stores/locale-store";
import { subscribeFilesChanged } from "@/lib/files-changed";
import { subscribeServerEvents } from "@/lib/server-events";
import { useViewResource } from "@/lib/views/hooks";
import { workRequest, type WorkViewData } from "@/lib/views/work-api";
import { Button } from "@/components/ui/button";
import { StudioShell } from "../StudioShell";
import PeopleWorkspace from "./PeopleWorkspace";
import WorkRecordView from "./WorkRecordView";
import WorkRecordEditor from "./WorkRecordEditor";
import WorkViewDesigner from "./WorkViewDesigner";
export default function WorkViewWorkspace({
  viewId,
  draftId,
}: {
  viewId?: string;
  draftId?: string;
}) {
  const { locale } = useLocale(),
    zh = locale === "zh",
    router = useRouter(),
    push = useSmoothRouterPush();
  const read = useCallback(
    (signal: AbortSignal) =>
      workRequest<WorkViewData>(
        draftId ? "preview" : "read",
        draftId ? { draftId } : { viewId },
        signal,
      ),
    [viewId, draftId],
  );
  const result = useViewResource(read),
    data = result.data;
  const [previewOperationId] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<{
      data: WorkViewData;
      record?: WorkRecord;
    }>(),
    [error, setError] = useState(""),
    [lastOperation, setLastOperation] = useState<string>();
  const refreshing = useRef(result.loading);
  useEffect(() => {
    refreshing.current = result.loading;
  }, [result.loading]);
  const reload = result.refresh;
  useEffect(() => {
    const refresh = () => {
      if (!refreshing.current) {
        refreshing.current = true;
        reload();
      }
    };
    const stops = [
      subscribeFilesChanged(refresh),
      subscribeServerEvents("views.changed", refresh),
      subscribeServerEvents("ready", refresh),
    ];
    window.addEventListener("focus", refresh);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !refreshing.current)
        refresh();
    }, 1000);
    return () => {
      stops.forEach((stop) => stop());
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);
  useEffect(() => {
    if (editing && data && editing.data.rootId !== data.rootId) {
      setEditing(undefined);
      setError(
        zh
          ? "资料库已切换；旧草稿保留。"
          : "Library changed; previous drafts are retained.",
      );
    }
  }, [data, editing, zh]);
  if (!data)
    return (
      <StudioShell>
        <p role={result.error ? "alert" : "status"}>
          {result.error
            ? zh
              ? "无法读取视图，请重试。"
              : "Unable to load this view."
            : zh
              ? "正在读取…"
              : "Loading…"}
        </p>
        <Button onClick={result.refresh}>{zh ? "重试" : "Retry"}</Button>
      </StudioShell>
    );
  const spec = data.view?.spec ?? data.spec!;
  const designer = (
    <WorkViewDesigner
      key={data.rootId + data.view?.id}
      data={data}
      locale={locale}
      refresh={result.refresh}
    />
  );
  if (
    data.collection.template === "people" &&
    spec.layout === "list-detail" &&
    !draftId
  )
    return (
      <>
        <div className="px-6 pt-4">{designer}</div>
        <PeopleWorkspace viewId={viewId!} />
      </>
    );
  const savePreview = async () => {
    try {
      const response = await workRequest<any>("save", {
        expectedRootId: data.rootId,
        operationId: previewOperationId,
        draftId,
        name: zh ? "保存的视图" : "Saved view",
      });
      push(response.viewUrl);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <StudioShell>
      <div className="mx-auto max-w-6xl space-y-6 pb-10">
        <Link
          className="text-sm text-muted-foreground hover:underline"
          href="/studio/views"
        >
          {zh ? "视图" : "Views"}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl">
              {data.view?.name ?? (zh ? "视图预览" : "View preview")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.collection.folder} · {data.records.length}{" "}
              {zh ? "条记录" : "records"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {draftId ? (
              <Button variant="amber" onClick={savePreview}>
                {zh ? "保留视图" : "Save view"}
              </Button>
            ) : (
              spec.actions.includes("record.create") && (
                <Button variant="amber" onClick={() => setEditing({ data })}>
                  {zh ? "新建记录" : "New record"}
                </Button>
              )
            )}
          </div>
        </header>
        {designer}
        {(error || result.error) && (
          <p role="alert" className="text-sm text-error">
            {error ||
              (zh
                ? "刷新失败，显示上次结果。"
                : "Refresh failed; showing the previous result.")}
          </p>
        )}
        {(data.limited || data.skipped > 0) && (
          <p role="status" className="text-sm text-muted-foreground">
            {zh
              ? "部分文件无法显示，请核对原资料。"
              : "Some files could not be shown; check the originals."}
          </p>
        )}
        <WorkRecordView
          records={data.records}
          spec={
            draftId
              ? {
                  ...spec,
                  actions: spec.actions.filter((a) => a !== "record.update"),
                }
              : spec
          }
          locale={locale}
          onEdit={(record) => {
            if (!draftId && spec.actions.includes("record.update"))
              setEditing({ data, record });
          }}
        />
        {lastOperation && (
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await workRequest("mutate", {
                  expectedRootId: data.rootId,
                  collectionId: data.collection.id,
                  operationId: crypto.randomUUID(),
                  action: "operation.undo",
                  input: { operationId: lastOperation },
                });
                setLastOperation(undefined);
                result.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {zh ? "撤回上次编辑" : "Undo last edit"}
          </Button>
        )}
        {editing && (
          <WorkRecordEditor
            key={editing.data.rootId + editing.record?.id}
            data={editing.data}
            record={editing.record}
            locale={locale}
            close={() => setEditing(undefined)}
            saved={(operationId) => {
              if (editing.record) setLastOperation(operationId);
              result.refresh();
              router.refresh();
            }}
          />
        )}
      </div>
    </StudioShell>
  );
}
