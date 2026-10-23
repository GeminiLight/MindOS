"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ProjectDefinition,
  ProjectSnapshot,
  WorkProject,
  WorkSnapshot,
} from "@geminilight/mindos/knowledge/views";
import { pageRequest, type PageSources } from "@/lib/views/page-api";
import { Button } from "@/components/ui/button";
import { fieldClass } from "../views/ViewPrimitives";
export default function ProjectRelationships({
  rootId,
  initial,
  readOnly = false,
  sources,
  owners,
  zh,
  saved,
  cancel,
}: {
  rootId: string;
  initial: ProjectDefinition & { version?: number };
  readOnly?: boolean;
  sources: PageSources;
  owners: WorkProject[];
  zh: boolean;
  saved: () => void;
  cancel: () => void;
}) {
  const [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [people, setPeople] = useState<
      Array<{ ref: string; name: string; collection: string }>
    >([]),
    [loading, setLoading] = useState(true),
    [partial, setPartial] = useState(false);
  const [retry, setRetry] = useState(0);
  const peopleSources = JSON.stringify(
    sources.collections
      .filter((c) => c.template === "people")
      .map((c) => ({ id: c.id, folder: c.folder })),
  );
  const active = useRef(true),
    guard = useRef(false),
    operation = useRef<{ payload: string; id: string } | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    // Ordinary project refreshes must not rescan every people folder while this form is open.
    const collections = JSON.parse(peopleSources) as Array<{
      id: string;
      folder: string;
    }>;
    setLoading(true);
    void Promise.allSettled(
      collections
        .slice(0, 20)
        .map((c) =>
          pageRequest<WorkSnapshot>(
            "read",
            { collectionId: c.id, rootId },
            controller.signal,
          ),
        ),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setPeople(
        results.flatMap((r, i) =>
          r.status === "fulfilled"
            ? r.value.records.map((p) => ({
                ref: r.value.collection.id + "/" + p.id,
                name: p.fields.name ?? p.id,
                collection: collections[i]!.folder,
              }))
            : [],
        ),
      );
      setPartial(
        collections.length > 20 ||
          results.some(
            (r) =>
              r.status === "rejected" || r.value.limited || r.value.skipped > 0,
          ),
      );
      setLoading(false);
    });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [rootId, peopleSources, retry]);
  function toggle(key: "personRefs" | "taskCollectionIds", value: string) {
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value)
        ? d[key].filter((v) => v !== value)
        : [...d[key], value],
    }));
  }
  async function save() {
    if (readOnly || guard.current || loading || !draft.title.trim()) return;
    guard.current = true;
    setBusy(true);
    setError("");
    const project = {
        id: draft.id,
        title: draft.title,
        goal: draft.goal,
        taskCollectionIds: draft.taskCollectionIds,
        personRefs: draft.personRefs,
      },
      payload = JSON.stringify(project);
    if (operation.current?.payload !== payload)
      operation.current = { payload, id: crypto.randomUUID() };
    let committed = false;
    try {
      await pageRequest<ProjectSnapshot>("project.save", {
        project,
        expectedRootId: rootId,
        expectedVersion: initial.version ?? 0,
        operationId: operation.current.id,
      });
      committed = true;
      await pageRequest("project.page", {
        projectId: project.id,
        expectedRootId: rootId,
      });
      if (active.current) saved();
    } catch (e) {
      if (active.current)
        setError(
          (committed
            ? zh
              ? "关联已保存，工作页更新未完成。重试会接着更新："
              : "Relationships saved, page update incomplete. Retry continues: "
            : "") + (e as Error).message,
        );
    } finally {
      guard.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <form
      className="mt-4 space-y-4 rounded-lg border border-border bg-background p-4"
      aria-label={zh ? "项目资料关联" : "Project relationships"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span>{zh ? "项目名称" : "Project name"}</span>
          <input
            className={fieldClass}
            value={draft.title}
            maxLength={100}
            disabled={busy || readOnly}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span>{zh ? "项目目标" : "Project goal"}</span>
          <textarea
            className={fieldClass}
            rows={2}
            maxLength={2000}
            value={draft.goal}
            disabled={busy || readOnly}
            onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))}
          />
        </label>
      </div>
      <fieldset disabled={busy || readOnly}>
        <legend className="mb-2 text-sm font-medium">
          {zh ? "项目任务资料" : "Project task collections"}
        </legend>
        <p className="mb-2 text-xs text-muted-foreground">
          {zh
            ? "选择已有资料，最多四个；每份任务资料归属一个项目。"
            : "Link up to four existing collections. Each task collection belongs to one project."}
        </p>
        {sources.collections
          .filter((c) => c.template === "tasks")
          .map((c) => {
            const owner = owners.find(
              (p) => p.id !== draft.id && p.taskCollectionIds.includes(c.id),
            );
            return (
              <label
                key={c.id}
                className="flex min-h-11 items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  data-project-task-source={c.id}
                  checked={draft.taskCollectionIds.includes(c.id)}
                  disabled={
                    !!owner ||
                    (!draft.taskCollectionIds.includes(c.id) &&
                      draft.taskCollectionIds.length >= 4)
                  }
                  onChange={() => toggle("taskCollectionIds", c.id)}
                  className="accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                />
                {sources.views.find((v) => v.collectionId === c.id)?.name ??
                  c.folder}
                {owner && (
                  <span className="text-xs text-muted-foreground">
                    {zh ? "已关联：" : "Linked to: "}
                    {owner.title}
                  </span>
                )}
              </label>
            );
          })}
        {!sources.collections.some((c) => c.template === "tasks") && (
          <p className="text-sm text-muted-foreground">
            {zh
              ? "先在视图中建立任务资料，再来关联。"
              : "Create a task collection in Views first."}
          </p>
        )}
      </fieldset>
      <fieldset disabled={busy || loading || readOnly}>
        <legend className="mb-2 text-sm font-medium">
          {zh ? "一起推进的人" : "People involved"}
        </legend>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {zh ? "正在读取人物…" : "Loading people…"}
          </p>
        ) : (
          people.map((p) => (
            <label
              key={p.ref}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                data-project-person-ref={p.ref}
                checked={draft.personRefs.includes(p.ref)}
                disabled={
                  !draft.personRefs.includes(p.ref) &&
                  draft.personRefs.length >= 40
                }
                onChange={() => toggle("personRefs", p.ref)}
                className="accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>
                {p.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.collection}
                </span>
              </span>
            </label>
          ))
        )}
        {!loading && !people.length && (
          <p className="text-sm text-muted-foreground">
            {zh
              ? "还没有可关联人物。可以先保存项目，稍后补充。"
              : "No people available yet. Save the project and connect them later."}
          </p>
        )}
        {draft.personRefs
          .filter((ref) => !people.some((p) => p.ref === ref))
          .map((ref) => (
            <label
              key={ref}
              className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
            >
              <input
                type="checkbox"
                checked
                onChange={() => toggle("personRefs", ref)}
              />
              {zh
                ? "暂时无法读取的已关联人物"
                : "Linked person currently unavailable"}
            </label>
          ))}
      </fieldset>
      {partial && (
        <p className="text-sm text-muted-foreground">
          {zh
            ? "部分人物资料未能读取，已有选择仍保留；最多读取前二十个人物集合。"
            : "Some people sources are unavailable. Existing selections are retained; the first twenty collections are shown."}
        </p>
      )}
      {partial && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || readOnly || loading}
          onClick={() => setRetry((n) => n + 1)}
        >
          {zh ? "重新读取人物" : "Reload people"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="amber"
          disabled={busy || loading || readOnly || !draft.title.trim()}
        >
          {busy
            ? zh
              ? "正在保存…"
              : "Saving…"
            : zh
              ? "保存项目关联"
              : "Save relationships"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>
          {zh ? "取消" : "Cancel"}
        </Button>
      </div>
    </form>
  );
}
