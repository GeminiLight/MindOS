'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { BranchStory, ReplayRef } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import { EvidenceExcerpt, OriginalRecord } from './ReplayEvidence';
import type { ReplayMapItem } from './replay-canvas-model';
import type { ReplayCopy } from './replay-copy';
import { ReplayArtifactView } from './ReplayParticipation';
import { ReplaySignals, ReplayTradeoff } from './ReplayLearning';

export function ReplayInspector({story,node,copy,onClose,practice}:{story:BranchStory;node:ReplayMapItem;copy:ReplayCopy;onClose:()=>void;practice?:ReactNode}){
  const [original,setOriginal]=useState<ReplayRef|null>(null);
  const panel=useRef<HTMLElement>(null);
  const clueScroll=useRef(0);
  useLayoutEffect(()=>{const element=panel.current;if(!element)return;element.focus({preventScroll:true});
    const mark=element.querySelector('mark');element.scrollTop=mark?Math.max(0,mark.getBoundingClientRect().top-element.getBoundingClientRect().top+element.scrollTop-115):clueScroll.current;
  },[original]);
  return <aside ref={panel} tabIndex={-1} className={`replay-canvas-inspector nowheel nopan ${original?'replay-original-inspector':practice?'replay-practice-inspector':''}`} aria-label={copy.clues} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <div className="replay-inspector-header">
      {original?<Button variant="ghost" size="sm" onClick={()=>setOriginal(null)}><ArrowLeft size={14}/>{copy.backToClues}</Button>:<span className="text-xs font-medium text-muted-foreground">{copy.clues}</span>}
      <Button variant="ghost" size="icon-sm" aria-label={copy.hideClues} onClick={onClose}><X size={15}/></Button>
    </div>
    <div className="replay-inspector-body">
      {original?<OriginalRecord story={story} copy={copy} focusId={original.messageId} highlightQuote={original.quote}/>:<>
        <h2 className="mb-4 text-lg font-semibold leading-7">{node.data.title}</h2>
        {practice}
        {(node.data.artifactIds??[]).flatMap(id=>story.artifacts?.filter(artifact=>artifact.id===id)??[]).map(artifact=><ReplayArtifactView key={artifact.id} artifact={artifact} copy={copy}/>)}
        {node.data.revisit&&<aside className="replay-learning-note"><p>{copy.revisitWithClue}</p><p>{node.data.revisit.clue}</p><p>{node.data.revisit.prompt??copy.thinkAgain}</p></aside>}
        <p className="mb-7 text-sm leading-7">{node.data.text||copy.noResult}</p>
        {node.data.tradeoff&&<div className="mb-6"><p className="text-xs text-muted-foreground">{copy.editorialTradeoff}</p><ReplayTradeoff tradeoff={node.data.tradeoff} copy={copy}/><p className="mt-3 text-sm leading-7">{node.data.tradeoff.check}</p></div>}
        {node.data.signals&&<ReplaySignals signals={node.data.signals}/>}
        {node.data.rejoin&&<aside className="replay-rejoin"><p className="text-xs font-medium">{copy.rejoined}</p><p className="mt-2 text-sm leading-7">{node.data.rejoin}</p></aside>}
        {node.data.refs.map((reference,index)=><EvidenceExcerpt key={`${reference.messageId}:${index}`} story={story} reference={reference} copy={copy} onOpen={()=>{clueScroll.current=panel.current?.scrollTop??0;setOriginal(reference);}}/>)}
        <p className="text-xs leading-6 text-muted-foreground">{story.source.runtime==='example'?copy.simulationNote:copy.recordedNote}</p>
      </>}
    </div>
  </aside>;
}
