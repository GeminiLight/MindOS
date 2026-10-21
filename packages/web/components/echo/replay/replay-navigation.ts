import { transitionReplay, type BranchStory, type ReplayState } from '@geminilight/mindos/knowledge/branch-replay';

/** Only completed links and already explored forks can be revisited. */
export function availableReplayScenes(story:BranchStory,state:ReplayState):Set<number>{
 const available=new Set([0,state.sceneIndex]);
 for(const attempt of state.attempts){
  const index=story.scenes.findIndex(scene=>scene.id===attempt.sceneId);if(index<0)continue;
  available.add(index);
  const choice=story.scenes[index].choices.find(c=>c.id===attempt.choiceId);
  if(choice?.nextSceneId&&choice.outcome.kind!=='unobserved'&&attempt.visibleSteps===choice.outcome.steps.length){
   const next=story.scenes.findIndex(scene=>scene.id===choice.nextSceneId);if(next>=0)available.add(next);
  }
 }
 return available;
}
export function revisitReplayScene(story:BranchStory,state:ReplayState,index:number):ReplayState{
 if(state.fingerprint!==story.fingerprint||!Number.isInteger(index)||!story.scenes[index]||!availableReplayScenes(story,state).has(index))return state;
 return {...state,historyFrom:undefined,sceneIndex:index,choiceId:null,visibleSteps:0,phase:'choice'};
}
/** Resume an observed cursor; leave future moments concealed until Continue. */
export function resumeReplayRoute(story:BranchStory,state:ReplayState,choiceId:string):ReplayState{
 if(state.fingerprint!==story.fingerprint)return state;
 const scene=story.scenes[state.sceneIndex];const attempt=state.attempts.find(a=>a.sceneId===scene?.id&&a.choiceId===choiceId);
 if(!attempt||!scene.choices.some(c=>c.id===choiceId))return state;
 let next=transitionReplay(story,{...state,choiceId:null,visibleSteps:0,phase:'choice'},{type:'choose',choiceId});
 for(let i=0;i<attempt.visibleSteps;i++)next=transitionReplay(story,next,{type:'advance'});
 return next;
}
