'use client';
import { useEchoDraft, readEchoDraft } from '../use-echo-draft';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type {
  Inquiry,
  InquiryDraft,
  InquiryRun,
} from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { NarrowPageShell } from '@/components/shared/ContentPageShell';
import { useLocale } from '@/lib/stores/locale-store';
import { openAskModal } from '@/hooks/useAskModal';
import { InquiryMethods } from './InquiryMethods';
import { inquiryCopy } from './inquiry-copy';
import { INQUIRY_UPDATED } from './inquiry-events';
import { InquiryFields, note } from './InquiryFields';
import { InquiryActionForm, type InquiryFormKind } from './InquiryActionForm';
type Summary = {
  id: string;
  title: string;
  updatedAt: string;
  archived: boolean;
};
type Payload = {
  inquiry?: Inquiry;
  inquiries?: Summary[];
  runs?: InquiryRun[];
  unavailableCount?: number;
  draft?: { prompt: string; attachedFiles?: string[] };
  code?: string;
};
export function InquiryWorkspace({
  locale,
  inquiryId,
}: {
  locale: 'en' | 'zh';
  inquiryId?: string | null;
}) {
  const p = inquiryCopy[locale];
  const [q, setQ] = useState<Inquiry | null>(null);
  const [draft, setDraft] = useEchoDraft<InquiryDraft | null>(`inquiry:${inquiryId}:draft`, null);
  const [draftVersion, setDraftVersion] = useEchoDraft(`inquiry:${inquiryId}:version`, 0);
  const [runs, setRuns] = useState<InquiryRun[]>([]);
  const [list, setList] = useState<Summary[]>([]);
  const [unavailable, setUnavailable] = useState(0);
  const [form, setForm] = useEchoDraft<InquiryFormKind | null>(`inquiry:${inquiryId}:form`, null);
  const [values, setValues] = useEchoDraft<Record<string, string>>(`inquiry:${inquiryId}:values`, {});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [missingDecision, setMissingDecision] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const draftEditor = useRef<HTMLFieldSetElement>(null);
  const formOpener = useRef<HTMLElement | null>(null);
  const reviewToFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!form && !busy && formOpener.current) {
      if (formOpener.current.isConnected) formOpener.current.focus();
      formOpener.current = null;
    }
  }, [form, busy]);
  const hasDraft = !!q?.draft;
  useEffect(() => {
    if (hasDraft) draftEditor.current?.querySelector('textarea')?.focus();
  }, [hasDraft]);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(q?.draft ?? null) ||
    (!!form &&
      Object.keys(values).some(
        (k) => !['kind', 'outcome', 'decisionId'].includes(k) && !!values[k],
      ));
  const guarded = dirty || busy || !!pending;
  useEffect(() => {
    if (!guarded) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const link = (e: MouseEvent) => {
      const target = (e.target as Element).closest?.(
        'a[href]',
      ) as HTMLAnchorElement | null;
      if (
        target &&
        !e.defaultPrevented &&
        target.target !== '_blank' &&
        !window.confirm(p.leave)
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('click', link, true);
    return () => {
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('click', link, true);
    };
  }, [guarded, p.leave]);
  async function send(body?: Record<string, unknown>) {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const op = ++operation.current;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const id =
        inquiryId === undefined
          ? new URLSearchParams(window.location.search).get('inquiry')
          : inquiryId;
      const response = await fetch(
        '/api/echo/inquiries' +
          (!body && id ? '?id=' + encodeURIComponent(id) : ''),
        {
          method: body ? 'PATCH' : 'GET',
          cache: 'no-store',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
          ...(body
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }
            : {}),
        },
      );
      const data = (await response.json()) as Payload;
      if (abort.signal.aborted || op !== operation.current) return;
      if (!response.ok) {
        setError(data.code ?? 'storage');
        return;
      }
      if (data.inquiry) {
        if (
          body &&
          ['method-draft', 'method-revision'].includes(String(body.action))
        ) {
          reviewToFocus.current = String(body.decisionId);
        }
        setQ(data.inquiry);
        setDraft(body ? data.inquiry.draft : readEchoDraft(`inquiry:${inquiryId}:draft`, data.inquiry.draft));
        setDraftVersion(body ? data.inquiry.version : readEchoDraft(`inquiry:${inquiryId}:version`, data.inquiry.version) || data.inquiry.version);
        setRuns(data.runs ?? []);
        if (body) { setForm(null); setValues({}); }
      } else if (!body && Array.isArray(data.inquiries)) {
        setList(data.inquiries);
        setUnavailable(data.unavailableCount ?? 0);
      } else throw new Error('Missing inquiry');
      setPending(null);
      if (body) window.dispatchEvent(new Event(INQUIRY_UPDATED));
      if (data.draft) {
        openAskModal(data.draft.prompt, 'user', null, {
          newSession: true,
          ...(data.draft.attachedFiles?.[0]
            ? {
                context: {
                  path: data.draft.attachedFiles[0],
                  type: 'file' as const,
                  label: p.approvedVersion,
                },
              }
            : {}),
        });
        setStatus(p.prepared);
      } else if (body) setStatus(p.saved);
    } catch {
      if (!abort.signal.aborted && op === operation.current)
        setError('storage');
    } finally {
      if (controller.current === abort) controller.current = null;
      if (!abort.signal.aborted && op === operation.current) {
        setBusy(false);
        setLoaded(true);
      }
    }
  }
  useEffect(() => {
    void send();
    return () => {
      ++operation.current;
      controller.current?.abort();
      controller.current = null;
    };
  }, []); // Initial identity comes from this page's URL.
  function mutate(command: Record<string, unknown>) {
    if (!q || busy || pending) return;
    if (command.action === 'save-draft')
      formOpener.current = document.activeElement as HTMLElement | null;
    const body = {
      id: q.id,
      version: draftVersion || q.version,
      requestId: crypto.randomUUID(),
      ...command,
    };
    setPending(body);
    void send(body);
  }
  function reload() {
    if (!guarded || window.confirm(p.leave)) {
      void send();
    }
  }
  function openForm(
    kind: InquiryFormKind,
    initial: Record<string, string> = {},
  ) {
    if (busy || pending || (dirty && !window.confirm(p.leave))) return;
    formOpener.current = document.activeElement as HTMLElement | null;
    setForm(kind);
    setValues(
      kind === 'observe'
        ? { kind: 'manual', outcome: 'uncertain' }
        : kind === 'decide'
          ? { outcome: 'open' }
          : initial,
    );
    setStatus('');
  }
  function closeForm() {
    if (!dirty || window.confirm(p.leave)) {
      setForm(null);
      setValues({});
    }
  }
  const loadedInquiryId = q?.id;
  useEffect(() => {
    const locate = () => {
      const hash = window.location.hash;
      const isDecision = /^#decision-[1-9][0-9]{0,2}$/.test(hash);
      const target = loadedInquiryId && isDecision ? document.getElementById(hash.slice(1)) : null;
      setMissingDecision(!!loadedInquiryId && isDecision && !target);
      if (!target) { heading.current?.focus(); return; }
      // History is collapsed by default. Open its ancestors before moving focus/scroll.
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'center' });
    };
    locate();
    window.addEventListener('hashchange', locate);
    return () => window.removeEventListener('hashchange', locate);
  }, [loadedInquiryId]);
  const frame = q?.frames.at(-1);
  const plans = q?.plans.filter((plan) => plan.frameId === frame?.id) ?? [];
  const plan = plans.at(-1);
  const disabled = busy || !!pending;
  const action = (label: string, command: Record<string, unknown>) => (
    <Button
      variant="outline"
      className="min-h-11"
      disabled={disabled || !!form || dirty}
      onClick={() => mutate(command)}
    >
      {label}
    </Button>
  );
  return (
    <NarrowPageShell>
      <div className="mx-auto w-full max-w-3xl space-y-7 pb-16 [overflow-wrap:anywhere]">
        <Link
          href="/echo/growth"
          className="inline-flex min-h-11 items-center rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← {p.back}
        </Link>
        <header className="space-y-3">
          <h1
            ref={heading}
            tabIndex={-1}
            className="font-display text-3xl outline-none"
          >
            {p.title}
          </h1>
          <p className={note}>{p.lead}</p>
          <p className={note}>{p.private}</p>
        </header>
        {missingDecision ? <p role="status" className={note}>{p.missingDecision}</p> : null}
        {!loaded ? (
          <p role="status" className={note}>
            {p.loading}
          </p>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-border p-4"
          >
            <div className="flex items-start gap-2">
              <CircleAlert
                size={18}
                className="mt-1 shrink-0 text-error"
                aria-hidden
              />
              <p className="text-sm leading-6 text-foreground">
                {!pending && error === 'storage'
                  ? p.loadError
                  : (p.errors[error as keyof typeof p.errors] ??
                    p.errors.storage)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {pending ? (
                <Button
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => void send(pending)}
                >
                  {p.retry}
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={reload}
              >
                {guarded ? p.discard : p.reload}
              </Button>
            </div>
          </div>
        ) : null}
        {status ? (
          <p role="status" className={note}>
            {status}
          </p>
        ) : null}
        {!q && loaded && !error ? (
          <section className="space-y-3">
            {!list.length ? (
              <p className="rounded-lg border border-dashed border-border p-5 text-sm leading-6">
                {p.empty}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {list.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={'/echo/questions?inquiry=' + item.id}
                      className="block min-h-11 rounded px-4 py-3 text-sm leading-6 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.title}
                      {item.archived ? (
                        <span className="ml-2 text-muted-foreground">
                          {p.archived}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {unavailable ? (
              <p role="alert" className={note}>
                {p.unavailable}
              </p>
            ) : null}
          </section>
        ) : null}
        {q ? (
          <>
            <details className="rounded-lg border border-border px-4">
              <summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {p.source}
              </summary>
              <p className="mb-3 whitespace-pre-wrap text-sm leading-6">
                {q.source.question}
              </p>
              <blockquote className="mb-4 whitespace-pre-wrap break-words border-l-2 border-border pl-4 text-sm leading-6 text-muted-foreground">
                {q.source.quote}
              </blockquote>
            </details>
            {q.archived ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className={note}>{p.archived}</p>
                {action(p.restore, { action: 'archive', archived: false })}
              </div>
            ) : null}
            {draft ? (
              <section className="space-y-4">
                <h2 className="font-display text-xl">{p.frameTitle}</h2>
                <p className={note}>{p.frameHint}</p>
                <fieldset
                  ref={draftEditor}
                  disabled={disabled || q.archived}
                  className="space-y-4"
                >
                  <InquiryFields
                    names={[
                      'question',
                      'explanationA',
                      'explanationB',
                      'distinction',
                      'capability',
                    ]}
                    value={draft}
                    onChange={(v) => setDraft(v as InquiryDraft)}
                    p={p}
                    optional
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11"
                      onClick={() => mutate({ action: 'save-draft', draft })}
                    >
                      {p.save}
                    </Button>
                    <Button
                      className="min-h-11"
                      variant="outline"
                      disabled={
                        dirty ||
                        Object.values(draft).some((v) => !v.trim()) ||
                        draft.explanationA.trim() === draft.explanationB.trim()
                      }
                      onClick={() => mutate({ action: 'commit-frame' })}
                    >
                      {p.commit}
                    </Button>
                  </div>
                  {dirty ? <p className={note}>{p.saveFirst}</p> : null}
                </fieldset>
              </section>
            ) : frame ? (
              <section className="space-y-4">
                <div>
                  <p className={note}>
                    {p.committed} · {q.frames.length}
                  </p>
                  <h2 className="mt-2 whitespace-pre-wrap break-words font-display text-xl">
                    {frame.question}
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['explanationA', 'explanationB'] as const).map((key) => (
                    <div
                      key={key}
                      className="space-y-2 rounded-lg bg-muted/30 p-4"
                    >
                      <h3 className="text-sm font-medium">{p[key]}</h3>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">
                        {frame[key]}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  <span className="font-medium">{p.distinction}</span>
                  <br />
                  {frame.distinction}
                </p>
                {!q.archived ? (
                  <div className="flex flex-wrap gap-2">
                    {action(p.challenge, {
                      action: 'prepare',
                      kind: 'challenge',
                      frameId: frame.id,
                    })}
                    {action(p.revise, { action: 'revise', frameId: frame.id })}
                    <Button
                      className="min-h-11"
                      disabled={disabled || !!form}
                      onClick={() => openForm('plan')}
                    >
                      {p.planTitle}
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={disabled || !!form}
                      onClick={() => openForm('decide')}
                    >
                      {p.decision}
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {!draft && frame ? (
              <InquiryMethods
                key={frame.id}
                q={q}
                p={p}
                disabled={disabled || !!form}
                onLink={mutate}
              />
            ) : null}
            {!draft && plan ? (
              <section className="space-y-3 border-t border-border pt-5">
                <h2 className="font-display text-xl">{p.planTitle}</h2>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {plan.task}
                </p>
                <p className={note}>
                  {p.methodLinkId}:{' '}
                  {plan.methodLinkId
                    ? q.methodLinks?.find((l) => l.id === plan.methodLinkId)
                        ?.method.behavior
                    : p.noMethod}
                </p>
                <details>
                  <summary className="min-h-11 cursor-pointer rounded py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {p.saved} · {plans.length}
                  </summary>
                  <dl className="space-y-3">
                    {[
                      'supportsA',
                      'supportsB',
                      'inconclusive',
                      'scope',
                      'budget',
                    ].map((k) => (
                      <div key={k}>
                        <dt className="text-sm font-medium">
                          {p[k as 'scope']}
                        </dt>
                        <dd className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                          {plan[k as 'scope']}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
                {!q.archived ? (
                  <div className="flex flex-wrap gap-2">
                    {action(p.test, {
                      action: 'prepare',
                      kind: 'test',
                      planId: plan.id,
                    })}
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={disabled || !!form}
                      onClick={() => openForm('observe')}
                    >
                      {p.observe}
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {form && !q.archived ? (
              <InquiryActionForm
                kind={form}
                q={q}
                runs={runs}
                values={values}
                change={setValues}
                busy={disabled}
                p={p}
                submit={mutate}
                close={closeForm}
              />
            ) : null}
            {q.preparations.length ? (
              <section className="space-y-3 border-t border-border pt-5">
                <h2 className="font-display text-xl">{p.runs}</h2>
                {!q.archived ? action(p.readRuns, { action: 'capture' }) : null}
                {!runs.length ? (
                  <p className={note}>{p.noRuns}</p>
                ) : (
                  runs.map((r) => (
                    <details
                      key={r.runId}
                      className="rounded-lg border border-border px-4"
                    >
                      <summary className="min-h-11 cursor-pointer rounded py-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {r.runtimeId} · {p.runStates[r.status]} ·{' '}
                        {new Date(r.startedAt).toLocaleString(locale)}
                      </summary>
                      <pre className="mb-4 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">
                        {r.error || r.output}
                      </pre>
                    </details>
                  ))
                )}
              </section>
            ) : null}
            {q.frames.length ? (
              <section className="space-y-4 border-t border-border pt-5">
                <h2 className="font-display text-xl">{p.history}</h2>
                {q.frames.map((f, i) => (
                  <details
                    key={f.id}
                    className="rounded-lg border border-border px-4"
                    open={i === q.frames.length - 1}
                  >
                    <summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {i + 1}. {f.question}
                    </summary>
                    <div className="space-y-4 pb-4">
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        A: {f.explanationA}
                        <br />
                        B: {f.explanationB}
                      </p>
                      <p className={note}>{f.capability}</p>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {p.distinction}: {f.distinction}
                      </p>
                      {i < q.frames.length - 1 && !draft && !q.archived
                        ? action(p.fromFrame, {
                            action: 'revise',
                            frameId: f.id,
                          })
                        : null}
                      {q.plans
                        .filter((plan) => plan.frameId === f.id)
                        .map((plan) => (
                          <details key={plan.id}>
                            <summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              {p.planTitle} ·{' '}
                              {new Date(plan.createdAt).toLocaleString(locale)}
                            </summary>
                            <dl className="space-y-3">
                              {[
                                'task',
                                'supportsA',
                                'supportsB',
                                'inconclusive',
                                'scope',
                                'budget',
                              ].map((key) => (
                                <div key={key}>
                                  <dt className="text-sm font-medium">
                                    {p[key as 'scope']}
                                  </dt>
                                  <dd className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                    {plan[key as 'scope']}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        ))}
                      {q.observations
                        .filter((o) =>
                          q.plans.some(
                            (p) => p.id === o.planId && p.frameId === f.id,
                          ),
                        )
                        .map((o) => (
                          <blockquote
                            key={o.id}
                            className="space-y-1 border-l-2 border-border pl-3"
                          >
                            <p className={note}>
                              {o.kind === 'manual'
                                ? p.manual + ' · ' + o.sourceLabel
                                : p.actual + ' · ' + o.runId}
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-6">
                              {o.quote}
                            </p>
                            <p className={note}>
                              {p[o.outcome]} · {o.interpretation}
                            </p>
                          </blockquote>
                        ))}
                      {q.decisions
                        .filter((d) => d.frameId === f.id)
                        .map((d) => (
                          <div
                            key={d.id}
                            id={d.id}
                            tabIndex={-1}
                            role="group"
                            aria-label={p.decision}
                            className="scroll-mt-4 space-y-2 rounded-lg bg-muted/30 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <p className="text-sm font-medium">
                              {p[d.outcome]}
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-6">
                              {d.reason}
                            </p>
                            {d.nextQuestion ? (
                              <p className="whitespace-pre-wrap text-sm leading-6">
                                {p.nextQuestion}: {d.nextQuestion}
                              </p>
                            ) : null}
                            {d.methodRevision ? (
                              <p className={note}>
                                {p.pendingRevision} · v
                                {d.methodRevision.revisionIndex + 1}
                              </p>
                            ) : null}
                            {!d.methodDraftId &&
                            d.outcome !== 'open' &&
                            !q.archived &&
                            !draft &&
                            q.methodLinks?.some(
                              (l) => l.frameId === d.frameId,
                            ) ? (
                              <Button
                                variant="outline"
                                className="min-h-11"
                                disabled={disabled || !!form}
                                onClick={() =>
                                  openForm('method-revision', {
                                    decisionId: d.id,
                                  })
                                }
                              >
                                {p.reviseMethod}
                              </Button>
                            ) : null}
                            {d.methodDraftId ? (
                              <Link
                                ref={(node) => {
                                  if (node && reviewToFocus.current === d.id) {
                                    formOpener.current = node;
                                    reviewToFocus.current = null;
                                  }
                                }}
                                href={
                                  '/echo/growth?learning=' + d.methodDraftId
                                }
                                className="inline-flex min-h-11 items-center rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {p.review}
                              </Link>
                            ) : d.outcome !== 'open' &&
                              !q.archived &&
                              !draft ? (
                              <Button
                                variant="outline"
                                className="min-h-11"
                                disabled={disabled || !!form}
                                onClick={() =>
                                  openForm('method-draft', { decisionId: d.id })
                                }
                              >
                                {p.proposal}
                              </Button>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  </details>
                ))}
              </section>
            ) : null}
            {!q.archived ? (
              <div className="border-t border-border pt-4">
                {action(p.archive, { action: 'archive', archived: true })}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </NarrowPageShell>
  );
}
function SelectedQuestion() {
  const { locale } = useLocale();
  const inquiryId = useSearchParams().get('inquiry');
  return (
    <InquiryWorkspace
      key={inquiryId ?? 'list'}
      inquiryId={inquiryId}
      locale={locale}
    />
  );
}
export default function QuestionsPage() {
  return (
    <Suspense>
      <SelectedQuestion />
    </Suspense>
  );
}
