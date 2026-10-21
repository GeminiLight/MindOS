// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createReplayState, transitionReplay, validateBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { learningForScene } from '@/components/echo/replay/replay-learning';
import { ReplayLearningNote, ReplaySignals, ReplayTradeoff } from '@/components/echo/replay/ReplayLearning';
import { ReplayRouteReview } from '@/components/echo/replay/ReplayRouteReview';
import { replayCopy } from '@/components/echo/replay/replay-copy';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const source={id:'learning-ui',runtime:'codex' as const,title:'观察',messages:[{id:'m',role:'assistant' as const,text:'先看到 0.99，再发现 32 个棋子放错了。'}]};
const first={messageId:'m',quote:'0.99'},later={messageId:'m',quote:'32 个棋子放错了'};
const story=validateBranchStory(source,{title:'观察',summary:'先证据再解释',scenes:[{id:'s',title:'先检查什么',context:'先观察',evidence:[first],reconsideration:{prompt:'分数是否覆盖了每个物体？',insight:'整场指标会漏掉局部错误',refs:[later]},choices:[
 {id:'a',label:'先看整场',description:'汇总检查',proposal:first,tradeoff:{benefit:'检查快速',cost:'可能遗漏局部',check:'先测试一个局部变异？',refs:[first]},outcome:{kind:'unobserved',title:'未知',steps:[]}},
 {id:'b',label:'逐个检查',description:'逐个比较',proposal:first,outcome:{kind:'recorded',title:'有后续',steps:[{title:'看到高分',text:'先显示分数',refs:[first],signals:[{label:'整场 IoU',value:'0.99'}]},{title:'发现错误',text:'棋子放错了',refs:[later]}]}},
 ]}]});
const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(host);});
describe('learning through revisiting evidence',()=>{
 it('places observed routes before editorial reflection in a comparison',async()=>{
  let state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'b'});state=transitionReplay(story,state,{type:'advance'});
  await act(async()=>root.render(<ReplayRouteReview scene={story.scenes[0]} state={state} copy={replayCopy('zh')} onResume={()=>{}} onInspect={()=>{}} onFocus={()=>{}} onClose={()=>{}}/>));
  const route=host.querySelector('.replay-review-route')!,reflection=host.querySelector('.replay-learning-note')!;
  expect(route.compareDocumentPosition(reflection)&Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
 });
 it('conceals the interpretation until both routes and its supporting evidence have been seen',()=>{
  let state=createReplayState(story);expect(learningForScene(story.scenes[0],state).insight).toBeNull();
  state=transitionReplay(story,state,{type:'choose',choiceId:'a'});state=transitionReplay(story,state,{type:'rewind'});state=transitionReplay(story,state,{type:'choose',choiceId:'b'});state=transitionReplay(story,state,{type:'advance'});
  expect(learningForScene(story.scenes[0],state).insight).toBeNull();
  state=transitionReplay(story,state,{type:'advance'});expect(learningForScene(story.scenes[0],state).insight).toContain('局部错误');
 });
 it('brings an observed clue and a specific question back to the fork without an unseen moral',async()=>{
  let state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'b'});state=transitionReplay(story,state,{type:'advance'});state=transitionReplay(story,state,{type:'rewind'});
  await act(async()=>root.render(<ReplayLearningNote scene={story.scenes[0]} state={state} copy={replayCopy('zh')}/>));
  expect(host.textContent).toContain('看到高分');expect(host.textContent).not.toContain('分数是否覆盖');expect(host.textContent).not.toContain('局部错误');expect(host.textContent).not.toContain('32 个棋子');
 });
 it('does not reveal a second route through the wording of a reconsideration question',async()=>{
  const scene={...story.scenes[0],reconsideration:{...story.scenes[0].reconsideration!,prompt:'两条路线都删了细节，为什么？'}};
  let state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'b'});state=transitionReplay(story,state,{type:'advance'});
  await act(async()=>root.render(<ReplayLearningNote scene={scene} state={state} copy={replayCopy('zh')} compare/>));
  expect(host.textContent).not.toContain('两条路线都删了细节');expect(host.textContent).toContain('刚看到的证据');
 });
 it('keeps benefits, costs and actual observations distinct',async()=>{
  await act(async()=>root.render(<><ReplayTradeoff tradeoff={story.scenes[0].choices[0].tradeoff!} copy={replayCopy('zh')}/><ReplaySignals signals={story.scenes[0].choices[1].outcome.steps[0].signals!}/></>));
  expect(host.textContent).toContain('检查快速');expect(host.textContent).toContain('可能遗漏局部');expect(host.querySelector('dd')?.textContent).toBe('0.99');
 });
 it('ignores history from another scene and empty histories',async()=>{
  const state={...createReplayState(story),attempts:[{sceneId:'other',choiceId:'b',visibleSteps:2}]};
  await act(async()=>root.render(<ReplayLearningNote scene={story.scenes[0]} state={state} copy={replayCopy('en')}/>));expect(host.textContent).toBe('');
 });
});
