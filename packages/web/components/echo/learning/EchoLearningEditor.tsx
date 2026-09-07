'use client';
import { useRef, useState } from 'react';
import { useEchoDraft, EchoDraftNotice } from '../use-echo-draft';
import { ArrowRight, Download, Check } from 'lucide-react';
import type { LearningAttempt, LearningLoop } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { notifyFilesChanged } from '@/lib/files-changed';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/stores/locale-store';
import EchoTransferPractice from './EchoTransferPractice';
import EchoLearningJoint from './EchoLearningJoint';
import EchoLearningForm, { initialLearningForm, type LearningFormMode } from './EchoLearningForm';
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
  const [snapshot, setSnapshot] = useEchoDraft(loop.id + ":snapshot", loop);
  const [values, setValues] = useEchoDraft(loop.id + ":personal", () => initialLearningForm(loop));
  const [editing, setEditing] = useEchoDraft<LearningFormMode | null>(loop.id + ":editing", null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const last = snapshot.attempts.at(-1);
  const hasUpdate = loop.version > snapshot.version;
  const mode = editing ?? (snapshot.stage === 'reflecting' ? 'reflect' : snapshot.stage === 'planning' ? 'plan' : snapshot.stage === 'practicing' ? 'review' : null);
  const currentStep = snapshot.stage === 'reflecting' ? 0 : snapshot.stage === 'planning' ? 1 : 2;
  const history = snapshot.stage === 'planning' ? snapshot.attempts : snapshot.attempts.slice(0, -1);
  const dirty = JSON.stringify(values) !== JSON.stringify(initialLearningForm(snapshot));
  const allowDiscard = useLearningDraftGuard(dirty, busy, p.unsavedLeave);

  function adopt(next: LearningLoop, resetPersonal = true) {
    setSnapshot(next); setError('');
    if (resetPersonal) { setValues(initialLearningForm(next)); setEditing(null); }
  }
  function changeMode(next: LearningFormMode | null) {
    if (!allowDiscard()) return;
    setValues(initialLearningForm(snapshot)); setEditing(next);
  }
  async function save(command: Record<string, unknown>) {
    if (inFlight.current) return;
    if (['archive', 'restore', 'retry'].includes(String(command.action)) && !allowDiscard()) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await learningRequest({ id: snapshot.id, version: snapshot.version, ...command }, 'PATCH');
      if (!result.loop) throw new Error('Missing record');
      // Saving a method must not discard an unrelated, unfinished personal reflection.
      adopt(result.loop, ['reflect', 'plan', 'review', 'archive', 'restore', 'retry'].includes(String(command.action)));
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
    <section className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-6" aria-label={snapshot.source.title}>
      <EchoDraftNotice />
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-display text-lg leading-7">{snapshot.source.title}</h3>
        <div className="flex flex-wrap gap-2">
          <a href={'/api/echo/learning?id=' + snapshot.id + '&format=markdown&locale=' + locale} download className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Download size={13} aria-hidden />{p.export}
          </a>
          <Button className="min-h-11" variant="ghost" size="sm" disabled={busy} onClick={() => void save({ action: snapshot.archived ? 'restore' : 'archive' })}>
            {snapshot.archived ? p.restore : p.archive}
          </Button>
        </div>
      </header>
      <details className="mb-6 rounded-lg bg-muted/25 p-3">
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
          <li key={step} aria-current={index === currentStep ? 'step' : undefined}
            className={cn('border-t-2 pt-2 font-sans text-xs leading-5 sm:text-sm', index === currentStep ? 'border-[var(--amber)] text-foreground' : 'border-border text-muted-foreground')}>
            <span className="mr-1.5 font-mono text-xs">{index < currentStep ? <Check size={12} className="inline" aria-hidden /> : '0' + (index + 1)}</span>{step}
          </li>
        ))}
      </ol>

      {hasUpdate ? <div className="mb-4 space-y-2 rounded-lg border border-border p-3" role="status">
        <p className="text-sm">{p.changed}</p>
        <Button className="min-h-11" variant="outline" size="sm" disabled={busy} onClick={() => adopt(loop)}>{p.replaceDraft}</Button>
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
        {reviewIsDue(snapshot) ? <p className="text-sm font-medium text-foreground">{p.due}</p> : null}
        <AttemptSummary attempt={last} p={p} />
        {snapshot.stage === 'practicing' && !snapshot.archived && !editing
          ? <Button className="min-h-11" variant="outline" size="sm" disabled={busy} onClick={() => changeMode('plan')}>{p.editPlan}</Button> : null}
      </div> : null}
      {mode && !snapshot.archived ? <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <EchoLearningForm mode={mode} values={values} onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))} p={p} />
          {dirty ? <p role="status" className="text-sm leading-6 text-muted-foreground">{p.unsavedHint}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-11 bg-primary text-primary-foreground">
              {busy ? p.saving : mode === 'reflect' ? p.saveUnderstanding : mode === 'plan' ? p.savePlan : p.saveReview}<ArrowRight size={14} aria-hidden />
            </Button>
            {editing ? <Button className="min-h-11" variant="ghost" type="button" onClick={() => changeMode(null)}>{p.cancel}</Button> : null}
          </div>
        </fieldset>
      </form> : null}
      {snapshot.stage === 'reviewed' && !snapshot.archived ? <Button className="min-h-11" disabled={busy} variant="outline" onClick={() => void save({ action: 'retry' })}>{p.tryAgain}<ArrowRight size={14} aria-hidden /></Button> : null}
      </details>
      {!snapshot.directMethod ? <EchoLearningJoint loop={snapshot} p={p} busy={busy} save={save} /> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-error">{error}</p> : null}
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
