"use client";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ViewSpec, WorkRecord } from "@geminilight/mindos/knowledge/views";
import { useLocale } from "@/lib/stores/locale-store";
import { subscribeFilesChanged } from "@/lib/files-changed";
import { subscribeServerEvents } from "@/lib/server-events";
import { useViewResource } from "@/lib/views/hooks";
import { workRequest, type WorkViewData } from "@/lib/views/work-api";
import { Button } from "@/components/ui/button";
import { StudioShell } from "../StudioShell";
import PeopleWorkspace from "./PeopleWorkspace";
import WorkRecordView, { statusLabel } from "./WorkRecordView";
import { Search, Plus, ArrowLeft, Check } from "lucide-react";
import { fieldClass, FolderCaption } from "./ViewPrimitives";
import { filterWorkRecords } from "@/lib/views/work-presentation";
import WorkRecordEditor from "./WorkRecordEditor";
import WorkViewDesigner from "./WorkViewDesigner";
import WorkViewNavigation from "./WorkViewNavigation";
import WorkViewSummary from "./WorkViewSummary";
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
  const [layoutOverride, setLayoutOverride] = useState<ViewSpec["layout"]>();
  useEffect(
    () => setLayoutOverride(undefined),
    [viewId, draftId, data?.rootId, data?.view?.version],
  );
  const [previewOperationId] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<{
      data: WorkViewData;
      record?: WorkRecord;
    }>(),
    [error, setError] = useState(""),
    [lastOperation, setLastOperation] = useState<string>();
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  const [notice, setNotice] = useState(""),
    [savingPreview, setSavingPreview] = useState(false);
  useEffect(() => {
    setSearch("");
    setStatus("all");
    setLastOperation(undefined);
    setNotice("");
  }, [data?.rootId, viewId, draftId]);
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
        {result.error && (
          <Button onClick={result.refresh}>{zh ? "重试" : "Retry"}</Button>
        )}
      </StudioShell>
    );
  const originalSpec = data.view?.spec ?? data.spec!;
  const spec = layoutOverride
    ? {
        ...originalSpec,
        layout: layoutOverride,
        groupBy: layoutOverride === "board" ? "status" : undefined,
      }
    : originalSpec;
  const displayData = data.view
    ? { ...data, view: { ...data.view, spec } }
    : { ...data, spec };
  const navigation = !draftId && (
    <WorkViewNavigation
      data={data}
      layout={spec.layout}
      onLayout={setLayoutOverride}
      locale={locale}
    />
  );
  const summary = <WorkViewSummary data={displayData} locale={locale} />;
  const designer = (
    <WorkViewDesigner
      key={data.rootId + data.view?.id + layoutOverride}
      data={displayData}
      locale={locale}
      refresh={result.refresh}
    />
  );
  if (
    data.collection.template === "people" &&
    spec.layout === "list-detail" &&
    !draftId &&
    // The full people template includes an interaction history. Customized
    // field order/labels use the generic renderer so the saved spec is honored.
    spec.fields.join(",") === "name,background,focus" &&
    !Object.keys(spec.labels ?? {}).length &&
    [
      "record.create",
      "record.update",
      "interaction.add",
      "followup.update",
      "source.open",
    ].every((action) =>
      spec.actions.includes(action as ViewSpec["actions"][number]),
    )
  )
    return (
      <PeopleWorkspace
        viewId={viewId!}
        description={spec.page?.description}
        projection={{
          rootId: data.rootId,
          recordIds: data.records.map((r) => r.id),
        }}
        toolbar={
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {navigation}
              {designer}
            </div>
            {summary}
          </div>
        }
      />
    );
  const savePreview = async () => {
    if (savingPreview) return;
    setSavingPreview(true);
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
    } finally {
      setSavingPreview(false);
    }
  };
  const visible = filterWorkRecords(data.records, spec.fields, search, status);
  const people = data.collection.template === "people";
  return (
    <StudioShell contentMaxWidth="full">
      <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
        <Link
          className="inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href="/studio/views"
        >
          <ArrowLeft size={13} aria-hidden />
          {zh ? "所有视图" : "All views"}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {people
                ? zh
                  ? "人脉"
                  : "People"
                : zh
                  ? "项目待办"
                  : "Project tasks"}
            </p>
            <h1
              tabIndex={-1}
              className="break-words text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {data.view?.name ?? (zh ? "视图预览" : "View preview")}
            </h1>
            {spec.page?.description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                {spec.page.description}
              </p>
            )}
            <div className="mt-3">
              <FolderCaption path={data.collection.folder} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 self-end">
            {draftId ? (
              <Button
                variant="amber"
                disabled={savingPreview}
                onClick={savePreview}
              >
                {zh ? "保留视图" : "Save view"}
              </Button>
            ) : (
              spec.actions.includes("record.create") && (
                <Button variant="amber" onClick={() => setEditing({ data })}>
                  <Plus size={15} aria-hidden />
                  {people
                    ? zh
                      ? "新建人物"
                      : "New person"
                    : zh
                      ? "新建任务"
                      : "New task"}
                </Button>
              )
            )}
          </div>
        </header>
        {navigation}
        {summary}
        <div className="space-y-4 border-y border-border py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-64">
              <Search
                size={15}
                aria-hidden
                className="absolute left-3 top-3 text-muted-foreground"
              />
              <input
                type="search"
                aria-label={zh ? "搜索当前视图" : "Search this view"}
                placeholder={
                  people
                    ? zh
                      ? "搜索人物、背景或跟进…"
                      : "Find people or follow-ups…"
                    : zh
                      ? "搜索任务…"
                      : "Find a task…"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={fieldClass + " pl-9"}
              />
            </div>
            {designer}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!people && (
              <div
                role="group"
                aria-label={zh ? "筛选任务状态" : "Filter task status"}
                className="flex flex-wrap gap-1"
              >
                {["all", "todo", "doing", "done"].map((value) => (
                  <Button
                    key={value}
                    variant={status === value ? "secondary" : "ghost"}
                    aria-pressed={status === value}
                    onClick={() => setStatus(value)}
                  >
                    {value === "all"
                      ? zh
                        ? "全部"
                        : "All"
                      : statusLabel(value, locale)}{" "}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {value === "all"
                        ? data.records.length
                        : data.records.filter((r) => r.fields.status === value)
                            .length}
                    </span>
                  </Button>
                ))}
              </div>
            )}
            <p role="status" className="text-xs text-muted-foreground">
              {visible.length}
              {zh ? " 条记录" : " records"}
              {(search || status !== "all") && (
                <Button
                  variant="ghost"
                  className="ml-2"
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                  }}
                >
                  {zh ? "清除筛选" : "Clear filters"}
                </Button>
              )}
            </p>
          </div>
        </div>
        {draftId && (
          <p
            role="status"
            className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
          >
            {zh
              ? "预览中 · 保留视图后，可在这里继续编辑资料。"
              : "Preview · Save this view to edit its records."}
          </p>
        )}
        {notice && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm"
          >
            <Check size={15} className="text-success" aria-hidden />
            {notice}
          </div>
        )}
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
          records={visible}
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
                setNotice(zh ? "已撤回上次编辑。" : "Last edit undone.");
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
              setLastOperation(editing.record ? operationId : undefined);
              setError("");
              setNotice(
                zh
                  ? "已保存到本地，其他视图会同步更新。"
                  : "Saved locally. Other views will update too.",
              );
              result.refresh();
              router.refresh();
            }}
          />
        )}
      </div>
    </StudioShell>
  );
}
