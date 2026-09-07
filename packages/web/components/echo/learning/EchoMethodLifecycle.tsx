'use client';
import { useEffect, useState } from 'react';
import type { LearningMethod } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import type { LearningCopy } from './learning-client';

const fieldClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const summaryClass = 'min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
type Props = { method: LearningMethod; p: LearningCopy; disabled: boolean; archived: boolean; canRevise: boolean; canResume: boolean; save: (command: Record<string, unknown>) => Promise<void> };

export default function EchoMethodLifecycle({ method, p, disabled, archived, canRevise, canResume, save }: Props) {
  const j = p.joint;
  const [counterexample, setCounterexample] = useState('');
  const [reason, setReason] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [behavior, setBehavior] = useState(method.behavior);
  const [scope, setScope] = useState(method.scope);
  const [check, setCheck] = useState(method.check);
  useEffect(() => { setCounterexample(''); }, [method.counterexamples?.length]);
  useEffect(() => { setReason(''); }, [method.transitions?.length]);
  const active = method.availability === 'active';
  const approved = method.review?.decision === 'approved';
  const field = (name: string, label: string, value: string, set: (value: string) => void, maxLength = 1600) => <label className="block space-y-2"><span className="text-sm">{label}</span><textarea name={name} required maxLength={maxLength} rows={2} className={fieldClass} value={value} onChange={(event) => set(event.target.value)} /></label>;
  const canTransition = approved && (active || (method.availability === 'deprecated' && canResume));
  return <div className="space-y-3 border-t border-border pt-3">
    {approved ? <p className="text-xs leading-5 text-muted-foreground">{active ? j.activeHint : method.availability === 'deprecated' ? j.pausedHint : j.unavailableHint}</p> : null}
    {approved && !archived ? <details key={'counterexample-' + (method.counterexamples?.length ?? 0)}>
      <summary className={summaryClass}>{j.counterexample}</summary>
      <form onSubmit={(event) => { event.preventDefault(); if (!disabled && counterexample.trim()) void save({ action: 'counterexample-agent', observation: counterexample }); }}>
        <fieldset disabled={disabled} className="min-w-0 space-y-3 pb-3">
          <p className="text-xs leading-5 text-muted-foreground">{j.counterexampleHint}</p>
          {field('methodCounterexample', j.counterexamplePrompt, counterexample, setCounterexample, 4000)}
          <Button type="submit" variant="outline" className="min-h-11" disabled={!counterexample.trim() || method.counterexamples?.some((item) => item.observation === counterexample.trim())}>{j.saveCounterexample}</Button>
        </fieldset>
      </form>
    </details> : null}
    {(method.counterexamples ?? []).map((item, index) => <div key={index} className="space-y-1 border-l-2 border-border pl-3">
      <p className="text-xs text-muted-foreground">{j.counterexampleReported} · {item.recordedAt.slice(0, 10)}</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.observation}</p>
    </div>)}
    {canTransition && !archived ? <details key={active ? 'pause' : 'resume'}>
      <summary className={summaryClass}>{active ? j.pause : j.resume}</summary>
      <form onSubmit={(event) => { event.preventDefault(); if (!disabled && canTransition && reason.trim()) void save({ action: active ? 'pause-agent' : 'resume-agent', reason }); }}>
        <fieldset disabled={disabled} className="min-w-0 space-y-3 pb-3">
          <p className="text-xs leading-5 text-muted-foreground">{active ? j.pauseHint : j.resumeHint}</p>
          {field('methodTransitionReason', j.transitionReason, reason, setReason)}
          <Button type="submit" variant="outline" className="min-h-11" disabled={!reason.trim()}>{active ? j.pause : j.resume}</Button>
        </fieldset>
      </form>
    </details> : null}
    {canRevise && !archived ? <details>
      <summary className={summaryClass}>{j.revise}</summary>
      <form onSubmit={(event) => { event.preventDefault(); if (!disabled && canRevise && revisionReason.trim()) void save({ action: 'revise-agent', reason: revisionReason, behavior, scope, check }); }}>
        <fieldset disabled={disabled} className="min-w-0 space-y-3 pb-3">
          <p className="text-xs leading-5 text-muted-foreground">{j.revisionHint}</p>
          {field('methodRevisionReason', j.revisionReason, revisionReason, setRevisionReason)}
          {field('methodRevisionBehavior', j.behavior, behavior, setBehavior)}
          {field('methodRevisionScope', j.scope, scope, setScope)}
          {field('methodRevisionCheck', j.check, check, setCheck)}
          <Button type="submit" variant="outline" className="min-h-11" disabled={!revisionReason.trim() || (behavior.trim() === method.behavior && scope.trim() === method.scope && check.trim() === method.check)}>{j.saveRevision}</Button>
        </fieldset>
      </form>
    </details> : null}
    {method.transitions?.length ? <details>
      <summary className={summaryClass}>{j.statusHistory}</summary>
      <ol className="space-y-3 pb-3">{method.transitions.map((item) => <li key={item.id} className="space-y-1 border-l-2 border-border pl-3">
        <p className="text-xs text-muted-foreground">{item.action === 'pause-agent' ? j.paused : j.resumed} · {item.recordedAt.slice(0, 10)}</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.reason}</p>
      </li>)}</ol>
    </details> : null}
  </div>;
}
