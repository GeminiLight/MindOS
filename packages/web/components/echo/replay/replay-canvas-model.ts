import type { BranchStory, ReplayRef, ReplayState, ReplaySignal, ReplayTradeoff } from '@geminilight/mindos/knowledge/branch-replay';
import { learningForScene } from './replay-learning';

export interface ReplayMapData {
  kind:'context'|'choice'|'step'|'unknown';
  status:'current'|'visited'|'available'; historical?:boolean;
  title:string; text:string; refs:ReplayRef[];
  choiceId?:string; letter?:string; stepIndex?:number;
  outcomeKind?:'recorded'|'simulation'|'unobserved';
  tradeoff?:ReplayTradeoff;signals?:ReplaySignal[];rejoin?:string;
  revisit?:{clue:string;prompt:string|null};
}
export interface ReplayMapItem { id:string; position:{x:number;y:number}; data:ReplayMapData; }
export interface ReplayMapEdge { id:string; source:string; target:string; active:boolean; visited:boolean; }

/** A projection of observed history. Coordinates never depend on the current route. */
export function buildReplayCanvas(story:BranchStory,state:ReplayState) {
  const scene=story.scenes[state.sceneIndex];
  if(!scene)throw new Error('Invalid replay scene');
  const rootId=`${scene.id}:context`;
  const learning=learningForScene(scene,state);const clue=learning.steps.at(-1);
  const choiceSpacing=scene.choices.some(c=>c.tradeoff)?280:240;
  const nodes:ReplayMapItem[]=[{id:rootId,position:{x:0,y:(scene.choices.length-1)*choiceSpacing/2},data:{
    kind:'context',status:state.choiceId?'visited':'current',title:scene.title,text:scene.context,refs:scene.evidence,
    revisit:state.phase==='choice'&&clue&&scene.reconsideration?{clue:clue.title,prompt:learning.prompt}:undefined,
  }}];
  const edges:ReplayMapEdge[]=[];
  let focusId=rootId;
  scene.choices.forEach((choice,index)=>{
    const choiceId=`${scene.id}:choice:${choice.id}`;
    const attempt=state.attempts.find(a=>a.sceneId===scene.id&&a.choiceId===choice.id);
    const active=state.choiceId===choice.id;
    const y=index*(scene.choices.some(c=>c.outcome.steps.some(s=>s.signals?.length))?480:360);
    nodes.push({id:choiceId,position:{x:360,y:index*choiceSpacing},data:{kind:'choice',status:active?'current':attempt?'visited':'available',
      title:choice.label,text:choice.description,refs:choice.tradeoff?.refs??[choice.proposal],tradeoff:choice.tradeoff,historical:active?!!state.historyFrom:attempt?.selection==='historical',choiceId:choice.id,letter:String.fromCharCode(65+index),outcomeKind:choice.outcome.kind}});
    edges.push({id:`${rootId}->${choiceId}`,source:rootId,target:choiceId,active,visited:!!attempt});
    if(active)focusId=choiceId;
    let previous=choiceId;
    // Keep previously seen results even when the playback cursor goes back.
    const count=Math.min(choice.outcome.steps.length,Math.max(attempt?.visibleSteps??0,active?state.visibleSteps:0));
    for(let i=0;i<count;i++){
      const step=choice.outcome.steps[i];const id=`${choiceId}:step:${i}`;
      const current=active&&i===state.visibleSteps-1;
      nodes.push({id,position:{x:720+i*360,y},data:{kind:'step',status:current?'current':'visited',
        title:step.title,text:step.text,refs:step.refs,signals:step.signals,rejoin:i===choice.outcome.steps.length-1?choice.rejoin?.note:undefined,choiceId:choice.id,stepIndex:i,outcomeKind:choice.outcome.kind}});
      edges.push({id:`${previous}->${id}`,source:previous,target:id,active:active&&i<state.visibleSteps,visited:true});
      previous=id;if(current)focusId=id;
    }
    if(choice.outcome.kind==='unobserved'&&attempt){
      const id=`${choiceId}:unknown`;
      nodes.push({id,position:{x:720,y},data:{kind:'unknown',status:active?'current':'visited',title:choice.outcome.title,text:choice.tradeoff?.check??'',refs:[],choiceId:choice.id,outcomeKind:'unobserved'}});
      edges.push({id:`${previous}->${id}`,source:previous,target:id,active,visited:true});
      if(active)focusId=id;
    }
  });
  return {nodes,edges,focusId,rootId};
}
