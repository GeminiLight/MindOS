'use client';
import { X } from 'lucide-react';
import type { BranchStory, ReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import { ReplayArtifactView, ReplayJudgmentFeedback } from './ReplayParticipation';
import { ReplaySignals } from './ReplayLearning';
import type { ReplayCopy } from './replay-copy';
import type { ReplayJudgment } from './replay-judgments';

/** Normal-scale reading stays separate from the scale of the navigable map. */
export function ReplayMomentPanel({story,state,copy,entry,onChange,onClose,onInspect}:{story:BranchStory;state:ReplayState;copy:ReplayCopy;entry?:ReplayJudgment;onChange:(patch:Partial<ReplayJudgment>)=>void;onClose:()=>void;onInspect:()=>void}){
 const scene=story.scenes[state.sceneIndex];const choice=scene.choices.find(c=>c.id===state.choiceId);if(!choice)return null;
 const step=choice.outcome.steps[state.visibleSteps-1];const unknown=choice.outcome.kind==='unobserved';
 const artifacts=(step?.artifactIds??[]).flatMap(id=>story.artifacts?.filter(a=>a.id===id)??[]);
 return <section className="replay-moment-panel nowheel nopan" aria-label={copy.readCurrent}>
  <header className="replay-moment-header"><div><p className="text-xs text-muted-foreground">{state.historyFrom?copy.historicalRoute:copy.yourNow} · {choice.label}</p><h2 className="mt-2 text-lg font-semibold leading-7">{unknown?choice.outcome.title:step?.title??copy.notRevealed}</h2></div><Button variant="ghost" size="icon-sm" aria-label={copy.onlyMap} onClick={onClose}><X size={15}/></Button></header>
  <div className="replay-moment-body" key={`${scene.id}/${choice.id}/${state.visibleSteps}`}>
   {state.historyFrom&&<p className="replay-history-boundary" role="status">{copy.historyBoundary}</p>}
   {artifacts.map(artifact=><ReplayArtifactView key={artifact.id} artifact={artifact} copy={copy}/>)}
   <p className="text-sm leading-7">{unknown?copy.noResult:step?.text}</p>
   {step?.signals&&<ReplaySignals signals={step.signals}/>}
   {unknown&&choice.tradeoff&&<p className="mt-3 text-sm leading-7 text-muted-foreground">{copy.checkNext} · {choice.tradeoff.check}</p>}
   {!unknown&&<Button variant="ghost" size="sm" className="mt-3" onClick={onInspect}>{copy.detail}</Button>}
   {state.phase==='complete'&&choice.rejoin&&<p className="replay-rejoin text-sm leading-7">{choice.rejoin.note}</p>}
   {(unknown||entry?.prediction||artifacts.length>0)&&<ReplayJudgmentFeedback entry={entry} copy={copy} onChange={onChange} unknown={unknown}/>}
  </div>
 </section>;
}
