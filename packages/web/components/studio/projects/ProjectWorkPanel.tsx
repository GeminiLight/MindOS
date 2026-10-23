"use client";
import Link from "next/link";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectSnapshot,
  WorkProject,
} from "@geminilight/mindos/knowledge/views";
import {
  pageRequest,
  PageRequestError,
  type PageSources,
} from "@/lib/views/page-api";
import { useViewResource, useViewLiveUpdates } from "@/lib/views/hooks";
import { useLocale } from "@/lib/stores/locale-store";
import { Button } from "@/components/ui/button";
import ProjectRelationships from "./ProjectRelationships";
import ProjectCommunication from "./ProjectCommunication";
type Loaded = {
  projectId: string;
  sources: PageSources;
  snapshot?: ProjectSnapshot;
  owners: WorkProject[];
};
export default function ProjectWorkPanel({
  projectId,
  initialProject,
  rootId,
  readOnly = false,
  onPage = false,
}: {
  projectId: string;
  initialProject?: { title: string; goal: string };
  rootId?: string;
  readOnly?: boolean;
  onPage?: boolean;
}) {
  const { locale } = useLocale(),
    zh = locale === "zh";
  const push = useSmoothRouterPush();
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [projectId, rootId]);
  const read = useCallback(
    async (signal: AbortSignal): Promise<Loaded> => {
      const sources = await pageRequest<PageSources>("list", {}, signal);
      if (rootId && rootId !== sources.rootId)
        throw new Error("Library changed");
      const owners = await pageRequest<{ projects: WorkProject[] }>(
        "project.list",
        { rootId: sources.rootId },
        signal,
      );
      let snapshot: ProjectSnapshot | undefined;
      try {
        snapshot = await pageRequest<ProjectSnapshot>(
          "project.read",
          { projectId, rootId: sources.rootId },
          signal,
        );
      } catch (e) {
        if (!(e instanceof PageRequestError) || e.status !== 404) throw e;
      }
      return { projectId, sources, snapshot, owners: owners.projects };
    },
    [projectId, rootId],
  );
  const result = useViewResource(read);
  useViewLiveUpdates(result.refresh, result.loading);
  const data =
      result.data?.projectId === projectId &&
      (!rootId || result.data.sources.rootId === rootId)
        ? result.data
        : undefined,
    snapshot = data?.snapshot;
  async function openPage() {
    if (!snapshot || readOnly || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await pageRequest<{ page: { id: string } }>(
        "project.page",
        { projectId, expectedRootId: snapshot.rootId },
      );
      if (active.current) push("/studio/pages/" + result.page.id);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (!data)
    return (
      <section
        className="rounded-xl border border-border p-5"
        aria-label={zh ? "项目工作页" : "Project work"}
      >
        {result.error ? (
          <p role="alert" className="text-sm text-error">
            {zh
              ? "项目资料暂时无法读取。"
              : "Project data is currently unavailable."}
            <Button variant="ghost" onClick={result.refresh}>
              {zh ? "重试" : "Retry"}
            </Button>
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {zh ? "正在连接项目资料…" : "Loading project relationships…"}
          </p>
        )}
      </section>
    );
  return (
    <section
      className="rounded-xl border border-border bg-card/45 p-4 sm:p-5"
      aria-label={zh ? "项目工作页" : "Project work"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            {onPage
              ? zh
                ? "项目脉络"
                : "Project context"
              : zh
                ? "项目工作页"
                : "Project work"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {snapshot
              ? onPage
                ? zh
                  ? "人物、任务与沟通共用当前项目资料。"
                  : "People, tasks and conversations share this project’s sources."
                : snapshot.project.goal ||
                  (zh
                    ? "人物、任务与沟通在同一个项目中继续。"
                    : "People, tasks and conversations in one project.")
              : zh
                ? "把人物和任务资料关联到项目，保存为可持续使用的工作页。"
                : "Connect existing people and tasks to a lasting project workspace."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onPage && (
            <Link
              className="rounded-md px-3 py-2 text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
              href={"/studio/" + encodeURIComponent(projectId)}
            >
              {zh ? "返回项目" : "Project settings"}
            </Link>
          )}
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setEditing((v) => !v)}
            >
              {editing
                ? zh
                  ? "收起设置"
                  : "Close setup"
                : snapshot
                  ? zh
                    ? "管理关联"
                    : "Manage relationships"
                  : zh
                    ? "关联项目资料"
                    : "Connect sources"}
            </Button>
          )}
        </div>
      </div>
      {result.error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {zh
            ? "刷新失败，当前显示上一次读取的资料。请重试。"
            : "Refresh failed. Showing the last successful read."}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
      {editing && (
        <ProjectRelationships
          key={data.sources.rootId + ":" + projectId}
          rootId={data.sources.rootId}
          readOnly={readOnly}
          sources={data.sources}
          owners={data.owners}
          initial={
            snapshot?.project ?? {
              id: projectId,
              title: initialProject?.title ?? projectId,
              goal: initialProject?.goal ?? "",
              taskCollectionIds: [],
              personRefs: [],
            }
          }
          zh={zh}
          saved={() => {
            setEditing(false);
            result.refresh();
          }}
          cancel={() => setEditing(false)}
        />
      )}
      {snapshot && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-muted-foreground">
              {zh ? "项目人物" : "People"}
            </span>
            {snapshot.people.map((p) =>
              p.href ? (
                <Link
                  key={p.ref}
                  href={p.href}
                  className="underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {p.name}
                </Link>
              ) : (
                <span key={p.ref}>{p.name}</span>
              ),
            )}
            {!snapshot.people.length && (
              <span className="text-muted-foreground">
                {zh ? "尚未关联" : "None linked"}
              </span>
            )}
          </div>
          {!onPage && (
            <div className="mt-4">
              <Button
                variant="amber"
                disabled={busy || readOnly}
                onClick={() => void openPage()}
              >
                {busy
                  ? zh
                    ? "正在准备…"
                    : "Preparing…"
                  : zh
                    ? "打开工作页面"
                    : "Open work page"}
              </Button>
            </div>
          )}
          {snapshot.incomplete && (
            <p className="mt-3 text-sm text-muted-foreground">
              {zh
                ? "部分关联资料无法读取，当前结果可能不完整。"
                : "Some linked sources are unavailable; these results may be incomplete."}
            </p>
          )}
          <ProjectCommunication
            key={snapshot.rootId + ":" + projectId}
            snapshot={snapshot}
            zh={zh}
            readOnly={readOnly || !!result.error}
            refresh={result.refresh}
          />
        </>
      )}
    </section>
  );
}
