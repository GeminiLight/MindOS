// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { ReplayExperience } from '@/components/echo/replay/ReplayExperience';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// JSDOM has no layout; real camera/gesture behavior is covered by Playwright.
vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
const host=document.createElement('div'); document.body.append(host); let root=createRoot(host);
afterEach(async()=>{ await act(async()=>root.unmount()); root=createRoot(host); localStorage.clear(); });
function story() {return validateBranchStory({ id:'ui-one',runtime:'codex',title:'一次设计判断',messages:[{id:'m',role:'user',text:'页面暂时恢复。旧内容又出现了。保留当前内容。'}]},{
 title:'一次设计判断',summary:'逐步观察与回退',scenes:[{id:'fork',title:'你想先试哪条路？',context:'切换后看到了旧内容。',evidence:[{messageId:'m',quote:'页面暂时恢复'}],choices:[
 {id:'a',label:'清理缓存',description:'先检查已有数据',proposal:{messageId:'m',quote:'暂时恢复'},outcome:{kind:'recorded',title:'还要继续观察',steps:[
 {title:'暂时恢复',text:'当前内容恢复。',refs:[{messageId:'m',quote:'页面暂时恢复'}]},
 {title:'问题复现',text:'旧结果随后返回。',refs:[{messageId:'m',quote:'旧内容又出现了'}]},]}},
 {id:'b',label:'确认归属',description:'先检查返回来源',proposal:{messageId:'m',quote:'保留当前内容'},outcome:{kind:'unobserved',title:'这条路还没有结果',steps:[]}},
 ]}],});}
