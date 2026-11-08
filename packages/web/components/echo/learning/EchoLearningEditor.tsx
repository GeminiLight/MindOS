'use client';
import { useEffect, useRef, useState } from 'react';
import { EchoDraftNotice } from '../use-echo-draft';
import { ArrowRight, Download, Check } from 'lucide-react';
import type { LearningAttempt, LearningLoop } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { notifyFilesChanged } from '@/lib/files-changed';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/stores/locale-store';
import EchoTransferPractice from './EchoTransferPractice';
import EchoLearningJoint from './EchoLearningJoint';
import EchoLearningForm, { initialLearningForm, type LearningFormMode } from './EchoLearningForm';
import { useLearningWorkspaceDraft } from './use-learning-workspace-draft';
import { useLearningDraftGuard } from './use-learning-draft-guard';
import { announceLearningUpdate, learningRequest, learningErrorMessage, reviewIsDue, type LearningCopy } from './learning-client';

function SavedText({ label, text }: { label: string; text: string }) {
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{text}</p></div>;
}
function AttemptSummary({ attempt, p }: { attempt: LearningAttempt; p: LearningCopy }) {
  return (
    <div className="space-y-3">
      <SavedText label={p.rule} text={attempt.rule} />
      <SavedText label={p.situation} text={attempt.plan.situation} />
      <SavedText label={p.experiment} text={attempt.plan.action} />
      <SavedText label={p.check} text={attempt.plan.check} />
      <p className="text-xs text-muted-foreground">{p.scheduled} · {attempt.plan.reviewOn}</p>
      {attempt.review ? <>
        <p className="text-xs font-medium">{p.selfReport} · {p.outcomes[attempt.review.outcome]}</p>
        <SavedText label={p.observation} text={attempt.review.observation} />
        <SavedText label={p.revisedRule} text={attempt.review.revisedRule} />
      </> : null}
    </div>
  );
}

