'use client';
import type { StudyProtocol } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { draftValue, studyFields, type StudyField, type StudyLocale } from './study-draft';
import { coachingCopy } from './coaching-copy';
import { studyCopy } from './study-copy';
import { studyNote } from './StudyFields';

export function StudyReview({ protocol, locale, frozen, goToField }: { protocol: StudyProtocol; locale: StudyLocale; frozen: boolean; goToField: (field: StudyField) => void }) {
  const p = studyCopy[locale]; const fields = studyFields(protocol, locale); const missing = fields.filter(field => !String(draftValue(protocol, field.path) ?? '').trim());
  return <div className="space-y-5">
    {!frozen ? missing.length ? <section aria-label={p.missing}>
      <h3 className="font-medium">{p.missing} · {missing.length}</h3>
      <ul className="mt-2 divide-y divide-border">{missing.map(field => <li key={field.path}><Button variant="ghost" className="min-h-11 h-auto w-full justify-start whitespace-normal text-left" onClick={() => goToField(field)}>{field.label}</Button></li>)}</ul>
    </section> : <p className={studyNote}>{p.ready}</p> : null}
    {p.steps.slice(0, 4).map((label, step) => <details key={step} className="border-t border-border pt-1">
      <summary className="min-h-11 cursor-pointer rounded py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</summary>
      <dl className="space-y-5 pb-4">{fields.filter(field => field.step === step).map(field => <div key={field.path}>
        <dt className="text-sm font-medium">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-7 text-[var(--prose-muted)]">{String(draftValue(protocol, field.path) ?? '').trim() || '—'}</dd>
      </div>)}
        {step === 0 ? <><div><dt className="text-sm font-medium">{locale === 'zh' ? '任务材料语言' : 'Task material language'}</dt><dd className={studyNote}>{protocol.locale === 'zh' ? '中文' : 'English'}</dd></div><div><dt className="text-sm font-medium">{p.capacity}</dt><dd className={studyNote}>{protocol.capacity}</dd></div><div><dt className="text-sm font-medium">{p.delay}</dt><dd className={studyNote}>{protocol.delayDays}</dd></div></> : null}
        {step === 1 && protocol.execution ? <div><dt className="text-sm font-medium">{coachingCopy[locale].turns}</dt><dd className={studyNote}>{protocol.execution.maxTurns} · {coachingCopy[locale].setup}</dd></div> : null}
        {step === 1 ? protocol.conditions.map((condition, i) => <div key={condition.id}><dt className="text-sm font-medium">{p.condition} {i + 1} · {p.tools}</dt><dd className={studyNote + ' whitespace-pre-wrap break-words'}>{condition.expectedRuntime.tools.join('\n') || p.none}</dd></div>) : null}
        {step === 2 ? protocol.tasks.map((task, i) => <div key={task.phase}><dt className="text-sm font-medium">{p.phases[i]} · {p.budget}</dt><dd className={studyNote}>{task.budgetSeconds}</dd></div>) : null}
        {step === 3 ? protocol.rubric.map((criterion, i) => <div key={criterion.id}><dt className="text-sm font-medium">{p.criterion} {i + 1} · {p.scoreMax}</dt><dd className={studyNote}>{criterion.maxScore}</dd></div>) : null}
      </dl>
    </details>)}
  </div>;
}
