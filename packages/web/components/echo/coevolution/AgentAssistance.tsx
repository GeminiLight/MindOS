"use client";
import type { CoevolutionTask, CoevolutionIntent, Inquiry } from '@geminilight/mindos/knowledge';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WorkspaceFeature } from './workspace-copy';
import { note, say } from './editor-shared';

export function AgentAssistance({ task, feature, inquiry, locale, busy, request }: { task: CoevolutionTask; feature: WorkspaceFeature; inquiry?: Inquiry | null; locale: string; busy: boolean; request: (intent: CoevolutionIntent) => void }) {
  const completed = feature === 'correction' && task.corrections.at(-1)?.status === 'confirmed'
    || feature === 'experiment' && task.agreements.some(a => a.status === 'trying' || a.status === 'kept')
    || feature === 'transfer' && task.applications.length > 0
    || feature === 'disagreement' && !!inquiry?.plans.length;
  const labels: Record<WorkspaceFeature, [string, string]> = {
    decision: ['从经历找一个关键取舍', 'Find a meaningful choice'],
    handoff: ['按这个方式继续', 'Continue with this approach'],
    correction: ['从经历找出我的纠偏', 'Find my correction in the session'],
    disagreement: ['先帮我整理两种观点', 'Draft the two perspectives'],
    transfer: ['帮我比较这次的适用条件', 'Compare when this method fits'],
    experiment: ['提出一个可以试一次的合作方式', 'Suggest one collaboration trial'],
  };
  const canRequest = feature !== 'handoff' && feature !== 'decision'
    && !(feature === 'correction' && task.corrections.at(-1)?.status === 'draft')
    && !(feature === 'disagreement' && inquiry?.draft?.explanationA)
    && !(feature === 'experiment' && task.agreements.at(-1)?.status === 'proposed');
  const run = [...task.runs].sort((a,b) => b.startedAt - a.startedAt)[0];
  if (!canRequest && !run?.collaboration) return null;
  return <div className="mb-5 space-y-3 border-b border-border pb-4">
    {canRequest && <>
      {completed && <p className={note}>{say(locale, '把刚才的决定用在下一小步，再看具体输出是否符合。', 'Use your decision on the next small step, then inspect the output.')}</p>}
      <Button data-co-primary-action disabled={busy} variant="outline" className="h-auto min-h-11 w-full whitespace-normal text-left" onClick={() => request(completed ? 'continue' : feature)}>
        {completed ? say(locale, '带着这个决定继续一小步', 'Try the next step with this decision') : say(locale, ...labels[feature])}<ArrowUpRight size={14} className="shrink-0" />
      </Button>
    </>}
    {run?.collaboration && <details className="text-xs leading-6 text-muted-foreground">
      <summary className="cursor-pointer">{say(locale, '这轮携带的协作上下文', 'This run’s collaboration context')}</summary>
      <p className="mt-2">{say(locale, '这是本轮生成时附带的约定；是否完成并做到，请对照运行状态和实际输出。之后的修改用于下一轮。', 'These instructions accompanied this run. Check its status and actual output for completion and compliance. Later changes apply to the next turn.')}</p>
      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-sans">{run.collaboration.context}</pre>
      {run.output && <details><summary className="cursor-pointer py-2">{say(locale, '对照这轮输出', 'Compare this run’s output')}</summary><p className="whitespace-pre-wrap text-sm">{run.output}</p></details>}
    </details>}
  </div>;
}
