"use client";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { ArrowRight, LayoutDashboard, Plus } from "lucide-react";
import { useLocale } from "@/lib/stores/locale-store";
import { useViewResource } from "@/lib/views/hooks";
import { pageRequest, type PageIndex } from "@/lib/views/page-api";
import { subscribeFilesChanged } from "@/lib/files-changed";
import { subscribeServerEvents } from "@/lib/server-events";
import { StudioShell } from "../StudioShell";
import { Button } from "@/components/ui/button";
export function PagesLibrarySection({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { locale } = useLocale(),
    zh = locale === "zh";
  const read = useCallback(
    (signal: AbortSignal) => pageRequest<PageIndex>("page.list", {}, signal),
    [],
  );
  const result = useViewResource(read);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(result.refresh, 100);
    };
    const stops = [
      subscribeFilesChanged(refresh),
      subscribeServerEvents("views.changed", refresh),
      subscribeServerEvents("ready", refresh),
    ];
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      window.removeEventListener("focus", refresh);
    };
  }, [result.refresh]);
  const pages = result.data?.pages ?? [];
  return (
    <section
      className={compact ? "mb-8 border-b border-border pb-7" : ""}
      aria-label={zh ? "我的工作页面" : "My pages"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {zh ? "我的工作页面" : "My pages"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {zh
              ? "把人物、任务和笔记放在一起，按你的工作方式组织。"
              : "Bring people, tasks and notes together, your way."}
          </p>
        </div>
        <Link
          href="/studio/pages/new"
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus size={14} aria-hidden />
          {zh ? "创建工作页面" : "Create a page"}
        </Link>
      </div>
      {result.loading && !result.data && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {zh ? "正在读取页面…" : "Loading pages…"}
        </p>
      )}
      {result.error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-2 text-sm text-error"
        >
          {zh ? "暂时无法读取工作页面。" : "Pages could not be loaded."}
          <Button variant="ghost" onClick={result.refresh}>
            {zh ? "重试" : "Retry"}
          </Button>
        </div>
      )}
      {!!pages.length && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {pages.map((page) => (
            <Link
              key={page.id}
              href={"/studio/pages/" + page.id}
              className="group flex min-w-0 items-start gap-3 rounded-lg border border-border p-4 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LayoutDashboard
                size={18}
                aria-hidden
                className="mt-0.5 shrink-0 text-[var(--amber)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {page.spec.title}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {page.spec.description ||
                    (zh
                      ? `${page.spec.blocks.length} 个模块 · 已保留的工作页面`
                      : `${page.spec.blocks.length} blocks · Saved page`)}
                </span>
              </span>
              <ArrowRight
                size={15}
                aria-hidden
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
            </Link>
          ))}
        </div>
      )}
      {!compact && result.data && !pages.length && (
        <div className="mt-8 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <LayoutDashboard
            size={28}
            aria-hidden
            className="mx-auto text-muted-foreground"
          />
          <h3 className="mt-4 font-medium">
            {zh
              ? "从一个真实的工作场景开始"
              : "Start with something you work on"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">
            {zh
              ? "创建每日推进、项目复盘或会前准备页。先预览，喜欢了再保留；原资料始终在原处。"
              : "Create a daily focus, project review or meeting page. Preview first, then keep it. Your source records stay in place."}
          </p>
        </div>
      )}
    </section>
  );
}
export default function PagesLibrary() {
  const { locale } = useLocale(),
    zh = locale === "zh";
  return (
    <StudioShell>
      <div className="mx-auto w-full max-w-5xl pb-12">
        <Link
          href="/studio/views"
          className="text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {zh ? "视图" : "Views"}
        </Link>
        <h1 className="mb-3 mt-4 text-3xl font-semibold tracking-tight">
          {zh ? "为你的工作留一个位置" : "A place for your work"}
        </h1>
        <p className="mb-8 max-w-xl text-sm leading-7 text-muted-foreground">
          {zh
            ? "从已有资料搭建页面，用一句话继续调整。页面会保留，资料会持续更新。"
            : "Build from your existing knowledge, then refine it in your own words. Keep the page as its data evolves."}
        </p>
        <PagesLibrarySection />
      </div>
    </StudioShell>
  );
}
