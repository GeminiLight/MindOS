'use client';
import { learningRecordStatus } from './learning-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Sprout } from 'lucide-react';
import type { LearningLoop } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import EchoLearningEditor from './EchoLearningEditor';
import EchoTransferQueue from './EchoTransferQueue';
import EchoTransferPractice from './EchoTransferPractice';
import InquiryQueue from '../inquiries/InquiryQueue';
import { transferCopy } from './transfer-copy';
import { requestLearningNavigation } from './use-learning-draft-guard';
import { LEARNING_UPDATED, learningRequest, learningErrorMessage, reviewIsDue } from './learning-client';

export default function EchoLearningPanel() {
  const { t, locale } = useLocale();
  const p = t.echoLearning;
  const [loops, setLoops] = useState<LearningLoop[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [returningPractice, setReturningPractice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search); const id = params.get('learning');
    if (params.get('practice') === '1' && id && /^learn-[a-f0-9]{24}$/.test(id)) setReturningPractice(id);
  }, []);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const consumedLink = useRef<string | null>(null);
  const updatesDuringLoad = useRef(new Map<string, LearningLoop>());
  const reload = useCallback(async () => {
    controller.current?.abort();
    const ctrl = new AbortController(); controller.current = ctrl;
    const id = ++requestId.current;
    updatesDuringLoad.current.clear();
    setLoading(true);
    try {
      const data = await learningRequest(undefined, 'GET', ctrl.signal);
      if (!Array.isArray(data.loops)) throw new Error('Missing learning records');
      if (id === requestId.current) {
        const merged = new Map(data.loops.map((loop) => [loop.id, loop]));
        // A start/save can finish before the initial read. Keep both that write and the rest of the list.
        for (const loop of updatesDuringLoad.current.values()) {
          if ((merged.get(loop.id)?.version ?? 0) <= loop.version) merged.set(loop.id, loop);
        }
        setLoops([...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        const linked = new URLSearchParams(window.location.search).get('learning');
        if (linked && merged.has(linked) && consumedLink.current !== linked) {
          consumedLink.current = linked;
          setSelected((current) => current ?? linked);
          setArchived(merged.get(linked)!.archived);
        }
        setError('');
      }
    } catch (err) {
      if (!ctrl.signal.aborted && id === requestId.current) setError(learningErrorMessage(err, p));
    } finally { if (id === requestId.current) setLoading(false); }
  }, [p]);
  useEffect(() => {
    void reload();
    const update = (event: Event) => {
      const { loop, select } = (event as CustomEvent<{ loop: LearningLoop; select: boolean }>).detail;
      updatesDuringLoad.current.set(loop.id, loop);
      setLoops((current) => [loop, ...current.filter((item) => item.id !== loop.id)]);
      if (select && (selectedRef.current === loop.id || requestLearningNavigation())) { setSelected(loop.id); setArchived(loop.archived); }
    };
    window.addEventListener(LEARNING_UPDATED, update);
    window.addEventListener('focus', reload);
    return () => { ++requestId.current; controller.current?.abort(); window.removeEventListener(LEARNING_UPDATED, update); window.removeEventListener('focus', reload); };
  }, [reload]);
  const visible = loops.filter((loop) => loop.archived === archived);
  const current = loops.find((loop) => loop.id === selected);
  return (
    <section id="echo-learning" className="scroll-mt-4 space-y-4" aria-labelledby="echo-learning-title">
      <header className="space-y-2">
        <h2 id="echo-learning-title" className="flex items-center gap-2 font-display text-xl"><Sprout className="text-[var(--amber)]" size={20} aria-hidden />{p.title}</h2>
        <p className="max-w-2xl font-sans text-sm leading-6 text-muted-foreground">{p.lead}</p>
      </header>
      <InquiryQueue />
      <EchoTransferQueue loops={loops} />
      {loading ? <p className="text-sm text-muted-foreground" role="status">{p.loading}</p> : null}
      {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-error">{error}<Button className="min-h-11" variant="outline" size="sm" onClick={() => void reload()}>{p.reload}</Button></div> : null}
      {loops.length ? <>
        <div className="flex flex-wrap gap-2" role="group" aria-label={p.title}>
          {[false, true].map((value) => <Button key={String(value)} size="sm" variant="ghost" aria-pressed={archived === value}
            className={cn('min-h-11', archived === value && 'bg-muted')} onClick={() => setArchived(value)}>{value ? p.archived : p.active}</Button>)}
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((loop) => <li key={loop.id} className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2.5', selected === loop.id && 'bg-muted/40')}>
            <button type="button" aria-expanded={selected === loop.id} onClick={() => { if (selected !== loop.id && requestLearningNavigation()) setSelected(loop.id); }}
              className="min-h-11 min-w-0 rounded text-left font-sans text-sm font-medium leading-6 break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{loop.source.title}</button>
            <span className={cn('text-xs', reviewIsDue(loop) ? 'text-foreground' : 'text-muted-foreground')}>{learningRecordStatus(loop, p)}</span>
          </li>)}
        </ul>
      </> : null}
      {!loading && !error && visible.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-5">
        <p className="font-sans text-sm font-medium">{archived ? p.archived : p.empty}</p>
        {!archived ? <><p className="mt-1 text-sm leading-6 text-muted-foreground">{p.emptyHint}</p>
          <Link href="/echo/growth#echo-insight" className="mt-3 inline-flex min-h-11 items-center gap-1 rounded text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.findInsight}<ArrowUpRight size={14} aria-hidden /></Link></> : null}
      </div> : null}
      {returningPractice && !loading && !loops.some(loop => loop.id === returningPractice) ? <div className="space-y-2">
        <p className="text-sm leading-6 text-muted-foreground">{transferCopy[locale].sourceUnavailable}</p>
        <EchoTransferPractice key={returningPractice} learningId={returningPractice} locale={locale} archived />
      </div> : null}
      {current ? <EchoLearningEditor key={current.id} loop={current} p={p} /> : null}
    </section>
  );
}
