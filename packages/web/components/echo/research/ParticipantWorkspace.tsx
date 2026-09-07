'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StudyAccessView } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NarrowPageShell } from '@/components/shared/ContentPageShell';
import { StudyCoaching } from './StudyCoaching';
import { coachingCopy } from './coaching-copy';
import { participantCopy } from './participant-copy';
import { studyControl, studyNote } from './StudyFields';
import { readStudyInvitationFragment } from '@/lib/study-invitation-fragment';
export function ParticipantWorkspace({ studyId, locale }: {
    studyId: string;
    locale: 'en' | 'zh';
}) {
    const [view, setView] = useState<StudyAccessView | null>(null);
    const [busy, setBusy] = useState(false);
    const [helpRunning, setHelpRunning] = useState(false);
    const [error, setError] = useState('');
    const [consent, setConsent] = useState(false);
    const [answer, setAnswer] = useState('');
    const [confidence, setConfidence] = useState('');
    const [assistance, setAssistance] = useState('');
    const [familiar, setFamiliar] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [erase, setErase] = useState('retain');
    const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
    const [helpDirty, setHelpDirty] = useState(false);
    const [locked, setLocked] = useState(false);
    const controller = useRef<AbortController | null>(null);
    const token = useRef<string | null>(null);
    const initializedStudy = useRef('');
    const form = useRef<HTMLFormElement>(null);
    const p = participantCopy[locale];
    const participant = view?.kind === 'participant' ? view.participant : null;
    const waitingForHelp = !!participant?.coaching?.runs.some(run => run.status === 'pending');
    const needsHelp = !!participant?.coaching && !participant.coaching.runs.some(run => run.status === 'succeeded');
    const dirty = helpDirty || !!answer || !!confidence || !!assistance || !!familiar || confirmed;
    const heading = useRef<HTMLHeadingElement>(null);
    const stateKey = view?.kind === 'participant' ? view.participant.status + ':' + view.participant.nextPhase : view?.kind;
    useEffect(() => { if (stateKey)
        heading.current?.focus(); }, [stateKey]);
    const base = '/api/study/participate/' + studyId;
    const reset = () => { setConsent(false); setAnswer(''); setConfidence(''); setAssistance(''); setFamiliar(''); setConfirmed(false); setWithdrawing(false); setWithdrawConfirmed(false); };
    async function send(command?: unknown, session = false, preserveDraft = false) {
        if (controller.current)
            return;
        const abort = new AbortController();
        controller.current = abort;
        setBusy(true);
        setError('');
        const helping = !!command && typeof command === 'object' && 'action' in command && command.action === 'help';
        setHelpRunning(helping);
        try {
            const response = await fetch(base + (session ? '/session' : ''), { method: session ? 'POST' : command ? 'PATCH' : 'GET', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(helping ? 105000 : 20000)]), ...(command ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) } : {}) });
            const result = await response.json();
            if (abort.signal.aborted)
                return;
            if (!response.ok) {
                setError(result.code ?? 'storage');
                return;
            }
            setView(result.view);
            if (session)
                token.current = null;
            if (!helping && !preserveDraft) reset();
            if (command && typeof command === 'object' && 'action' in command)
                setLocked(command.action === 'answer');
            return true;
        }
        catch {
            if (!abort.signal.aborted)
                setError('storage');
        }
        finally {
            if (controller.current === abort) {
                controller.current = null;
                if (!abort.signal.aborted)
                    setBusy(false);
            }
        }
    }
    useEffect(() => {
        if (initializedStudy.current !== studyId) {
            initializedStudy.current = studyId;
            setView(null);
            reset();
            setLocked(false);
            token.current = readStudyInvitationFragment();
        }
        void send(token.current !== null ? { token: token.current } : undefined, token.current !== null);
        return () => { controller.current?.abort(); controller.current = null; };
    }, [studyId]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!dirty && !busy)
        return; const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', leaving); return () => window.removeEventListener('beforeunload', leaving); }, [dirty, busy]);
    useEffect(() => {
        const changeInvitation = () => {
            if (window.location.pathname.replace(/\/$/, '') !== '/study/participate/' + studyId) return;
            const incoming = readStudyInvitationFragment();
            if (incoming === null) return;
            if (busy) { setError('switch-busy'); return; }
            if (dirty && !window.confirm(p.unsent)) return;
            token.current = incoming;
            setView(null); reset(); setLocked(false);
            void send({ token: incoming }, true);
        };
        window.addEventListener('hashchange', changeInvitation);
        return () => window.removeEventListener('hashchange', changeInvitation);
    }, [studyId, busy, dirty, p.unsent]); // eslint-disable-line react-hooks/exhaustive-deps
    function reload() { if (busy || (dirty && !window.confirm(p.unsent)))
        return; void send(token.current !== null ? { token: token.current } : undefined, token.current !== null); }
    const check = (name: string, label: string, value: boolean, change: (value: boolean) => void) => <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" disabled={busy} name={name} checked={value} onChange={e => change(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>{label}</label>;
    const select = (name: string, label: string, value: string, change: (value: string) => void, options: [
        string,
        string
    ][], required = false) => <label className="block space-y-2 text-sm"><span>{label}</span><select disabled={busy} name={name} value={value} onChange={e => { change(e.target.value); setConfirmed(false); }} required={required} className={studyControl + ' block w-full border rounded-md bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'}>{options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>;
    const phaseIndex = ['baseline', 'coaching', 'transfer', 'delayed'].indexOf(participant?.nextPhase ?? '');
    const canWithdraw = !!participant && !participant.erasedAt || view?.kind === 'expired' && view.canErase;
    const version = participant?.version ?? (view?.kind === 'expired' ? view.version : undefined);
    let content: ReactNode = null;
    if (view?.kind === 'consent')
        content = <section className="space-y-5"><p className={studyNote}>{view.coachingAvailable ? coachingCopy[locale].pilot : p.pilot}</p><p className="whitespace-pre-wrap break-words leading-7">{view.consent}</p><p className={studyNote + ' whitespace-pre-wrap break-words'}>{view.withdrawal}</p>{check('consent', p.consent, consent, setConsent)}<Button className="min-h-11" disabled={busy || !consent} onClick={() => void send({ action: 'join', protocolHash: view.protocolHash, consentAccepted: true })}>{p.join}</Button></section>;
    if (view?.kind === 'expired')
        content = <section className="space-y-4"><p>{p.expired}</p><p className={studyNote + ' whitespace-pre-wrap break-words'}>{view.withdrawal}</p></section>;
    if (participant) {
        if (participant.status === 'withdrawn')
            content = <section className="space-y-3"><h2 className="font-display text-xl">{p.withdrawn}</h2><p className={studyNote}>{participant.erasedAt ? p.erased : p.retained}</p></section>;
        else if (participant.status === 'complete')
            content = <section className="space-y-3"><h2 className="font-display text-xl">{p.complete}</h2><p className={studyNote}>{p.completeNote}</p></section>;
        else if (participant.status === 'waiting')
            content = <section className="space-y-4"><p>{p.waiting} <time dateTime={participant.dueAt}>{new Date(participant.dueAt!).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</time></p><Button variant="outline" className={studyControl} disabled={busy} onClick={reload}>{p.check}</Button></section>;
        else if (participant.nextPhase === 'coaching' && !participant.coachingAvailable)
            content = <p className={studyNote}>{p.coachingUnavailable}</p>;
        else if (participant.status === 'ready')
            content = <section className="space-y-4"><h2 className="font-display text-xl">{p.ready}</h2><Button className="min-h-11" disabled={busy} onClick={() => void send({ action: 'open', version: participant.version })}>{p.open}</Button></section>;
        else if (participant.task)
            content = <form ref={form} onSubmit={e => { e.preventDefault(); if (busy || waitingForHelp || needsHelp || !confirmed || !answer.trim() || !assistance || !familiar || !form.current?.reportValidity())
                return; if (helpDirty && !window.confirm(coachingCopy[locale].discard)) return; void send({ action: 'answer', version: participant.version, answer, confidence: confidence === '' ? null : Number(confidence), assistance, familiar: familiar === 'yes' }); }}>
   <div className="mb-6 space-y-3"><p className="whitespace-pre-wrap break-words leading-7">{participant.task.prompt}</p><p className={studyNote}>{p.budget} · {participant.task.budgetSeconds}</p></div>
   {participant.coaching ? <StudyCoaching key={participant.id} participant={participant} locale={locale} busy={busy} send={send} refresh={() => void send(undefined, false, true)} onDirty={setHelpDirty} /> : null}
   <fieldset disabled={busy || waitingForHelp} className="space-y-6">
    <label className="block space-y-2 text-sm"><span>{participant.coaching ? coachingCopy[locale].answer : p.answer}</span><textarea name="answer" value={answer} required maxLength={4000} rows={8} onChange={e => { setAnswer(e.target.value); setConfirmed(false); }} className={studyControl + ' block w-full border rounded-md bg-background px-3 py-3 leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'}/></label>
    <label className="block space-y-2 text-sm"><span>{p.confidence}</span><Input className={studyControl} name="confidence" type="number" min={0} max={100} step={1} value={confidence} onChange={e => { setConfidence(e.target.value); setConfirmed(false); }}/></label>
    {select('assistance', p.assistance, assistance, setAssistance, [['', p.choose], ['none', p.none], ['notes', p.notes], ['agent', p.agent], ['other', p.other]], true)}
    {select('familiar', p.familiar, familiar, setFamiliar, [['', p.choose], ['no', p.no], ['yes', p.yes]], true)}
    {check('confirmAnswer', p.confirmAnswer, confirmed, setConfirmed)}<p className={studyNote}>{p.local}</p>
    <div className="flex flex-wrap gap-3"><Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={busy || waitingForHelp || needsHelp || !confirmed || !answer.trim() || !assistance || !familiar}>{p.submit}</Button><Button variant="ghost" className="min-h-11" onClick={() => { if (!busy && !waitingForHelp && window.confirm(p.skipConfirm))
                void send({ action: 'skip', version: participant.version, reason: 'skipped' }); }}>{p.skip}</Button></div>
   </fieldset>
  </form>;
    }
    return <NarrowPageShell as="main" aria-labelledby="participant-title" className="min-h-[calc(100dvh-var(--app-titlebar-h))] space-y-7">
  <header className="space-y-3"><p className={studyNote}>MindOS</p><h1 ref={heading} tabIndex={-1} id="participant-title" className="rounded font-display text-3xl break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{participant?.title ?? (view && 'title' in view ? view.title : p.title)}</h1>{phaseIndex >= 0 && participant?.status !== 'withdrawn' ? <p className={studyNote}>{phaseIndex + 1} / 4 · {p.stages[phaseIndex]}</p> : null}</header>
  {busy ? <p role="status" className={studyNote}>{view ? helpRunning ? coachingCopy[locale].pending : p.saving : p.loading}</p> : null}
  {error ? <div role="alert" className="space-y-3 rounded-lg border border-error p-4"><p>{error === 'switch-busy' ? p.switchBusy : error === 'unauthorized' ? p.unauthorized : error === 'unavailable' || !view ? p.unavailable : error === 'invalid' ? p.invalid : error === 'conflict' ? p.conflict : p.saveUnknown}</p><Button variant="outline" className={studyControl} disabled={busy} onClick={reload}>{view ? p.reload : p.retry}</Button></div> : null}
  {locked ? <p role="status" className={studyNote}>{p.locked}</p> : null}
  <div hidden={withdrawing}>{content}</div>
  {withdrawing ? <section className="space-y-5"><h2 className="font-display text-xl">{p.withdrawTitle}</h2><p className={studyNote + ' whitespace-pre-wrap break-words'}>{participant?.withdrawal ?? (view?.kind === 'expired' ? view.withdrawal : '')}</p>{select('erase', p.eraseLabel, erase, value => { setErase(value); setWithdrawConfirmed(false); }, participant?.status === 'withdrawn' ? [['erase', p.erase]] : [['retain', p.retain], ['erase', p.erase]])}{check('confirmWithdrawal', p.withdrawConfirm, withdrawConfirmed, setWithdrawConfirmed)}<div className="flex flex-wrap gap-3"><Button variant="outline" className={studyControl} disabled={busy || !withdrawConfirmed} onClick={() => void send({ action: 'withdraw', version, eraseData: erase === 'erase' })}>{participant?.status === 'withdrawn' ? p.eraseAction : p.withdraw}</Button><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setWithdrawing(false)}>{p.cancel}</Button></div></section> : null}
  {canWithdraw && !withdrawing ? <footer className="border-t border-border pt-5"><Button variant="ghost" className="min-h-11 -ml-2" disabled={busy} onClick={() => { setWithdrawing(true); setErase(participant?.status === 'withdrawn' ? 'erase' : 'retain'); setWithdrawConfirmed(false); }}>{participant?.status === 'withdrawn' ? p.eraseAction : p.leave}</Button></footer> : null}
 </NarrowPageShell>;
}
