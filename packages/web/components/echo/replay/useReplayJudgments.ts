'use client';
import { useEffect, useState } from 'react';
import type { BranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { judgmentKey, restoreJudgments, type ReplayJudgment } from './replay-judgments';
export function useReplayJudgments(story:BranchStory){
 const storageKey=`mindos:branch-replay:${story.id}:judgments`;
 const [judgments,setJudgments]=useState(()=>{try{return restoreJudgments(story,JSON.parse(localStorage.getItem(storageKey)||'null'));}catch{return restoreJudgments(story,null);}});
 const [saved,setSaved]=useState(true);
 useEffect(()=>{let ok=true;try{localStorage.setItem(storageKey,JSON.stringify(judgments));}catch{ok=false;}
  // Storage success is a runtime result, not a property of the note.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setSaved(ok);
 },[storageKey,judgments]);
 const write=(sceneId:string,choiceId:string,patch:Partial<ReplayJudgment>)=>setJudgments(current=>{const key=judgmentKey(sceneId,choiceId);return restoreJudgments(story,{...current,entries:{...current.entries,[key]:{...current.entries[key],...patch}}});});
 const selectTransfer=(transferId:string)=>setJudgments(current=>restoreJudgments(story,{...current,transferId}));
 return {judgments,saved,write,selectTransfer};
}
