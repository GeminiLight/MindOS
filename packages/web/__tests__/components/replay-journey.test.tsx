// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReplayState, transitionReplay, validateBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { ReplayJourneyReview } from '@/components/echo/replay/ReplayJourneyReview';
import { replayCopy } from '@/components/echo/replay/replay-copy';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
const ref={messageId:'m',quote:'先查证据'};
const story=validateBranchStory({id:'journey-review',runtime:'claude',title:'会话',messages:[{id:'m',role:'user',text:'先查证据，再改判断。'}]}, {
 title:'判断如何改变',summary:'连续经历',scenes:['first','second'].map((id,index)=>({id,title:`分岔 ${index+1}`,context:'先查证据',evidence:[ref],choices:[
  {id:'a',label:'先验证',description:'检查证据',proposal:ref,nextSceneId:index===0?'second':undefined,outcome:{kind:'recorded',title:'记录',steps:[{title:'先见到的变化',text:'只看已见内容',refs:[ref]},{title:'尚未展开的结果',text:'未来结果不能提前出现',refs:[ref]}]}},
  {id:'b',label:'直接承诺',description:'未验证的选择',proposal:ref,outcome:{kind:'unobserved',title:'没有执行记录',steps:[]}},
 ]}))
});
const observed=()=>transitionReplay(story,transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'a'}),{type:'advance'});
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(host);vi.unstubAllGlobals();localStorage.clear();vi.restoreAllMocks();});
describe('observed decision chain',()=>{
 it('starts empty and does not reveal future scene titles or result text',async()=>{
  await act(async()=>root.render(<ReplayJourneyReview story={story} state={createReplayState(story)} copy={replayCopy('zh')} onRevisit={vi.fn()}/>));
  expect(host.textContent).toContain('还没有走过的判断');expect(host.textContent).not.toContain('分岔 2');expect(host.textContent).not.toContain('未来结果');
 });
 it('keeps only observed steps, includes their evidence, and revisits the correct fork',async()=>{
  const revisit=vi.fn();await act(async()=>root.render(<ReplayJourneyReview story={story} state={observed()} copy={replayCopy('zh')} onRevisit={revisit}/>));
  expect(host.textContent).toContain('只看已见内容');expect(host.textContent).not.toContain('未来结果不能提前出现');expect(host.textContent).not.toContain('分岔 2');
  expect(host.querySelector('blockquote')?.textContent).toContain('先查证据');
  await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(revisit).toHaveBeenCalledWith(0);
 });
 it('offers the real artifact only after its associated step has been observed',async()=>{
  const value=structuredClone(story);value.artifacts=[{id:'file-row',title:'真实任务行',fileName:'proposal.docx',sha256:'a'.repeat(64),capturedAt:'2026-10-22T00:00:00Z',modifiedAt:'2026-10-01T00:00:00Z',source:ref,columns:['任务'],rows:[['探索候选']]}];value.scenes[0].choices[0].outcome.steps[1].artifactIds=['file-row'];
  const before=observed();await act(async()=>root.render(<ReplayJourneyReview story={value} state={before} copy={replayCopy('zh')} onRevisit={vi.fn()}/>));
  expect(host.querySelector('.replay-artifact')).toBeNull();
  const after=transitionReplay(value,before,{type:'advance'});await act(async()=>root.render(<ReplayJourneyReview story={value} state={after} copy={replayCopy('zh')} onRevisit={vi.fn()}/>));
  expect(host.querySelector('.replay-artifact')?.textContent).toContain('探索候选');expect(host.querySelector('.replay-artifact')?.closest('details')?.open).toBe(false);
 });
 it('preserves unknown attempts without inventing their results',async()=>{
  const state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'b'});
  await act(async()=>root.render(<ReplayJourneyReview story={story} state={state} copy={replayCopy('en')} onRevisit={vi.fn()}/>));
  expect(host.textContent).toContain('No result recorded');expect(host.textContent).not.toContain('只看已见内容');
 });
 it('restores a personal takeaway only for the same story version and reports failed storage',async()=>{
  const key=`mindos:branch-replay:${story.id}:takeaway`;
  localStorage.setItem(key,JSON.stringify({fingerprint:'old',text:'过期的体会'}));
  await act(async()=>root.render(<ReplayJourneyReview story={story} state={observed()} copy={replayCopy('zh')} onRevisit={vi.fn()}/>));
  const input=host.querySelector('textarea')!;expect(input.value).toBe('');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'先检查局部证据');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(JSON.parse(localStorage.getItem(key)!).text).toBe('先检查局部证据');
  await act(async()=>root.unmount());root=createRoot(host);
  await act(async()=>root.render(<ReplayJourneyReview story={story} state={observed()} copy={replayCopy('zh')} onRevisit={vi.fn()}/>));
  expect(host.querySelector('textarea')!.value).toBe('先检查局部证据');
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new Error('blocked');}});
  await act(async()=>{const field=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'仍可以写');field.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelector('[role=status]')?.textContent).toContain('未能保存');expect(host.querySelector('textarea')!.value).toBe('仍可以写');
 });
});