export default function EchoLearningEditor({ loop, p }: { loop: LearningLoop; p: LearningCopy }) {
  const { locale } = useLocale();
  // Keep the version the form was opened against: focus refreshes must never silently rebase a draft.
  const draft = useLearningWorkspaceDraft(loop);
  const { snapshot, values, editing } = draft;
  const [savedAction, setSavedAction] = useState('');
  const stepRef = useRef<HTMLLegendElement>(null);
  const completedRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (savedAction) (stepRef.current ?? completedRef.current)?.focus(); }, [savedAction, snapshot.version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const inFlight = useRef(false);
  const last = snapshot.attempts.at(-1);
  const hasUpdate = loop.version > snapshot.version || draft.unversioned;
  const mode = editing ?? (snapshot.stage === 'reflecting' ? 'reflect' : snapshot.stage === 'planning' ? 'plan' : snapshot.stage === 'practicing' ? 'review' : null);
  const currentStep = mode === 'reflect' ? 0 : mode === 'plan' ? 1 : 2;
  const history = snapshot.stage === 'planning' ? snapshot.attempts : snapshot.attempts.slice(0, -1);
  const dirty = JSON.stringify(values) !== JSON.stringify(initialLearningForm(snapshot));
  const allowDiscard = useLearningDraftGuard(dirty, busy, p.unsavedLeave, draft.storage.failed ? p.unsavedLeave : p.workspace.leaveDraft);

  function adopt(next: LearningLoop, resetPersonal = true) {
    draft.adopt(next, resetPersonal); setError('');
  }
  function changeMode(next: LearningFormMode | null) {
    if (!allowDiscard()) return;
    draft.change({ values: initialLearningForm(snapshot), editing: next }); setSavedAction('');
  }
  async function save(command: Record<string, unknown>) {
    if (inFlight.current) return;
    if (['archive', 'restore', 'retry'].includes(String(command.action)) && !allowDiscard()) return;
    if (draft.unversioned) { setError(p.workspace.legacyDraft); return; }
    inFlight.current = true; setBusy(true); setError(''); setSavedAction('');
    try {
      const result = await learningRequest({ id: snapshot.id, version: snapshot.version, ...command }, 'PATCH');
      if (!result.loop) throw new Error('Missing record');
      // Saving a method must not discard an unrelated, unfinished personal reflection.
      adopt(result.loop, ['reflect', 'plan', 'review', 'archive', 'restore', 'retry'].includes(String(command.action)));
      setSavedAction(String(command.action));
      announceLearningUpdate(result.loop);
      if (['approve-agent', 'pause-agent', 'resume-agent'].includes(String(command.action))) notifyFilesChanged();
    } catch (err) { setError(learningErrorMessage(err, p)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function submit() {
    if (!mode || snapshot.archived || inFlight.current) return;
    const required = mode === 'reflect' ? ['before', 'understanding'] as const
      : mode === 'plan' ? ['situation', 'experiment', 'check', 'reviewOn'] as const
        : ['outcome', 'observation', 'revisedRule'] as const;
    if (required.some((key) => !values[key].trim())) { setError(p.errors.invalid); return; }
    void save({ action: mode, ...Object.fromEntries(required.map((key) => [key, values[key]])) });
  }
  return (
    <section className="min-w-0 border-t border-border pt-5" aria-label={snapshot.source.title}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <h3 tabIndex={-1} className="min-w-0 scroll-mt-6 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-xl font-medium leading-8 [overflow-wrap:anywhere]">{snapshot.source.title}</h3>
        <div className="flex flex-wrap gap-2">
          <a href={'/api/echo/learning?id=' + snapshot.id + '&format=markdown&locale=' + locale} download className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Download size={13} aria-hidden />{p.export}
          </a>
          <Button className="min-h-11" variant="ghost" size="sm" disabled={busy} onClick={() => void save({ action: snapshot.archived ? 'restore' : 'archive' })}>
            {snapshot.archived ? p.restore : p.archive}
          </Button>
        </div>
      </header>
      {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="mb-5 rounded-md border border-error/40 px-4 py-3 text-sm leading-6">{error}</p> : null}
      <details className="mb-6 border-b border-border pb-3">
        <summary className="min-h-11 py-3 cursor-pointer rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.source}</summary>
        <p className="mt-3 text-xs text-muted-foreground">{snapshot.directMethod ? p.joint.correctionSourceHint : p.sourceHint}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{snapshot.source.content}</p>
        {snapshot.source.sessions.map((session) => <div key={session.id} className="mt-3 space-y-2">
          <p className="break-all font-mono text-xs text-muted-foreground">{session.title || session.id}</p>
          {session.messageRefs.map((ref, index) => <blockquote key={index} className="break-words border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground">
            {ref.quote}<span className="ml-2 font-mono text-xs">#{ref.messageIndex + 1}</span>
          </blockquote>)}
        </div>)}
      </details>
      {snapshot.directMethod ? <EchoLearningJoint loop={snapshot} p={p} busy={busy} save={save} /> : null}
      <details open={!snapshot.directMethod} className="mt-5">
      {snapshot.directMethod ? <summary className="min-h-11 py-3 mb-5 cursor-pointer rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.joint.personalPractice}</summary> : <summary className="hidden" />}
      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label={p.title}>
        {p.steps.map((step, index) => (
          <li key={step} aria-current={mode && index === currentStep ? 'step' : undefined}
            className={cn('border-t-2 pt-2 font-sans text-xs leading-5 sm:text-sm', mode && index === currentStep ? 'border-[var(--amber)] text-foreground' : 'border-border text-muted-foreground')}>
            <span className="mr-1.5 font-mono text-xs">{(!mode || index < currentStep) ? <Check size={12} className="inline" aria-hidden /> : '0' + (index + 1)}</span>{step}
          </li>
        ))}
      </ol>

      {!mode && snapshot.stage === 'reviewed' ? <p ref={completedRef} tabIndex={-1} role="status" className="mb-5 flex items-center gap-2 text-sm"><Check size={16} className="text-success" aria-hidden />{p.workspace.completed}</p> : null}
      {savedAction && ['reflect', 'plan'].includes(savedAction) ? <p role="status" className="mb-5 text-sm leading-6">{savedAction === 'reflect' ? p.workspace.understandingSaved : savedAction === 'plan' ? p.workspace.planSaved : p.workspace.completed}</p> : null}
      {hasUpdate ? <div className="mb-4 space-y-2 rounded-lg border border-border p-3" role="status">
        <p className="text-sm">{draft.unversioned ? p.workspace.legacyDraft : p.changed}</p>
        <Button className="min-h-11" variant="outline" size="sm" disabled={busy} onClick={() => { if (allowDiscard()) adopt(loop); }}>{p.replaceDraft}</Button>
      </div> : null}
      {snapshot.reflection && mode !== 'reflect' ? <details className="mb-5 border-b border-border pb-4">
        <summary className="min-h-11 py-3 cursor-pointer rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.steps[0]}</summary>
        <div className="mt-3 space-y-3">
          <SavedText label={p.before} text={snapshot.reflection.before} />
          <SavedText label={p.understanding} text={snapshot.reflection.understanding} />
        </div>
      </details> : null}
      {snapshot.archived ? <p className="text-sm leading-6 text-muted-foreground">{p.archivedHint}</p> : null}
      {mode === 'plan' && !snapshot.archived ? <div className="mb-5 border-l-2 border-[var(--amber)] pl-3">
        <SavedText label={p.rule} text={last?.review?.revisedRule ?? snapshot.reflection?.understanding ?? ''} />
        {!last && !editing ? <Button variant="ghost" size="sm" className="min-h-11 mt-2" disabled={busy} onClick={() => changeMode('reflect')}>{p.editUnderstanding}</Button> : null}
      </div> : null}
      {last && snapshot.stage !== 'planning' ? <div className="mb-6 space-y-3">
        {snapshot.stage === 'practicing' ? <p className="text-sm leading-6">{reviewIsDue(snapshot) ? p.due : p.scheduled} · <time dateTime={last.plan.reviewOn}>{last.plan.reviewOn}</time></p> : null}
        <details className="border-b border-border pb-3">
          <summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{snapshot.stage === 'reviewed' ? p.workspace.reviewSummary : p.workspace.planSummary}</summary>
          <div className="pt-3"><AttemptSummary attempt={last} p={p} /></div>
        </details>
        {snapshot.stage === 'practicing' && !snapshot.archived && !editing
          ? <Button className="min-h-11" variant="outline" size="sm" disabled={busy} onClick={() => changeMode('plan')}>{p.editPlan}</Button> : null}
      </div> : null}
      {mode && !snapshot.archived ? <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          <legend ref={stepRef} tabIndex={-1} className="mb-2 scroll-mt-6 rounded text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.steps[currentStep]}</legend>
          <p className="text-xs leading-5 text-muted-foreground">{p.workspace.required}</p>
          <EchoLearningForm mode={mode} values={values} onChange={(name, value) => { draft.change({ values: { ...values, [name]: value } }); setSavedAction(''); }} p={p} />
          {dirty ? <p role="status" className="text-sm leading-6 text-muted-foreground">{p.unsavedHint}</p> : null}
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <Button type="submit" variant="amber" className="min-h-11 px-4">
              {busy ? p.saving : mode === 'reflect' ? p.saveUnderstanding : mode === 'plan' ? p.savePlan : p.saveReview}<ArrowRight size={14} aria-hidden />
            </Button>
            {editing ? <Button className="min-h-11" variant="ghost" type="button" onClick={() => changeMode(null)}>{p.cancel}</Button> : null}
          </div>
          <EchoDraftNotice state={{ ...draft.storage, restored: draft.storage.restored && dirty }} />
        </fieldset>
      </form> : null}
      {snapshot.stage === 'reviewed' && !snapshot.archived ? <Button className="min-h-11" disabled={busy} variant="outline" onClick={() => void save({ action: 'retry' })}>{p.tryAgain}<ArrowRight size={14} aria-hidden /></Button> : null}
      </details>
      {!snapshot.directMethod ? <EchoLearningJoint loop={snapshot} p={p} busy={busy} save={save} /> : null}
      <EchoTransferPractice learningId={snapshot.id} locale={locale} archived={snapshot.archived} />
      {history.length ? <details className="mt-6 border-t border-border pt-4">
        <summary className="min-h-11 py-3 cursor-pointer rounded text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.history} · {history.length}</summary>
        <div className="mt-4 space-y-6">{history.map((attempt, index) => <div key={index} className="space-y-3">
          <h4 className="font-mono text-xs text-muted-foreground">{p.attempt} {index + 1}</h4><AttemptSummary attempt={attempt} p={p} />
        </div>)}</div>
      </details> : null}
    </section>
  );
}
