'use client';
import type { MethodComparison } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import type { ComparisonCopy } from './method-comparison-copy';
export const comparisonField = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export type ComparisonJudgment = { outcome: 'met' | 'missed' | 'uncertain'; quote: string; reason: string };
export const emptyJudgment: ComparisonJudgment = { outcome: 'uncertain', quote: '', reason: '' };
export default function EchoComparisonResults({ record: c, p, busy, retry, drafts, edit, assess }: {
  record: MethodComparison; p: ComparisonCopy; busy: boolean; retry: (slot: number) => void;
  drafts: Record<string, ComparisonJudgment>; edit: (id: string, value: ComparisonJudgment) => void; assess: (id: string) => void;
}) {
  return <div className="space-y-7">{c.cases.map(item => <section key={item.kind} className="space-y-3">
    <h5 className="font-display text-base">{p[item.kind]}</h5>
    <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.task}</p>
    <div className="border-l-2 border-border pl-3 text-sm leading-6"><p className="font-medium">{p.expected}</p><p className="whitespace-pre-wrap break-words">{item.expected}</p></div>
    {Array.from({ length: c.repetitions }, (_, repetition) => <div key={repetition} className="space-y-2">
      <p className="text-xs text-muted-foreground">{p.repeat} {repetition + 1}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">{([0, 1] as const).map(side => {
        const slot = c.slots.findIndex(s => s.kind === item.kind && s.repetition === repetition && s.side === side);
        const runs = c.runs.filter(r => r.slot === slot);
        return <div key={side} className="min-w-0 space-y-3 rounded-lg border border-border p-3">
          <h6 className="text-sm font-medium">{p.version} {c.methods[side].revisionIndex + 1}</h6>
          {!runs.length ? <p className="text-sm text-muted-foreground">{p.waiting}</p> : null}
          {[...runs].reverse().map(run => {
            const attempt = runs.indexOf(run);
            const judgments = c.assessments.filter(a => a.runId === run.id), latest = judgments.at(-1);
            const draft = drafts[run.id] ?? emptyJudgment;
            return <div key={run.id} className="space-y-3 border-t border-border pt-3">
              <p className="text-sm font-medium">{p.attempt} {attempt + 1} · {p[run.status]}</p>
              {run.failure ? <p className="text-sm leading-6">{p[run.failure]}</p> : null}
              {run.status === 'unknown' || run.status === 'running' ? <p className="text-sm leading-6 text-muted-foreground">{p.unknownHint}</p> : null}
              {run.status === 'failed' || run.status === 'unknown' ? <p className="text-sm leading-6 text-muted-foreground">{p.failureHint}</p> : null}
              {run.output ? <p className="whitespace-pre-wrap break-words text-sm leading-6">{run.output}</p> : null}
              {run.status === 'succeeded' && run.reportedModel !== c.runtime.model ? <p className="border-l-2 border-border pl-3 text-sm leading-6">{run.reportedModel ? p.mismatch + ' (' + run.reportedModel + ')' : p.missingModel}</p> : null}
              {latest ? <div className="space-y-1 border-l-2 border-[var(--amber)] pl-3 text-sm leading-6"><p className="font-medium">{p.judgment} · {p[latest.outcome]}</p><blockquote className="whitespace-pre-wrap break-words">{latest.quote}</blockquote><p className="whitespace-pre-wrap break-words">{latest.reason}</p></div> : null}
              {judgments.length > 1 ? <details><summary className="min-h-11 cursor-pointer rounded py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.history}</summary><ol className="space-y-3">{judgments.slice(0, -1).map(a => <li key={a.requestId} className="text-sm leading-6"><p>{p[a.outcome]} · {a.recordedAt.slice(0, 10)}</p><p className="whitespace-pre-wrap break-words">{a.quote}</p><p className="whitespace-pre-wrap break-words">{a.reason}</p></li>)}</ol></details> : null}
              {run.status === 'succeeded' ? <details><summary className="min-h-11 cursor-pointer rounded py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.judgment}</summary>
                <form onSubmit={event => { event.preventDefault(); assess(run.id); }}><fieldset disabled={busy} className="min-w-0 space-y-3">
                  <label className="block space-y-2"><span className="text-sm">{p.outcome}</span><select className={comparisonField} value={draft.outcome} onChange={e => edit(run.id, { ...draft, outcome: e.target.value as ComparisonJudgment['outcome'] })}>{(['uncertain', 'met', 'missed'] as const).map(value => <option key={value} value={value}>{p[value]}</option>)}</select></label>
                  {(['quote', 'reason'] as const).map(key => <label key={key} className="block space-y-2"><span className="text-sm">{p[key]}</span><textarea name={'comparison-' + run.id + '-' + key} required maxLength={key === 'quote' ? 1200 : 1600} rows={3} className={comparisonField} value={draft[key]} onChange={e => edit(run.id, { ...draft, [key]: e.target.value })} /></label>)}
                  <Button type="submit" className="min-h-11" variant="outline" disabled={!draft.quote.trim() || !draft.reason.trim()}>{p.save}</Button>
                </fieldset></form>
              </details> : null}
            </div>;
          })}
          {runs.length === 1 && ['failed', 'unknown'].includes(runs[0].status) ? <Button type="button" className="min-h-11 h-auto whitespace-normal" variant="outline" disabled={busy || c.runs.some(r => r.status === 'running')} onClick={() => retry(slot)}>{p.retry}</Button> : null}
        </div>;
      })}</div>
    </div>)}
  </section>)}</div>;
}
