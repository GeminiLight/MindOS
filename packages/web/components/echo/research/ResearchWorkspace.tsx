'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { StudyAdminView, StudyProtocol, StudySummary } from '@geminilight/mindos/knowledge';
import { Button, buttonVariants } from '@/components/ui/button';
import { NarrowPageShell } from '@/components/shared/ContentPageShell';
import { useLocale } from '@/lib/stores/locale-store';
import { blankStudyProtocol, changeDraft, draftValue, studyFields, type StudyField, type StudyLocale } from './study-draft';
import { studyCopy } from './study-copy';
import { StudyFields, StudyTextField, studyControl, studyNote } from './StudyFields';
import { StudyInvitations } from './StudyInvitations';
import { StudyReviewers } from './StudyReviewers';
import { StudyReview } from './StudyReview';

type Payload = { study?: StudyAdminView; studies?: StudySummary[]; unavailableCount?: number; code?: string };
export function ResearchWorkspace({ locale }: { locale: StudyLocale }) {
  const p = studyCopy[locale];
  const [study, setStudy] = useState<StudyAdminView | null>(null); const [draft, setDraft] = useState<StudyProtocol | null>(null);
  const [studies, setStudies] = useState<StudySummary[]>([]); const [unavailable, setUnavailable] = useState(0);
  const [step, setStep] = useState(0); const [focusPath, setFocusPath] = useState('');
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  const [errorOperation, setErrorOperation] = useState('GET');
  const [reviewedBy, setReviewedBy] = useState(''); const [reviewNote, setReviewNote] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const request = useRef<AbortController | null>(null); const form = useRef<HTMLFormElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const pendingCreation = useRef<{ requestId: string; protocol: StudyProtocol } | null>(null);
  const creationSource = useRef<string | null>(null);
  const frozen = study?.status === 'frozen';
  const dirty = !!draft && !!study && JSON.stringify(draft) !== JSON.stringify(study.protocol);
  const hasUnsent = dirty || (!frozen && (!!reviewNote || !!reviewedBy || confirmed));
  const canLeave = () => !hasUnsent && !busy || window.confirm(p.leave);
  useEffect(() => {
    if (!hasUnsent && !busy) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const link = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.download || event.defaultPrevented) return;
      if (!window.confirm(p.leave)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', leave); document.addEventListener('click', link, true);
    return () => { window.removeEventListener('beforeunload', leave); document.removeEventListener('click', link, true); };
  }, [hasUnsent, busy, p.leave]);
  useEffect(() => { if (study) heading.current?.focus(); }, [study?.id, step, frozen]);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  async function send(query = '', body?: unknown, method = 'GET'): Promise<Payload | null> {
    if (request.current) return null;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setErrorOperation(method);
    try {
      const response = await fetch('/api/echo/research' + query, { method, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
      const data = await response.json() as Payload;
      if (controller.signal.aborted) return null;
      if (!response.ok) { setError(data.code ?? 'storage'); return null; }
      return data;
    } catch { if (!controller.signal.aborted) setError('storage'); return null; }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  function accept(value: StudyAdminView) {
    pendingCreation.current = null;
    setStudy(value); setDraft(structuredClone(value.protocol)); setReviewedBy(''); setReviewNote(''); setConfirmed(false);
    const url = new URL(window.location.href); url.searchParams.set('study', value.id); window.history.replaceState({}, '', url);
  }
  async function load(id?: string) {
    const data = await send(id ? '?id=' + encodeURIComponent(id) : '');
    if (!data) return;
    if (data.study) { accept(data.study); setStep(0); }
    else { setStudies(data.studies ?? []); setUnavailable(data.unavailableCount ?? 0); setStudy(null); setDraft(null); const url = new URL(window.location.href); url.searchParams.delete('study'); window.history.replaceState({}, '', url); }
    setLoaded(true);
  }
  useEffect(() => { void load(new URLSearchParams(window.location.search).get('study') ?? undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function create(source?: StudyProtocol) {
    if (busy) return;
    const sourceId = source ? study?.id ?? null : null;
    if (creationSource.current !== sourceId) pendingCreation.current = null;
    creationSource.current = sourceId;
    const protocol = source ? { ...structuredClone(source), title: source.title.slice(0, 200 - p.copySuffix.length) + p.copySuffix } : blankStudyProtocol(locale);
    pendingCreation.current ??= { requestId: crypto.randomUUID(), protocol };
    const data = await send('', pendingCreation.current, 'POST');
    if (data?.study) { accept(data.study); setStep(0); pendingCreation.current = null; }
  }
  async function save() {
    if (!study || !draft || frozen || busy || !form.current?.reportValidity()) return;
    const protocol = { ...draft, conditions: draft.conditions.map(condition => ({ ...condition, expectedRuntime: { ...condition.expectedRuntime, tools: condition.expectedRuntime.tools.map(tool => tool.trim()).filter(Boolean) } })) };
    const data = await send('', { id: study.id, version: study.version, action: 'save', protocol }, 'PATCH');
    if (data?.study) { setStudy(data.study); setDraft(structuredClone(data.study.protocol)); setConfirmed(false); }
  }
  const complete = !!draft && studyFields(draft, locale).every(field => String(draftValue(draft, field.path) ?? '').trim());
  const canFreeze = complete && !dirty && !busy && /^[a-z][a-z0-9-]{0,63}$/.test(reviewedBy) && !!reviewNote.trim() && confirmed;
  async function freeze() {
    if (!study || !canFreeze || frozen) return;
    const data = await send('', { id: study.id, version: study.version, action: 'freeze', reviewedBy, reviewNote, confirmed }, 'PATCH');
    if (data?.study) accept(data.study);
  }
  function goStep(index: number) { if (!busy && form.current?.reportValidity()) { setStep(index); setFocusPath(''); } }
  function goToField(field: StudyField) { setStep(field.step); setFocusPath(field.path); }
  const errorCopy = error === 'storage' && errorOperation === 'GET'
    ? (locale === 'zh' ? '暂时无法读取研究材料，请重试。已保存的文件仍保留在本机。' : 'Could not load study materials. Retry; saved files remain on this device.')
    : p.errors[error as keyof typeof p.errors] ?? p.errors.storage;
  return <NarrowPageShell as="article" aria-labelledby="research-title" className="space-y-7">
    <header className="space-y-3">
      <Link href="/echo/growth" className={buttonVariants({ variant: 'ghost' }) + ' min-h-11 -ml-2 w-fit'}>{p.back}</Link>
      <h1 id="research-title" className="font-display text-3xl">{p.title}</h1>
      <p className={studyNote}>{p.lead}</p><p className={studyNote}>{p.limit}</p>
    </header>
    {error ? <div role="alert" className="space-y-2 rounded-lg border border-error p-4"><p className="text-sm leading-6">{errorCopy}</p>
      {study || new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('study') ? <Button variant="outline" className={studyControl} disabled={busy} onClick={() => { if (canLeave()) void load(study?.id ?? new URLSearchParams(window.location.search).get('study')!); }}>{p.refresh}</Button> : <Button variant="outline" className={studyControl} disabled={busy} onClick={() => void load()}>{p.retry}</Button>}
      {!study && new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('study') ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void load()}>{p.all}</Button> : null}
    </div> : null}
    {!study || !draft ? <section className="space-y-5" aria-busy={busy}>
      {busy ? <p role="status" className={studyNote}>{p.loading}</p> : null}
      {loaded && !studies.length ? <div className="space-y-2 border-t border-border py-6"><h2 className="font-display text-xl">{p.empty}</h2><p className={studyNote}>{p.emptyHint}</p></div> : null}
      {loaded ? <Button className="min-h-11" disabled={busy} onClick={() => void create()}>{p.create}</Button> : null}
      {unavailable ? <p className={studyNote}>{p.unavailable}</p> : null}
      <ul className="divide-y divide-border">{studies.map(item => <li key={item.id} className="py-3">
        <Button variant="ghost" className="min-h-11 h-auto w-full justify-start whitespace-normal text-left" disabled={busy} onClick={() => void load(item.id)}>{item.title.trim() || p.untitled}</Button>
        <p className={studyNote + ' px-2.5'}>{item.status === 'frozen' ? p.frozen : p.draft} · {new Date(item.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</p>
      </li>)}</ul>
    </section> : <section className="space-y-5" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="ghost" className="min-h-11 -ml-2" disabled={busy} onClick={() => { if (canLeave()) void load(); }}>{p.all}</Button><span className={studyNote}>{frozen ? p.frozen : p.draft}</span></div>
      {!frozen ? <nav aria-label={p.title} className="flex flex-wrap gap-1 border-b border-border pb-3">{p.steps.map((label, i) => <Button key={i} variant={i === step ? 'default' : 'ghost'} className="min-h-11 h-auto whitespace-normal" aria-current={i === step ? 'step' : undefined} disabled={busy} onClick={() => goStep(i)}>{i + 1} {label}</Button>)}</nav> : null}
      <h2 ref={heading} tabIndex={-1} className="scroll-mt-6 rounded font-display text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{frozen ? p.frozenTitle : step === 4 ? p.reviewTitle : p.steps[step]}</h2>
      {frozen ? <div className="space-y-4"><p className={studyNote}>{p.frozenHint}</p>
        {study.review ? <details className="rounded-lg border border-border p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.reviewRecord}</summary>
          <dl className="space-y-3 text-sm leading-6"><div><dt className={studyNote}>{p.reviewedBy}</dt><dd>{study.review.reviewedBy}</dd></div>
            <div><dt className={studyNote}>{p.reviewNote}</dt><dd className="whitespace-pre-wrap break-words">{study.review.reviewNote}</dd></div>
            <div><dt className={studyNote}>{p.frozen}</dt><dd><time dateTime={study.review.frozenAt}>{new Date(study.review.frozenAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</time></dd></div></dl>
        </details> : null}
        <Button variant="outline" className={studyControl + ' h-auto whitespace-normal'} disabled={busy} onClick={() => void create(study.protocol)}>{p.copy}</Button>
      </div> : null}
      <form ref={form} onSubmit={e => { e.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          {!frozen && step < 4 ? <StudyFields protocol={draft} locale={locale} step={step} focusPath={focusPath} change={(path, value) => { setDraft(changeDraft(draft, path, value)); setConfirmed(false); }} replace={value => { setDraft(value); setConfirmed(false); }} /> : <StudyReview protocol={draft} locale={locale} frozen={!!frozen} goToField={goToField} />}
          {!frozen && step === 4 ? <div className="space-y-5 border-t border-border pt-5">
            {dirty ? <p className={studyNote}>{p.unsavedReview}</p> : null}
            <StudyTextField name="reviewedBy" label={p.reviewedBy} value={reviewedBy} max={64} onChange={setReviewedBy} /><p className={studyNote}>{p.reviewerHint}</p>
            <StudyTextField name="reviewNote" label={p.reviewNote} value={reviewNote} max={4000} multiline onChange={setReviewNote} />
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"><input name="confirmed" type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{p.confirm}</span></label>
            <Button className="min-h-11 h-auto whitespace-normal" disabled={!canFreeze} onClick={() => void freeze()}>{p.freeze}</Button>
          </div> : null}
        </fieldset>
      </form>
      {frozen && study.protocolHash ? <StudyInvitations key={study.id} studyId={study.id} protocolHash={study.protocolHash} delayDays={study.protocol.delayDays} locale={locale}/> : null}
      {frozen && study.protocolHash ? <StudyReviewers key={study.id + '-reviewers'} studyId={study.id} protocolHash={study.protocolHash} locale={locale} /> : null}
      {!frozen ? <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-4">
        <p role="status" className={studyNote}>{busy ? p.busy : dirty ? p.dirty : hasUnsent ? p.reviewPending : p.saved}</p>
        <div className="flex flex-wrap gap-2">{step > 0 ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => goStep(step - 1)}>{p.previous}</Button> : null}
          <Button variant={step === 4 ? 'outline' : 'default'} className={studyControl} disabled={busy || !dirty} onClick={() => void save()}>{p.save}</Button>
          {step < 4 ? <Button variant="outline" className={studyControl} disabled={busy} onClick={() => goStep(step + 1)}>{p.next}</Button> : null}
        </div>
      </footer> : null}
    </section>}
  </NarrowPageShell>;
}
export default function ResearchPage() { const { locale } = useLocale(); return <ResearchWorkspace locale={locale === 'zh' ? 'zh' : 'en'} />; }
