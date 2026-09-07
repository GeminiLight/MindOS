'use client';
import { useEchoDraft } from '../use-echo-draft';
import { useEffect, useRef, useState } from 'react';
import type { LearningLoop, MethodComparison, MethodComparisonRequest } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { useLearningDraftGuard } from './use-learning-draft-guard';
import { comparisonCopy } from './method-comparison-copy';
import EchoComparisonResults, { comparisonField as field, emptyJudgment, type ComparisonJudgment } from './EchoComparisonResults';
const endpoint = '/api/echo/method-comparisons';
const blankCases = () => (['use', 'exception', 'retention'] as const).map(kind => ({ kind, task: '', expected: '' }));
type Summary = { id: string; createdAt: string; revisions: number[] };
export default function EchoMethodComparison({ loop, attemptIndex, disabled }: { loop: LearningLoop; attemptIndex: number; disabled: boolean }) {
  const { locale } = useLocale(), p = comparisonCopy[locale];
  const family = attemptIndex === -1 ? loop.directMethod : loop.attempts[attemptIndex]?.agentChange;
  const methods = [family, ...(family?.revisions ?? [])].map((method, index) => ({ method, index })).filter(({ method }) => method?.review?.decision === 'approved');
  const [a, setA] = useEchoDraft(`${loop.id}:comparison:${attemptIndex}` + ":a", methods.at(-2)?.index ?? 0), [b, setB] = useEchoDraft(`${loop.id}:comparison:${attemptIndex}` + ":b", methods.at(-1)?.index ?? 1);
  const [cases, setCases] = useEchoDraft(`${loop.id}:comparison:${attemptIndex}` + ":cases", blankCases), [repetitions, setRepetitions] = useEchoDraft(`${loop.id}:comparison:${attemptIndex}` + ":repetitions", 2);
  const [runtime, setRuntime] = useState<MethodComparisonRequest['runtime'] | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]), [record, setRecord] = useState<MethodComparison | null>(null);
  const [loaded, setLoaded] = useState(false), [creating, setCreating] = useState(false), [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [error, setError] = useState<'error' | 'invalid' | 'conflict' | null>(null);
  const [drafts, setDrafts] = useEchoDraft<Record<string, ComparisonJudgment>>(`${loop.id}:comparison:${attemptIndex}` + ":drafts", {}), [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null), stop = useRef(false), batch = useRef(false), mounted = useRef(true);
  const initialLoad = useRef(false);
  const identities = useRef(new Map<string, { key: string; id: string }>());
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = cases.some(c => c.task || c.expected) || Object.keys(drafts).length > 0;
  const allowDiscard = useLearningDraftGuard(dirty, busy || running, p.unsaved);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; controller.current?.abort(); }; }, []);
  useEffect(() => { if (record && !creating) heading.current?.focus(); }, [record?.id, creating]);
  function identity(scope: string, value: unknown) {
    const key = JSON.stringify(value), old = identities.current.get(scope);
    if (old?.key === key) return old.id;
    const id = crypto.randomUUID(); identities.current.set(scope, { key, id }); return id;
  }
  async function call(url: string, method = 'GET', body?: Record<string, unknown>) {
    if (controller.current) return null;
    const ctrl = new AbortController(); controller.current = ctrl; setBusy(true); setError(null); setSaved(false);
    try {
      const response = await fetch(url, { method, cache: 'no-store', signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(method === 'PATCH' && body?.action === 'run' ? 100000 : 20000)]), ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const data = await response.json(); if (ctrl.signal.aborted || !mounted.current) return null;
      if (!response.ok) { setError(data.code === 'conflict' || data.code === 'invalid' ? data.code : 'error'); return null; }
      return data;
    } catch { if (mounted.current) setError('error'); return null; }
    finally { if (controller.current === ctrl) controller.current = null; if (mounted.current) setBusy(false); }
  }
  function adopt(c: MethodComparison) {
    setRecord(c); setCreating(false);
    setSummaries(current => [{ id: c.id, createdAt: c.createdAt, revisions: c.methods.map(m => m.revisionIndex) }, ...current.filter(s => s.id !== c.id)]);
  }
  async function load(id: string) { const data = await call(endpoint + '?id=' + id); if (data?.comparison) adopt(data.comparison); }
  async function refresh() {
    if (batch.current) return;
    const data = await call(endpoint + '?' + new URLSearchParams({ learningId: loop.id, attemptIndex: String(attemptIndex) }));
    if (!data || !Array.isArray(data.comparisons)) return;
    setLoaded(true); setSummaries(data.comparisons); setRuntime(data.runtime ?? null); setPartial(data.unavailableCount > 0);
    if (record && !creating) await load(record.id);
    else if (!dirty && data.comparisons[0]) await load(data.comparisons[0].id);
    else setCreating(true);
  }
  async function create() {
    if (busy || batch.current || disabled || loop.archived || !runtime || a >= b || cases.some(c => !c.task.trim() || !c.expected.trim())) return;
    const payload = { learningId: loop.id, attemptIndex, revisions: [a, b], repetitions, cases, runtime };
    const data = await call(endpoint, 'POST', { ...payload, version: loop.version, requestId: identity('freeze', payload) });
    if (data?.comparison) { adopt(data.comparison); setCases(blankCases()); identities.current.delete('freeze'); }
  }
  async function runSlots(slots: number[]) {
    if (!record || busy || batch.current) return;
    batch.current = true; stop.current = false; setRunning(true); let current = record;
    try {
      for (const slot of slots) {
        if (stop.current || !mounted.current) break;
        const requestId = identity('run', { id: current.id, slot, attempts: current.runs.filter(r => r.slot === slot).length });
        const data = await call(endpoint, 'PATCH', { id: current.id, action: 'run', version: current.version, slot, requestId });
        if (!data?.comparison) break;
        current = data.comparison; adopt(current);
        const run = current.runs.find(r => r.id === requestId);
        if (run?.status !== 'succeeded') break;
        identities.current.delete('run');
      }
    } finally { batch.current = false; if (mounted.current) setRunning(false); }
  }
  async function assess(runId: string) {
    if (!record || busy || batch.current) return;
    const payload = { id: record.id, runId, ...(drafts[runId] ?? emptyJudgment) };
    const data = await call(endpoint, 'PATCH', { ...payload, action: 'assess', version: record.version, requestId: identity('assess-' + runId, payload) });
    if (data?.comparison) { adopt(data.comparison); setDrafts(current => { const next = { ...current }; delete next[runId]; return next; }); identities.current.delete('assess-' + runId); setSaved(true); }
  }
  const remaining = record?.slots.flatMap((_, index) => record.runs.some(r => r.slot === index) ? [] : [index]) ?? [];
  const summaryClass = 'min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <details className="mt-4 border-t border-border" onToggle={event => { if (event.currentTarget.open && !initialLoad.current) { initialLoad.current = true; void refresh(); } }}>
    <summary className={summaryClass}>{p.title}</summary>
    <div className="space-y-5 pb-4" aria-busy={busy || running}>
      <p className="text-sm leading-6 text-muted-foreground">{p.lead}</p>
      {summaries.length ? <label className="block space-y-2"><span className="text-sm">{p.choose}</span><select className={field} disabled={busy || running} value={record?.id ?? ''} onChange={e => { if (allowDiscard()) { setCases(blankCases()); void load(e.target.value); } }}><option value="" disabled>—</option>{summaries.map(s => <option key={s.id} value={s.id}>{p.version} {s.revisions.map(i => i + 1).join(' / ')} · {new Date(s.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</option>)}</select></label> : null}
      {loaded && !creating && !loop.archived && methods.length >= 2 ? <Button className="min-h-11" variant="outline" disabled={busy || running || disabled} onClick={() => { if (allowDiscard()) { setDrafts({}); setCases(blankCases()); setCreating(true); } }}>{p.new}</Button> : null}
      {loaded && creating ? <form onSubmit={event => { event.preventDefault(); void create(); }}><fieldset disabled={busy || running || disabled || loop.archived} className="min-w-0 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">{([['old', a, setA], ['next', b, setB]] as const).map(([label, value, set]) => <label key={label} className="block space-y-2"><span className="text-sm">{p[label]}</span><select className={field} value={value} onChange={e => set(Number(e.target.value))}>{methods.map(m => <option key={m.index} value={m.index}>{p.version} {m.index + 1}</option>)}</select></label>)}</div>
        <details><summary className={summaryClass}>{p.method}</summary><p className="mb-4 text-sm leading-6 text-muted-foreground">{p.material}</p><div className="grid gap-4 sm:grid-cols-2">{[a, b].map((index, side) => <div key={side} className="space-y-2"><p className="text-sm font-medium">{p.version} {index + 1}</p>{(['behavior', 'scope', 'check'] as const).map(key => <p key={key} className="whitespace-pre-wrap break-words text-sm leading-6"><span className="font-medium">{p[key]}: </span>{methods.find(m => m.index === index)?.method?.[key]}</p>)}</div>)}</div></details>
        {cases.map((c, index) => <div key={c.kind} className="space-y-3 border-t border-border pt-4"><h5 className="text-sm font-medium">{p[c.kind]}</h5>{(['task', 'expected'] as const).map(key => <label key={key} className="block space-y-2"><span className="text-sm">{p[key]}</span><textarea name={'comparison-' + c.kind + '-' + key} required rows={3} maxLength={key === 'task' ? 4000 : 1600} className={field} value={c[key]} onChange={e => setCases(current => current.map((item, i) => i === index ? { ...item, [key]: e.target.value } : item))} /></label>)}</div>)}
        <label className="block space-y-2"><span className="text-sm">{p.repetitions}</span><select className={field} value={repetitions} onChange={e => setRepetitions(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
        <p className="text-sm leading-6">{repetitions * 6} {p.budget.replace('{tokens}', String(runtime?.maxOutputTokens ?? 1024))}</p>
        <p className="break-words text-sm leading-6">{runtime ? p.runtime + ': ' + runtime.provider + ' / ' + runtime.model : p.unavailable}</p>
        <Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={!runtime || a >= b || cases.some(c => !c.task.trim() || !c.expected.trim())}>{p.fixed}</Button>
      </fieldset></form> : null}
      {creating && record ? <Button className="min-h-11" variant="ghost" disabled={busy || running} onClick={() => { if (allowDiscard()) { setCases(blankCases()); setCreating(false); } }}>{p.back}</Button> : null}
      {record && !creating ? <>
        <h5 ref={heading} tabIndex={-1} className="scroll-mt-20 rounded font-display text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.frozen} · {p.version} {record.methods.map(m => m.revisionIndex + 1).join(' / ')}</h5>
        <p className="text-sm leading-6 text-muted-foreground">{p.frozenHint}</p><p className="break-words text-sm leading-6">{p.runtime}: {record.runtime.provider} / {record.runtime.model} · {record.slots.length} {p.budget.replace('{tokens}', String(record.runtime.maxOutputTokens))}</p>
        <div className="flex flex-wrap gap-2">{remaining.length ? <Button className="min-h-11 h-auto whitespace-normal" disabled={busy || running || record.runs.some(r => r.status === 'running')} onClick={() => void runSlots(remaining)}>{p.run} ({remaining.length})</Button> : null}
          {running ? <Button className="min-h-11" variant="outline" onClick={() => { stop.current = true; controller.current?.abort(); }}>{p.stop}</Button> : null}
          <a download href={endpoint + '?id=' + record.id + '&format=json'} className="inline-flex min-h-11 items-center rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.export}</a>
        </div>
        <EchoComparisonResults record={record} p={p} busy={busy || running} retry={slot => void runSlots([slot])} drafts={drafts} edit={(id, value) => setDrafts(current => ({ ...current, [id]: value }))} assess={id => void assess(id)} />
      </> : null}
      {running || busy ? <p role="status" className="text-sm">{running ? p.running : p.loading}</p> : null}
      {saved ? <p role="status" className="text-sm">{p.saved}</p> : null}
      {partial ? <p role="status" className="text-sm text-muted-foreground">{p.partial}</p> : null}
      {error ? <p role="alert" className="border-l-2 border-error pl-3 text-sm leading-6">{p[error]}</p> : null}
      {loaded || error ? <Button className="min-h-11" variant="ghost" disabled={busy || running} onClick={() => void refresh()}>{p.refresh}</Button> : null}
    </div>
  </details>;
}
