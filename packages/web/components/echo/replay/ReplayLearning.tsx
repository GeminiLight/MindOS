'use client';
import type { ReplayScene, ReplaySignal, ReplayState, ReplayTradeoff as Tradeoff } from '@geminilight/mindos/knowledge/branch-replay';
import type { ReplayCopy } from './replay-copy';
import { learningForScene } from './replay-learning';

export function ReplayTradeoff({tradeoff,copy}:{tradeoff:Tradeoff;copy:ReplayCopy}){
 return <span className="replay-tradeoff"><span><span>{copy.gain}</span>{tradeoff.benefit}</span><span><span>{copy.cost}</span>{tradeoff.cost}</span></span>;
}
export function ReplaySignals({signals}:{signals:ReplaySignal[]}){
 return <dl className="replay-signals">{signals.map((signal,index)=><div key={index}><dt>{signal.label}</dt><dd className="font-mono">{signal.value}</dd></div>)}</dl>;
}
export function ReplayLearningNote({scene,state,copy,compare=false}:{scene:ReplayScene;state:ReplayState;copy:ReplayCopy;compare?:boolean}){
 const learning=learningForScene(scene,state);const clue=learning.steps.at(-1);
 if(!scene.reconsideration||!clue)return null;
 return <aside className="replay-learning-note" aria-label={compare?copy.changedJudgment:copy.revisitWithClue}>
  <p className="text-xs font-medium">{compare?copy.changedJudgment:copy.revisitWithClue}</p>
  {!compare&&<p className="mt-2 text-xs leading-6 text-muted-foreground">{copy.observedClue} · {clue.title}</p>}
  <p className="mt-2 text-sm leading-7">{learning.prompt??copy.thinkAgain}</p>
  {compare&&learning.insight&&<p className="mt-3 text-sm leading-7 text-muted-foreground">{learning.insight}</p>}
 </aside>;
}
