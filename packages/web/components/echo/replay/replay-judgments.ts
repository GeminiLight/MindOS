import type { BranchStory } from '@geminilight/mindos/knowledge/branch-replay';
export interface ReplayJudgment {
 prediction?:string;reason?:string;confidence?:'unsure'|'likely'|'confident';revision?:string;nextCheck?:string;
}
export interface ReplayJudgments {fingerprint:string;entries:Record<string,ReplayJudgment>;transferId?:string;}
export const judgmentKey=(sceneId:string,choiceId:string)=>`${sceneId}/${choiceId}`;
export function restoreJudgments(story:BranchStory,raw:unknown):ReplayJudgments{
 const result:ReplayJudgments={fingerprint:story.fingerprint,entries:{}};
 if(!raw||typeof raw!=='object'||!('fingerprint'in raw)||raw.fingerprint!==story.fingerprint)return result;
 const value=raw as Partial<ReplayJudgments>;
 if(value.entries&&typeof value.entries==='object')for(const scene of story.scenes)for(const choice of scene.choices){
  const key=judgmentKey(scene.id,choice.id);const entry=value.entries[key];if(!entry||typeof entry!=='object')continue;
  const clean:ReplayJudgment={};
  for(const name of ['prediction','reason','revision','nextCheck'] as const)if(typeof entry[name]==='string')clean[name]=entry[name].slice(0,600);
  if(['unsure','likely','confident'].includes(entry.confidence??''))clean.confidence=entry.confidence;
  result.entries[key]=clean;
 }
 if(story.transfer?.options.some(o=>o.id===value.transferId))result.transferId=value.transferId;
 return result;
}
