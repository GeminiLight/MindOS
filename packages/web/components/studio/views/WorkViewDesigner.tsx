"use client";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import { useRef, useState } from "react";
import type { ViewSpec } from "@geminilight/mindos/knowledge/views";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { workRequest, type WorkViewData } from "@/lib/views/work-api";
import { fieldClass, Field, useDialogReturnFocus } from "./ViewPrimitives";
import WorkViewSummary from "./WorkViewSummary";
import WorkRecordView, { fieldLabel } from "./WorkRecordView";
import { withHiddenCompleted } from "@/lib/views/work-presentation";
import {
  Columns3,
  List,
  Table2,
  SlidersHorizontal,
  Copy,
  Check,
  Eye,
} from "lucide-react";
export default function WorkViewDesigner({
  data,
  locale,
  refresh,
}: {
  data: WorkViewData;
  locale: string;
  refresh: () => void;
}) {
  const zh = locale === "zh",
    push = useSmoothRouterPush();
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<{
      draftId: string;
      previewUrl: string;
      data: WorkViewData;
    }>();
  const [copied, setCopied] = useState(false);
  const [snapshot, setSnapshot] = useState(data);
  const original = data.view?.spec ?? data.spec!;
  const [spec, setSpec] = useState<ViewSpec>(original),
    [name, setName] = useState(
      data.view?.name ?? (zh ? "我的视图" : "My view"),
    );
  const [newField, setNewField] = useState("");
  const [fieldPreview, setFieldPreview] = useState<{
    key: string;
    affectedRecords: number;
  }>();
  const pending = useRef<{ fingerprint: string; operationId: string } | null>(
    null,
  );
  const returnFocus = useDialogReturnFocus();
  const update = (next: ViewSpec) => {
    setSpec(next);
    setDraft(undefined);
  };
  async function act(op: string, input: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify({ op, input, rootId: data.rootId });
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, operationId: crypto.randomUUID() };
      const result = await workRequest<any>(op, {
        ...input,
        expectedRootId: data.rootId,
        operationId: pending.current.operationId,
      });
      if (op === "preview" && input.spec) {
        const preview = await workRequest<WorkViewData>("preview", {
          draftId: result.draftId,
        });
        if (preview.rootId !== data.rootId)
          throw new Error(
            zh
              ? "资料库已切换，请重新打开。"
              : "Library changed. Reopen this view.",
          );
        result.data = preview;
      }
      pending.current = null;
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => {
          setSnapshot(data);
          setError("");
          setFieldPreview(undefined);
          setNewField("");
          setName(data.view?.name ?? name);
          setOpen(true);
          setSpec(original);
          setDraft(undefined);
        }}
      >
        <SlidersHorizontal size={14} aria-hidden />
        {zh ? "调整视图" : "Customize view"}
      </Button>
      <Button
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              `${zh ? "请用 MindOS 插件调整这个视图，先读取字段和当前版本，预览后保存。我的要求：" : "Use the MindOS plugin to customize this view. Read fields and revisions, preview, then save. My request:"}\nrootId: ${data.rootId}\ncollectionId: ${data.collection.id}\nviewId: ${data.view?.id ?? ""}`,
            );
            setCopied(true);
            setError("");
          } catch {
            setError(
              zh
                ? "复制失败，请从插件打开这个视图。"
                : "Copy failed; open this view from the plugin.",
            );
          }
        }}
      >
        {copied ? (
          <Check size={14} aria-hidden />
        ) : (
          <Copy size={14} aria-hidden />
        )}
        {copied
          ? zh
            ? "已复制，粘贴给 Agent"
            : "Copied · paste to your Agent"
          : zh
            ? "复制给 Agent 的说明"
            : "Copy instructions for Agent"}
      </Button>
      {error && !open && <p role="alert">{error}</p>}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          finalFocus={returnFocus}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl"
        >
          <DialogHeader>
            <DialogTitle>{zh ? "调整视图" : "Customize view"}</DialogTitle>
            <DialogDescription>
              {zh
                ? "选择需要看到的信息。布局变化不会复制或改动原记录。"
                : "Choose what to see. Layout changes keep the same original records."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <fieldset disabled={busy} className="min-w-0 space-y-5">
              <Field label={zh ? "名称" : "Name"}>
                {(id) => (
                  <input
                    id={id}
                    className={fieldClass}
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Field label={zh ? "页面说明" : "Page description"}>
                {(id) => (
                  <textarea
                    id={id}
                    rows={2}
                    maxLength={280}
                    className={fieldClass}
                    value={spec.page?.description ?? ""}
                    placeholder={
                      zh
                        ? "这个页面帮你关注什么？"
                        : "What is this workspace for?"
                    }
                    onChange={(e) =>
                      update({
                        ...spec,
                        page: { ...spec.page, description: e.target.value },
                      })
                    }
                  />
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                  checked={spec.page?.showSummary !== false}
                  onChange={(e) =>
                    update({
                      ...spec,
                      page: { ...spec.page, showSummary: e.target.checked },
                    })
                  }
                />
                {zh ? "显示概览数据" : "Show summary"}
              </label>
              <fieldset>
                <legend className="mb-2 text-xs font-medium">
                  {zh ? "布局" : "Layout"}
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      "list-detail",
                      "table",
                      ...(data.collection.template === "tasks"
                        ? ["board"]
                        : []),
                    ] as ViewSpec["layout"][]
                  ).map((layout) => {
                    const Icon =
                      layout === "board"
                        ? Columns3
                        : layout === "table"
                          ? Table2
                          : List;
                    return (
                      <label key={layout} className="relative cursor-pointer">
                        <input
                          type="radio"
                          name="view-layout"
                          value={layout}
                          checked={spec.layout === layout}
                          className="peer sr-only"
                          onChange={() => {
                            const rest = { ...spec };
                            delete rest.groupBy;
                            update({
                              ...rest,
                              layout,
                              ...(layout === "board"
                                ? { groupBy: "status" }
                                : {}),
                            });
                          }}
                        />
                        <span className="flex flex-col items-center gap-2 rounded-lg border border-border px-2 py-3 text-xs text-muted-foreground peer-checked:border-[var(--amber)] peer-checked:bg-[var(--amber-subtle)] peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                          <Icon size={20} aria-hidden />
                          {layout === "board"
                            ? zh
                              ? "看板"
                              : "Board"
                            : layout === "table"
                              ? zh
                                ? "表格"
                                : "Table"
                              : data.collection.template === "people"
                                ? zh ? "人物详情" : "People details"
                                : zh ? "卡片" : "Cards"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="mb-2 text-sm">
                  {zh ? "显示字段" : "Visible fields"}
                </legend>
                {Object.keys(data.fields).map((key) => (
                  <label
                    key={key}
                    className="flex min-h-8 items-center gap-2 rounded-md border border-border px-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                      checked={spec.fields.includes(key)}
                      onChange={(e) =>
                        update({
                          ...spec,
                          fields: e.target.checked
                            ? [...spec.fields, key]
                            : spec.fields.filter((k) => k !== key),
                        })
                      }
                    />
                    {fieldLabel(key, locale, spec)}
                  </label>
                ))}
              </fieldset>
              <Field label={zh ? "排序" : "Sort"}>
                {(id) => (
                  <select
                    id={id}
                    className={fieldClass}
                    value={spec.sort?.[0]?.field ?? ""}
                    onChange={(e) =>
                      update({
                        ...spec,
                        sort: e.target.value
                          ? [{ field: e.target.value, direction: "asc" }]
                          : [],
                      })
                    }
                  >
                    <option value="">{zh ? "默认顺序" : "Default"}</option>
                    {Object.keys(data.fields).map((k) => (
                      <option key={k} value={k}>
                        {fieldLabel(k, locale, spec)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {spec.sort?.length ? (
                <Field label={zh ? "排序方向" : "Sort direction"}>
                  {(id) => (
                    <select
                      id={id}
                      className={fieldClass}
                      value={spec.sort![0]!.direction}
                      onChange={(e) =>
                        update({
                          ...spec,
                          sort: [
                            {
                              ...spec.sort![0]!,
                              direction: e.target.value as "asc" | "desc",
                            },
                          ],
                        })
                      }
                    >
                      <option value="asc">
                        {zh ? "升序 · 较早在前" : "Ascending"}
                      </option>
                      <option value="desc">
                        {zh ? "降序 · 较晚在前" : "Descending"}
                      </option>
                    </select>
                  )}
                </Field>
              ) : null}
              {data.collection.template === "tasks" && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                    checked={
                      !!spec.filter?.all.some(
                        (f) =>
                          f.field === "status" &&
                          f.op === "neq" &&
                          f.value === "done",
                      )
                    }
                    onChange={(e) =>
                      update(withHiddenCompleted(spec, e.target.checked))
                    }
                  />
                  {zh ? "隐藏已完成" : "Hide completed"}
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !spec.fields.length}
                  variant="outline"
                  onClick={async () => {
                    const result = await act("preview", {
                      collectionId: data.collection.id,
                      spec,
                    });
                    if (result) setDraft(result);
                  }}
                >
                  {busy
                    ? zh
                      ? "处理中…"
                      : "Working…"
                    : zh
                      ? "预览"
                      : "Preview"}
                </Button>
                {draft && (
                  <>
                    <a
                      className="p-2 text-sm underline"
                      href={draft.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {zh ? "打开预览" : "Open preview"}
                    </a>
                    <Button
                      variant="amber"
                      disabled={busy || !name.trim()}
                      onClick={async () => {
                        const result = await act("save", {
                          draftId: draft.draftId,
                          name,
                          viewId: data.view?.id,
                          expectedViewVersion: snapshot.view?.version,
                        });
                        if (result) {
                          setOpen(false);
                          refresh();
                          push(result.viewUrl);
                        }
                      }}
                    >
                      {zh ? "保留此视图" : "Save this view"}
                    </Button>
                  </>
                )}
              </div>
              {data.view && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {(["pin", "copy", "restore"] as const).map((action) => (
                    <Button
                      key={action}
                      variant="ghost"
                      disabled={
                        busy ||
                        (action === "restore" && !data.view?.previousSpec)
                      }
                      onClick={async () => {
                        const result = await act("save", {
                          viewId: data.view!.id,
                          expectedViewVersion: snapshot.view?.version,
                          action: action === "pin" ? "save" : action,
                          ...(action === "pin"
                            ? { pinned: !data.view!.pinned }
                            : {}),
                          ...(action === "copy"
                            ? { name: name + (zh ? " 副本" : " copy") }
                            : {}),
                        });
                        if (result) {
                          setOpen(false);
                          refresh();
                          push(result.viewUrl);
                        }
                      }}
                    >
                      {action === "pin"
                        ? data.view!.pinned
                          ? zh
                            ? "取消置顶"
                            : "Unpin"
                          : zh
                            ? "置顶"
                            : "Pin"
                        : action === "copy"
                          ? zh
                            ? "复制视图"
                            : "Copy view"
                          : zh
                            ? "恢复上次布局"
                            : "Restore previous layout"}
                    </Button>
                  ))}
                </div>
              )}
              {data.collection.template === "tasks" && (
                <details className="border-t border-border pt-3">
                  <summary className="text-sm">
                    {zh ? "添加信息字段" : "Add a field"}
                  </summary>
                  <p className="my-2 text-xs text-muted-foreground">
                    {zh
                      ? "可选文本字段；现有记录会保留，新字段初始为空。"
                      : "Optional text; existing values stay intact and new cells start empty."}
                  </p>
                  <Field
                    label={
                      zh
                        ? "字段标识（小写英文字母）"
                        : "Field key (lowercase letters)"
                    }
                  >
                    {(id) => (
                      <input
                        id={id}
                        className={fieldClass}
                        value={newField}
                        onChange={(e) => {
                          setNewField(e.target.value);
                          setFieldPreview(undefined);
                        }}
                      />
                    )}
                  </Field>
                  <Button
                    className="mt-2"
                    disabled={busy || !newField}
                    onClick={async () => {
                      if (!fieldPreview) {
                        const preview = await act("preview", {
                          collectionId: data.collection.id,
                          schemaExtension: { key: "x_" + newField },
                        });
                        if (preview) setFieldPreview(preview.schemaChange);
                        return;
                      }
                      const result = await act("mutate", {
                        collectionId: data.collection.id,
                        action: "schema.extend",
                        expectedRevision: snapshot.revision,
                        expectedSchemaRevision: snapshot.schemaRevision,
                        input: { key: "x_" + newField },
                      });
                      if (result) {
                        setOpen(false);
                        refresh();
                      }
                    }}
                  >
                    {fieldPreview
                      ? zh
                        ? "确认添加文本字段"
                        : "Confirm new field"
                      : zh
                        ? "预览字段变化"
                        : "Preview field change"}
                  </Button>
                  {fieldPreview && (
                    <p
                      role="status"
                      className="mt-2 text-sm text-muted-foreground"
                    >
                      {zh
                        ? `新增文本字段，${fieldPreview.affectedRecords} 条记录将增加空白值，原字段保持不变。`
                        : `Add an empty optional field to ${fieldPreview.affectedRecords} records. Existing values stay unchanged.`}
                    </p>
                  )}
                </details>
              )}
              {error && (
                <p role="alert" className="text-sm text-error">
                  {error}
                </p>
              )}
            </fieldset>
            <section
              aria-label={zh ? "视图预览" : "View preview"}
              className="min-w-0 rounded-xl border border-border bg-muted/20 p-4"
            >
              <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Eye size={14} aria-hidden />
                {zh ? "视图预览" : "View preview"}
                {draft && (
                  <span className="ml-auto">
                    {draft.data.records.length}
                    {zh ? " 条记录" : " records"}
                  </span>
                )}
              </div>
              {draft ? (
                <div className="space-y-4">
                  {draft.data.spec?.page?.description && (
                    <p className="text-sm text-muted-foreground">
                      {draft.data.spec.page.description}
                    </p>
                  )}
                  <WorkViewSummary data={draft.data} locale={locale} />
                  <WorkRecordView
                    records={draft.data.records}
                    spec={{ ...draft.data.spec!, actions: [] }}
                    locale={locale}
                    onEdit={() => {}}
                  />
                </div>
              ) : (
                <div className="flex min-h-52 flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  <Eye size={28} aria-hidden className="mb-4" />
                  <p>
                    {zh
                      ? "选好布局和信息，点击预览。"
                      : "Choose a layout and fields, then preview."}
                  </p>
                  <p className="mt-2 text-xs leading-5">
                    {zh
                      ? "这里会展示真实资料。保留后才会替换当前视图。"
                      : "See your actual records before saving the view."}
                  </p>
                </div>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
