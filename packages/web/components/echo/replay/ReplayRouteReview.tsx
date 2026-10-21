'use client';
import { useRef } from 'react';
import { ArrowRight, Focus, ScanLine, X } from 'lucide-react';
import type { ReplayScene, ReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import { practiceOutcome, type PracticeConditions } from './replay-practice';
import type { ReplayCopy } from './replay-copy';
import { ReplayLearningNote, ReplaySignals, ReplayTradeoff } from './ReplayLearning';

export function ReplayRouteReview({scene,state,copy,conditions,onResume,onInspect,onFocus,onClose}:{scene:ReplayScene;state:ReplayState;copy:ReplayCopy;conditions?:PracticeConditions;onResume:(id:string)=>void;onInspect:(id:string)=>void;onFocus:(id:string)=>void;onClose:()=>void}){
  const attempts=state.attempts.filter(a=>a.sceneId===scene.id);
  const panel=useRef<HTMLElement>(null);const header=useRef<HTMLDivElement>(null);const routes=useRef(new Map<string,HTMLElement>());
  const jumpTo=(id:string)=>{
    const target=routes.current.get(id);if(!target||!panel.current)return;
    panel.current.scrollTo({top:Math.max(0,target.offsetTop-(header.current?.offsetHeight??0)-16),behavior:'auto'});
  };
  return <section ref={panel} className="replay-route-review nowheel nopan" aria-label={copy.compareResults}>
    <div ref={header} className="replay-review-header"><div className="replay-review-heading"><div><h2 className="text-sm font-semibold">{copy.compareResults}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{conditions?copy.sameConditions:copy.reviewScope}</p></div><Button variant="ghost" size="sm" onClick={onClose}><X size={14}/>{copy.onlyMap}</Button></div>
      <div className="replay-review-jump">{attempts.map(attempt=>{const index=scene.choices.findIndex(c=>c.id===attempt.choiceId);const choice=scene.choices[index];return choice&&<Button key={choice.id} variant="outline" size="sm" aria-label={`${String.fromCharCode(65+index)} · ${choice.label}`} onClick={()=>jumpTo(choice.id)}><span className="font-mono">{String.fromCharCode(65+index)}</span><span className="truncate">{choice.label}</span></Button>;})}</div>
    </div>
    {!attempts.length?<p className="py-5 text-sm text-muted-foreground">{copy.noComparison}</p>:<div className="replay-review-routes">
      {attempts.map(attempt=>{
        const index=scene.choices.findIndex(c=>c.id===attempt.choiceId);const choice=scene.choices[index];if(!choice)return null;
        const observed=choice.outcome.steps.slice(0,attempt.visibleSteps);const step=observed.at(-1);
        const summary=step&&choice.outcome.kind==='simulation'&&conditions?practiceOutcome(choice.id,observed.length,conditions,copy):step;
        const nodeId=`${scene.id}:choice:${choice.id}${step?`:step:${observed.length-1}`:choice.outcome.kind==='unobserved'?':unknown':''}`;
        return <article ref={element=>{if(element)routes.current.set(choice.id,element);else routes.current.delete(choice.id);}} key={choice.id} className="replay-review-route" data-current={state.choiceId===choice.id}>
          <div className="flex items-start gap-2"><span className="replay-review-letter font-mono">{String.fromCharCode(65+index)}</span><h3 className="text-sm font-semibold leading-6">{choice.label}</h3></div>
          <p className="mt-2 text-xs text-muted-foreground">{choice.outcome.kind==='unobserved'?copy.unknown:`${copy.revealed} ${observed.length} / ${choice.outcome.steps.length}`}</p>
          {choice.tradeoff&&<ReplayTradeoff tradeoff={choice.tradeoff} copy={copy}/>}
          {observed.slice(0,-1).filter(moment=>moment.signals?.length).map((moment,i)=><div className="mt-4" key={i}><h4 className="text-sm font-medium leading-6">{moment.title}</h4><p className="mt-2 text-sm leading-7 text-muted-foreground">{moment.text}</p><ReplaySignals signals={moment.signals!}/></div>)}
          <p className="mt-4 text-sm font-medium leading-6">{summary?.title||(choice.outcome.kind==='unobserved'?choice.outcome.title:copy.notRevealed)}</p>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">{summary?.text||(choice.outcome.kind==='unobserved'?copy.noResult:copy.notRevealed)}</p>
          {step?.signals&&<ReplaySignals signals={step.signals}/>}
          {choice.outcome.kind==='unobserved'&&choice.tradeoff&&<p className="mt-3 text-sm leading-7">{copy.checkNext} · {choice.tradeoff.check}</p>}
          {observed.length===choice.outcome.steps.length&&choice.rejoin&&<p className="replay-rejoin text-xs leading-6">{choice.rejoin.note}</p>}
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={()=>onInspect(nodeId)}><ScanLine size={13}/>{copy.detail}</Button><Button variant="ghost" size="sm" onClick={()=>onFocus(choice.id)}><Focus size={13}/>{copy.focusRoute}</Button></div>
          <Button variant="outline" size="sm" className="mt-3" onClick={()=>onResume(choice.id)}>{observed.length<choice.outcome.steps.length?copy.resumeRoute:copy.revisitRoute}<ArrowRight size={13}/></Button>
        </article>;
      })}
    </div>}
    <ReplayLearningNote scene={scene} state={state} copy={copy} compare/>
    {attempts.length===1&&<p className="mt-4 text-xs leading-6 text-muted-foreground">{copy.noComparison}</p>}
    {attempts.some(a=>scene.choices.find(c=>c.id===a.choiceId)?.outcome.kind==='unobserved')&&<p className="mt-4 text-xs leading-6 text-muted-foreground">{copy.comparisonBoundary}</p>}
  </section>;
}
