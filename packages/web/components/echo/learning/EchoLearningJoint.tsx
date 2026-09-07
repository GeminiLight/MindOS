'use client';
import { useEchoDraft } from '../use-echo-draft';
import { useEffect, useState } from 'react';
import type { LearningLoop, LearningAgentEvidence } from '@geminilight/mindos/knowledge';
import Link from 'next/link';
import { contextAssetViewHref } from '@/lib/context-observability';
import EchoMethodLifecycle from './EchoMethodLifecycle';
import EchoMethodTrial from './EchoMethodTrial';
import EchoMethodCheck from './EchoMethodCheck';
import EchoMethodComparison from './EchoMethodComparison';
import EchoLearningRunEvidence from './EchoLearningRunEvidence';
import { Button } from '@/components/ui/button';
import { learningMethodStatus, type LearningCopy } from './learning-client';

const fieldClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
type Props = { loop: LearningLoop; p: LearningCopy; busy: boolean; save: (command: Record<string, unknown>) => Promise<void> };

export default function EchoLearningJoint(props: Props) {
  const { loop, p } = props;
  const [evidence, setEvidence] = useState<LearningAgentEvidence[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const families = [
    ...(loop.directMethod ? [{ attemptIndex: -1, method: loop.directMethod }] : []),
    ...loop.attempts.flatMap((attempt, attemptIndex) => attempt.review ? [{ attemptIndex, method: attempt.agentChange }] : []),
  ];
  const versions = families.flatMap(({ attemptIndex, method }) => [method, ...(method?.revisions ?? [])].map((change, revisionIndex, all) => ({ attemptIndex, revisionIndex, change, latest: revisionIndex === all.length - 1 })).reverse());
  const approved = versions.some(({ change }) => change?.review?.decision === 'approved');
  useEffect(() => {
    if (!approved) return;
    const controller = new AbortController();
    let generation = 0;
    async function load() {
      const current = ++generation;
      setStatus('loading');
      try {
        const response = await fetch('/api/echo/learning?id=' + loop.id, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (!Array.isArray(data.agentEvidence)) throw new Error('Missing evidence');
        if (!controller.signal.aborted && current === generation) { setEvidence(data.agentEvidence); setStatus('ready'); }
      } catch {
        if (!controller.signal.aborted && current === generation) setStatus('error');
      }
    }
    void load(); window.addEventListener('focus', load);
    return () => { controller.abort(); window.removeEventListener('focus', load); };
  }, [approved, loop.id, loop.version, refresh]);
  if (!loop.directMethod && !loop.attempts.some((attempt) => attempt.review)) return null;
  return <div className="mt-6 space-y-5 border-t border-border pt-5">
    <h4 className="font-display text-base">{p.joint.title}</h4>
    <p className="text-sm leading-6 text-muted-foreground">{p.joint.hint}</p>
    {versions.map(({ attemptIndex, revisionIndex, latest }) => <JointAttempt key={`${attemptIndex}-${revisionIndex}`} {...props} attemptIndex={attemptIndex} revisionIndex={revisionIndex} latest={latest}
      evidenceReady={status === 'ready'} evidence={status === 'ready' ? evidence.find((item) => item.attemptIndex === attemptIndex && (item.revisionIndex ?? 0) === revisionIndex)?.receipts ?? [] : []} />)}
    {approved ? <div className="space-y-2 text-xs text-muted-foreground" role="status">
      {status === 'loading' ? p.joint.loading : status === 'error' ? p.joint.failed : p.joint.limited}
      <Button className="min-h-11" variant="ghost" size="sm" disabled={status === 'loading'} onClick={() => setRefresh((value) => value + 1)}>{p.joint.retry}</Button>
    </div> : null}
  </div>;
}

function JointAttempt({ loop, p, busy, save: saveCommand, attemptIndex, revisionIndex, latest, evidence, evidenceReady }: Props & { revisionIndex: number; latest: boolean; evidenceReady: boolean; attemptIndex: number; evidence: LearningAgentEvidence['receipts'] }) {
  const attempt = loop.attempts[attemptIndex];
  const family = attemptIndex === -1 ? loop.directMethod : attempt?.agentChange;
  const change = revisionIndex === 0 ? family : family?.revisions?.[revisionIndex - 1];
  const versions = family ? [family, ...(family.revisions ?? [])] : [];
  const otherActive = versions.some((item, index) => index !== revisionIndex && item.review?.decision === 'approved' && item.availability !== 'deprecated');
  const superseded = versions.some((item, index) => index > revisionIndex && item.review?.decision === 'approved');
  const save = (command: Record<string, unknown>) => saveCommand({ ...command, revisionIndex });
  const j = p.joint;
  const [behavior, setBehavior] = useEchoDraft(`${loop.id}:joint:${attemptIndex}:${revisionIndex}` + ":behavior", change?.behavior ?? attempt?.review?.revisedRule.slice(0, 1600) ?? '');
  const [scope, setScope] = useEchoDraft(`${loop.id}:joint:${attemptIndex}:${revisionIndex}` + ":scope", '');
  const [check, setCheck] = useEchoDraft(`${loop.id}:joint:${attemptIndex}:${revisionIndex}` + ":check", '');
  const [receiptId, setReceiptId] = useEchoDraft(`${loop.id}:joint:${attemptIndex}:${revisionIndex}` + ":receiptId", '');
  const [outcome, setOutcome] = useEchoDraft(`${loop.id}:joint:${attemptIndex}:${revisionIndex}` + ":outcome", 'uncertain');
  const [observation, setObservation] = useEchoDraft(`${loop.id}:joint:${attemptIndex}:${revisionIndex}` + ":observation", '');
  const available = evidence.filter((item) => !change?.observations.some((record) => record.receiptId === item.id));
  const text = (name: string, label: string, value: string, set: (value: string) => void, maxLength = 1600) => <label className="block space-y-2">
    <span className="text-sm font-medium">{label}</span>
    <textarea name={name} required maxLength={maxLength} rows={2} className={fieldClass} value={value} onChange={(event) => set(event.target.value)} />
  </label>;
  const saved = (label: string, value: string) => <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{value}</p></div>;
  return <details open={latest && (attemptIndex === -1 || attemptIndex === loop.attempts.length - 1)} className="rounded-lg border border-border p-4">
    <summary className="min-h-11 cursor-pointer rounded py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{attemptIndex === -1 ? j.fromCorrection : p.attempt + ' ' + (attemptIndex + 1)} · {j.methodVersion} {revisionIndex + 1} · {learningMethodStatus(change, p)}</summary>
    <div className="mt-4 space-y-4">
      {!change ? !loop.archived ? <form onSubmit={(event) => { event.preventDefault(); if (!busy && !loop.archived) void save({ action: 'propose-agent', attemptIndex, behavior, scope, check }); }}>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {text('agentBehavior', j.behavior, behavior, setBehavior)}
          {text('agentScope', j.scope, scope, setScope)}
          {text('agentCheck', j.check, check, setCheck)}
          <p className="text-xs leading-5 text-muted-foreground">{j.private}</p>
          <Button className="min-h-11" type="submit" variant="outline">{j.save}</Button>
        </fieldset>
      </form> : null : <>
        {'revisionReason' in change ? saved(j.revisionReason, String(change.revisionReason)) : null}
        {change.inquiryOrigin ? <Link href={`/echo/questions?inquiry=${change.inquiryOrigin.inquiryId}#${change.inquiryOrigin.decisionId}`} className="inline-flex min-h-11 items-center rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{j.revisionEvidence}</Link> : null}
        {saved(j.behavior, change.behavior)}{saved(j.scope, change.scope)}{saved(j.check, change.check)}
        {!change.review && !loop.archived ? <>
          <p className="text-xs leading-5 text-muted-foreground">{otherActive ? j.pauseBeforeApproval : j.approvalHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || otherActive} className="min-h-11 bg-primary text-primary-foreground" onClick={() => { if (!busy && !otherActive && !loop.archived) void save({ action: 'approve-agent', attemptIndex }); }}>{j.approve}</Button>
            <Button disabled={busy} className="min-h-11" variant="ghost" onClick={() => void save({ action: 'reject-agent', attemptIndex })}>{j.reject}</Button>
          </div>
        </> : null}
        {change.review?.decision === 'approved' ? <>
          {!loop.archived && change.availability === 'active' ? <EchoMethodTrial id={loop.id} version={loop.version} attemptIndex={attemptIndex} revisionIndex={revisionIndex} p={p} disabled={busy} /> : null}
          <EchoMethodCheck loop={loop} attemptIndex={attemptIndex} revisionIndex={revisionIndex} disabled={busy || loop.archived || change.availability !== 'active'} />
          {change.review.targetPath ? <Link target="_blank" rel="noopener noreferrer" href={contextAssetViewHref(change.review.targetPath)} className="inline-flex min-h-11 items-center rounded text-sm text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{j.read}</Link> : null}
          <h5 className="text-sm font-medium">{j.evidence}</h5>
          <p className="text-xs leading-5 text-muted-foreground">{j.evidenceHint}</p>
          {evidenceReady && evidence.length === 0 ? <p className="text-xs text-muted-foreground">{j.noEvidence}</p> : null}
          {available.length && !loop.archived ? <form onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !loop.archived && available.some((item) => item.id === receiptId)) void save({ action: 'observe-agent', attemptIndex, receiptId, outcome, observation });
          }}><fieldset disabled={busy} className="min-w-0 space-y-4">
            <label className="block space-y-2"><span className="text-sm">{j.receipt}</span>
              <select name="agentReceipt" required className={fieldClass} value={available.some((item) => item.id === receiptId) ? receiptId : ''} onChange={(event) => setReceiptId(event.target.value)}>
                <option value="">{j.choose}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.startedAt.slice(0, 10)} · {item.title || item.runId || item.sessionId}</option>)}
              </select>
            </label>
            {receiptId && available.some((item) => item.id === receiptId) ? <EchoLearningRunEvidence receiptId={receiptId} p={p} /> : null}
            <label className="block space-y-2"><span className="text-sm">{j.outcome}</span><select name="agentOutcome" className={fieldClass} value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              {Object.entries(j.outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {text('agentObservation', j.observation, observation, setObservation, 4000)}
            <Button className="min-h-11" type="submit" variant="outline">{j.record}</Button>
          </fieldset></form> : null}
          {change.observations.map((item) => <div key={item.receiptId} className="space-y-2 border-l-2 border-border pl-3">
            <p className="text-xs text-muted-foreground">{j.reported} · {j.outcomes[item.outcome]}</p>
            <p className="break-words text-sm leading-6">{item.observation}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{item.receiptId} · {item.recordedAt.slice(0, 10)}</p>
          </div>)}
        </> : null}
        {latest && versions.filter(item => item.review?.decision === 'approved').length >= 2 ? <EchoMethodComparison key={loop.id + ':' + attemptIndex} loop={loop} attemptIndex={attemptIndex} disabled={busy} /> : null}
        {change.review ? <EchoMethodLifecycle method={change} p={p} disabled={busy} archived={loop.archived} canResume={!superseded && !otherActive} canRevise={latest && versions.every((item) => !!item.review)} save={(command) => save({ ...command, attemptIndex })} /> : null}
      </>}
    </div>
  </details>;
}
