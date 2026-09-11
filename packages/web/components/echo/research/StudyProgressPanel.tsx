'use client';
import type { StudyProgress } from '@geminilight/mindos/knowledge';
import { cn } from '@/lib/utils';
import { studyNote } from './StudyFields';
const copy = {
  en: {
    title: 'Participant progress', empty: 'No one has joined yet. Progress appears here as invitations are used.',
    enrolled: 'Joined', active: 'In progress', waiting: 'Waiting for delay', complete: 'Complete', withdrawn: 'Withdrawn', ratings: 'Scores saved', failedRuns: 'Failed replies',
    participant: 'Participant', condition: 'Condition', stage: 'Stage', help: 'Agent replies', succeeded: 'completed', failed: 'failed', missing: 'missing', erased: 'answers erased', due: 'Delayed task opens', updated: 'Updated',
    status: { ready: 'Ready for the next task', answering: 'Working on a task', waiting: 'Waiting for the delayed task', complete: 'Complete', withdrawn: 'Withdrawn' },
    phases: ['Initial judgment', 'Practice with help', 'New situation', 'Delayed situation'],
    note: 'Researcher view only. Answers stay in review packets and the study record; conditions are visible here but never to reviewers.',
  },
  zh: {
    title: '参与进度', empty: '还没有人加入。参与者使用邀请后，进度会显示在这里。',
    enrolled: '已加入', active: '进行中', waiting: '等待延迟任务', complete: '已完成', withdrawn: '已退出', ratings: '已保存评分', failedRuns: '失败回复',
    participant: '参与者', condition: '条件', stage: '阶段', help: 'Agent 回复', succeeded: '完成', failed: '失败', missing: '缺失', erased: '作答已删除', due: '延迟任务开放', updated: '更新于',
    status: { ready: '可开始下一任务', answering: '正在作答', waiting: '等待延迟任务', complete: '已完成', withdrawn: '已退出' },
    phases: ['初始判断', '获得帮助的练习', '新情境', '延迟新情境'],
    note: '仅研究者可见。回答保存在评审工作包和研究记录中；条件在这里可见，但不会显示给评审者。',
  },
};
export function StudyProgressPanel({ progress, locale }: { progress: StudyProgress; locale: 'en' | 'zh' }) {
  const p = copy[locale]; const format = (value?: string) => (value ? new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') : '');
  const { summary, participants } = progress;
  const tiles: [string, string | number][] = [[p.enrolled, `${summary.enrolled} / ${summary.capacity}`], [p.active, summary.active], [p.waiting, summary.waiting], [p.complete, summary.complete], [p.withdrawn, summary.withdrawn], [p.ratings, summary.ratings]];
  if (summary.failedRuns) tiles.push([p.failedRuns, summary.failedRuns]);
  return <section className="space-y-4 border-t border-border pt-5" aria-labelledby="study-progress-title">
    <div className="space-y-1"><h2 id="study-progress-title" className="font-display text-xl">{p.title}</h2><p className={studyNote}>{p.note}</p></div>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map(([label, value]) => <div key={label} className="rounded-lg border border-border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-mono text-xl">{value}</dd></div>)}
    </dl>
    {!participants.length ? <p className={studyNote}>{p.empty}</p> : <ul className="divide-y divide-border rounded-xl border border-border">
      {participants.map(item => <li key={item.id} className="space-y-1 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">P{item.ordinal + 1}</span>
          <span className="text-muted-foreground">{p.condition} · {item.conditionId}</span>
          <span className={cn('inline-flex min-h-6 items-center rounded-md border px-2 text-xs leading-5', item.status === 'complete' ? 'border-success/40 text-success' : 'border-border text-muted-foreground')}>{p.status[item.status as keyof typeof p.status] ?? item.status}</span>
          {item.status !== 'withdrawn' && item.nextPhase ? <span className="text-muted-foreground">{p.stage} {item.completedStages + 1}/4 · {p.phases[item.completedStages] ?? ''}</span> : null}
          {item.erased ? <span className="inline-flex min-h-6 items-center rounded-md border border-border px-2 text-xs text-muted-foreground">{p.erased}</span> : null}
          {item.helpFailed ? <span className="inline-flex min-h-6 items-center rounded-md border border-error/40 px-2 text-xs text-error">{item.helpFailed} {p.failed}</span> : null}
        </div>
        <p className={studyNote}>
          {p.help} {item.helpSucceeded} {p.succeeded}{item.missing ? ` · ${item.missing} ${p.missing}` : ''}
          {item.status === 'waiting' && item.dueAt ? ` · ${p.due} ${format(item.dueAt)}` : ''} · {p.updated} {format(item.updatedAt)}
        </p>
      </li>)}
    </ul>}
  </section>;
}
