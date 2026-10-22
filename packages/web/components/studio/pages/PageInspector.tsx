"use client";
import {
  ArrowDown,
  ArrowUp,
  LockKeyhole,
  Trash2,
  UnlockKeyhole,
} from "lucide-react";
import type { PageSpec, PageBlock } from "@geminilight/mindos/knowledge/views";
import type { PageSources } from "@/lib/views/page-api";
import { movePageBlock } from "@/lib/views/page-workspace";
import { fieldClass } from "../views/ViewPrimitives";
import { Button } from "@/components/ui/button";
export default function PageInspector({
  spec,
  sources,
  selectedId,
  change,
  select,
  locale,
  disabled = false,
}: {
  spec: PageSpec;
  sources: PageSources;
  selectedId?: string;
  change: (spec: PageSpec) => void;
  select: (id: string) => void;
  locale: string;
  disabled?: boolean;
}) {
  const zh = locale === "zh",
    block = spec.blocks.find((b) => b.id === selectedId);
  function update(patch: Partial<PageBlock>) {
    if (block)
      change({
        ...spec,
        blocks: spec.blocks.map((b) =>
          b.id === block.id ? { ...b, ...patch } : b,
        ),
      });
  }
  function add(kind: PageBlock["kind"]) {
    const source = sources.collections.find(
      (c) => c.template === (kind === "people" ? "people" : "tasks"),
    );
    const id = "block-" + crypto.randomUUID();
    const title = {
      tasks: zh ? "项目待办" : "Project tasks",
      people: zh ? "相关人物" : "People",
      notes: zh ? "最近笔记" : "Notes",
      summary: zh ? "进展概览" : "Progress",
      html: zh ? "自定义网页" : "Custom page",
    }[kind];
    const next: PageBlock = {
      id,
      title,
      kind,
      ...(["tasks", "people", "summary"].includes(kind) && source
        ? { collectionId: source.id }
        : {}),
      ...(kind === "notes" ? { folder: "" } : {}),
      ...(kind === "html"
        ? {
            html:
              "<main><h1>" +
              (zh ? "我的页面" : "My page") +
              "</h1><p>" +
              (zh ? "在这里开始设计。" : "Start creating here.") +
              "</p></main>",
          }
        : {}),
    };
    change({ ...spec, blocks: [...spec.blocks, next] });
    select(id);
  }
  const kinds: PageBlock["kind"][] = [
    "tasks",
    "people",
    "notes",
    "summary",
    "html",
  ];
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-5 disabled:opacity-60"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium">
          {zh ? "页面标题" : "Page title"}
          <input
            className={fieldClass + " mt-1.5"}
            value={spec.title}
            maxLength={80}
            onChange={(e) => change({ ...spec, title: e.target.value })}
          />
        </label>
        <label className="text-xs font-medium">
          {zh ? "一句话说明" : "Description"}
          <input
            className={fieldClass + " mt-1.5"}
            value={spec.description ?? ""}
            maxLength={280}
            onChange={(e) => change({ ...spec, description: e.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs font-medium">
          {zh ? "页面分栏" : "Columns"}
          <select
            className={fieldClass + " mt-1.5"}
            value={spec.layout.columns}
            onChange={(e) =>
              change({
                ...spec,
                layout: {
                  ...spec.layout,
                  columns: Number(e.target.value) as 1 | 2,
                },
              })
            }
          >
            <option value={1}>{zh ? "一栏" : "One column"}</option>
            <option value={2}>{zh ? "两栏" : "Two columns"}</option>
          </select>
        </label>
        <label className="text-xs font-medium">
          {zh ? "内容密度" : "Density"}
          <select
            className={fieldClass + " mt-1.5"}
            value={spec.layout.density}
            onChange={(e) =>
              change({
                ...spec,
                layout: {
                  ...spec.layout,
                  density: e.target.value as "comfortable" | "compact",
                },
              })
            }
          >
            <option value="comfortable">{zh ? "舒展" : "Comfortable"}</option>
            <option value="compact">{zh ? "紧凑" : "Compact"}</option>
          </select>
        </label>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium">
          {zh ? "添加模块" : "Add a block"}
        </h3>
        <div className="flex flex-wrap gap-2">
          {kinds.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              onClick={() => add(kind)}
              disabled={spec.blocks.length >= 12}
            >
              {
                {
                  tasks: zh ? "任务" : "Tasks",
                  people: zh ? "人物" : "People",
                  notes: zh ? "笔记" : "Notes",
                  summary: zh ? "概览" : "Summary",
                  html: zh ? "自定义网页" : "Custom page",
                }[kind]
              }
            </Button>
          ))}
        </div>
      </div>
      {!!spec.blocks.length && (
        <div>
          <label className="text-xs font-medium">
            {zh ? "正在调整的模块" : "Block to adjust"}
            <select
              className={fieldClass + " mt-1.5"}
              value={selectedId ?? ""}
              onChange={(e) => select(e.target.value)}
            >
              <option value="">{zh ? "选择模块" : "Choose a block"}</option>
              {spec.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {block && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">
              {zh ? "模块设置" : "Block settings"}
            </h3>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label={zh ? "上移模块" : "Move block up"}
                disabled={spec.blocks[0]?.id === block.id}
                onClick={() => change(movePageBlock(spec, block.id, -1))}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={zh ? "下移模块" : "Move block down"}
                disabled={spec.blocks.at(-1)?.id === block.id}
                onClick={() => change(movePageBlock(spec, block.id, 1))}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={!!block.locked}
                onClick={() => update({ locked: !block.locked })}
              >
                {block.locked ? (
                  <LockKeyhole size={14} />
                ) : (
                  <UnlockKeyhole size={14} />
                )}{" "}
                {zh
                  ? block.locked
                    ? "已锁定"
                    : "锁定"
                  : block.locked
                    ? "Locked"
                    : "Lock"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={zh ? "移除模块" : "Remove block"}
                onClick={() => {
                  change({
                    ...spec,
                    blocks: spec.blocks.filter((b) => b.id !== block.id),
                  });
                  select("");
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <label className="block text-xs font-medium">
            {zh ? "模块标题" : "Block title"}
            <input
              className={fieldClass + " mt-1.5"}
              value={block.title}
              maxLength={80}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          {block.kind !== "notes" && (
            <label className="block text-xs font-medium">
              {zh ? "资料来源" : "Data source"}
              <select
                className={fieldClass + " mt-1.5"}
                value={
                  block.viewId
                    ? "view:" + block.viewId
                    : block.collectionId
                      ? "collection:" + block.collectionId
                      : ""
                }
                onChange={(e) => {
                  const [type, id] = e.target.value.split(":");
                  update({
                    collectionId: type === "collection" ? id : undefined,
                    viewId: type === "view" ? id : undefined,
                    fields: undefined,
                    filter: undefined,
                  });
                }}
              >
                <option value="">
                  {zh ? "选择已有资料" : "Choose existing data"}
                </option>
                {sources.collections
                  .filter((c) =>
                    block.kind === "people"
                      ? c.template === "people"
                      : block.kind === "tasks"
                        ? c.template === "tasks"
                        : true,
                  )
                  .map((c) => (
                    <option key={c.id} value={"collection:" + c.id}>
                      {sources.views.find((v) => v.collectionId === c.id)
                        ?.name ?? c.folder}
                    </option>
                  ))}
                {sources.views
                  .filter((v) =>
                    block.kind === "people"
                      ? v.template === "people"
                      : block.kind === "tasks"
                        ? v.template === "tasks"
                        : true,
                  )
                  .map((v) => (
                    <option key={v.id} value={"view:" + v.id}>
                      {v.name} ·{" "}
                      {zh ? "保存的筛选与字段" : "Saved filters and fields"}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {["tasks", "people"].includes(block.kind) && (
            <>
              <label className="block text-xs font-medium">
                {zh ? "呈现方式" : "Presentation"}
                <select
                  className={fieldClass + " mt-1.5"}
                  value={
                    block.layout ??
                    (block.kind === "tasks" ? "table" : "list-detail")
                  }
                  onChange={(e) =>
                    update({ layout: e.target.value as PageBlock["layout"] })
                  }
                >
                  <option value="list-detail">{zh ? "列表" : "List"}</option>
                  <option value="table">{zh ? "表格" : "Table"}</option>
                  {block.kind === "tasks" && (
                    <option value="board">{zh ? "看板" : "Board"}</option>
                  )}
                </select>
              </label>
              {block.kind === "tasks" && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={
                      !!block.filter?.all.some(
                        (f) =>
                          f.field === "status" &&
                          f.op === "neq" &&
                          f.value === "done",
                      )
                    }
                    onChange={(e) =>
                      update({
                        filter: {
                          all: [
                            ...(block.filter?.all.filter(
                              (f) =>
                                !(
                                  f.field === "status" &&
                                  f.op === "neq" &&
                                  f.value === "done"
                                ),
                            ) ?? []),
                            ...(e.target.checked
                              ? [
                                  {
                                    field: "status",
                                    op: "neq" as const,
                                    value: "done",
                                  },
                                ]
                              : []),
                          ],
                        },
                      })
                    }
                  />
                  {zh ? "隐藏已完成任务" : "Hide completed tasks"}
                </label>
              )}
            </>
          )}
          {block.kind === "notes" && (
            <label className="block text-xs font-medium">
              {zh ? "笔记资料夹" : "Notes folder"}
              <input
                className={fieldClass + " mt-1.5"}
                placeholder={
                  zh ? "例如：项目/产品研究" : "For example: Projects/Research"
                }
                value={block.folder ?? ""}
                onChange={(e) =>
                  update({ folder: e.target.value, paths: undefined })
                }
              />
              <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                {zh
                  ? "使用当前知识库中的资料夹，展示可直接打开的原笔记。"
                  : "Use a folder in this library. Notes link to their original files."}
              </span>
            </label>
          )}
          {block.kind === "html" && (
            <label className="block text-xs font-medium">
              {zh ? "网页内容" : "Page HTML"}
              <textarea
                rows={9}
                className={fieldClass + " mt-1.5 resize-y font-mono text-xs"}
                value={block.html ?? ""}
                onChange={(e) => update({ html: e.target.value })}
              />
              <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                {zh
                  ? "支持 HTML/CSS；脚本通过页面运行接口执行。绑定资料后可读取真实内容。"
                  : "HTML/CSS supported; scripts run through the page runtime. Bind a source to read live data."}
              </span>
            </label>
          )}
          {block.locked && (
            <p className="text-xs leading-5 text-muted-foreground">
              {zh
                ? "AI 会保留这个模块。你仍可在此手动调整。"
                : "AI will preserve this block. You can still edit it here."}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
