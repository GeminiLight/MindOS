'use client';
import { useEchoDraft } from '../use-echo-draft';
import { useEffect, useRef, useState } from 'react';
import type { TransferView } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { openAskModal, ASK_HIDE_PANELS_EVENT } from '@/hooks/useAskModal';
import { TRANSFER_UPDATED } from './transfer-events';
import { transferCopy, type TransferCopy } from './transfer-copy';
import { TransferMethodMatch, TransferMethodIdentity, TransferHelpResults, emptyMatchDraft, type PracticeMethod } from './EchoTransferSupport';
const control = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const summary = 'min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
type AnswerDraft = { answer: string; confidence: string; assistance: string; familiar: string };
const emptyDraft: AnswerDraft = { answer: '', confidence: '', assistance: '', familiar: '' };
export default function EchoTransferPractice({ learningId, locale, archived }: { learningId: string; locale: 'en' | 'zh'; archived: boolean }) {
  const p = transferCopy[locale];
  const [methods, setMethods] = useState<PracticeMethod[]>([]);
  const [match, setMatch] = useEchoDraft(`${learningId}:practice` + ":match", emptyMatchDraft);
  const [drafts, setDrafts] = useEchoDraft<Record<string, AnswerDraft>>(`${learningId}:practice` + ":drafts", {});
  const hasDraft = !!match.selected || !!match.reason.trim() || Object.values(drafts).some(draft => draft.answer.trim() || draft.confidence || draft.assistance || draft.familiar);
  useEffect(() => {
    if (!hasDraft) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [hasDraft]);
  const [open, setOpen] = useState(false); const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<TransferView | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.get('learning') === learningId && params.get('practice') === '1') setOpen(true); }, [learningId]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (view) heading.current?.focus(); }, [view?.stage]); // Announce a committed step change without stealing focus while typing.
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function send(command?: Record<string, unknown>, method = 'GET') {
    if (request.current) return null;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const response = await fetch('/api/echo/transfer' + (method === 'GET' ? '?learningId=' + learningId : ''), {
        method, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        ...(command ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: view?.id, version: view?.version, ...command }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) { setError(p.errors[data.code as keyof typeof p.errors] ?? p.errors.storage); return null; }
      if (controller.signal.aborted) return null;
      if (data.methods) setMethods(data.methods);
      if (method === 'POST' && data.practice) setMatch(emptyMatchDraft);
      if (data.practice && data.practice.stage !== view?.stage && ['baseline', 'transfer', 'delayed'].includes(data.practice.stage)) window.dispatchEvent(new Event(ASK_HIDE_PANELS_EVENT));
      if (command?.action === 'answer' && view) setDrafts((current) => { const next = { ...current }; delete next[view.stage]; return next; });
      if (!data.practice && method === 'GET' && new URLSearchParams(window.location.search).get('practice') === '1') setError(p.errors['not-found']);
      if (data.draft) openAskModal(data.draft.prompt, 'user', null, { newSession: true, ...(data.draft.path ? { context: { path: data.draft.path, label: data.draft.title, type: 'file' as const } } : {}) });
      setView(data.practice); setLoaded(true); if (method !== 'GET') window.dispatchEvent(new Event(TRANSFER_UPDATED)); return data.practice as TransferView | null;
    } catch { if (!controller.signal.aborted) setError(p.errors.storage); return null; }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => { if (open && !loaded) void send(); /* Loading is initiated only by expanding this section. */ }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (command: Record<string, unknown>) => send(command, 'PATCH');
  const terminal = view?.stage === 'complete' || view?.stage === 'ended';
  async function prepareAgent() {
    if (!view || view.stage !== 'coaching' || busy) return;
    await save({ action: 'prepare-help' });
  }
  const selectedMethod = methods.find(item => `${item.attemptIndex}:${item.revisionIndex}` === match.selected);
  return <details id={'echo-transfer-' + learningId} open={open} className="mt-6 scroll-mt-20 border-t border-border pt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className={summary}>{p.title}</summary>
    <div className="space-y-4 py-3" aria-busy={busy}>
      {!view ? <><p className="text-sm leading-6 text-muted-foreground">{p.intro}</p><p className="text-xs leading-5 text-muted-foreground">{p.privacy}</p>
        {loaded && !archived ? <>
          <TransferMethodMatch methods={methods} draft={match} change={setMatch} locale={locale} busy={busy} />
          <Button className="min-h-11" disabled={busy || (!!match.selected && (!selectedMethod || !match.reason.trim() || !match.confirmed))} onClick={() => void send({ learningId, locale, ...(selectedMethod ? { methodMatch: { ...selectedMethod, reason: match.reason, fitConfirmed: match.confirmed } } : {}) }, 'POST')}>{p.start}</Button>
        </> : null}</> : <>
        <TransferMethodIdentity view={view} locale={locale} />
        <p className="text-xs text-muted-foreground">{p.step} {{ baseline: 1, coaching: 2, transfer: 3, waiting: 4, delayed: 4, complete: 4, ended: view.history?.length ?? 0 }[view.stage]} / 4</p>
        <h4 ref={heading} tabIndex={-1} className="scroll-mt-20 rounded font-display text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.stages[view.stage]}</h4>
        {view.previousExposure ? <p className="text-xs leading-5 text-muted-foreground">{p.exposure}</p> : null}
        {view.task ? <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/25 p-4 text-sm leading-7">{view.task.prompt}</p> : null}
        {view.stage === 'coaching' ? <>
          <details><summary className={summary}>{p.yourFirst}</summary><p className="whitespace-pre-wrap break-words text-sm leading-6">{view.previousAnswer?.answer}</p></details>
          {view.guidance ? <p className="border-l-2 border-border pl-3 text-sm leading-6">{view.guidance}</p> : <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void save({ action: 'guidance' })}>{p.hint}</Button>}
          <Button variant="outline" className="min-h-11 h-auto whitespace-normal text-left" disabled={busy} onClick={() => void prepareAgent()}>{p.agent}</Button>
          {view.agentHelpPreparedAt ? <p className="text-xs leading-5 text-muted-foreground" role="status">{p.agentPrepared}</p> : null}
          {view.agentHelpPreparedAt ? <TransferHelpResults view={view} locale={locale} busy={busy} refresh={() => void send()} inspect={runId => void save({ action: 'inspect-help', runId })} /> : null}
        </> : null}
        {view.task ? <AnswerForm key={view.id + view.stage} p={p} view={view} busy={busy} save={save} draft={drafts[view.stage] ?? emptyDraft} change={(field, value) => setDrafts((current) => ({ ...current, [view.stage]: { ...(current[view.stage] ?? emptyDraft), [field]: value } }))} /> : null}
        {view.stage === 'waiting' ? <><p className="text-sm leading-6 text-muted-foreground">{p.waiting}</p><p className="text-sm">{p.due} · {new Date(view.dueAt!).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</p>
          <Button className="min-h-11" disabled={busy || !view.delayedReady} onClick={() => void save({ action: 'begin-delayed' })}>{p.beginDelayed}</Button>
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void send()}>{p.refresh}</Button>
        </> : null}
        {terminal ? <><p className="text-sm leading-6 text-muted-foreground">{p.reviewHint}</p>
          {view.agentHelpPreparedAt ? <TransferHelpResults view={view} locale={locale} busy={busy} refresh={() => void send()} inspect={() => {}} /> : null}
          {view.ending ? <p className="text-sm">{p.outcomes[view.ending.reason]}</p> : null}
          <p className="text-sm font-medium">{p.criteria}</p><ul className="list-disc space-y-1 pl-5 text-sm leading-6">{view.criteria?.map((item) => <li key={item}>{item}</li>)}</ul>
          {view.history?.map((item) => <details key={item.response.phase} className="border-t border-border"><summary className={summary}>{p.stages[item.response.phase]}</summary><div className="space-y-3 pb-4">
            <p className="text-xs text-muted-foreground">{item.independent ? p.independent : [item.response.phase === 'coaching' ? p.sameSituation : '', view.previousExposure ? p.repeatedTag : '', item.response.familiar ? p.familiarTag : '', item.response.assistance !== 'none' ? p.assistanceOptions[item.response.assistance] : ''].filter(Boolean).join(' · ')} · {new Date(item.response.submittedAt).toLocaleString()}</p>
            <p className="text-sm leading-6">{item.task}</p>
            {item.response.confidence !== null ? <p className="text-xs text-muted-foreground">{p.reportedConfidence} · {item.response.confidence} / 100</p> : null}<p className="whitespace-pre-wrap break-words text-sm leading-6">{item.response.answer}</p>
            <p className="text-xs text-muted-foreground">{p.reference}</p><p className="text-sm leading-6">{item.reference}</p>
          </div></details>)}
          <a className="inline-flex min-h-11 items-center rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={'/api/echo/transfer?id=' + view.id + '&format=json'} download>{p.export}</a>
        </> : <details className="border-t border-border" onToggle={(event) => { if (event.currentTarget.open && !busy) void send(); }}><summary className={summary}>{p.stop}</summary><p className="mb-3 text-xs leading-5 text-muted-foreground">{p.stopHint}</p><div className="flex flex-wrap gap-2">
          {(['stopped', 'skipped', ...(view.canRecordTimeout ? ['timeout'] : [])] as const).map((reason) => <Button key={reason} variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={() => void save({ action: 'end', reason })}>{p[reason as 'stopped' | 'skipped' | 'timeout']}</Button>)}
        </div></details>}
      </>}
      {view && !['baseline', 'transfer', 'delayed'].includes(view.stage) ? Object.entries(drafts).filter(([stage, draft]) => stage !== view.stage && draft.answer.trim()).map(([stage, draft]) => <details key={stage}><summary className={summary}>{p.unsentDraft} · {p.stages[stage as keyof typeof p.stages]}</summary><p className="whitespace-pre-wrap break-words text-sm leading-6">{draft.answer}</p></details>) : null}
      {busy ? <p role="status" className="text-xs text-muted-foreground">{loaded ? p.saving : p.loading}</p> : null}
      {error ? <div role="alert" className="space-y-2 border-l-2 border-error pl-3"><p className="text-sm text-foreground">{error}</p><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void send()}>{p.retry}</Button></div> : null}
    </div>
  </details>;
}
function AnswerForm({ p, view, busy, save, draft, change }: { p: TransferCopy; view: TransferView; busy: boolean; save: (command: Record<string, unknown>) => Promise<unknown>; draft: AnswerDraft; change: (field: keyof AnswerDraft, value: string) => void }) {
  const { answer, confidence, assistance, familiar } = draft;
  return <form onSubmit={(event) => { event.preventDefault(); if (!busy && answer.trim() && assistance && familiar) void save({ action: 'answer', answer, confidence: confidence === '' ? null : Number(confidence), assistance, familiar: familiar === 'yes' }); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      {view.stage !== 'coaching' ? <p className="text-xs leading-5 text-muted-foreground">{p.independentHint}</p> : null}
      <label className="block space-y-2"><span className="text-sm">{p.answer}</span><textarea autoComplete="off" name="transferAnswer" required rows={4} maxLength={4000} className={control} value={answer} onChange={(event) => change('answer', event.target.value)} /></label>
      <label className="block space-y-2"><span className="text-sm">{p.confidence}</span><input name="transferConfidence" type="number" min={0} max={100} step={1} className={control} value={confidence} onChange={(event) => change('confidence', event.target.value)} /></label>
      <label className="block space-y-2"><span className="text-sm">{p.assistance}</span><select name="transferAssistance" required className={control} value={assistance} onChange={(event) => change('assistance', event.target.value)}><option value="">{p.choose}</option>{Object.entries(p.assistanceOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block space-y-2"><span className="text-sm">{p.familiar}</span><select name="transferFamiliar" required className={control} value={familiar} onChange={(event) => change('familiar', event.target.value)}><option value="">{p.choose}</option>{Object.entries(p.familiarOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={!answer.trim() || !assistance || !familiar}>{view.stage === 'baseline' ? p.lock : view.stage === 'coaching' ? p.coached : view.stage === 'delayed' ? p.delayed : p.transfer}</Button>
    </fieldset>
  </form>;
}
