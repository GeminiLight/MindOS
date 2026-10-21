'use client';
import { useState } from 'react';
import { ArrowUpLeft, GitBranch } from 'lucide-react';
import type { BranchStory, ReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import { EvidenceExcerpt } from './ReplayEvidence';
import type { ReplayCopy } from './replay-copy';
import { ReplayArtifactView, ReplayTransferExercise } from './ReplayParticipation';
import { judgmentKey, type ReplayJudgments } from './replay-judgments';
import { ReplayLearningNote, ReplaySignals } from './ReplayLearning';

/** A reading of revealed history, never a summary of unopened results. */
export function ReplayJourneyReview({story,state,copy,onRevisit,judgments,onTransfer}:{story:BranchStory;state:ReplayState;copy:ReplayCopy;onRevisit:(index:number)=>void;judgments?:ReplayJudgments;onTransfer?:(id:string)=>void}){
 const key=`mindos:branch-replay:${story.id}:takeaway`;
 const [takeaway,setTakeaway]=useState(()=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return value?.fingerprint===story.fingerprint&&typeof value.text==='string'?value.text.slice(0,1200):'';}catch{return '';}});
 const [saved,setSaved]=useState(true);
 const explored=story.scenes.map((scene,index)=>({scene,index,attempts:state.attempts.filter(a=>a.sceneId===scene.id)})).filter(item=>item.attempts.length);
 const write=(text:string)=>{setTakeaway(text);try{localStorage.setItem(key,JSON.stringify({fingerprint:story.fingerprint,text}));setSaved(true);}catch{setSaved(false);}};
 return <section className="replay-journey" aria-label={copy.decisionChain}>
  <div className="replay-journey-intro"><GitBranch size={19}/><div><h2 className="text-lg font-semibold">{copy.decisionChain}</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">{copy.chainScope}</p></div></div>
  {!explored.length?<p className="py-10 text-sm text-muted-foreground">{copy.emptyChain}</p>:<>
   <ReplayTransferExercise story={story} state={state} copy={copy} selected={judgments?.transferId} onSelect={onTransfer??(()=>{})}/>
   <ol className="replay-journey-list">{explored.map(({scene,index,attempts})=><li key={scene.id}>
    <div className="replay-journey-fork"><span className="replay-journey-number font-mono">{String(index+1).padStart(2,'0')}</span><h3 className="text-base font-semibold leading-7">{scene.title}</h3><Button variant="ghost" size="sm" onClick={()=>onRevisit(index)}><ArrowUpLeft size={13}/>{copy.rechoose}</Button></div>
    <p className="mt-3 text-sm leading-7 text-muted-foreground">{scene.context}</p>
    {attempts.map(attempt=>{const choice=scene.choices.find(c=>c.id===attempt.choiceId);if(!choice)return null;const steps=choice.outcome.steps.slice(0,attempt.visibleSteps);const judgment=judgments?.entries[judgmentKey(scene.id,choice.id)];return <div className="replay-journey-attempt" key={choice.id}>
     <p className="text-sm font-medium leading-7">{attempt.selection==='historical'?copy.historicalRoute:copy.yourNow} · {choice.label}<span className="ml-3 text-xs font-normal text-muted-foreground">{choice.outcome.kind==='unobserved'?copy.unknown:`${copy.revealed} ${steps.length} / ${choice.outcome.steps.length}`}</span></p>
     {judgment&&<div className="replay-judgment-feedback">{judgment.prediction&&<p className="text-sm leading-7">{copy.yourPrediction} · {judgment.prediction}</p>}{judgment.reason&&<p className="text-sm leading-7 text-muted-foreground">{copy.yourReason} · {judgment.reason}</p>}{judgment.revision&&<p className="mt-2 text-sm leading-7">{copy.changeMind} · {judgment.revision}</p>}{judgment.nextCheck&&<p className="mt-2 text-sm leading-7">{copy.checkNext} · {judgment.nextCheck}</p>}</div>}
     {choice.outcome.kind==='unobserved'?<><p className="mt-2 text-sm leading-7 text-muted-foreground">{copy.noResult}</p>{choice.tradeoff&&<p className="mt-2 text-sm leading-7">{copy.checkNext} · {choice.tradeoff.check}</p>}</>:steps.length?steps.map((step,i)=><div key={i} className="replay-journey-moment"><h4 className="text-sm font-medium leading-7">{step.title}</h4><p className="mt-1 text-sm leading-7 text-muted-foreground">{step.text}</p>{step.signals&&<ReplaySignals signals={step.signals}/>}{(step.artifactIds??[]).map(id=>{const artifact=story.artifacts?.find(a=>a.id===id);return artifact?<details key={id} className="mt-3"><summary className="cursor-pointer text-sm leading-7 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{copy.fileExcerpt} · {artifact.fileName}</summary><ReplayArtifactView artifact={artifact} copy={copy}/></details>:null;})}<details className="mt-2"><summary className="cursor-pointer text-xs leading-7 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{copy.clue}</summary>{step.refs.map((reference,j)=><EvidenceExcerpt key={j} story={story} reference={reference} copy={copy}/>)}</details></div>):<p className="mt-2 text-sm text-muted-foreground">{copy.notRevealed}</p>}
     {steps.length===choice.outcome.steps.length&&choice.rejoin&&<p className="replay-rejoin text-xs leading-6">{choice.rejoin.note}</p>}
    </div>;})}
    <ReplayLearningNote scene={scene} state={state} copy={copy} compare/>
   </li>)}</ol>
   <div className="replay-takeaway"><label htmlFor="replay-takeaway" className="text-sm font-medium leading-7">{copy.takeawayPrompt}</label><p className="mt-1 text-xs leading-6 text-muted-foreground">{copy.takeawayHint}</p><textarea id="replay-takeaway" value={takeaway} maxLength={1200} onChange={event=>write(event.target.value)} rows={3} className="mt-4 w-full resize-y rounded-lg border border-border bg-background p-4 text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring"/><p className="mt-2 text-xs text-muted-foreground" role="status">{saved?copy.takeawayLocal:copy.takeawayUnsaved}</p></div>
  </>}
 </section>;
}
