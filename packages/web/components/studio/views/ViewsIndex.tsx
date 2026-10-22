"use client";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Search,
  Settings2,
  Users,
  Plus,
  ListTodo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/stores/locale-store";
import { viewsCopy } from "@/lib/views/copy";
import { type ViewSummary } from "@/lib/views/api";
import { useViewsIndex, viewHref } from "@/lib/views/hooks";
import { StudioShell } from "../StudioShell";
import { fieldClass, FolderCaption, ViewNotice } from "./ViewPrimitives";
import TemplateDialog from "./TemplateDialog";
import TaskTemplateButton from "./TaskTemplateButton";
import ManageDialog from "./ManageDialog";
import { groupViewWorkspaces, layoutLabel } from "@/lib/views/view-workspaces";

export default function ViewsIndex() {
  const { locale } = useLocale();
  const push = useSmoothRouterPush();
  const c = viewsCopy(locale);
  const index = useViewsIndex();
  const [search, setSearch] = useState("");
  const [template, setTemplate] = useState(false);
  const [managing, setManaging] = useState<ViewSummary>();
  const views = index.data?.views ?? [];
  const recent = views
    .filter((v) => v.availability === "ready" && v.lastOpenedAt)
    .sort((a, b) =>
      (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""),
    )[0];
  const workspaces = groupViewWorkspaces(views);
  const filtered = workspaces.filter((group) =>
    group.views.some((v) =>
      `${v.name} ${v.folder}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
    ),
  );
  const zh = locale === "zh";
  return (
    <StudioShell>
      <div className="mx-auto w-full max-w-5xl pb-10">
        <Link
          href="/studio"
          className="text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {c.workbench}
        </Link>
        <header className="mb-8 mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 tabIndex={-1} className="text-3xl font-semibold tracking-tight">
              {c.title}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {zh
                ? "一份资料，一个工作页面。在页面内切换表格、看板和人物详情。"
                : "One workspace per collection. Switch between tables, boards and people details inside."}
            </p>
          </div>
          {!!views.length && index.data && (
            <div className="flex flex-wrap gap-2">
              <TaskTemplateButton rootId={index.data.rootId} locale={locale} />
              <Button
                variant="amber"
                disabled={!index.data || !!index.error}
                onClick={() => setTemplate(true)}
              >
                <Plus size={15} aria-hidden />
                {c.usePeople}
              </Button>
            </div>
          )}
        </header>
        <ViewNotice
          c={c}
          loading={!index.data && index.loading}
          error={index.error}
          retry={index.refresh}
        />
        {index.data && !index.error && (
          <>
            {recent && (
              <Link
                href={viewHref(recent)}
                aria-label={`${c.continue}${recent.name}`}
                className="mb-6 inline-flex items-center gap-2 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {c.continueLabel} · {recent.name}
                <ArrowRight size={14} aria-hidden />
              </Link>
            )}
            {views.length ? (
              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-sm font-semibold">
                    {zh ? "工作页面" : "Workspaces"}{" "}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {workspaces.length}
                    </span>
                  </h2>
                  <div className="relative w-full sm:w-64">
                    <Search
                      size={14}
                      className="absolute left-3 top-3 text-muted-foreground"
                      aria-hidden
                    />
                    <input
                      aria-label={c.searchViews}
                      placeholder={c.searchViews}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className={`${fieldClass} pl-9`}
                    />
                  </div>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  {filtered.map((group) => {
                    const v = group.primary,
                      people = v.template === "people";
                    const Icon = people ? Users : ListTodo;
                    return (
                      <article
                        key={group.id}
                        data-view-workspace={group.id}
                        className="min-w-0 overflow-hidden rounded-xl border border-border bg-background transition-shadow duration-150 hover:shadow-sm"
                      >
                        <Link
                          href={viewHref(group.resume)}
                          className="group block p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <div className="mb-6 flex items-center justify-between">
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--amber-subtle)] text-[var(--amber)]">
                              <Icon size={22} aria-hidden />
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {people
                                ? zh
                                  ? "关系与跟进"
                                  : "People & follow-ups"
                                : zh
                                  ? "计划与进展"
                                  : "Plans & progress"}
                            </span>
                          </div>
                          <h3 className="break-words text-xl font-semibold tracking-tight group-hover:text-[var(--amber)]">
                            {v.name}
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {v.spec?.page?.description ||
                              (people
                                ? zh
                                  ? "记住交流的来龙去脉，把下次跟进安排好。"
                                  : "Keep the context of each conversation and plan the next step."
                                : zh
                                  ? "把下一步落到任务，随时掌握项目进展。"
                                  : "Turn next steps into tasks and see how the project is moving.")}
                          </p>
                          <div
                            aria-hidden
                            className="mt-5 flex gap-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground"
                          >
                            {(people
                              ? [
                                  zh ? "人物档案" : "Profiles",
                                  zh ? "互动记录" : "Conversations",
                                  zh ? "下次跟进" : "Follow-ups",
                                ]
                              : [
                                  zh ? "待办" : "To do",
                                  zh ? "进行中" : "Doing",
                                  zh ? "已完成" : "Done",
                                ]
                            ).map((label) => (
                              <span
                                key={label}
                                className="flex-1 rounded-md border border-border bg-background px-2 py-3 text-center"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium">
                            {zh ? "打开工作页面" : "Open workspace"}
                            <ArrowRight size={15} aria-hidden />
                          </span>
                        </Link>
                        <div className="border-t border-border px-5 py-3">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <FolderCaption path={v.folder} />
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${c.manage} · ${v.name}`}
                              onClick={() => setManaging(v)}
                            >
                              <Settings2 size={16} aria-hidden />
                            </Button>
                          </div>
                          {v.availability !== "ready" && (
                            <Button
                              variant="outline"
                              onClick={() => setManaging(v)}
                            >
                              {c.repair}
                            </Button>
                          )}
                          {group.views.length > 1 && (
                            <details
                              open={!!search || undefined}
                              className="mt-2"
                            >
                              <summary className="cursor-pointer rounded py-1 text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
                                {group.views.length}
                                {zh ? " 种查看方式" : " saved views"}
                              </summary>
                              <ul className="mt-2 space-y-1">
                                {group.views.map((variant) => (
                                  <li
                                    key={variant.id}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <Link
                                      href={viewHref(variant)}
                                      className="min-w-0 flex-1 rounded py-2 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                      {variant.name}
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {layoutLabel(
                                          variant.spec?.layout,
                                          locale,
                                          variant.template,
                                        )}
                                      </span>
                                    </Link>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`${c.manage} · ${variant.name}`}
                                      onClick={() => setManaging(variant)}
                                    >
                                      <Settings2 size={14} aria-hidden />
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {!filtered.length && (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    <p>{c.noResults}</p>
                    <Button variant="ghost" onClick={() => setSearch("")}>
                      {c.clearSearch}
                    </Button>
                  </div>
                )}
              </section>
            ) : (
              <section className="grid gap-8 border-y border-border py-9 sm:grid-cols-[1fr_240px]">
                <div>
                  <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
                    <Users size={22} aria-hidden />
                  </span>
                  <h2 className="text-xl font-semibold">{c.emptyTitle}</h2>
                  <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                    {c.emptyBody}
                  </p>
                  <Button
                    variant="amber"
                    className="mt-6"
                    onClick={() => setTemplate(true)}
                  >
                    {c.usePeople}
                    <ArrowRight size={15} aria-hidden />
                  </Button>
                </div>
                <div className="self-center rounded-xl border border-border bg-muted/20 p-5">
                  <ListTodo
                    size={22}
                    className="mb-4 text-[var(--amber)]"
                    aria-hidden
                  />
                  <h3 className="font-medium">
                    {locale === "zh"
                      ? "推进一个项目"
                      : "Move a project forward"}
                  </h3>
                  <p className="my-3 text-sm leading-6 text-muted-foreground">
                    {locale === "zh"
                      ? "整理下一步、安排日期、关联人物。用表格或看板掌握进展。"
                      : "Plan next steps, set dates and link people. Follow progress in a table or board."}
                  </p>
                  <TaskTemplateButton
                    rootId={index.data.rootId}
                    locale={locale}
                  />
                </div>
              </section>
            )}
          </>
        )}
        {template && index.data && (
          <TemplateDialog
            navigate={push}
            index={index.data}
            c={c}
            close={() => setTemplate(false)}
          />
        )}
        {managing && index.data && (
          <ManageDialog
            view={managing}
            rootId={index.data.rootId}
            c={c}
            close={() => setManaging(undefined)}
            changed={() => index.refresh()}
          />
        )}
      </div>
    </StudioShell>
  );
}
