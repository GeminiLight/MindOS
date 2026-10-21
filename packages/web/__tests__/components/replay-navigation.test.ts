import { describe, expect, it } from 'vitest';
import { createReplayState, transitionReplay, validateBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { resumeReplayRoute, revisitReplayScene } from '@/components/echo/replay/replay-navigation';

const story=validateBranchStory({id:'navigation',runtime:'example',title:'连续判断',messages:[{id:'m',role:'user',text:'先观察，再验证。'}]}, {
 title:'连续判断',summary:'逐个判断',scenes:['first','second','third'].map((id,index)=>({id,title:`判断 ${index+1}`,context:'先观察，再验证。',evidence:[{messageId:'m',quote:'先观察'}],choices:['a','b'].map(choiceId=>({id:choiceId,label:choiceId,description:'再验证',proposal:{messageId:'m',quote:'再验证'},nextSceneId:index<2&&choiceId==='b'?['second','third'][index]:undefined,outcome:{kind:'recorded',title:'有后续',steps:[1,2,3].map(n=>({title:`变化 ${n}`,text:'再验证',refs:[{messageId:'m',quote:'再验证'}]}))}}))}))
});
describe('replay recovery navigation',()=>{
 it('resumes the last observed moment without opening an unseen later result',()=>{
  let state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'a'});
  state=transitionReplay(story,state,{type:'advance'});state=transitionReplay(story,state,{type:'advance'});
  state=transitionReplay(story,state,{type:'rewind'});
  const resumed=resumeReplayRoute(story,state,'a');
  expect(resumed.visibleSteps).toBe(2);expect(resumed.phase).toBe('result');expect(resumed.attempts).toEqual(state.attempts);
 });
 it('returns to an explored earlier fork while preserving every recorded attempt',()=>{
  let state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'b'});
  for(let i=0;i<4;i++)state=transitionReplay(story,state,{type:'advance'});
  expect(state.sceneIndex).toBe(1);
  const previous=revisitReplayScene(story,state,0);
  expect(previous).toMatchObject({sceneIndex:0,choiceId:null,visibleSteps:0,phase:'choice'});
  expect(previous.attempts).toEqual(state.attempts);expect(state.sceneIndex).toBe(1);
 });
 it('ignores unopened forks, invalid routes and stale versions',()=>{
  const state=createReplayState(story);
  for(const index of [-1,2,NaN])expect(revisitReplayScene(story,state,index)).toBe(state);
  expect(resumeReplayRoute(story,state,'a')).toBe(state);
  expect(resumeReplayRoute(story,state,'missing')).toBe(state);
  const stale={...state,fingerprint:'stale'};expect(revisitReplayScene(story,stale,0)).toBe(stale);
 });
});
