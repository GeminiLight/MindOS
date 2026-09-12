'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Repeat2, Layers3 } from 'lucide-react';
import type { LongitudinalProtocol, LongitudinalSummary } from '@geminilight/mindos/knowledge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ReadinessRow } from '../longitudinal/LongitudinalWorkspace';
import { longitudinalCopy } from '../longitudinal/longitudinal-copy';
import { studyNote } from './StudyFields';
import { researchHubCopy } from './research-hub-copy';

type Payload = { studies?: LongitudinalSummary[]; runtime?: LongitudinalProtocol['runtime'] | null; accessReady?: boolean };
export default function ResearchHub({ locale, fourStageCount }: { locale: 'en' | 'zh'; fourStageCount: number | null }) {
  const p = researchHubCopy[locale];
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  async function load() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; setFailed(false);
    try {
      const response = await fetch('/api/echo/longitudinal', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const body = await response.json().catch(() => ({})) as Payload;
      if (controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(body.studies)) throw new Error('readiness');
      setData(body);
    } catch { if (!controller.signal.aborted) setFailed(true); }
  }
  useEffect(() => { void load(); return () => request.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const studies = data?.studies ?? [];
  const active = studies.reduce((n, s) => n + s.active, 0);
  const pending = studies.reduce((n, s) => n + s.pendingReviews, 0);
  const runtime = data?.runtime ?? null;
  return (
    <section aria-labelledby="research-hub-title" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="research-hub-title" className="font-display text-xl">{p.designs}</h2><span className="text-xs text-muted-foreground">{p.designHint}</span></div>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="flex flex-col gap-4 rounded-xl border border-[var(--amber)]/30 bg-muted/20 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><Repeat2 size={22} strokeWidth={1.5} className="text-[var(--amber)]" aria-hidden /><span className="text-xs text-muted-foreground">{p.multiKicker}</span></div>
          <h3 className="font-display text-xl">{p.multiTitle}</h3>
          <p className={studyNote}>{p.multiBody}</p>
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">{data ? p.multiStats(studies.length, active, pending) : failed ? p.unknown : p.loading}</p>
          <Link href="/echo/research/longitudinal" className={buttonVariants({ variant: 'amber' }) + ' mt-auto min-h-11 w-fit gap-2 focus-visible:ring-2 focus-visible:ring-ring'}>{p.multiOpen}<ArrowRight size={16} aria-hidden /></Link>
        </article>
        <article className="flex flex-col gap-4 rounded-xl border border-border p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><Layers3 size={22} strokeWidth={1.5} className="text-muted-foreground" aria-hidden /><span className="text-xs text-muted-foreground">{p.fourKicker}</span></div>
          <h3 className="font-display text-xl">{p.fourTitle}</h3>
          <p className={studyNote}>{p.fourBody}</p>
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">{fourStageCount === null ? p.loading : p.fourStats(fourStageCount)}</p>
          <a href="#four-stage-drafts" className={buttonVariants({ variant: 'ghost' }) + ' mt-auto min-h-11 w-fit gap-2 focus-visible:ring-2 focus-visible:ring-ring'}>{p.fourOpen}<ArrowRight size={16} aria-hidden /></a>
        </article>
      </div>
      <section className="space-y-2" aria-labelledby="research-readiness-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="research-readiness-title" className="font-display text-lg">{p.readiness}</h3><span className="text-xs text-muted-foreground">{data && !failed ? p.configured(Number(!!runtime) + Number(!!data.accessReady)) : p.loading}</span></div>
        {failed ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm"><span>{p.unknown}</span><Button variant="outline" size="sm" className="min-h-11" onClick={() => void load()}>{p.retry}</Button></div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border px-4" aria-busy={!data}>
            <ReadinessRow ready={!!runtime} text={runtime ? p.modelReady(longitudinalCopy[locale].form.runtimeSummary(runtime.provider, runtime.model, runtime.temperature, runtime.maxOutputTokens)) : data ? p.modelMissing : p.loading} action={{ href: '/settings?tab=ai', label: p.aiSettings }} />
            <ReadinessRow ready={!!data?.accessReady} text={data?.accessReady ? p.accessReady : data ? p.accessMissing : p.loading} action={{ href: '/settings?tab=knowledge', label: p.settings }} />
            <li className="py-2 text-sm leading-6 text-muted-foreground">{p.materials}</li>
          </ul>
        )}
      </section>
      <details className="rounded-xl border border-border px-4">
        <summary className="min-h-11 cursor-pointer rounded py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.checklist}</summary>
        <ol className="list-decimal space-y-2 pb-4 pl-5 text-sm leading-6">{p.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      </details>
    </section>
  );
}
