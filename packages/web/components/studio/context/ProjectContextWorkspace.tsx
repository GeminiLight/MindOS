"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  LayoutList,
  PencilLine,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Select } from "@/components/settings/Primitives";
import { Button } from "@/components/ui/button";
import { useViewsIndex, useViewResource } from "@/lib/views/hooks";
import { subscribeFilesChanged } from "@/lib/files-changed";
import { encodePath } from "@/lib/utils";
import {
  getStudioProjectSpaceRefs,
  localize,
  updateStudioProjectDefaults,
  type StudioProject,
} from "@/lib/studio-projects";
import {
  rememberContext,
  readContextPositions,
} from "@/lib/context-work/continuity";
import {
  contextError,
  readContext,
  readContextFile,
  prepareContext,
  type ContextDocument,
  type ContextFile,
} from "@/lib/context-work/api";
import { ViewsApiError } from "@/lib/views/api";
import ContextHandoff from "./ContextHandoff";
import ProgressDialog from "./ProgressDialog";

function ProjectHandoff({
  rootId,
  project,
  folder,
  files,
  current,
  locale,
  close,
  mode,
  inspect,
  path,
}: {
  rootId: string;
  project: StudioProject;
  folder: string;
  files: ContextFile[];
  current?: ContextDocument;
  locale: string;
  close: () => void;
  mode: "files" | "view";
  inspect: (path: string) => void;
  path: string;
}) {
  const revisions = useRef(new Map(current ? [[current.path, current]] : []));
  useEffect(() => {
    if (current && !revisions.current.has(current.path)) revisions.current.set(current.path, current);
  }, [current]);
  const items = useMemo(
    () =>
      files.map((f) => ({
          id: f.path,
          label: f.name,
          path: f.path,
          hint:
            f.path === current?.path
              ? (locale === "zh" ? "正在阅读 · " : "Currently reading · ") +
                f.path
              : f.path,
        })),
    [files, current?.path, locale],
  );
  const prepare = async (
    selected: string[],
    goal: string,
    target: string,
    signal: AbortSignal,
  ) => {
    const documents = await Promise.all(
      selected.map(async (path) => {
        const previous = revisions.current.get(path);
        if (previous) return previous;
        const value = await readContextFile(rootId, folder, path, signal);
        if (value.rootId !== rootId) throw new ViewsApiError("ROOT_CHANGED");
        revisions.current.set(path, value);
        return value;
      }),
    );
    const result = await prepareContext(
      rootId,
      folder,
      goal,
      target,
      documents.map(({ path, revision }) => ({ path, revision })),
      locale,
      signal,
    );
    if (result.rootId !== rootId) throw new ViewsApiError("ROOT_CHANGED");
    return result.text;
  };
  return (
    <ContextHandoff
      rootId={rootId}
      scopeId={"project:" + project.id}
      legacyScopeId={"project:" + project.id + ":" + (path || "folder")}
      presentation="inline"
      activeItemId={path}
      inspect={inspect}
      position={{ kind: "project", id: project.id, title: localize(project.title, project.titleZh, locale), folder, mode, file: path || undefined }}
      title={localize(project.title, project.titleZh, locale)}
      folder={folder}
      locale={locale}
      items={items}
      defaults={current ? [current.path] : []}
      initialGoal={localize(project.nextAction, project.nextActionZh, locale)}
      prepare={prepare}
      reload={() => revisions.current.clear()}
      close={close}
    />
  );
}
function ResourceNotice({
  loading,
  error,
  retry,
  zh,
}: {
  loading?: boolean;
  error?: string;
  retry: () => void;
  zh: boolean;
}) {
  if (loading)
    return (
      <p role="status" className="py-8 text-sm text-muted-foreground">
        {zh ? "正在读取资料…" : "Loading material…"}
      </p>
    );
  if (!error) return null;
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm leading-6">{contextError(error, zh)}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        {zh ? "重新读取" : "Retry"}
      </Button>
    </div>
  );
}
export default function ProjectContextWorkspace({
  project,
  locale,
}: {
  project: StudioProject;
  locale: string;
}) {
  const zh = locale === "zh";
  const params = useSearchParams();
  const index = useViewsIndex();
  const rootId = index.data?.rootId ?? "";
  const spaces = getStudioProjectSpaceRefs(project, locale).filter(
    (s) =>
      s.path &&
      !s.path.startsWith("/") &&
      !s.path.split("/").some((p) => !p || p.startsWith(".")),
  );
  const remembered = rootId
    ? readContextPositions(rootId).find(
        (p) => p.kind === "project" && p.id === project.id,
      )
    : undefined;
  const requestedFolder = params.get("folder") || remembered?.folder;
  const folder =
    spaces.find((s) => s.path === requestedFolder)?.path ||
    spaces[0]?.path ||
    "";
  const mode =
    params.get("mode") === "files"
      ? "files"
      : params.get("mode") === "view"
        ? "view"
        : remembered?.mode || "view";
  const requestedFile =
    params.get("file") ??
    (remembered?.folder === folder ? remembered.file : undefined);
  const [search, setSearch] = useState("");
  const [linkFolder, setLinkFolder] = useState("");
  const [progressOpen, setProgressOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const handoffTrigger = useRef<HTMLButtonElement>(null);
  const readingPane = useRef<HTMLElement>(null);
  const readingPositions = useRef(new Map<string, number>());
  const [savedPath, setSavedPath] = useState("");
  const [rememberedLocally, setRememberedLocally] = useState(true);
  const read = useCallback(
    (signal: AbortSignal) => readContext(rootId, folder, signal),
    [rootId, folder],
  );
  const resource = useViewResource(read, !!rootId && !!folder && !index.error);
  const data =
    resource.data?.rootId === rootId && resource.data.folder === folder
      ? resource.data
      : undefined;
  const path =
    requestedFile ||
    data?.files.find((f) => !f.path.startsWith(folder + "/进展/"))?.path ||
    data?.files[0]?.path ||
    "";
  const readFile = useCallback(
    (signal: AbortSignal) => readContextFile(rootId, folder, path, signal),
    [rootId, folder, path],
  );
  const fileResource = useViewResource(
    readFile,
    !!data && !!path && !resource.error && !index.error,
  );
  const file =
    fileResource.data?.rootId === rootId && fileResource.data.path === path
      ? fileResource.data
      : undefined;
  const readable = !!data && !resource.error && !index.error;
  const usable = readable && !resource.loading;
  const folderMissing = resource.error === "FOLDER_MISSING";
  const title = localize(project.title, project.titleZh, locale);
  useEffect(() => {
    setSearch("");
    setLinkFolder("");
  }, [rootId, folder, project.id]);
  useEffect(() => {
    setProgressOpen(false);
    setHandoffOpen(false);
    setSavedPath("");
  }, [rootId, folder, project.id]);
  useEffect(() => {
    if (readingPane.current) readingPane.current.scrollTop = readingPositions.current.get(rootId + ":" + path) ?? 0;
  }, [rootId, path, file?.content]);
  useEffect(() => {
    if (!usable || (path && !data?.files.some((f) => f.path === path))) return;
    setRememberedLocally(
      rememberContext(rootId, {
        kind: "project",
        id: project.id,
        title,
        folder,
        mode,
        file: path || undefined,
      }),
    );
  }, [usable, rootId, project.id, title, folder, mode, path, data?.files]);
  useEffect(() => {
    const refresh = () => {
      resource.refresh();
      fileResource.refresh();
    };
    const stop = subscribeFilesChanged(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      stop();
      window.removeEventListener("focus", refresh);
    };
  }, [resource.refresh, fileResource.refresh]);
  const navigate = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    next.set("folder", folder);
    next.set("mode", mode);
    if (path) next.set("file", path);
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    // These are presentations of one Context; changing them needs no server navigation.
    window.history.replaceState(
      null,
      "",
      `/studio/${encodeURIComponent(project.id)}?${next}`,
    );
  };
  const displayName = (filePath: string) =>
    data?.progress.find((p) => p.path === filePath)?.title ||
    filePath.split("/").pop();
  const filtered =
    data?.files.filter((f) =>
      `${displayName(f.path)} ${f.path}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  const associated =
    index.data?.views.filter(
      (v) => v.folder === folder && v.availability === "ready",
    ) ?? [];
  return (
    <section
      aria-label={zh ? "项目 Context" : "Project Context"}
      id="context-workspace"
      className="@container/context min-w-0"
    >
      <ResourceNotice
        loading={index.loading && !index.data}
        error={index.error}
        retry={index.refresh}
        zh={zh}
      />
      {(!folder || folderMissing) && !index.loading && !index.error && (
        <div className="space-y-4 rounded-lg border border-dashed border-border p-6">
          <FolderOpen size={24} className="text-muted-foreground" />
          <h2 className="font-medium">
            {folderMissing
              ? zh
                ? "重新关联资料文件夹"
                : "Reconnect your material folder"
              : zh
                ? "把这个项目的资料放在一起"
                : "Bring this project’s material together"}
          </h2>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            {folderMissing
              ? zh
                ? `原文件夹「${folder}」已不可用。选择新的位置，保留项目并继续。`
                : `The folder “${folder}” is unavailable. Choose its new location to continue.`
              : zh
                ? "关联知识库中的文件夹，就能在这里阅读资料、记录进展，或带着资料继续使用 Agent。"
                : "Link a library folder to read files, record progress and continue with an Agent."}
          </p>
          <div className="flex max-w-xl flex-wrap gap-2">
            <Select
              className="min-w-0 flex-1"
              aria-label={zh ? "关联资料文件夹" : "Context folder"}
              value={linkFolder}
              onChange={(e) => setLinkFolder(e.target.value)}
            >
              <option value="">
                {zh ? "选择已有文件夹" : "Choose a folder"}
              </option>
              {index.data?.folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              disabled={!linkFolder}
              onClick={() => {
                if (!linkFolder || !index.data?.folders.includes(linkFolder))
                  return;
                const previous = getStudioProjectSpaceRefs(
                  project,
                  locale,
                ).filter((s) => !folderMissing || s.path !== folder);
                const next = previous.some((s) => s.path === linkFolder)
                  ? previous
                  : [
                      ...previous,
                      {
                        path: linkFolder,
                        label: linkFolder.split("/").pop(),
                        source: "project-default" as const,
                      },
                    ];
                updateStudioProjectDefaults(project.id, { spaces: next });
                navigate({ folder: linkFolder, file: "" });
              }}
            >
              {zh ? "关联文件夹" : "Link folder"}
            </Button>
          </div>
        </div>
      )}
      {folder && !folderMissing && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label={zh ? "Context 展示方式" : "Context display"}
                className="inline-flex rounded-lg bg-muted/50 p-1"
              >
                {(["view", "files"] as const).map((m) => (
                  <Button
                    key={m}
                    variant="ghost"
                    size="sm"
                    aria-pressed={mode === m}
                    className={
                      mode === m
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground"
                    }
                    onClick={() => navigate({ mode: m })}
                  >
                    {m === "view" ? (
                      <LayoutList size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                    {m === "view"
                      ? zh
                        ? "视图"
                        : "View"
                      : zh
                        ? "文件"
                        : "Files"}
                  </Button>
                ))}
              </div>
              {spaces.length > 1 ? (
                <Select
                  aria-label={zh ? "当前资料文件夹" : "Current folder"}
                  className="max-w-64 min-w-0"
                  size="sm"
                  value={folder}
                  onChange={(e) =>
                    navigate({ folder: e.target.value, file: "" })
                  }
                >
                  {spaces.map((s) => (
                    <option key={s.path} value={s.path}>
                      {s.label || s.path}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <FolderOpen size={13} className="shrink-0" />
                  <span className="max-w-64 truncate" title={folder}>
                    {folder}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!usable}
                onClick={() => setProgressOpen(true)}
              >
                <PencilLine size={14} />
                {zh ? "记下进展" : "Record progress"}
              </Button>
              <Button
                ref={handoffTrigger}
                variant="outline"
                size="sm"
                aria-expanded={handoffOpen}
                aria-controls="context-handoff"
                disabled={
                  !usable || !data?.files.length || fileResource.loading
                }
                onClick={() => {
                  setHandoffOpen(true);
                  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#context-handoff textarea')?.focus({ preventScroll: true }));
                }}
              >
                <ArrowUpRight size={14} />
                {zh ? "交给 Agent" : "Hand off to Agent"}
              </Button>
            </div>
          </div>
          {path && readable && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-3 text-xs text-muted-foreground">
              <span>{zh ? "当前资料" : "Current material"}</span>
              <button className="min-w-0 max-w-full truncate rounded text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                title={path} onClick={() => navigate({ mode: "files" })}>
                {displayName(path)}
              </button>
              <span>{zh ? "文件、视图和 Agent 共用这份 Context" : "One Context across files, views and your Agent"}</span>
            </div>
          )}
          <div className={handoffOpen ? "grid items-start gap-6 @[800px]/context:grid-cols-[minmax(0,1fr)_340px]" : "min-w-0"}>
          <div className="min-w-0">
          {savedPath && (
            <p
              role="status"
              className="mt-3 flex flex-wrap items-center gap-2 text-xs text-success"
            >
              <Check size={14} />
              {zh ? "进展已保存到 Context" : "Progress saved to Context"}
              <button
                className="rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => navigate({ mode: "files", file: savedPath })}
              >
                {zh ? "查看文件" : "View file"}
              </button>
            </p>
          )}
          {!rememberedLocally && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {zh
                ? "本次位置仅在当前页面保留，浏览器暂时无法记住它。"
                : "This browser could not remember your position beyond this tab."}
            </p>
          )}
          <ResourceNotice
            loading={resource.loading && !data}
            error={resource.error}
            retry={resource.refresh}
            zh={zh}
          />
          {readable && (resource.loading || fileResource.loading) && (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              {zh ? "正在更新资料…" : "Updating material…"}
            </p>
          )}
          {readable && (
            <div hidden={mode !== "view"} className={`gap-8 py-5 ${mode !== "view" ? "hidden" : "grid"} ${handoffOpen ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.48fr)]"}`}>
              <div>
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">
                    {zh ? "最近进展" : "Recent progress"}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {zh ? "保存在资料中" : "Saved with your material"}
                  </span>
                </div>
                {data.progress.length ? (
                  <ol className="space-y-5">
                    {data.progress.slice(0, 6).map((p, i) => (
                      <li
                        key={p.id}
                        className={`border-l-2 pl-5 ${i === 0 ? "border-[var(--amber)]" : "border-border"}`}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <time dateTime={p.createdAt}>
                            {new Date(p.createdAt).toLocaleDateString(locale, {
                              month: "short",
                              day: "numeric",
                            })}
                          </time>
                          <span>{p.source}</span>
                          {i === 0 && (
                            <span className="text-[var(--amber)]">
                              {zh ? "最近一次" : "Latest"}
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-7">
                          {p.text}
                        </p>
                        <button
                          className="mt-2 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            navigate({ mode: "files", file: p.path })
                          }
                        >
                          {zh ? "打开原文件" : "Open source"} ↗
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-6">
                    <PencilLine
                      size={20}
                      className="mb-3 text-muted-foreground"
                    />
                    <h3 className="text-sm font-medium">
                      {zh ? "下一次，从这里接着做" : "Pick up here next time"}
                    </h3>
                    <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
                      {zh
                        ? "记下已确定的判断、还没解决的问题，或者下一步。不需要先开启一段对话。"
                        : "Leave a decision, an open question or a next step. You can record it directly."}
                    </p>
                    <Button
                      className="mt-4"
                      variant="outline"
                      size="sm"
                      disabled={!usable}
                      onClick={() => setProgressOpen(true)}
                    >
                      {zh ? "记下第一条进展" : "Record first progress"}
                    </Button>
                  </div>
                )}
              </div>
              <aside className="min-w-0 space-y-7">
                <div>
                  <h2 className="mb-3 text-sm font-semibold">
                    {zh ? "正在看的资料" : "Current material"}
                  </h2>
                  {path ? (
                    <button
                      onClick={() => navigate({ mode: "files", file: path })}
                      className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FileText
                        size={18}
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {displayName(path)}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {folder}
                        </span>
                      </span>
                      <ArrowRight
                        size={14}
                        className="mt-1 shrink-0 text-muted-foreground"
                      />
                    </button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {zh
                        ? "文件夹中还没有可阅读的文本。"
                        : "There are no readable text files in this folder yet."}
                    </p>
                  )}
                </div>
                {associated.length > 0 && (
                  <div>
                    <h2 className="mb-3 text-sm font-semibold">
                      {zh ? "这份 Context 的视图" : "Views of this Context"}
                    </h2>
                    {associated.map((v) => (
                      <Link
                        key={v.id}
                        href={`/studio/views/${encodeURIComponent(v.id)}`}
                        className="flex items-center justify-between rounded-md py-3 text-sm hover:text-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex items-center gap-2">
                          <Sparkles size={14} />
                          {v.name}
                        </span>
                        <ArrowUpRight size={14} />
                      </Link>
                    ))}
                  </div>
                )}
                <p className="text-xs leading-6 text-muted-foreground">
                  {zh
                    ? "文件与视图使用同一份资料。你可以自己推进，也可以随时把选中的资料交给 Agent。"
                    : "Files and views share the same material. Work directly, or bring selected material to an Agent."}
                </p>
              </aside>
            </div>
          )}
          {readable && (
            <div hidden={mode !== "files"} className={`min-h-96 gap-5 py-5 ${mode !== "files" ? "hidden" : "grid"} ${handoffOpen ? "md:grid-cols-[150px_minmax(0,1fr)]" : "md:grid-cols-[210px_minmax(0,1fr)]"}`}>
              <nav
                aria-label={zh ? "Context 文件" : "Context files"}
                className="min-w-0 border-border md:border-r md:pr-4"
              >
                <div className="mb-3 flex items-center gap-2 rounded-md border border-input px-2.5">
                  <Search
                    size={14}
                    className="shrink-0 text-muted-foreground"
                  />
                  <input
                    aria-label={zh ? "查找文件" : "Find file"}
                    className="min-h-9 min-w-0 w-full bg-transparent text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={search}
                    placeholder={zh ? "查找文件" : "Find file"}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={zh ? "清除文件搜索" : "Clear file search"}
                      onClick={() => setSearch("")}
                    >
                      <X size={13} />
                    </Button>
                  )}
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto md:max-h-[60dvh]">
                  {filtered.map((f) => (
                    <button
                      key={f.path}
                      aria-current={f.path === path ? "true" : undefined}
                      onClick={() => navigate({ file: f.path })}
                      className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring ${f.path === path ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                    >
                      <FileText size={14} className="shrink-0" />
                      <span className="truncate" title={f.path}>
                        {displayName(f.path)}
                      </span>
                    </button>
                  ))}
                  {!filtered.length && (
                    <p className="py-4 text-xs text-muted-foreground">
                      {zh ? "没有找到文件。" : "No files found."}
                    </p>
                  )}
                </div>
              </nav>
              <article id="context-reading" ref={readingPane} tabIndex={-1}
                onScroll={(event) => readingPositions.current.set(rootId + ":" + path, event.currentTarget.scrollTop)}
                className="max-h-[68dvh] min-w-0 overflow-y-auto pr-2">
                <ResourceNotice
                  loading={fileResource.loading && !file}
                  error={fileResource.error}
                  retry={fileResource.refresh}
                  zh={zh}
                />
                {file && !fileResource.error && (
                  <>
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                      <span className="min-w-0 break-all text-xs text-muted-foreground">
                        {path}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        render={<Link href={`/view/${encodePath(path)}`} />}
                        nativeButton={false}
                      >
                        <PencilLine size={14} />
                        {zh ? "编辑原文件" : "Edit source"}
                      </Button>
                    </div>
                    <div className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-headings:font-display prose-a:text-[var(--amber)] prose-pre:overflow-x-auto">
                      {/\.md$/i.test(path) ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {file.content.replace(
                            /^<!-- mindos-progress[^\n]+-->\n*/,
                            "",
                          )}
                        </ReactMarkdown>
                      ) : (
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-6">
                          {file.content}
                        </pre>
                      )}
                    </div>
                  </>
                )}
                {!path && (
                  <p className="py-10 text-sm text-muted-foreground">
                    {zh
                      ? "这个文件夹还没有文本资料。"
                      : "This folder has no text material yet."}
                  </p>
                )}
              </article>
            </div>
          )}
          {!!(data?.limited || data?.skipped) && (
            <p
              role="status"
              className="text-xs leading-5 text-muted-foreground"
            >
              {zh
                ? "部分文件未在此列出；可以在知识库文件栏查看完整目录。"
                : "Some files are not listed here. Browse the full folder in the library."}
            </p>
          )}
          </div>
          {handoffOpen && data && (
            <div id="context-handoff" className="order-first min-w-0 @[800px]/context:sticky @[800px]/context:top-4 @[800px]/context:order-last">
              <ProjectHandoff
                key={rootId + folder}
                rootId={rootId}
                project={project}
                folder={folder}
                mode={mode}
                path={path}
                files={data.files.map((f) => ({ ...f, name: displayName(f.path) || f.name }))}
                current={!fileResource.error && !fileResource.loading ? file : undefined}
                locale={locale}
                inspect={(filePath) => {
                  navigate({ mode: "files", file: filePath });
                  if ((document.getElementById("context-workspace")?.clientWidth ?? 0) < 800)
                    requestAnimationFrame(() => readingPane.current?.scrollIntoView({ block: "nearest" }));
                }}
                close={() => {
                  setHandoffOpen(false);
                  handoffTrigger.current?.focus({ preventScroll: true });
                }}
              />
            </div>
          )}
          </div>
        </>
      )}
      {progressOpen && (
        <ProgressDialog
          key={rootId + folder}
          rootId={rootId}
          scopeId={"project:" + project.id}
          folder={folder}
          locale={locale}
          close={() => setProgressOpen(false)}
          saved={(path) => {
            setProgressOpen(false);
            setSavedPath(path);
            resource.refresh();
          }}
        />
      )}
    </section>
  );
}
