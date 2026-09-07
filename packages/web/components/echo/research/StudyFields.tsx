'use client';
import { useEffect, useState } from 'react';
import type { StudyProtocol } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { blankCondition, draftValue, studyFields, type StudyLocale } from './study-draft';
import { coachingCopy } from './coaching-copy';
import { studyCopy } from './study-copy';

export const studyControl = 'min-h-11 border-[var(--muted-foreground)]';
export const studyNote = 'text-sm leading-6 text-[var(--prose-muted)]';
const area = 'w-full rounded-lg border border-[var(--muted-foreground)] bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export function StudyTextField({ name, label, value, max, multiline, onChange }: {
  name: string; label: string; value: string; max: number; multiline?: boolean; onChange: (value: string) => void;
}) {
  return <label className="block space-y-2 text-sm font-medium" htmlFor={'study-' + name}>
    <span>{label}</span>
    {multiline ? <textarea id={'study-' + name} name={name} value={value} maxLength={max} rows={4} onChange={e => onChange(e.target.value)} className={area + ' font-normal'} />
      : <Input id={'study-' + name} name={name} value={value} maxLength={max} onChange={e => onChange(e.target.value)} className={studyControl + ' font-normal'} />}
  </label>;
}
function NumberField({ name, label, value, min, max, onChange }: { name: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="block space-y-2 text-sm font-medium" htmlFor={'study-' + name}><span>{label}</span>
    <Input id={'study-' + name} name={name} type="number" min={min} max={max} step={1} required value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} className={studyControl + ' max-w-52 font-normal'} />
  </label>;
}
export function StudyFields({ protocol, locale, step, focusPath, change, replace }: {
  protocol: StudyProtocol; locale: StudyLocale; step: number; focusPath: string;
  change: (path: string, value: unknown) => void; replace: (protocol: StudyProtocol) => void;
}) {
  const p = studyCopy[locale]; const [condition, setCondition] = useState(0); const [task, setTask] = useState(0); const [criterion, setCriterion] = useState(0);
  useEffect(() => {
    if (!focusPath) return;
    const [group, index] = focusPath.split('.');
    if (group === 'conditions') setCondition(Number(index));
    if (group === 'tasks') setTask(Number(index));
    if (group === 'rubric') setCriterion(Number(index));
    const timer = setTimeout(() => document.getElementsByName(focusPath)[0]?.focus(), 0); return () => clearTimeout(timer);
  }, [focusPath]);
  const fields = studyFields(protocol, locale).filter(field => field.step === step &&
    (step === 0 || field.path.startsWith((step === 1 ? 'conditions.' + condition : step === 2 ? 'tasks.' + task : 'rubric.' + criterion) + '.')));
  const selections = step === 1 ? protocol.conditions.map((_, i) => `${p.condition} ${i + 1}`) : step === 2 ? p.phases : step === 3 ? protocol.rubric.map((_, i) => `${p.criterion} ${i + 1}`) : [];
  const select = step === 1 ? setCondition : step === 2 ? setTask : setCriterion;
  const current = step === 1 ? condition : step === 2 ? task : criterion;
  return <div className="space-y-6">
    {selections.length > 0 ? <div className="flex flex-wrap gap-2" aria-label={p.steps[step]}>{selections.map((label, i) => <Button key={i} variant={current === i ? 'default' : 'ghost'} className="min-h-11 h-auto whitespace-normal" aria-pressed={current === i} onClick={event => { if (event.currentTarget.closest('form')?.reportValidity()) select(i); }}>{label}</Button>)}</div> : null}
    {step > 0 ? <p className={studyNote}>{step === 1 ? p.conditionHint : step === 2 ? p.taskHint : p.rubricHint}</p> : null}
    {step === 1 ? <>
      <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input name="executionEnabled" type="checkbox" checked={!!protocol.execution} className="mt-1 size-5 accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring" onChange={event => { const next = { ...protocol }; if (event.target.checked) next.execution = { adapter: 'isolated-chat-v1', maxTurns: 2 }; else delete next.execution; replace(next); }} />{coachingCopy[locale].enabled}</label>
      {protocol.execution ? <><p className={studyNote}>{coachingCopy[locale].setup}</p><NumberField name="execution.maxTurns" label={coachingCopy[locale].turns} min={1} max={3} value={protocol.execution.maxTurns} onChange={value => change('execution.maxTurns', value)} /></> : null}
    </> : null}
    {fields.map(field => <StudyTextField key={field.path} name={field.path} label={field.label} value={String(draftValue(protocol, field.path) ?? '')} max={field.max} multiline={field.multiline} onChange={value => change(field.path, value)} />)}
    {step === 0 ? <><label className="block space-y-2 text-sm font-medium" htmlFor="study-locale"><span>{locale === 'zh' ? '任务材料语言' : 'Task material language'}</span><select id="study-locale" name="locale" value={protocol.locale} onChange={event => change('locale', event.target.value)} className={area + ' min-h-11'}><option value="en">English</option><option value="zh">中文</option></select></label><div className="grid gap-5 sm:grid-cols-2">
      <NumberField name="capacity" label={p.capacity} value={protocol.capacity} min={protocol.conditions.length} max={200} onChange={value => change('capacity', value)} />
      <NumberField name="delayDays" label={p.delay} value={protocol.delayDays} min={1} max={90} onChange={value => change('delayDays', value)} />
    </div><p className={studyNote}>{p.capacityHint}</p></> : null}
    {step === 1 ? <>
      {protocol.execution ? <NumberField name={`conditions.${condition}.expectedRuntime.temperature`} label={locale === 'zh' ? '采样温度（需与设置一致）' : 'Temperature (must match Settings)'} min={0} max={2} value={protocol.conditions[condition].expectedRuntime.temperature ?? 0} onChange={value => change(`conditions.${condition}.expectedRuntime.temperature`, value)} /> : null}
      <StudyTextField name={`conditions.${condition}.expectedRuntime.tools`} label={p.tools} multiline max={3630} value={protocol.conditions[condition].expectedRuntime.tools.join('\n')} onChange={value => change(`conditions.${condition}.expectedRuntime.tools`, value.split('\n'))} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className={studyControl} disabled={protocol.conditions.length >= 4 || protocol.conditions.length >= protocol.capacity} onClick={() => { const next = { ...protocol, conditions: [...protocol.conditions, blankCondition('condition-' + crypto.randomUUID().slice(0, 8))] }; replace(next); setCondition(next.conditions.length - 1); }}>{p.addCondition}</Button>
        {protocol.conditions.length > 2 ? <Button variant="ghost" className="min-h-11" onClick={() => { if (window.confirm(p.remove)) { replace({ ...protocol, conditions: protocol.conditions.filter((_, i) => i !== condition) }); setCondition(0); } }}>{p.removeCondition}</Button> : null}
      </div>
      {protocol.conditions.length < 4 && protocol.conditions.length >= protocol.capacity ? <p className={studyNote}>{locale === 'zh' ? '添加更多条件前，请先在“问题”中提高可登记人数上限。' : 'Before adding another condition, increase the enrollment limit in Question.'}</p> : null}
    </> : null}
    {step === 2 ? <NumberField name={`tasks.${task}.budgetSeconds`} label={p.budget} value={protocol.tasks[task].budgetSeconds} min={30} max={7200} onChange={value => change(`tasks.${task}.budgetSeconds`, value)} /> : null}
    {step === 3 ? <>
      <NumberField name={`rubric.${criterion}.maxScore`} label={p.scoreMax} value={protocol.rubric[criterion].maxScore} min={1} max={100} onChange={value => change(`rubric.${criterion}.maxScore`, value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className={studyControl} disabled={protocol.rubric.length >= 12} onClick={event => { if (!event.currentTarget.closest('form')?.reportValidity()) return; const next = { ...protocol, rubric: [...protocol.rubric, { id: 'criterion-' + crypto.randomUUID().slice(0, 8), label: '', description: '', maxScore: 3 }] }; replace(next); setCriterion(next.rubric.length - 1); }}>{p.addCriterion}</Button>
        {protocol.rubric.length > 1 ? <Button variant="ghost" className="min-h-11" onClick={() => { if (window.confirm(p.remove)) { replace({ ...protocol, rubric: protocol.rubric.filter((_, i) => i !== criterion) }); setCriterion(0); } }}>{p.removeCriterion}</Button> : null}
      </div>
    </> : null}
  </div>;
}
