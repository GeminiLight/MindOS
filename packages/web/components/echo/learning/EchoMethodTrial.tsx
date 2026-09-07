'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { openAskModal } from '@/hooks/useAskModal';
import { Button } from '@/components/ui/button';
import type { LearningCopy } from './learning-client';

type Props = { id: string; version: number; attemptIndex: number; revisionIndex?: number; p: LearningCopy; disabled: boolean };
export default function EchoMethodTrial({ id, version, attemptIndex, revisionIndex = 0, p, disabled }: Props) {
  const j = p.joint;
  const [task, setTask] = useState('');
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function prepare() {
    if (busy || controller.current || disabled || !task.trim()) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setOpened(false);
    try {
      const params = new URLSearchParams({ id, action: 'trial', attemptIndex: String(attemptIndex), revisionIndex: String(revisionIndex), version: String(version) });
      const response = await fetch('/api/echo/learning?' + params, { cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok) { setError(response.status === 409 || response.status === 404 ? j.trialUnavailable : j.trialFailed); return; }
      const { trial } = await response.json();
      if (typeof trial?.path !== 'string' || typeof trial?.title !== 'string') throw new Error('Missing method');
      if (request.signal.aborted) return;
      openAskModal(j.trialInstruction + '\n\n' + task.trim(), 'user', null, { newSession: true, context: { path: trial.path, type: 'file', label: trial.title } });
      setOpened(true);
    } catch { if (!request.signal.aborted) setError(j.trialFailed); }
    finally { controller.current = null; if (!request.signal.aborted) setBusy(false); }
  }
  return <details className="rounded-lg border border-border">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowUpRight size={16} aria-hidden />{j.trial}</summary>
    <form className="space-y-3 px-3 pb-4" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
      <p className="text-xs leading-5 text-muted-foreground">{j.trialHint}</p>
      <fieldset disabled={disabled || busy} className="min-w-0 space-y-3">
        <label className="block space-y-2"><span className="text-sm">{j.trialTask}</span>
          <textarea name="methodTrialTask" required maxLength={4000} rows={3} value={task} onChange={(event) => { setTask(event.target.value); setOpened(false); }} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
        <Button type="submit" disabled={!task.trim()} className="min-h-11 bg-primary text-primary-foreground">{busy ? j.trialPreparing : j.trialPrepare}</Button>
      </fieldset>
      {error ? <p role="alert" className="text-sm leading-6 text-error">{error}</p> : null}
      {opened ? <p role="status" className="text-sm leading-6 text-muted-foreground">{j.trialOpened}</p> : null}
    </form>
  </details>;
}
