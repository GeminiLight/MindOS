'use client';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Search, Settings2, Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { viewsCopy } from '@/lib/views/copy';
import { type ViewSummary } from '@/lib/views/api';
import { useViewsIndex, viewHref } from '@/lib/views/hooks';
import { StudioShell } from '../StudioShell';
import { fieldClass, FolderCaption, ViewNotice } from './ViewPrimitives';
import TemplateDialog from './TemplateDialog';
import TaskTemplateButton from './TaskTemplateButton';
import ManageDialog from './ManageDialog';

export default function ViewsIndex() {
  const { locale } = useLocale();
  const push = useSmoothRouterPush();
  const c = viewsCopy(locale);
  const index = useViewsIndex();
  const [search, setSearch] = useState('');
  const [template, setTemplate] = useState(false);
  const [managing, setManaging] = useState<ViewSummary>();
  const views = index.data?.views ?? [];
  const recent = views
    .filter((v) => v.availability === 'ready' && v.lastOpenedAt)
    .sort((a, b) =>
      (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''),
    )[0];
  const filtered = views.filter((v) =>
    `${v.name} ${v.folder}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
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
            <h1 tabIndex={-1} className="font-display text-3xl tracking-tight">
              {c.title}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {c.subtitle}
            </p>
          </div>
          {!!views.length && (
            <Button
              variant="amber"
              disabled={!index.data || !!index.error}
              onClick={() => setTemplate(true)}
            >
              <Plus size={15} aria-hidden />
              {c.template}
            </Button>
          )}
        </header>
        {index.data && <div className="mb-5"><TaskTemplateButton rootId={index.data.rootId} locale={locale}/></div>}
        <ViewNotice
          c={c}
          loading={!index.data && index.loading}
          error={index.error}
          retry={index.refresh}
        />
        {index.data && !index.error && (
          <>
            {recent && (
              <section className="mb-8 border-y border-border py-5">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  {c.continueLabel}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold">{recent.name}</h2>
                    <div className="mt-2">
                      <FolderCaption path={recent.folder} />
                    </div>
                    {recent.lastPersonName && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {c.lastPerson} · {recent.lastPersonName}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    render={
                      <Link
                        href={viewHref(recent)}
                        aria-label={`${c.continue}${recent.name}`}
                      />
                    }
                    nativeButton={false}
                  >
                    {c.continue}
                    <ArrowRight size={15} aria-hidden />
                  </Button>
                </div>
              </section>
            )}
            {views.length ? (
              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-sm font-semibold">
                    {c.allViews}{' '}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {views.length}
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
                <div className="divide-y divide-border border-y border-border">
                  {filtered.map((v) => (
                    <div
                      key={v.id}
                      className="flex min-w-0 items-center gap-3 py-4"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Users size={18} aria-hidden />
                      </span>
                      <Link
                        href={viewHref(v)}
                        className="group min-w-0 flex-1 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block truncate text-sm font-medium group-hover:text-[var(--amber)]">
                          {v.name}
                        </span>
                        <span className="mt-1 block">
                          <FolderCaption path={v.folder} />
                        </span>
                      </Link>
                      {v.availability !== 'ready' ? (
                        <Button
                          variant="outline"
                          onClick={() => setManaging(v)}
                        >
                          {c.repair}
                        </Button>
                      ) : (
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {v.template === 'tasks' ? (locale === 'zh' ? '项目待办' : 'Project tasks') : c.peopleTemplate}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${c.manage} · ${v.name}`}
                        onClick={() => setManaging(v)}
                      >
                        <Settings2 size={16} aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
                {!filtered.length && (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    <p>{c.noResults}</p>
                    <Button variant="ghost" onClick={() => setSearch('')}>
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
                <div className="self-center rounded-lg border border-border bg-muted/20 p-5">
                  <p className="text-xs text-muted-foreground">
                    {c.peopleTemplate}
                  </p>
                  <p className="my-3 font-medium leading-6">{c.recordFields}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {c.linkedFolder}
                  </p>
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
