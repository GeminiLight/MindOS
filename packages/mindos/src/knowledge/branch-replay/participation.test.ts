import { describe, expect, it } from 'vitest';
import { createReplayState, restoreReplayState, transitionReplay, validateBranchStory } from './index.js';
const ref={messageId:'m',quote:'proposal.docx'};
const source={id:'participation',runtime:'codex' as const,title:'计划',messages:[{id:'m',role:'assistant' as const,text:'proposal.docx 保留探索候选。'}]};
const raw=()=>({title:'怎样写承诺？',summary:'先观察',artifacts:[{id:'task-row',title:'任务表原文',fileName:'proposal.docx',sha256:'a'.repeat(64),capturedAt:'2026-10-22T01:00:00Z',modifiedAt:'2026-10-01T01:00:00Z',source:ref,columns:['任务','状态'],rows:[['Motion','探索候选']]}],scenes:[{id:'start',title:'怎样安排？',context:'先做选择',evidence:[ref],historicalChoiceId:'recorded',prediction:{question:'读者怎样理解？',options:['确定承诺','仍待验证']},choices:[
 {id:'unknown',label:'另一种安排',description:'待验证',proposal:ref,outcome:{kind:'unobserved' as const,title:'未知',steps:[]}},
 {id:'recorded',label:'当时的安排',description:'原记录',proposal:ref,nextSceneId:'next',outcome:{kind:'recorded' as const,title:'记录',steps:[{title:'原文',text:'文档保留探索候选',refs:[ref],artifactIds:['task-row']}]}},
]},{id:'next',title:'下一处',context:'继续',evidence:[ref],choices:[{id:'a',label:'A',description:'A',proposal:ref,outcome:{kind:'recorded' as const,title:'记录',steps:[{title:'末步',text:'末步',refs:[ref]}]}},{id:'b',label:'B',description:'B',proposal:ref,outcome:{kind:'unobserved' as const,title:'未知',steps:[]}}]}]});
describe('returning from an unrecorded choice to documented history',()=>{
 it('keeps the personal choice and labels the continued route as historical',()=>{
  const story=validateBranchStory(source,raw());let state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'unknown'});
  state=transitionReplay(story,state,{type:'follow-history'});
  expect(state.choiceId).toBe('recorded');expect(state.visibleSteps).toBe(1);expect(state.historyFrom).toBe('unknown');
  expect(state.attempts).toEqual([{sceneId:'start',choiceId:'unknown',visibleSteps:0},{sceneId:'start',choiceId:'recorded',visibleSteps:1,selection:'historical'}]);
  expect(restoreReplayState(story,state)).toEqual(state);
  state=transitionReplay(story,state,{type:'advance'});expect(state.sceneIndex).toBe(1);expect(state.historyFrom).toBeUndefined();
 });
 it('does not jump from an unopened choice or invent a history when all routes are unknown',()=>{
  const story=validateBranchStory(source,raw());const initial=createReplayState(story);expect(transitionReplay(story,initial,{type:'follow-history'})).toEqual(initial);
  const draft=raw();draft.scenes[0].historicalChoiceId=undefined as never;draft.scenes[0].choices=draft.scenes[0].choices.map(c=>({...c,nextSceneId:undefined,outcome:{kind:'unobserved',title:'未知',steps:[]}}));
  const unknown=validateBranchStory(source,draft);const state=transitionReplay(unknown,createReplayState(unknown),{type:'choose',choiceId:'unknown'});
  expect(transitionReplay(unknown,state,{type:'follow-history'})).toEqual(state);
 });
 it('rejects a history link to an unknown path and a forged restored history origin',()=>{
  const draft=raw();draft.scenes[0].historicalChoiceId='unknown';expect(()=>validateBranchStory(source,draft)).toThrow(/history|recorded/i);
  const story=validateBranchStory(source,raw());expect(restoreReplayState(story,{...createReplayState(story),historyFrom:'missing'})).toEqual(createReplayState(story));
  const unknown=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'unknown'});unknown.attempts[0].selection='historical';expect(restoreReplayState(story,unknown)).toEqual(createReplayState(story));
 });
 it('retains bounded artifact provenance and rejects missing or malformed artifacts',()=>{
  const story=validateBranchStory(source,raw());expect(story.artifacts?.[0].rows[0][1]).toBe('探索候选');expect(story.scenes[0].prediction?.options).toHaveLength(2);
  const missing=raw();missing.artifacts=[];expect(()=>validateBranchStory(source,missing)).toThrow(/artifact/i);
  const invalid=raw();invalid.artifacts[0].rows=[['one cell']];expect(()=>validateBranchStory(source,invalid)).toThrow();
  const foreign=raw();foreign.artifacts[0].fileName='other.docx';expect(()=>validateBranchStory(source,foreign)).toThrow(/source|file/i);
 });
});
