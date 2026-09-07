'use client';
import { useEffect, useState } from 'react';
import type { StudyParticipantView } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { studyControl, studyNote } from './StudyFields';
import { coachingCopy } from './coaching-copy';
export function StudyCoaching({ participant, locale, busy, send, refresh, onDirty }: {
  participant: StudyParticipantView; locale: 'en' | 'zh'; busy: boolean;
  send: (command: unknown) => Promise<boolean | undefined>; refresh: () => void; onDirty: (dirty: boolean) => void;
}) {
  const p = coachingCopy[locale];
  const [question, setQuestion] = useState(''); const [requestId, setRequestId] = useState('');
  const coaching = participant.coaching!;
  const pending = coaching.runs.some(run => run.status === 'pending');
  const completed = coaching.runs.filter(run => run.status === 'succeeded').length;
  const exhausted = completed >= coaching.maxTurns || coaching.runs.length >= 6;
  useEffect(() => { onDirty(!!question); return () => onDirty(false); }, [question, onDirty]);
  async function ask() {
    if (busy || pending || exhausted || !question.trim()) return;
    const identity = requestId || crypto.randomUUID(); setRequestId(identity);
    const saved = await send({ action: 'help', version: participant.version, requestId: identity, question });
    if (saved) { setQuestion(''); setRequestId(''); }
  }
  return <section className="space-y-5 border-b border-border pb-7 mb-7" aria-label={p.title}>
    <h2 className="font-display text-xl">{p.title}</h2><p className={studyNote}>{p.note}</p>
    <p className={studyNote} aria-live="polite">{p.count} · {completed} / {coaching.maxTurns}</p>
    {coaching.runs.map((run, index) => <article key={run.id} className="space-y-3 border-l-2 border-border pl-4">
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{index + 1}. {run.question}</p>
      {run.status === 'succeeded' ? <p className="whitespace-pre-wrap break-words leading-7">{run.output}</p> : <p role="status" className={studyNote}>{run.status === 'pending' ? p.pending : run.status === 'interrupted' ? p.interrupted : p.failed}</p>}
    </article>)}
    {pending ? <Button type="button" variant="outline" className={studyControl} disabled={busy} onClick={refresh}>{p.check}</Button> : exhausted ? <p className={studyNote}>{p.limit}</p> : <>
      <label className="block space-y-2 text-sm"><span>{p.question}</span><textarea name="helpQuestion" rows={3} maxLength={2000} value={question} disabled={busy || !!requestId} onChange={event => setQuestion(event.target.value)} className={studyControl + ' block w-full border rounded-md bg-background px-3 py-3 leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'} /></label>
      <Button type="button" variant="outline" className={studyControl} disabled={busy || !question.trim()} onClick={() => void ask()}>{requestId ? p.retry : p.ask}</Button>
    </>}
  </section>;
}
