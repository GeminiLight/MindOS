'use client';
import { useEffect, useRef, useState } from 'react';
import type { StudyReviewAccessView } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { studyControl, studyNote } from './StudyFields';
import { reviewerCopy } from './reviewer-copy';
type Packet = Extract<StudyReviewAccessView, { kind: 'workspace' }>;
type Draft = { itemId: string; version: number; scores: Record<string, string>; rationale: string };
export function ReviewPacket({ view, locale, busy, send, onDirty }: {
  view: Packet; locale: 'en' | 'zh'; busy: boolean; send: (command: unknown) => Promise<StudyReviewAccessView | null>; onDirty: (dirty: boolean) => void;
}) {
  const p = reviewerCopy[locale];
  const [selected, setSelected] = useState(view.items[0]?.id ?? ''); const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null); const [pending, setPending] = useState<{ action: 'rate'; requestId: string; itemId: string; version: number; scores: Record<string, number>; rationale: string } | null>(null);
  const [saved, setSaved] = useState(false); const heading = useRef<HTMLHeadingElement>(null);
  const latest = new Map(view.assessments.map(a => [a.itemId, a]));
  const item = view.items.find(i => i.id === selected); const previous = latest.get(selected);
  const current: Draft = draft ?? { itemId: selected, version: previous?.version ?? 0, scores: Object.fromEntries(view.rubric.map(c => [c.id, previous ? String(previous.scores[c.id]) : ''])), rationale: previous?.rationale ?? '' };
  const dirty = !!draft || !!pending;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { heading.current?.focus(); }, [selected]);
  function choose(id: string, nextFilter = filter) {
    if (busy || dirty && !window.confirm(p.discard)) return;
    setSelected(id); setFilter(nextFilter); setDraft(null); setPending(null); setSaved(false);
  }
  const visible = view.items.filter(i => filter === 'all' || (saved && i.id === selected) || (filter === 'reviewed' ? latest.has(i.id) : !latest.has(i.id)));
  const index = visible.findIndex(i => i.id === selected);
  const valid = !!item && !!current.rationale.trim() && view.rubric.every(c => current.scores[c.id]?.trim() !== '' && Number.isInteger(Number(current.scores[c.id])) && Number(current.scores[c.id]) >= 0 && Number(current.scores[c.id]) <= c.maxScore);
  async function save() {
    if (busy || !valid || !dirty && previous) return;
    const command = pending ?? { action: 'rate' as const, requestId: crypto.randomUUID(), itemId: selected, version: current.version, scores: Object.fromEntries(view.rubric.map(c => [c.id, Number(current.scores[c.id])])), rationale: current.rationale };
    setPending(command);
    const result = await send(command);
    if (result?.kind === 'workspace') { setDraft(null); setPending(null); setSaved(true); }
  }
  if (!view.items.length) return <section className="space-y-3"><h2 className="font-display text-xl">{p.empty}</h2><p className={studyNote}>{p.emptyNote}</p></section>;
  return <section className="space-y-6">
    <p className={studyNote}>{p.progress} · {latest.size} / {view.items.length}</p>
    <div className="flex flex-wrap gap-2" aria-label={p.work}>{[['all', p.all], ['unreviewed', p.unreviewed], ['reviewed', p.reviewed]].map(([key, label]) => <Button key={key} variant={filter === key ? 'default' : 'ghost'} className="min-h-11" aria-pressed={filter === key} disabled={busy} onClick={() => { const items = view.items.filter(i => key === 'all' || (key === 'reviewed' ? latest.has(i.id) : !latest.has(i.id))); choose(items[0]?.id ?? '', key); }}>{label}</Button>)}</div>
    <label className="block space-y-2 text-sm"><span>{p.work}</span><select aria-label={p.work} disabled={busy || !visible.length} value={visible.some(i => i.id === selected) ? selected : ''} onChange={e => choose(e.target.value)} className={studyControl + ' block w-full border rounded-md bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'}>
      {!item ? <option value="">{p.noMatch}</option> : null}{visible.map(i => <option key={i.id} value={i.id}>{p.work} {i.id.slice(-8)} · {latest.has(i.id) ? p.reviewed : p.pending}</option>)}
    </select></label>
    {!item ? <p className={studyNote}>{selected ? p.missing : p.noMatch}</p> : <>
      <h2 ref={heading} tabIndex={-1} className="rounded font-display text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.work} {item.id.slice(-8)}</h2>
      <dl className="space-y-5">{[[p.task, item.prompt], [p.answer, item.answer], [p.reference, item.reference]].map(([label, value]) => <div key={label}><dt className={studyNote}>{label}</dt><dd className="mt-2 whitespace-pre-wrap break-words leading-7">{value}</dd></div>)}</dl>
      <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-5 border-t border-border pt-6">
        <h3 className="font-display text-lg">{p.criteria}</h3>
        <fieldset disabled={busy || !!pending} className="space-y-5">
          {view.rubric.map(c => <label key={c.id} className="block space-y-2 text-sm"><span className="font-medium">{c.label}</span><span className={studyNote + ' block whitespace-pre-wrap break-words'}>{c.description} · {p.scoreRange} 0–{c.maxScore}</span><Input name={'score-' + c.id} type="number" required min={0} max={c.maxScore} step={1} value={current.scores[c.id] ?? ''} className={studyControl + ' max-w-52'} onChange={e => { setDraft({ ...current, scores: { ...current.scores, [c.id]: e.target.value } }); setSaved(false); }} /></label>)}
          <label className="block space-y-2 text-sm"><span>{p.rationale}</span><textarea name="rationale" required maxLength={4000} rows={5} value={current.rationale} onChange={e => { setDraft({ ...current, rationale: e.target.value }); setSaved(false); }} className={studyControl + ' block w-full border rounded-md bg-background px-3 py-3 leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'} /></label>
        </fieldset>
        <p className={studyNote}>{pending ? p.uncertain : p.local}</p>
        <Button type="submit" className="min-h-11" disabled={busy || !valid || !dirty && !!previous}>{pending ? p.retrySave : previous ? p.revise : p.save}</Button>
        {saved ? <p role="status" className={studyNote}>{p.saved}</p> : null}
      </form>
      {previous ? <details className="border-t border-border pt-1"><summary className="min-h-11 cursor-pointer rounded py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.history}</summary><ol className="space-y-4">{view.assessments.filter(a => a.itemId === selected).map(a => <li key={a.version} className="space-y-2 py-2 text-sm"><p>{a.version} · <time dateTime={a.recordedAt}>{new Date(a.recordedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</time></p><p>{view.rubric.map(c => c.label + ': ' + a.scores[c.id] + '/' + c.maxScore).join(' · ')}</p><p className="whitespace-pre-wrap break-words leading-7">{a.rationale}</p></li>)}</ol></details> : null}
    </>}
    <div className="flex flex-wrap gap-3 border-t border-border pt-5"><Button variant="outline" className={studyControl} disabled={busy || index <= 0} onClick={() => choose(visible[index - 1].id)}>{p.previous}</Button><Button variant="outline" className={studyControl} disabled={busy || index < 0 || index >= visible.length - 1} onClick={() => choose(visible[index + 1].id)}>{p.next}</Button></div>
  </section>;
}