const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!;
describe('branch replay experience',()=>{
 it('keeps an unknown choice while predicting a separately labelled historical continuation',async()=>{
  const base=story();const value=validateBranchStory(base.source,{...base,scenes:[{...base.scenes[0],historicalChoiceId:'a',prediction:{question:'你预计会怎样？',options:['会恢复','还不确定']}}]});
  await act(async()=>root.render(<ReplayExperience story={value} locale="zh"/>));
  await act(async()=>button('确认归属').click());expect(host.textContent).toContain('这条路还没有结果');
  await act(async()=>button('接回当时的记录').click());expect(host.textContent).toContain('揭晓之前');expect(host.textContent).not.toContain('当前内容恢复。');
  await act(async()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));expect(host.textContent).not.toContain('当前内容恢复。');
  await act(async()=>button('会恢复').click());await act(async()=>button('记下预测').click());
  expect(host.textContent).toContain('当时采用的路线');expect(host.textContent).toContain('当前内容恢复。');
  const state=JSON.parse(localStorage.getItem(`mindos:branch-replay:${value.id}`)!);expect(state.historyFrom).toBe('b');expect(state.attempts).toHaveLength(2);
  const notes=JSON.parse(localStorage.getItem(`mindos:branch-replay:${value.id}:judgments`)!);expect(notes.entries['fork/a'].prediction).toBe('会恢复');
  await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<ReplayExperience story={value} locale="zh"/>));expect(host.textContent).toContain('揭晓前的预测');expect(host.textContent).toContain('当时采用的路线');
 });
 it('lets a pending prediction leave for comparison and reopen without revealing the result',async()=>{
  const base=story();const value=validateBranchStory(base.source,{...base,scenes:[{...base.scenes[0],prediction:{question:'你预计会怎样？',options:['会恢复','还不确定']}}]});
  await act(async()=>root.render(<ReplayExperience story={value} locale="zh"/>));
  await act(async()=>button('清理缓存').click());expect(host.textContent).toContain('揭晓之前');
  await act(async()=>button('路径对照').click());expect(host.querySelector<HTMLElement>('[data-prediction-draft]')?.hidden).toBe(true);
  expect(host.textContent).not.toContain('当前内容恢复。');
  await act(async()=>button('剧情回放').click());expect(host.textContent).toContain('揭晓之前');
 });
 it('opens a readable choice panel when requested on a large canvas',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh"/>));
  const opener=host.querySelector<HTMLButtonElement>('.replay-canvas-tools button')!;
  await act(async()=>opener.click());expect(host.querySelector('.replay-decision-sheet')).not.toBeNull();
 });
 it('reports unavailable prediction storage without blocking the choice or discarding the typed observation',async()=>{
  const value=story();const storage=globalThis.localStorage;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new Error('blocked');},clear:()=>{}});
  try{
   await act(async()=>root.render(<ReplayExperience story={value} locale="zh"/>));await act(async()=>button('确认归属').click());
   const field=host.querySelector<HTMLTextAreaElement>('#replay-nextCheck')!;
   await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'先做一个可区分的检查');field.dispatchEvent(new Event('input',{bubbles:true}));});
   expect(host.textContent).toContain('未能保存预测与体会');expect(field.value).toBe('先做一个可区分的检查');expect(button('接回当时的记录')).toBeTruthy();
  }finally{vi.stubGlobal('localStorage',storage);}
 });
 it('opens the full observed decision chain at a route ending and returns to its fork',async()=>{
  const base=story();const value=validateBranchStory(base.source,{title:base.title,summary:base.summary,scenes:[base.scenes[0],{...base.scenes[0],id:'later',title:'未见的后续标题'}]});
  await act(async()=>root.render(<ReplayExperience story={value} locale="zh"/>));
  await act(async()=>button('清理缓存').click());await act(async()=>button('继续回放').click());
  await act(async()=>button('回看判断链').click());
  expect(host.querySelector('#replay-tab-journey')?.getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('.replay-journey')?.textContent).not.toContain('未见的后续标题');
  await act(async()=>button('回到这里再选').click());
  expect(host.querySelector('[data-replay-canvas]')).not.toBeNull();expect(host.querySelector('#replay-tab-story')?.getAttribute('aria-selected')).toBe('true');
 });
 it('does not interpret a scene navigation keystroke as choosing a route',async()=>{
  const base=story();const value=validateBranchStory(base.source,{title:base.title,summary:base.summary,scenes:[base.scenes[0],{...base.scenes[0],id:'later'}]});
  await act(async()=>root.render(<ReplayExperience story={value} locale="zh"/>));
  const navigation=host.querySelector<HTMLButtonElement>('nav[aria-label="分岔点导航"] button')!;
  await act(async()=>{navigation.focus();navigation.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true}));});
  expect(host.querySelectorAll('.replay-map-step')).toHaveLength(0);
 });
 it('continues a partly viewed route directly from comparison',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  await act(async()=>button('清理缓存').click());await act(async()=>button('路径对照').click());
  expect(button('继续这条路')).toBeTruthy();
  await act(async()=>button('继续这条路').click());
  expect(host.querySelector('#replay-tab-story')?.getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('.replay-map-step[data-status=current]')?.textContent).toContain('当前内容恢复。');
  expect(host.textContent).not.toContain('旧结果随后返回。');
 });
 it('marks the exact source quote when inspecting the original message',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  await act(async()=>button('清理缓存').click());await act(async()=>button('展开这一步').click());
  await act(async()=>button('查看这段原文').click());
  expect(host.querySelector('aside mark')?.textContent).toBe('页面暂时恢复');
 });
 it('explains restored progress and keeps the resume hint dismissible',async()=>{
  const value=story();await act(async()=>root.render(<ReplayExperience story={value} locale="zh" />));
  await act(async()=>button('清理缓存').click());await act(async()=>root.unmount());root=createRoot(host);
  await act(async()=>root.render(<ReplayExperience story={value} locale="zh" />));
  expect(host.textContent).toContain('已接上上次看到的位置');
  const dismiss=host.querySelector<HTMLButtonElement>('button[aria-label="收起进度提示"]');expect(dismiss).not.toBeNull();
  await act(async()=>dismiss!.click());expect(host.textContent).not.toContain('已接上上次看到的位置');
 });
 it('moves between tabs with arrow keys while preserving the selected route',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  await act(async()=>button('清理缓存').click());
  const replay=host.querySelector<HTMLButtonElement>('#replay-tab-story')!;
  await act(async()=>{replay.focus();replay.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});
  expect(host.querySelector('#replay-tab-compare')?.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement?.id).toBe('replay-tab-compare');
  await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
  expect(host.querySelector('.replay-map-step[data-status=current]')?.textContent).toContain('当前内容恢复。');
 });
 it('offers a clear next action after the first route is complete',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  await act(async()=>button('清理缓存').click());await act(async()=>button('继续回放').click());
  expect(button('试另一条路')).toBeTruthy();
  await act(async()=>button('试另一条路').click());
  expect(host.querySelector('.replay-dock-caption')?.textContent).toContain('选路');
 });
 it('provides readable comparison of observed results without revealing a later step',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  await act(async()=>button('清理缓存').click());
  await act(async()=>button('路径对照').click());
  const review=host.querySelector('[aria-label="比较已看到的结果"]');
  expect(review).not.toBeNull();expect(review?.textContent).toContain('当前内容恢复。');
  expect(review?.textContent).not.toContain('旧结果随后返回。');
 });
 it('opens an original excerpt without discarding the canvas or selected route',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  await act(async()=>button('清理缓存').click());await act(async()=>button('展开这一步').click());
  await act(async()=>button('查看这段原文').click());
  expect(host.querySelector('[data-replay-canvas]')).not.toBeNull();
  expect(host.querySelector('aside .replay-original')).not.toBeNull();
  await act(async()=>button('返回线索').click());
  expect(host.querySelector('.replay-map-step[data-status=current]')?.textContent).toContain('当前内容恢复。');
 });
 it('keeps observed outcomes on an explorable canvas when returning to the fork',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  expect(host.querySelector('[data-replay-canvas]')).not.toBeNull();
  expect(host.querySelector('[role="group"][aria-label="剧情画布"]')).not.toBeNull();
  await act(async()=>button('清理缓存').click());
  await act(async()=>button('继续回放').click());
  await act(async()=>button('试另一条路').click());
  expect(host.textContent).toContain('旧结果随后返回。');
  expect(button('全景')).toBeTruthy();
 });
 it('allows keyboard rewind while the continue button has focus',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  await act(async()=>button('清理缓存').click());
  await act(async()=>{const next=button('继续回放');next.focus();next.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));});
  expect(host.querySelector('[aria-label="回放路径"]')).not.toBeNull();
 });
 it('shows the selected first result immediately, conceals later results, and preserves the attempt on rewind',async()=>{
  await act(async()=>root.render(<ReplayExperience story={story()} locale="zh" />));
  expect(host.textContent).not.toContain('旧结果随后返回。');
  await act(async()=>button('清理缓存').click());
  expect(host.textContent).toContain('当前内容恢复。'); expect(host.textContent).not.toContain('旧结果随后返回。');
  await act(async()=>button('继续回放').click()); expect(host.textContent).toContain('旧结果随后返回。');
  await act(async()=>button('试另一条路').click());
  expect(host.textContent).toContain('已试过'); expect(host.textContent).toContain('清理缓存');
  await act(async()=>button('确认归属').click()); expect(host.textContent).toContain('这条路还没有结果');
 });
 it('restores progress on remount without exposing a different story version',async()=>{
  const value=story(); await act(async()=>root.render(<ReplayExperience story={value} locale="zh" />));
  await act(async()=>button('清理缓存').click());
  await act(async()=>root.unmount()); root=createRoot(host);
  await act(async()=>root.render(<ReplayExperience story={value} locale="zh" />));
  expect(host.textContent).toContain('当前内容恢复。');
 });
 it('renders source text safely and keeps unknown alternatives distinct',async()=>{
  const value=story(); value.summary='<script>alert(1)</script>';
  await act(async()=>root.render(<ReplayExperience story={value} locale="en" />));
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('[aria-label="Replay routes"]')).not.toBeNull();
 });
});
