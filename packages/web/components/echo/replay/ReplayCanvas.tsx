'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, useNodesInitialized, useReactFlow, useStore, type Edge, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Focus, GitBranch, Maximize, Minimize, Minus, Plus, ScanLine } from 'lucide-react';
import type { BranchStory, ReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import { buildReplayCanvas } from './replay-canvas-model';
import { ReplayCanvasNode, type StoryCanvasNode } from './ReplayCanvasNode';
import { ReplayInspector } from './ReplayInspector';
import { ReplayRouteReview } from './ReplayRouteReview';
import { practiceOutcome, type PracticeConditions } from './replay-practice';
import type { ReplayCopy } from './replay-copy';
import { ReplayMomentPanel } from './ReplayMomentPanel';
import type { ReplayJudgment } from './replay-judgments';
import { availableReplayScenes } from './replay-navigation';

const nodeTypes={story:ReplayCanvasNode};
interface Props {
  story:BranchStory; state:ReplayState; copy:ReplayCopy; compare:boolean;
  onChoose:(id:string)=>void; children:ReactNode; judgment?:ReplayJudgment;onJudgment?:(patch:Partial<ReplayJudgment>)=>void;
  onResume:(id:string)=>void;onRevisit:(index:number)=>void; pending?:boolean;
  practice?:PracticeConditions & {render:(choiceId:string,visibleSteps:number)=>ReactNode};
}
export function ReplayCanvas(props:Props){
  return <ReactFlowProvider><CanvasStage {...props}/></ReactFlowProvider>;
}
function CanvasStage({story,state,copy,compare,onChoose,onResume,onRevisit,children,practice,judgment,onJudgment,pending=false}:Props){
  const map=useMemo(()=>buildReplayCanvas(story,state),[story,state]);
  const container=useRef<HTMLDivElement>(null);
  // Include the sibling prediction gate in fullscreen so choosing a route stays actionable.
  const fullscreenTarget=useCallback(()=>container.current?.closest<HTMLElement>('.replay-view')??container.current,[]);
  const viewportWidth=useStore(s=>s.width);const viewportHeight=useStore(s=>s.height);
  const narrow=viewportWidth>0&&viewportWidth<650;
  const [immersive,setImmersive]=useState(false);
  const [stageHeight,setStageHeight]=useState<number|undefined>(undefined);
  useEffect(()=>{
    if(immersive||!viewportWidth)return;
    const element=container.current;if(!element)return;
    const measure=()=>{const main=element.closest('#main-content');const top=Math.max(main?.getBoundingClientRect().top??0,element.getBoundingClientRect().top);setStageHeight(Math.max(viewportWidth<650?520:420,Math.min(1200,window.innerHeight-top-12)));};
    const frame=requestAnimationFrame(measure);window.addEventListener('resize',measure);
    const observer=new ResizeObserver(measure);const shell=element.closest('.replay-shell');if(shell)observer.observe(shell);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);};
  },[immersive,viewportWidth,story.id,state.sceneIndex]);
  const [error,setError]=useState('');
  const [ready,setReady]=useState(false);
  const [measurements,setMeasurements]=useState<Record<string,{width:number;height:number}>>({});
  // Controlled nodes must retain dimensions returned by React Flow's observer.
  // Otherwise the initialization flag stays false and camera follow never starts.
  const measureNodes=useCallback((changes:NodeChange<StoryCanvasNode>[])=>setMeasurements(current=>{
    let next=current;
    for(const change of changes){if(change.type!=='dimensions'||!change.dimensions)continue;
      const previous=current[change.id];if(previous?.width===change.dimensions.width&&previous.height===change.dimensions.height)continue;
      if(next===current)next={...current};next[change.id]=change.dimensions;
    }
    return next;
  }),[]);
  const cursorKey=`${state.sceneIndex}:${state.choiceId}:${state.visibleSteps}:${compare}`;
  const [inspection,setInspection]=useState<{id:string;cursor:string}|null>(null);
  const [reviewHidden,setReviewHidden]=useState(false);
  const [requestedReading,setRequestedReading]=useState<string|null>(null);
  const momentShown=!compare&&!!state.choiceId&&requestedReading===cursorKey;
  const cameraTop=narrow?'112px':'70px';
  const opener=useRef<HTMLElement|null>(null);
  const inspect=useCallback((id:string)=>{setRequestedReading(null);opener.current=document.activeElement as HTMLElement;setInspection({id,cursor:cursorKey});},[cursorKey]);
  const close=()=>{setInspection(null);opener.current?.focus({preventScroll:true});};
  const initialized=useNodesInitialized();const flow=useReactFlow<StoryCanvasNode>();
  const duration=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:250;
  const focusNode=useCallback((id:string)=>{
    const node=flow.getNode(id);if(!node)return;
    const viewport=flow.getViewport();const x=node.position.x*viewport.zoom+viewport.x;const y=node.position.y*viewport.zoom+viewport.y;
    const width=(node.measured?.width??310)*viewport.zoom;const height=(node.measured?.height??280)*viewport.zoom;
    if(x>=24&&x+width<=viewportWidth-24&&y>=parseFloat(cameraTop)&&y+height<=viewportHeight-100)return;
    void flow.fitView({nodes:[{id}],padding:{top:cameraTop,bottom:narrow?'140px':'100px',x:'24px'},minZoom:.25,maxZoom:1.05,duration:duration()});
  },[flow,viewportWidth,viewportHeight,narrow,cameraTop]);
  const nodes:StoryCanvasNode[]=useMemo(()=>map.nodes.map(node=>{
    const demo=practice&&node.data.kind==='step'&&node.data.outcomeKind==='simulation'?practiceOutcome(node.data.choiceId!,node.data.stepIndex!+1,practice,copy):null;
    return {...node,type:'story',draggable:false,selectable:false,measured:measurements[node.id],data:{...node.data,copy,onChoose,onInspect:inspect,onFocusNode:focusNode,onReadMoment:()=>{setInspection(null);setRequestedReading(cursorKey);},hasPrediction:!!judgment?.prediction,
      ...(demo?{title:demo.title,text:demo.text}:{}),preview:demo?{project:demo.project,ignored:demo.ignored}:undefined}};
  }),[map,copy,onChoose,inspect,focusNode,practice,measurements,cursorKey,judgment?.prediction]);
  const inspector=inspection?.cursor===cursorKey?nodes.find(n=>n.id===inspection.id):null;
  const inspectingPractice=!!practice&&inspector?.data.kind==='step'&&inspector.data.outcomeKind==='simulation';
  const edges:Edge[]=useMemo(()=>map.edges.map(edge=>({...edge,type:'default',className:edge.active?'replay-wire-active':edge.visited?'replay-wire-visited':'replay-wire',
    style:{stroke:edge.active?'var(--amber)':edge.visited?'var(--muted-foreground)':'var(--border)',strokeWidth:edge.active?2:1.3}})),[map.edges]);
  const cameraKey=useRef('');
  const overview=useCallback(()=>void flow.fitView({padding:{top:'70px',bottom:'100px',x:'32px'},minZoom:.25,maxZoom:1,duration:duration()}),[flow]);
  const follow=useCallback(()=>{
    let ids:string[];
    if(!state.choiceId){const choices=map.nodes.filter(n=>n.data.kind==='choice').slice(0,narrow?1:2).map(n=>n.id);ids=narrow?choices:[map.rootId,...choices];}
    else{
      const incoming=map.edges.find(e=>e.target===map.focusId)?.source;
      const prior=map.nodes.find(node=>node.id===incoming);const current=map.nodes.find(node=>node.id===map.focusId);
      ids=narrow||(prior&&current&&Math.abs(prior.position.y-current.position.y)>100)?[map.focusId]:[incoming??map.rootId,map.focusId];
    }
    void flow.fitView({nodes:ids.map(id=>({id})),padding:{top:cameraTop,bottom:narrow?'140px':'100px',left:narrow?'24px':'50px',right:narrow?'24px':'50px'},minZoom:.8,maxZoom:1,duration:duration()});
  },[state.choiceId,narrow,map,flow,cameraTop]);
  const focusRoute=(id:string)=>{
    setReviewHidden(true);setInspection(null);
    const endpoint=map.nodes.filter(node=>node.data.choiceId===id).at(-1);if(!endpoint)return;
    const prior=map.edges.find(edge=>edge.target===endpoint.id)?.source;
    void flow.fitView({nodes:(narrow?[endpoint.id]:[prior??map.rootId,endpoint.id]).map(nodeId=>({id:nodeId})),
      padding:{top:cameraTop,bottom:narrow?'140px':'100px',x:'40px'},minZoom:.25,maxZoom:1.05,duration:duration()});
  };
  useEffect(()=>{
    const element=fullscreenTarget();if(!element)return;
    const fullscreen=()=>setImmersive(document.fullscreenElement===element);
    document.addEventListener('fullscreenchange',fullscreen);
    return()=>document.removeEventListener('fullscreenchange',fullscreen);
  },[fullscreenTarget]);
  useEffect(()=>{
    const key=`${cursorKey}:${Math.round(viewportWidth)}:${Math.round(viewportHeight)}:${immersive}`;
    if(!ready||!initialized||!viewportWidth||!viewportHeight||cameraKey.current===key)return;
    const frame=requestAnimationFrame(()=>{cameraKey.current=key;if(compare)overview();else follow();});
    return()=>cancelAnimationFrame(frame);
  },[ready,initialized,cursorKey,viewportWidth,viewportHeight,immersive,compare,overview,follow]);
  const fullscreen=async()=>{
    try {const target=fullscreenTarget();if(target&&document.fullscreenElement===target)await document.exitFullscreen();else await target?.requestFullscreen();setError('');}
    catch {setError(copy.fullscreenError);}
  };
  const attempts=state.attempts.filter(a=>a.sceneId===story.scenes[state.sceneIndex].id);
  const available=availableReplayScenes(story,state);
  return <section aria-label={copy.routes} className="replay-canvas-region">
    <div ref={container} style={{height:!immersive?stageHeight:undefined}} data-replay-canvas className="replay-canvas" data-has-trail={story.scenes.length>1} data-narrow={narrow} data-immersive={immersive} data-reading={false} data-camera-ready={ready&&initialized}>
      <div className="replay-flow-layer" inert={pending} aria-hidden={pending||undefined}>
      <ReactFlow<StoryCanvasNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false}
        onInit={()=>setReady(true)} onNodesChange={measureNodes}
        nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} deleteKeyCode={null} autoPanOnNodeFocus={false}
        onNodeClick={(event,node)=>{if(!(event.target as HTMLElement).closest('button'))inspect(node.id);}}
        minZoom={.25} maxZoom={1.6} zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} preventScrolling={false}
        proOptions={{hideAttribution:true}} aria-label={copy.canvas}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)"/>
        {nodes.length>5&&<MiniMap pannable zoomable className="replay-minimap" nodeColor={node=>node.data.status==='current'?'var(--amber)':'var(--muted)'} nodeStrokeColor="var(--muted-foreground)" maskColor="var(--amber-subtle)" ariaLabel={copy.overview}/>}
      </ReactFlow>
      </div>
      <div className="replay-canvas-caption"><span className="replay-chapter font-mono">{String(state.sceneIndex+1).padStart(2,'0')}</span><div><p>{compare?copy.compare:state.historyFrom?copy.historicalRoute:state.choiceId?copy.afterChoice:copy.beforeChoice}</p><span>{narrow?story.scenes[state.sceneIndex].title:copy.canvasHelp}</span></div></div>
      {story.scenes.length>1&&<nav className="replay-scene-trail" aria-label={copy.journey}>{story.scenes.map((scene,index)=><Button key={scene.id} size="icon-sm" variant="ghost" aria-current={state.sceneIndex===index?'step':undefined} disabled={!available.has(index)} aria-label={`${available.has(index)?copy.revisitScene:copy.lockedScene} ${index+1}`} title={available.has(index)?scene.title:copy.lockedScene} onClick={()=>onRevisit(index)}><span className="font-mono">{index+1}</span></Button>)}</nav>}
      {!compare&&!state.choiceId&&(narrow||story.scenes[state.sceneIndex].choices.length>2)&&<nav className="replay-route-jump" aria-label={copy.routes}>{story.scenes[state.sceneIndex].choices.map((choice,index)=><Button key={choice.id} size="sm" variant="outline" aria-label={`${copy.jumpChoice} ${String.fromCharCode(65+index)}`} onClick={()=>focusNode(`${story.scenes[state.sceneIndex].id}:choice:${choice.id}`)}>{String.fromCharCode(65+index)}</Button>)}</nav>}
      <div className="replay-canvas-tools">
        {!compare&&state.choiceId&&<Button variant="ghost" size="sm" className="replay-read-tool" title={copy.readCurrent} aria-label={copy.readCurrent} onClick={()=>{setInspection(null);setRequestedReading(cursorKey);}}><GitBranch size={14}/><span>{copy.readCurrent}</span></Button>}
        {compare&&reviewHidden&&<Button variant="ghost" size="sm" onClick={()=>setReviewHidden(false)}><GitBranch size={14}/><span>{copy.showResults}</span></Button>}
        <Button variant="ghost" size="sm" onClick={()=>inspect(map.rootId)} aria-expanded={!!inspector}><ScanLine size={14}/><span>{copy.showClues}</span></Button>
        <Button variant="ghost" size="icon-sm" aria-label={immersive?copy.exitImmersive:copy.immersive} onClick={()=>void fullscreen()}>{immersive?<Minimize size={16}/>:<Maximize size={16}/>}</Button>
      </div>
      <div className="replay-canvas-zoom" role="group" aria-label={copy.canvas}>
        <Button variant="ghost" size="icon-sm" aria-label={copy.zoomOut} onClick={()=>void flow.zoomOut({duration:duration()})}><Minus size={15}/></Button>
        <Button variant="ghost" size="icon-sm" aria-label={copy.zoomIn} onClick={()=>void flow.zoomIn({duration:duration()})}><Plus size={15}/></Button>
        <span className="replay-tool-divider"/>
        <Button variant="ghost" size="sm" onClick={overview}><GitBranch size={14}/>{copy.overview}</Button>
        <Button variant="ghost" size="sm" onClick={()=>{setInspection(null);setRequestedReading(null);follow();}}><Focus size={14}/>{copy.follow}</Button>
      </div>
      <div className="replay-canvas-legend" data-has-trail={story.scenes.length>1}><span className="replay-legend-dot"/>{copy.here}<span className="replay-legend-line"/>{copy.preserved}<span>{copy.observed} {attempts.length} / {story.scenes[state.sceneIndex].choices.length} {copy.routesUnit}</span></div>
      {momentShown&&<ReplayMomentPanel story={story} state={state} copy={copy} entry={judgment} onChange={onJudgment??(()=>{})} onClose={()=>setRequestedReading(null)} onInspect={()=>inspect(map.focusId)}/>}
      {compare&&!reviewHidden&&<ReplayRouteReview scene={story.scenes[state.sceneIndex]} state={state} copy={copy} conditions={practice} onResume={onResume} onInspect={inspect} onFocus={focusRoute} onClose={()=>setReviewHidden(true)}/>}
      {inspector&&<ReplayInspector key={`${cursorKey}:${inspector.id}`} story={story} node={inspector} copy={copy} onClose={close}
        practice={inspectingPractice?practice!.render(inspector.data.choiceId!,inspector.data.stepIndex!+1):undefined}/>}
      {error&&<p role="status" className="replay-canvas-error">{error}</p>}
      <div className="replay-canvas-dock">{children}</div>
    </div>
  </section>;
}
