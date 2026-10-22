'use client';
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ArrowRight, Check, CircleHelp, FileText, GitBranch, Quote, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReplayMapData } from './replay-canvas-model';
import type { ReplayCopy } from './replay-copy';
import { ReplaySignals, ReplayTradeoff } from './ReplayLearning';

export type ReplayCanvasNodeData = ReplayMapData & Record<string,unknown> & {
  copy:ReplayCopy; onChoose:(id:string)=>void; onInspect:(id:string)=>void;
  onFocusNode:(id:string)=>void;onReadMoment:()=>void;hasPrediction:boolean;
  preview?:{project:'A'|'B'|null;ignored:boolean};
};
export type StoryCanvasNode = Node<ReplayCanvasNodeData,'story'>;

// Keep the canvas skimmable; full evidence remains in the explicit inspector.
const previewText=(text:string,length=90)=>Array.from(text).length>length?Array.from(text).slice(0,length).join('')+'…':text;

export const ReplayCanvasNode=memo(function ReplayCanvasNode({id,data}:NodeProps<StoryCanvasNode>){
  const {copy,kind,status}=data;
  return <article className={`replay-map-node replay-map-${kind}`} data-status={status} onFocusCapture={event=>{
    if((event.target as HTMLElement).matches(':focus-visible'))data.onFocusNode(id);
  }}>
    {kind!=='context'&&<Handle type="target" position={Position.Left} isConnectable={false}/>}
    <Handle type="source" position={Position.Right} isConnectable={false}/>
    {kind==='choice'?<>
      <Button variant="ghost" className="replay-choice-hit nodrag" aria-label={`${data.letter} · ${data.title}`} onClick={()=>data.onChoose(data.choiceId!)}>
        <span className="replay-map-letter font-mono">{data.letter}</span>
        <span className="min-w-0 flex-1 text-left"><span className="block text-base font-semibold leading-7">{data.title}</span>{data.tradeoff?<ReplayTradeoff tradeoff={{...data.tradeoff,benefit:previewText(data.tradeoff.benefit,42),cost:previewText(data.tradeoff.cost,42)}} copy={copy}/>:<span className="mt-2 block text-xs font-normal leading-6 text-muted-foreground">{previewText(data.text,65)}</span>}</span>
        <ArrowRight size={17} className="shrink-0 text-muted-foreground"/>
      </Button>
      <div className="replay-map-note"><span>{status==='available'?copy.awaiting:status==='current'?(data.historical?copy.historicalRoute:copy.currentChoice):<><Check size={12}/>{copy.tried}</>}</span><Button variant="ghost" size="sm" className="nodrag" onClick={()=>data.onInspect(id)}><Quote size={12}/>{copy.clue}</Button></div>
    </>:<>
      <div className="replay-map-eyebrow"><span>{kind==='context'?<GitBranch size={14}/>:kind==='unknown'?<CircleHelp size={14}/>:<span className="font-mono">{String((data.stepIndex??0)+1).padStart(2,'0')}</span>}{kind==='context'?copy.context:kind==='unknown'?copy.unknown:data.outcomeKind==='simulation'?copy.preview:copy.recorded}</span>{status==='current'&&<span className="replay-map-now">{copy.here}</span>}</div>
      <h2 className="text-lg font-semibold leading-7 tracking-tight">{data.title}</h2>
      {!data.revisit&&<p className="replay-map-text">{kind==='unknown'?copy.noResult:previewText(data.text,90)}</p>}
      {kind==='unknown'&&data.text&&<div className="replay-learning-note"><p className="text-xs font-medium">{copy.checkNext}</p><p className="mt-2 text-sm leading-7">{previewText(data.text,75)}</p></div>}
      {data.signals&&<ReplaySignals signals={data.signals.slice(0,2)}/>}
      {data.revisit&&<aside className="replay-learning-note" aria-label={copy.revisitWithClue}><p className="text-xs font-medium">{copy.revisitWithClue}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{copy.observedClue} · {data.revisit.clue}</p><p className="mt-2 text-sm leading-7">{previewText(data.revisit.prompt??copy.thinkAgain,70)}</p></aside>}
      {data.rejoin&&<aside className="replay-rejoin" aria-label={copy.rejoined}><p className="text-xs font-medium">{copy.rejoined}</p><p className="mt-2 text-xs leading-6">{previewText(data.rejoin,70)}</p></aside>}
      {data.preview?<div className="replay-map-window"><div className="replay-window-title"><span><i/><i/><i/></span><span className={data.preview.project==='A'?'text-error':'text-success'}>{data.preview.project?`${copy.showing} ${data.preview.project}`:copy.waiting}</span></div>{(data.preview.project==='A'?['旧项目说明.md','历史方案.md']:['产品方向.md','界面讨论.md']).map(name=><div key={name}><FileText size={12}/>{name}<span className="font-mono">{data.preview!.project}</span></div>)}<p className={data.preview.project==='A'?'text-error':'text-muted-foreground'}>{data.preview.ignored?copy.oldIgnored:data.preview.project==='A'?copy.oldApplied:copy.currentApplied}</p></div>:null}
      {status==='current'&&(kind==='unknown'||data.hasPrediction||!!data.artifactNames?.length)&&<Button variant="outline" size="sm" className="replay-moment-link nodrag" onClick={data.onReadMoment}><FileText size={13}/>{data.artifactNames?.length?copy.fileExcerpt:kind==='unknown'?copy.writeCheck:copy.yourPrediction}<ArrowRight size={12}/></Button>}
      {kind!=='unknown'&&<Button variant="ghost" size="sm" className="replay-map-read nodrag" onClick={()=>data.onInspect(id)}><ScanLine size={13}/>{data.preview?copy.changeConditions:kind==='context'?copy.evidence:copy.detail}<ArrowRight size={12}/></Button>}
    </>}
  </article>;
});
