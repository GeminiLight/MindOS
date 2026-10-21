'use client';
import { useRef } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type { ReplayScene, ReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import type { ReplayCopy } from './replay-copy';
import { ReplayLearningNote, ReplayTradeoff } from './ReplayLearning';

/** Reading and choosing stay at normal scale while the map remains explorable. */
export function ReplayDecisionSheet({scene,state,copy,onChoose,onClose}:{scene:ReplayScene;state:ReplayState;copy:ReplayCopy;onChoose:(id:string)=>void;onClose:()=>void}){
 const body=useRef<HTMLDivElement>(null);const options=useRef(new Map<string,HTMLButtonElement>());
 const jump=(id:string)=>{const target=options.current.get(id);if(!target||!body.current)return;body.current.scrollTo({top:Math.max(0,target.getBoundingClientRect().top-body.current.getBoundingClientRect().top+body.current.scrollTop),behavior:'auto'});};
 return <section className="replay-decision-sheet nowheel nopan" aria-label={copy.beforeChoice}>
  <div className="replay-decision-header"><div className="replay-decision-heading"><h2 className="text-base font-semibold leading-7">{scene.title}</h2><Button variant="ghost" size="icon-sm" aria-label={copy.onlyMap} onClick={onClose}><X size={14}/></Button></div><nav className="replay-decision-jump" aria-label={copy.jumpChoice}>{scene.choices.map((choice,index)=><Button key={choice.id} variant="outline" size="sm" aria-label={`${copy.jumpChoice} ${String.fromCharCode(65+index)}`} onClick={()=>jump(choice.id)}><span className="font-mono">{String.fromCharCode(65+index)}</span><span className="truncate">{choice.label}</span></Button>)}</nav></div>
  <div ref={body} className="replay-decision-body"><div className="replay-decision-context"><ReplayLearningNote scene={scene} state={state} copy={copy}/><p className="mb-4 text-sm leading-7 text-muted-foreground">{scene.context}</p></div><div className="replay-decision-options">
   {scene.choices.map((choice,index)=>{
    const visited=state.attempts.some(attempt=>attempt.sceneId===scene.id&&attempt.choiceId===choice.id);
    return <Button ref={element=>{if(element)options.current.set(choice.id,element);else options.current.delete(choice.id);}} key={choice.id} variant="ghost" className="replay-decision-choice" aria-label={`${String.fromCharCode(65+index)} · ${choice.label}`} onClick={()=>onChoose(choice.id)}>
     <span className="replay-map-letter font-mono">{String.fromCharCode(65+index)}</span><span className="min-w-0 flex-1 text-left"><span className="block font-semibold leading-6">{choice.label}</span>{choice.tradeoff?<ReplayTradeoff tradeoff={choice.tradeoff} copy={copy}/>:<span className="mt-2 block text-xs font-normal leading-6 text-muted-foreground">{choice.description}</span>}{visited&&<span className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Check size={12}/>{copy.tried}</span>}</span><ArrowRight size={14} className="shrink-0"/>
    </Button>;
   })}</div>
  </div>
 </section>;
}
