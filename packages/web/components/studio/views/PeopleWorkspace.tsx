'use client';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Search,
  Settings2,
  Users,
  Plus,
  Pencil,
  CalendarDays,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import {
  getView,
  getViewPerson,
  getViewRaw,
  VIEWS_UPDATED,
  type PersonDocument,
} from '@/lib/views/api';
import { useViewResource, useViewsIndex } from '@/lib/views/hooks';
import { type ViewsCopy, viewsCopy } from '@/lib/views/copy';
import { subscribeFilesChanged } from '@/lib/files-changed';
import { encodePath } from '@/lib/utils';
import { StudioShell } from '../StudioShell';
import { fieldClass, FolderCaption, ViewNotice } from './ViewPrimitives';
import PersonEditor from './PersonEditor';
import MeetingPanel from './MeetingPanel';
import ManageDialog from './ManageDialog';

function SourceFiles({
  rootId,
  viewId,
  files,
  c,
}: {
  rootId: string;
  viewId: string;
  files: Array<{ path: string; name: string }>;
  c: ViewsCopy;
}) {
  const [path, setPath] = useState('');
  const read = useCallback(
    (signal: AbortSignal) => getViewRaw(rootId, viewId, path, signal),
    [rootId, viewId, path],
  );
  const raw = useViewResource(read, !!path);
  return (
    <div className="grid min-h-96 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label={c.file}
        className="space-y-1 border-border md:border-r md:pr-4"
      >
        {files.length ? (
          files.map((f) => (
            <button
              key={f.path}
              type="button"
              aria-current={path === f.path ? 'true' : undefined}
              className={`flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring ${path === f.path ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/40'}`}
              onClick={() => setPath(f.path)}
            >
              <FileText size={14} className="shrink-0" aria-hidden />
              <span className="truncate" title={f.path}>
                {f.name}
              </span>
            </button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{c.fileEmpty}</p>
        )}
      </nav>
      <section className="min-w-0">
        <ViewNotice
          c={c}
          loading={raw.loading}
          error={raw.error}
          retry={raw.refresh}
        />
        {path && raw.data?.path === path && !raw.loading && !raw.error ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <FolderCaption path={path} />
              <Button
                variant="outline"
                render={<Link href={`/view/${encodePath(path)}`} />}
                nativeButton={false}
              >
                {c.openEditor}
                <ArrowUpRight size={14} aria-hidden />
              </Button>
            </div>
            <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/15 p-4 font-mono text-xs leading-6">
              {raw.data.content}
            </pre>
          </>
        ) : (
          !path && (
            <p className="py-10 text-sm text-muted-foreground">
              {c.chooseFile}
            </p>
          )
        )}
      </section>
    </div>
  );
}

export default function PeopleWorkspace({
  viewId, toolbar, description, projection,
}: {
  viewId: string;
  toolbar?: ReactNode;
  description?: string;
  projection?: { rootId: string; recordIds: string[] };
}) {
  const { locale } = useLocale();
  const c = viewsCopy(locale);
  const router = useRouter();
  const push = useSmoothRouterPush();
  const params = useSearchParams();
  const index = useViewsIndex();
  const rootId = index.data?.rootId ?? '';
  const [mode, setMode] = useState('people');
  const [search, setSearch] = useState('');
  const [manage, setManage] = useState(false);
  const [meeting, setMeeting] = useState(false);
  const [editor, setEditor] = useState<
    'new' | 'person' | 'interaction' | 'followup'
  >();
  const [notice, setNotice] = useState('');
  const read = useCallback(
    (signal: AbortSignal) => getView(rootId, viewId, signal),
    [rootId, viewId],
  );
  const collection = useViewResource(read, !!rootId && !index.error);
  const rawData =
    collection.data?.view.id === viewId && collection.data.rootId === rootId
      ? collection.data
      : undefined;
  const peopleById = new Map(rawData?.people.map(person => [person.id, person]));
  const data = rawData && (!projection || projection.rootId === rootId)
    ? {
        ...rawData,
        people: projection
          ? projection.recordIds.flatMap(id => {
              const person = peopleById.get(id);
              return person ? [person] : [];
            })
          : rawData.people,
      }
    : undefined;
  const view = data?.view ?? index.data?.views.find((v) => v.id === viewId);
  const personQuery = params.get('person');
  const summary = personQuery
    ? data?.people.find((p) => p.id === personQuery)
    : data?.people[0];
  const readPerson = useCallback(
    (signal: AbortSignal) =>
      getViewPerson(rootId, viewId, summary!.id, summary!.path, signal),
    [rootId, viewId, summary?.id, summary?.path, summary?.revision],
  );
  const detail = useViewResource(
    readPerson,
    !!summary && !collection.error && mode === 'people',
  );
  const person =
    detail.data &&
    detail.data.person.id === summary?.id &&
    detail.data.rootId === rootId
      ? detail.data.person
      : undefined;
  useEffect(() => {
    if (!rootId) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(collection.refresh, 100);
    };
    const stop = subscribeFilesChanged(refresh);
    window.addEventListener(VIEWS_UPDATED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      stop();
      window.removeEventListener(VIEWS_UPDATED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [rootId, collection.refresh]);
  useEffect(() => {
    setMeeting(false);
    setEditor(undefined);
    setNotice('');
  }, [rootId, personQuery]);
  useEffect(() => {
    if (
      !person ||
      (!personQuery && !window.matchMedia('(min-width: 768px)').matches)
    )
      return;
    // Remembering is metadata only. Do not trigger refresh loops through the mutation event.
    const controller = new AbortController();
    void fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        op: 'remember',
        id: viewId,
        personId: person.id,
        path: person.path,
        expectedRootId: rootId,
      }),
    }).catch(() => {});
    return () => controller.abort();
  }, [person?.id, rootId, viewId, personQuery]);
  const select = (id?: string) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('person', id);
    else next.delete('person');
    router.replace(
      `/studio/views/${encodeURIComponent(viewId)}${next.size ? '?' + next : ''}`,
      { scroll: false },
    );
    setNotice('');
  };
  const saved = (p: PersonDocument) => {
    collection.refresh();
    detail.refresh();
    index.refresh();
    select(p.id);
    setNotice(c.saved);
  };
  const filtered =
    data?.people.filter((p) =>
      `${p.name} ${p.background} ${p.focus}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <StudioShell contentMaxWidth="full">
      <div className="mx-auto w-full max-w-6xl pb-10">
        <Link
          href="/studio/views"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={13} aria-hidden />
          {c.backViews}
        </Link>
        <header className="my-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted-foreground">{c.peopleView}</p>
            <h1
              tabIndex={-1}
              className="break-words text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {view?.name ?? c.title}
            </h1>
            {description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
            )}
            {view && (
              <div className="mt-3">
                <FolderCaption path={view.folder} />
              </div>
            )}
          </div>
          {view && (
            <div className="flex items-center gap-2 self-end">
              <Button
                variant="ghost"
                size="icon"
                aria-label={c.manage}
                onClick={() => setManage(true)}
              >
                <Settings2 size={17} aria-hidden />
              </Button>
              <Button
                variant="amber"
                disabled={!data || !!collection.error || !!index.error}
                onClick={() => setEditor('new')}
              >
                <Plus size={15} aria-hidden />
                {c.newPerson}
              </Button>
            </div>
          )}
        </header>
        {toolbar && <div className="mb-5">{toolbar}</div>}
        <ViewNotice
          c={c}
          loading={!data && (index.loading || collection.loading)}
          error={index.error || collection.error}
          retry={() => {
            index.refresh();
            collection.refresh();
          }}
        />
        {view && collection.error === 'FOLDER_MISSING' && (
          <Button variant="outline" onClick={() => setManage(true)}>
            {c.repair}
          </Button>
        )}
        {data && !collection.error && !index.error && (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              {toolbar ? (
                <Button variant="ghost" size="sm" onClick={() => setMode(mode === 'people' ? 'files' : 'people')}>
                  {mode === 'people' ? <FileText size={14} aria-hidden /> : <ArrowLeft size={14} aria-hidden />}
                  {mode === 'people' ? c.file : c.backPeople}
                </Button>
              ) : <div
                className="inline-flex gap-1 rounded-lg bg-muted/50 p-1"
                role="group"
                aria-label={view?.name}
              >
                {['people', 'files'].map((m) => (
                  <Button
                    key={m}
                    variant="ghost"
                    size="sm"
                    aria-pressed={mode === m}
                    className={
                      mode === m
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground'
                    }
                    onClick={() => setMode(m)}
                  >
                    {m === 'people' ? c.peopleView : c.file}
                  </Button>
                ))}
              </div>}
              <a
                href={`/api/views?op=csv&rootId=${encodeURIComponent(rootId)}&id=${encodeURIComponent(viewId)}`}
                download="people.csv"
                title={c.csvHint}
                aria-disabled={
                  data.limited || !!data.skipped || !data.people.length
                }
                onClick={(e) => {
                  if (data.limited || !!data.skipped || !data.people.length)
                    e.preventDefault();
                }}
                className={`rounded-md text-xs underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring ${data.limited || !!data.skipped || !data.people.length ? 'pointer-events-none text-muted-foreground/50' : 'text-muted-foreground hover:text-foreground hover:underline'}`}
              >
                {c.exportCsv}
              </a>
            </div>
            {!!(data.skipped || data.limited) && (
              <p
                role="status"
                className="mb-4 text-xs leading-5 text-muted-foreground"
              >
                {c.limited}
              </p>
            )}
            {notice && (
              <p role="status" className="mb-3 text-xs text-success">
                {notice}
              </p>
            )}
            {mode === 'files' ? (
              <SourceFiles
                rootId={rootId}
                viewId={viewId}
                files={data.files}
                c={c}
              />
            ) : !data.people.length ? (
              <section className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-border px-5 py-12 text-center">
                <Users
                  size={26}
                  className="mb-4 text-muted-foreground"
                  aria-hidden
                />
                <h2 className="text-xl font-semibold">{c.newPersonTitle}</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  {data.files.length > 2 ? c.noRecognized : c.newPersonBody}
                </p>
                <Button
                  variant="amber"
                  className="mt-5"
                  onClick={() => setEditor('new')}
                >
                  {c.newPerson}
                  <Plus size={15} aria-hidden />
                </Button>
                {data.files.length > 0 && (
                  <Button
                    variant="ghost"
                    className="mt-2"
                    onClick={() => setMode('files')}
                  >
                    {c.file} · {data.files.length}
                  </Button>
                )}
              </section>
            ) : (
              <div className="grid min-h-[520px] gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
                <aside
                  className={`${personQuery ? 'hidden md:block' : ''} min-w-0 border-border md:border-r md:pr-4`}
                >
                  <div className="relative mb-4">
                    <Search
                      size={14}
                      className="absolute left-3 top-3 text-muted-foreground"
                      aria-hidden
                    />
                    <input
                      className={`${fieldClass} pl-9`}
                      aria-label={c.searchPeople}
                      placeholder={c.searchPeople}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="mb-2 flex items-center justify-between px-2 text-xs text-muted-foreground">
                    <span>{c.contacts}</span>
                    <span className="font-mono">{data.people.length}</span>
                  </div>
                  <nav aria-label={c.contacts} className="space-y-1">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-current={summary?.id === p.id ? 'true' : undefined}
                        className={`flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring ${summary?.id === p.id ? 'bg-[var(--amber-subtle)]' : 'hover:bg-muted/40'}`}
                        onClick={() => select(p.id)}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs text-muted-foreground"
                          aria-hidden
                        >
                          {Array.from(p.name)[0]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {p.name}
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {p.followup.text || p.focus || p.background}
                          </span>
                        </span>
                        <ChevronRight
                          size={12}
                          className="shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </button>
                    ))}
                    {!filtered.length && (
                      <p className="px-2 py-6 text-sm text-muted-foreground">
                        {c.noPeople}
                      </p>
                    )}
                  </nav>
                </aside>
                <section
                  className={`${personQuery ? '' : 'hidden md:block'} min-w-0`}
                  aria-label={c.contacts}
                >
                  <Button
                    variant="ghost"
                    className="mb-4 px-0 md:hidden"
                    onClick={() => select()}
                  >
                    <ArrowLeft size={14} aria-hidden />
                    {c.backPeople}
                  </Button>
                  {personQuery && !summary ? (
                    <>
                      <ViewNotice c={c} error="PERSON_MISSING" />
                      <Button variant="outline" onClick={() => select()}>
                        {c.backPeople}
                      </Button>
                    </>
                  ) : (
                    <>
                      <ViewNotice
                        c={c}
                        loading={detail.loading}
                        error={detail.error}
                        retry={detail.refresh}
                      />
                      {person && !detail.loading && !detail.error && (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h2 className="break-words text-2xl font-semibold">
                                {person.name}
                              </h2>
                              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                                {person.focus}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                onClick={() => setEditor('person')}
                              >
                                <Pencil size={13} aria-hidden />
                                {c.editPerson}
                              </Button>
                              <Button
                                variant="amber"
                                onClick={() => setMeeting(true)}
                              >
                                {c.prepare}
                                <ArrowUpRight size={14} aria-hidden />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-6 border-y border-border bg-muted/15 px-4 py-4">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="flex items-center gap-2 text-sm font-semibold">
                                <CalendarDays
                                  size={15}
                                  aria-hidden
                                  className="text-[var(--amber)]"
                                />
                                {c.followup}
                              </h3>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditor('followup')}
                              >
                                {person.followup.text
                                  ? c.editFollowup
                                  : c.planFollowup}
                              </Button>
                            </div>
                            <p
                              className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${person.followup.completed ? 'text-muted-foreground line-through' : ''}`}
                            >
                              {person.followup.text || c.noPlan}
                            </p>
                            {(person.followup.date ||
                              person.followup.completed) && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {person.followup.date}
                                {person.followup.completed
                                  ? ` · ${c.completed}`
                                  : ''}
                              </p>
                            )}
                          </div>
                          <section className="mt-6">
                            <h3 className="text-xs font-semibold text-muted-foreground">
                              {c.background}
                            </h3>
                            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
                              {person.background || '—'}
                            </p>
                          </section>
                          <section className="mt-7">
                            <div className="mb-4 flex items-center justify-between gap-2">
                              <h3 className="text-sm font-semibold">
                                {c.interactions}{' '}
                                <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">
                                  {person.interactionCount}
                                </span>
                              </h3>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditor('interaction')}
                              >
                                <Plus size={13} aria-hidden />
                                {c.addInteraction}
                              </Button>
                            </div>
                            {!person.interactions.length ? (
                              <p className="py-4 text-sm leading-6 text-muted-foreground">
                                {c.noInteractions}
                              </p>
                            ) : (
                              <ol className="space-y-5">
                                {person.interactions.map((i) => (
                                  <li
                                    key={i.id}
                                    className="border-l-2 border-border pl-4"
                                  >
                                    <time className="font-mono text-xs text-muted-foreground">
                                      {i.date}
                                    </time>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-7">
                                      {i.text}
                                    </p>
                                    {i.source && (
                                      <p className="mt-2 break-words text-xs text-muted-foreground">
                                        {c.source} · {i.source}
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </section>
                          {!!person.sources && (
                            <section className="mt-7">
                              <h3 className="text-xs font-semibold text-muted-foreground">
                                {c.source}
                              </h3>
                              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                                {person.sources}
                              </p>
                            </section>
                          )}
                          <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                            <FolderCaption path={person.path} />
                            <Button
                              variant="ghost"
                              size="sm"
                              render={
                                <Link
                                  href={`/view/${encodePath(person.path)}`}
                                />
                              }
                              nativeButton={false}
                            >
                              <FileText size={13} aria-hidden />
                              {c.rawFile}
                              <ArrowUpRight size={13} aria-hidden />
                            </Button>
                          </footer>
                        </>
                      )}
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
        {manage && view && (
          <ManageDialog
            view={view}
            rootId={rootId}
            c={c}
            close={() => setManage(false)}
            changed={(removed) => {
              if (removed) push('/studio/views');
              else {
                collection.refresh();
                index.refresh();
              }
            }}
          />
        )}
        {editor && data && (editor === 'new' || person) && (
          <PersonEditor
            key={`${rootId}:${viewId}:${person?.id ?? 'new'}:${editor}`}
            rootId={rootId}
            viewId={viewId}
            person={editor === 'new' ? undefined : person}
            kind={editor}
            c={c}
            close={() => setEditor(undefined)}
            saved={saved}
          />
        )}
        {meeting && person && (
          <MeetingPanel
            key={`${rootId}:${person.id}`}
            rootId={rootId}
            viewId={viewId}
            person={person}
            locale={locale}
            c={c}
            close={() => setMeeting(false)}
          />
        )}
      </div>
    </StudioShell>
  );
}
