"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  History,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type {
  PageSpec,
  SavedPage,
  WorkProject,
} from "@geminilight/mindos/knowledge/views";
import { useLocale } from "@/lib/stores/locale-store";
import { useViewResource } from "@/lib/views/hooks";
import { subscribeFilesChanged } from "@/lib/files-changed";
import { subscribeServerEvents } from "@/lib/server-events";
import {
  pageRequest,
  PageRequestError,
  type PageRead,
  type PagePreview,
  type PageSources,
} from "@/lib/views/page-api";
import {
  blankPage,
  clearPageDraft,
  pageChanges,
  readPageDraft,
  writePageDraft,
} from "@/lib/views/page-workspace";
import { StudioShell } from "../StudioShell";
import { Button } from "@/components/ui/button";
import { fieldClass } from "../views/ViewPrimitives";
import PageInspector from "./PageInspector";
import PageCanvas from "./PageCanvas";
import ProjectWorkPanel from "../projects/ProjectWorkPanel";

type Bootstrap = { sources: PageSources; document?: PageRead };
export default function PageWorkspace({ pageId }: { pageId: string }) {
  const { locale } = useLocale(),
    zh = locale === "zh";
  const load = useCallback(
    async (signal: AbortSignal) => {
      const sources = await pageRequest<PageSources>("list", {}, signal);
      const document =
        pageId === "new"
          ? undefined
          : await pageRequest<PageRead>(
              "page.read",
              { pageId, rootId: sources.rootId },
              signal,
            );
      if (document && document.rootId !== sources.rootId)
        throw new Error("Library changed");
      if (document?.page.spec.projectId) {
        const directory = await pageRequest<{ projects: WorkProject[] }>(
          "project.list",
          { rootId: sources.rootId },
          signal,
        );
        const project = directory.projects.find(
          (p) => p.id === document.page.spec.projectId,
        );
        if (!project) throw new Error("Project relationships are unavailable");
        const ids = new Set([
          ...project.taskCollectionIds,
          ...project.personRefs.map((ref) => ref.split("/")[0]),
        ]);
        sources.collections = sources.collections.filter((c) => ids.has(c.id));
        sources.views = sources.views.filter(
          (v) => v.collectionId !== undefined && ids.has(v.collectionId),
        );
      }
      return { sources, document };
    },
    [pageId],
  );
  const bootstrap = useViewResource<Bootstrap>(load);
  useEffect(() => {
    const onFocus = () => bootstrap.refresh();
    window.addEventListener("focus", onFocus);
    const stops = [
      subscribeFilesChanged(onFocus),
      subscribeServerEvents("views.changed", onFocus),
      subscribeServerEvents("ready", onFocus),
    ];
    return () => {
      window.removeEventListener("focus", onFocus);
      stops.forEach((stop) => stop());
    };
  }, [bootstrap.refresh]);
  return (
    <StudioShell contentMaxWidth="full">
      <div className="mx-auto w-full max-w-7xl pb-12">
        {bootstrap.error ? (
          <div role="alert" className="rounded-xl border border-border p-8">
            <h1 className="text-lg font-semibold">
              {zh ? "工作页面暂时无法打开" : "This page could not be opened"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {zh
                ? "资料库可能已切换，或页面已被移除。你的原资料不会受到影响。"
                : "The library may have changed or the page may have been removed. Your source records are unaffected."}
            </p>
            <div className="mt-4 flex gap-3">
              <Button onClick={bootstrap.refresh}>
                {zh ? "重试" : "Retry"}
              </Button>
              <Link
                href="/studio/pages"
                className="self-center text-sm underline"
              >
                {zh ? "返回工作页面" : "Back to pages"}
              </Link>
            </div>
          </div>
        ) : bootstrap.data ? (
          <PageSession
            key={bootstrap.data.sources.rootId + pageId}
            pageId={pageId}
            sources={bootstrap.data.sources}
            incoming={bootstrap.data.document}
            locale={locale}
          />
        ) : (
          <div
            role="status"
            className="flex items-center gap-2 py-16 text-sm text-muted-foreground"
          >
            <LoaderCircle className="animate-spin" size={16} />
            {zh ? "正在打开工作页面…" : "Opening your page…"}
          </div>
        )}
      </div>
    </StudioShell>
  );
}
function PageSession({
  pageId,
  sources,
  incoming,
  locale,
}: {
  pageId: string;
  sources: PageSources;
  incoming?: PageRead;
  locale: string;
}) {
  const zh = locale === "zh",
    router = useRouter(),
    push = useSmoothRouterPush(),
    rootId = sources.rootId;
  const [restored] = useState(() => readPageDraft(rootId, pageId));
  const [saved, setSaved] = useState<SavedPage | undefined>(incoming?.page);
  const [spec, setSpec] = useState<PageSpec>(
    restored?.spec ?? incoming?.page.spec ?? blankPage(locale),
  );
  const [baseVersion, setBaseVersion] = useState(
    restored?.baseVersion ?? incoming?.page.version ?? 0,
  );
  const [settings, setSettings] = useState(pageId === "new"),
    [selectedId, setSelectedId] = useState("");
  const [aiExpanded, setAiExpanded] = useState(pageId === "new");
  const promptField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (aiExpanded) promptField.current?.focus();
  }, [aiExpanded, selectedId]);
  const [prompt, setPrompt] = useState(""),
    [generating, setGenerating] = useState(false),
    [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PagePreview>(),
    [summary, setSummary] = useState(""),
    [error, setError] = useState("");
  const [notice, setNotice] = useState(
    restored
      ? zh
        ? "已恢复未保存的页面草稿。"
        : "Your unsaved page draft has been restored."
      : "",
  );
  const [storageError, setStorageError] = useState(false),
    [aiSetup, setAiSetup] = useState(false),
    [history, setHistory] = useState(false),
    [removeConfirm, setRemoveConfirm] = useState(false);
  const generation = useRef<AbortController | undefined>(undefined),
    pending = useRef<{ fingerprint: string; id: string } | undefined>(
      undefined,
    );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current?.abort();
    };
  }, []);
  const baseline = saved?.spec ?? blankPage(locale),
    dirty = JSON.stringify(spec) !== JSON.stringify(baseline);
  const read = useCallback(
    (signal: AbortSignal) =>
      pageRequest<PagePreview>(
        "page.preview",
        { expectedRootId: rootId, spec },
        signal,
      ),
    [rootId, spec],
  );
  const previewReady =
    !!spec.title.trim() &&
    spec.blocks.length > 0 &&
    spec.blocks.every(
      (block) =>
        !!block.title.trim() &&
        (block.kind === "notes"
          ? !!block.folder || !!block.paths?.length
          : block.kind === "html"
            ? !!block.html?.trim()
            : !!block.collectionId || !!block.viewId),
    );
  const data = useViewResource(read, previewReady);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(data.refresh, 150);
    };
    const stops = [
      subscribeFilesChanged(refresh),
      subscribeServerEvents("views.changed", refresh),
      subscribeServerEvents("ready", refresh),
    ];
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      stops.forEach((s) => s());
      window.removeEventListener("focus", refresh);
    };
  }, [data.refresh]);
  useEffect(() => {
    if (dirty)
      setStorageError(!writePageDraft(rootId, pageId, { spec, baseVersion }));
    else clearPageDraft(rootId, pageId);
  }, [rootId, pageId, spec, baseVersion, dirty]);
  useEffect(() => {
    if (!incoming || incoming.page.version <= (saved?.version ?? 0)) return;
    if (dirty || preview || generating) {
      setNotice(
        zh
          ? "页面已有新版本。你的草稿仍在，保存前请比较或恢复。"
          : "This page has a newer version. Your draft is kept; compare or restore before saving.",
      );
      return;
    }
    setSaved(incoming.page);
    setSpec(incoming.page.spec);
    setBaseVersion(incoming.page.version);
  }, [incoming, saved?.version, dirty, preview, generating, zh]);
  const change = (next: PageSpec) => {
    setSpec(next);
    setPreview(undefined);
    setNotice("");
    setError("");
  };
  const selected = spec.blocks.find((b) => b.id === selectedId);
  async function generate() {
    if (generation.current || !prompt.trim() || saving) return;
    const controller = new AbortController();
    generation.current = controller;
    setGenerating(true);
    setError("");
    setAiSetup(false);
    setNotice("");
    try {
      const result = await pageRequest<{
        rootId: string;
        spec: PageSpec;
        summary?: string;
      }>(
        "page.generate",
        {
          expectedRootId: rootId,
          prompt: prompt.trim(),
          spec,
          ...(selectedId ? { selectedBlockId: selectedId } : {}),
        },
        controller.signal,
      );
      if (result.rootId !== rootId)
        throw new Error(
          zh
            ? "资料库已切换，请重新打开页面。"
            : "Library changed. Reopen the page.",
        );
      const candidate = await pageRequest<PagePreview>(
        "page.preview",
        { expectedRootId: rootId, spec: result.spec },
        controller.signal,
      );
      if (controller.signal.aborted || !alive.current) return;
      setPreview(candidate);
      setSummary(result.summary ?? "");
    } catch (e) {
      if (!controller.signal.aborted && alive.current) {
        setError((e as Error).message);
        setAiSetup(
          e instanceof PageRequestError && e.code === "AI_NOT_CONFIGURED",
        );
      }
    } finally {
      if (generation.current === controller) {
        generation.current = undefined;
        if (alive.current) setGenerating(false);
      }
    }
  }
  function cancelGenerate() {
    generation.current?.abort();
    generation.current = undefined;
    setGenerating(false);
    setNotice(
      zh
        ? "已停止生成，当前页面保持原样。"
        : "Generation stopped. Your page is unchanged.",
    );
  }
  async function persist(
    op: "page.save" | "page.restore" | "page.remove",
    extra: Record<string, unknown> = {},
  ) {
    if (saving || generating) return;
    setSaving(true);
    setError("");
    setNotice("");
    const input = {
      expectedRootId: rootId,
      expectedVersion: baseVersion,
      ...(pageId !== "new" ? { pageId } : {}),
      ...(op === "page.save" ? { spec } : {}),
      ...extra,
    };
    const fingerprint = JSON.stringify({ op, input });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await pageRequest<{ rootId: string; page?: SavedPage }>(
        op,
        { ...input, operationId: pending.current.id },
      );
      if (!alive.current) return;
      if (result.rootId !== rootId)
        throw new Error(
          zh
            ? "资料库已切换，请重新打开页面。"
            : "Library changed. Reopen the page.",
        );
      pending.current = undefined;
      clearPageDraft(rootId, pageId);
      if (op === "page.remove") {
        push("/studio/pages");
        return;
      }
      if (!result.page)
        throw new Error(
          zh
            ? "保存结果不完整，请重试。"
            : "The save result was incomplete. Retry.",
        );
      setSaved(result.page);
      setSpec(result.page.spec);
      setBaseVersion(result.page.version);
      setPreview(undefined);
      setStorageError(false);
      setHistory(false);
      setNotice(
        op === "page.restore"
          ? zh
            ? "布局已恢复，原资料保持最新。"
            : "Layout restored. Your source data stays current."
          : zh
            ? "页面已保留，下次可以从视图首页继续。"
            : "Page saved. Continue from Views next time.",
      );
      if (pageId === "new") router.replace("/studio/pages/" + result.page.id);
      data.refresh();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  const visibleSpec = preview?.spec ?? spec,
    visibleData =
      preview ??
      (data.data?.rootId === rootId &&
      JSON.stringify(data.data.spec) === JSON.stringify(spec)
        ? data.data
        : undefined);
  const differences = preview ? pageChanges(spec, preview.spec, locale) : [];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/studio/views"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={13} aria-hidden />
          {zh ? "视图" : "Views"}
        </Link>
        <span className="text-xs text-muted-foreground">
          {preview
            ? zh
              ? "正在预览，尚未应用"
              : "Preview · not applied"
            : dirty
              ? zh
                ? "有未保存的调整"
                : "Unsaved changes"
              : saved
                ? zh
                  ? `已保存 · 第 ${saved.version} 版`
                  : `Saved · version ${saved.version}`
                : zh
                  ? "临时页面 · 保存后出现在首页"
                  : "Temporary page · save to keep"}
        </span>
      </div>
      <header className="mb-7 mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="break-words text-3xl font-semibold tracking-tight">
            {visibleSpec.title || (zh ? "未命名页面" : "Untitled page")}
          </h1>
          {visibleSpec.description && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
              {visibleSpec.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            aria-label={zh ? "刷新页面资料" : "Refresh page data"}
            onClick={data.refresh}
            disabled={data.loading}
          >
            <RefreshCw size={15} aria-hidden />
          </Button>
          <Button
            variant="outline"
            onClick={() => setSettings((v) => !v)}
            aria-expanded={settings}
          >
            <Settings2 size={15} aria-hidden />
            {zh ? "调整页面" : "Customize"}
          </Button>
          {saved && (
            <Button
              variant="ghost"
              onClick={() => setHistory((v) => !v)}
              aria-expanded={history}
            >
              <History size={15} aria-hidden />
              {zh ? "历史" : "History"}
            </Button>
          )}
          <Button
            variant="amber"
            onClick={() => void persist("page.save")}
            disabled={
              saving ||
              generating ||
              !!preview ||
              !spec.title.trim() ||
              !spec.blocks.length ||
              (!dirty && !!saved)
            }
          >
            <Save size={15} aria-hidden />
            {saving
              ? zh
                ? "正在保存…"
                : "Saving…"
              : saved
                ? zh
                  ? "保存调整"
                  : "Save changes"
                : zh
                  ? "保留此页面"
                  : "Keep this page"}
          </Button>
        </div>
      </header>
      {spec.projectId && (
        <div className="mb-6">
          <ProjectWorkPanel
            key={rootId + spec.projectId}
            projectId={spec.projectId}
            rootId={rootId}
            onPage
            readOnly={!!preview || generating || saving}
          />
        </div>
      )}
      {aiExpanded || generating || preview ? (
        <section
          aria-label={zh ? "用 AI 调整页面" : "Adjust with AI"}
          className="mb-6 rounded-xl border border-border bg-muted/30 p-4 sm:p-5"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles size={16} aria-hidden className="text-[var(--amber)]" />
              {zh ? "让页面更合你的习惯" : "Make this page your own"}
            </span>
            <div className="flex items-center gap-2">
              {selected ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={generating}
                  onClick={() => setSelectedId("")}
                >
                  {zh ? "仅调整：" : "Adjusting: "}
                  {selected.title}
                  <X size={12} aria-hidden />
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {zh
                    ? "调整整个页面，保留已锁定模块"
                    : "Whole page · locked blocks are preserved"}
                </span>
              )}
              {!generating && !preview && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAiExpanded(false)}
                >
                  {zh ? "收起" : "Collapse"}
                </Button>
              )}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
          >
            <label className="sr-only" htmlFor="page-prompt">
              {zh ? "描述页面调整" : "Describe your change"}
            </label>
            <textarea
              ref={promptField}
              id="page-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={generating || saving}
              rows={2}
              maxLength={4000}
              placeholder={
                zh
                  ? "例如：把未完成任务放左边，相关人物放右边，整体紧凑一些。"
                  : "For example: put open tasks on the left, people on the right, and make it more compact."
              }
              className={fieldClass + " resize-y bg-background"}
            />
            {selected && !generating && !preview && (
              <div
                className="mt-2 flex flex-wrap gap-2"
                aria-label={zh ? "局部调整建议" : "Suggestions for this region"}
              >
                {(selected.kind === "tasks"
                  ? zh
                    ? ["只展示未完成任务", "改成状态看板", "布局紧凑一些"]
                    : [
                        "Show only open tasks",
                        "Use a status board",
                        "Make this more compact",
                      ]
                  : selected.kind === "people"
                    ? zh
                      ? [
                          "突出人物背景与下一步",
                          "改成简洁表格",
                          "减少装饰，突出内容",
                        ]
                      : [
                          "Highlight context and next steps",
                          "Use a simple table",
                          "Simplify the presentation",
                        ]
                    : zh
                      ? ["让信息更清晰", "布局紧凑一些", "保留内容，优化排版"]
                      : [
                          "Clarify the hierarchy",
                          "Make this more compact",
                          "Refine typography, keep content",
                        ]
                ).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving || selected.locked}
                    onClick={() => {
                      setPrompt(value);
                      promptField.current?.focus();
                    }}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs leading-5 text-muted-foreground">
                {generating
                  ? zh
                    ? "正在基于你的资料设计页面，可以随时停止。"
                    : "Designing with your sources. You can stop at any time."
                  : zh
                    ? "先看真实预览，再决定是否应用。资料不会因为改布局而改变。"
                    : "Preview first, then apply. Layout changes leave your records intact."}
              </p>
              {generating ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelGenerate}
                >
                  <LoaderCircle
                    size={14}
                    className="animate-spin"
                    aria-hidden
                  />
                  {zh ? "停止" : "Stop"}
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!prompt.trim() || saving || selected?.locked}
                >
                  <Sparkles size={14} aria-hidden />
                  {zh ? "生成预览" : "Generate preview"}
                </Button>
              )}
            </div>
          </form>
        </section>
      ) : (
        <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-border pb-4">
          <Button variant="ghost" size="sm" onClick={() => setAiExpanded(true)}>
            <Sparkles size={15} aria-hidden className="text-[var(--amber)]" />
            {zh ? "用 AI 调整" : "Adjust with AI"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {zh
              ? "想换个布局？描述你的想法"
              : "A different layout? Describe what you have in mind."}
          </span>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-error/30 p-4 text-sm"
        >
          <p className="break-words text-error">{error}</p>
          {aiSetup && (
            <p className="mt-2 text-muted-foreground">
              {zh
                ? "先在设置中配置 AI；你也可以继续手动调整页面。"
                : "Configure AI in Settings, or continue customizing manually."}
              <Link href="/settings" className="ml-2 underline">
                {zh ? "打开设置" : "Open settings"}
              </Link>
            </p>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {storageError && (
        <p role="alert" className="mb-4 text-sm text-error">
          {zh
            ? "浏览器无法保存草稿，请在离开前保存页面。"
            : "This browser could not keep a draft. Save the page before leaving."}
        </p>
      )}
      {history && saved && (
        <section
          aria-label={zh ? "页面版本" : "Page versions"}
          className="mb-6 rounded-xl border border-border p-5"
        >
          <h2 className="text-sm font-semibold">
            {zh ? "恢复以前的布局" : "Restore an earlier layout"}
          </h2>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            {zh
              ? "恢复会替换当前草稿；任务和笔记仍保持最新，不会回退真实资料。"
              : "Restoring replaces your current draft. It never rolls back tasks or notes."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {saved.history?.length ? (
              saved.history
                .slice()
                .reverse()
                .map((v) => (
                  <Button
                    key={v.version}
                    variant="outline"
                    size="sm"
                    disabled={saving || generating}
                    onClick={() =>
                      void persist("page.restore", {
                        restoreVersion: v.version,
                      })
                    }
                  >
                    {zh
                      ? `恢复第 ${v.version} 版`
                      : `Restore version ${v.version}`}
                  </Button>
                ))
            ) : (
              <p className="text-sm text-muted-foreground">
                {zh
                  ? "保存下一次调整后，这个版本会留在这里。"
                  : "This version will appear here after your next save."}
              </p>
            )}
          </div>
          <div className="mt-5 border-t border-border pt-4">
            {removeConfirm ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {zh
                    ? "仅移除这个页面，保留所有原资料。"
                    : "Remove this page only. All source records remain."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => void persist("page.remove")}
                >
                  {zh ? "确认移除页面" : "Remove page"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveConfirm(false)}
                >
                  {zh ? "取消" : "Cancel"}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRemoveConfirm(true)}
              >
                {zh ? "移除页面" : "Remove page"}
              </Button>
            )}
          </div>
        </section>
      )}
      {preview && (
        <section
          aria-label={zh ? "调整预览" : "Change preview"}
          className="mb-6 rounded-xl border border-[var(--amber)] bg-[var(--amber-subtle)] p-5"
        >
          <h2 className="text-sm font-semibold">
            {zh ? "看看这次调整" : "Review these changes"}
          </h2>
          {summary && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
              {summary}
            </p>
          )}
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {differences.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="amber"
              onClick={() => {
                setSpec(preview.spec);
                setPreview(undefined);
                setNotice(
                  zh
                    ? "已应用到草稿。满意后保存，成为默认页面。"
                    : "Applied to your draft. Save to keep this layout.",
                );
              }}
            >
              <Check size={14} />
              {zh ? "应用调整" : "Apply changes"}
            </Button>
            <Button variant="outline" onClick={() => setPreview(undefined)}>
              {zh ? "保持原样" : "Keep original"}
            </Button>
          </div>
        </section>
      )}
      <div
        className={`grid min-w-0 gap-6 ${settings ? "xl:grid-cols-[300px_minmax(0,1fr)]" : ""}`}
      >
        {settings && (
          <aside
            aria-label={zh ? "页面设置" : "Page settings"}
            className="min-w-0 rounded-xl border border-border p-4"
          >
            <PageInspector
              spec={spec}
              sources={sources}
              selectedId={selectedId}
              change={change}
              select={setSelectedId}
              locale={locale}
              disabled={generating || saving || !!preview}
            />
            {dirty && (
              <Button
                className="mt-5"
                variant="ghost"
                size="sm"
                disabled={generating || saving}
                onClick={() => {
                  clearPageDraft(rootId, pageId);
                  const current =
                    incoming?.page &&
                    incoming.page.version > (saved?.version ?? 0)
                      ? incoming.page
                      : saved;
                  setSaved(current);
                  setSpec(current?.spec ?? blankPage(locale));
                  setBaseVersion(current?.version ?? 0);
                  setPreview(undefined);
                  setNotice(
                    zh ? "已恢复保存的布局。" : "Saved layout restored.",
                  );
                }}
              >
                {zh ? "放弃未保存调整" : "Discard unsaved changes"}
              </Button>
            )}
          </aside>
        )}
        <div className="min-w-0">
          {data.error && !preview && (
            <div
              role="alert"
              className="mb-4 flex flex-wrap items-center gap-2 text-sm text-error"
            >
              {zh
                ? "部分配置暂时无法预览，请检查资料来源或重试。"
                : "This configuration could not be previewed. Check its sources or retry."}
              <Button variant="ghost" size="sm" onClick={data.refresh}>
                {zh ? "重试" : "Retry"}
              </Button>
            </div>
          )}
          {data.loading && !visibleData && (
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              {zh ? "正在读取真实资料…" : "Loading live data…"}
            </p>
          )}
          <PageCanvas
            key={rootId}
            rootId={rootId}
            sources={sources}
            spec={visibleSpec}
            blocks={visibleData?.blocks ?? []}
            locale={locale}
            selectedId={selectedId}
            onAdjust={
              generating || saving || preview
                ? undefined
                : (id) => {
                    setSelectedId(id);
                    setSettings(false);
                    setAiExpanded(true);
                  }
            }
            onSelect={
              generating || saving || preview
                ? undefined
                : (id) => {
                    setSelectedId(id);
                    setSettings(true);
                  }
            }
            refresh={data.refresh}
            preview={!!preview}
          />
        </div>
      </div>
    </>
  );
}
