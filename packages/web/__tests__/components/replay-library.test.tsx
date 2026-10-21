// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReplayPageClient from '@/components/echo/replay/ReplayPageClient';
import { requestRaceExample } from '@/components/echo/replay/replay-example';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
vi.mock('@/lib/stores/locale-store',()=>({useLocale:()=>({locale:'zh'})}));
vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});
const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
const source={id:'s1',runtime:'codex',title:'一次普通会话',project:'项目一'};
const library={stories:[],sources:[source],sourceErrors:[]};
const fetchMock=vi.fn();
const response=(body:unknown,status=200)=>({ok:status<400,status,json:async()=>body});
const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;
beforeEach(()=>{vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();window.history.replaceState({},'','/echo/replay');});
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(host);localStorage.clear();});
describe('local replay library recovery',()=>{
 it('opens a saved story without waiting for the source catalog',async()=>{
  fetchMock.mockImplementation(()=>new Promise(()=>{}));
  await act(async()=>root.render(<ReplayPageClient initialStory={requestRaceExample('zh')}/>));
  expect(host.querySelector('[data-replay-canvas]')).not.toBeNull();
 });
 it('keeps a saved story readable when the background catalog fails and shows recovery in the picker',async()=>{
  fetchMock.mockRejectedValue(new DOMException('timeout','TimeoutError'));
  await act(async()=>root.render(<ReplayPageClient initialStory={requestRaceExample('zh')}/>));
  expect(host.querySelector('[data-replay-canvas]')).not.toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async()=>button('换一段经历').click());expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('读取本地经历超时');
 });
 it('waits for browser progress before rendering a preloaded canvas on the server',()=>{
  const html=renderToString(<ReplayPageClient initialStory={requestRaceExample('zh')}/>);
  expect(html).not.toContain('data-replay-canvas');
 });
 it('explains a timeout without presenting it as an empty library and can retry',async()=>{
  fetchMock.mockRejectedValueOnce(new DOMException('signal timed out','TimeoutError')).mockResolvedValueOnce(response({...library,stories:[requestRaceExample('zh')]}));
  await act(async()=>root.render(<ReplayPageClient/>));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('读取本地经历超时');
  expect(host.textContent).not.toContain('signal timed out');expect(host.textContent).not.toContain('从一次真实的工作开始');
  await act(async()=>button('重试').click());expect(host.querySelector('[data-replay-canvas]')).not.toBeNull();
 });
 it('clears the failed source context when switching to another agent',async()=>{
  fetchMock.mockResolvedValueOnce(response(library)).mockResolvedValueOnce(response({error:'Codex 的整理失败',source:{...source,messages:[]}},422)).mockResolvedValueOnce(response({...library,sources:[]}));
  await act(async()=>root.render(<ReplayPageClient/>));await act(async()=>button('换一段经历').click());await act(async()=>button('整理成剧情').click());
  await act(async()=>button('Claude Code').click());
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
  expect(button('查看这段原文')).toBeUndefined();
 });
 it('clearing a remote search reloads the full list and ignores the older pending search',async()=>{
  let complete!:(value:unknown)=>void;
  fetchMock.mockResolvedValueOnce(response(library)).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValueOnce(response(library));
  await act(async()=>root.render(<ReplayPageClient/>));await act(async()=>button('换一段经历').click());
  const input=document.querySelector<HTMLInputElement>('input[aria-label="搜索会话或项目"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'不存在');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  const clear=document.querySelector<HTMLButtonElement>('[aria-label="清空搜索"]')!;await act(async()=>clear.click());
  await act(async()=>complete(response({...library,sources:[]})));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('一次普通会话');
  expect(input.value).toBe('');
 });
 it('allows a built-in practice immediately while the catalog is still loading',async()=>{
  fetchMock.mockImplementation(()=>new Promise(()=>{}));await act(async()=>root.render(<ReplayPageClient/>));
  await act(async()=>button('演练示例').click());
  expect(host.querySelector('[data-replay-canvas]')).not.toBeNull();
 });
 it('keeps an import failure visible inside the picker and offers its original text without stacking dialogs',async()=>{
  fetchMock.mockResolvedValueOnce(response(library)).mockResolvedValueOnce(response({error:'这段会话暂无可验证的分支',source:{...source,messages:[{id:'m',role:'user',text:'普通记录'}]}},422));
  await act(async()=>root.render(<ReplayPageClient/>));await act(async()=>button('换一段经历').click());
  await act(async()=>button('整理成剧情').click());
  const picker=document.querySelector('[role="dialog"]');
  expect(picker?.querySelector('[role="alert"]')?.textContent).toContain('暂无可验证的分支');
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await act(async()=>button('查看这段原文').click());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('.replay-original')?.textContent).toContain('普通记录');
 });
 it('does not replace a missing linked experience with an unrelated story',async()=>{
  window.history.replaceState({},'','/echo/replay?story=missing');
  fetchMock.mockResolvedValue(response({...library,stories:[{...requestRaceExample('zh'),id:'unrelated'}]}));
  await act(async()=>root.render(<ReplayPageClient/>));
  expect(host.textContent).toContain('没有找到这段经历');
  expect(host.querySelector('[data-replay-canvas]')).toBeNull();
 });
 it('hides stale source rows while switching between Codex and Claude',async()=>{
  let complete!:(value:unknown)=>void;
  fetchMock.mockResolvedValueOnce(response(library)).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  await act(async()=>root.render(<ReplayPageClient/>));await act(async()=>button('换一段经历').click());
  await act(async()=>button('Claude Code').click());
  const picker=document.querySelector('[role="dialog"]');expect(picker?.textContent).not.toContain('一次普通会话');
  expect(picker?.querySelector('[role="status"]')).not.toBeNull();
  await act(async()=>complete(response({...library,sources:[]})));expect(picker?.textContent).toContain('没有找到');
 });
 it('ignores a late import response after the picker is closed',async()=>{
  let complete!:(value:unknown)=>void;
  fetchMock.mockResolvedValueOnce(response(library)).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  await act(async()=>root.render(<ReplayPageClient/>));await act(async()=>button('换一段经历').click());
  await act(async()=>button('整理成剧情').click());await act(async()=>button('Close').click());
  await act(async()=>complete(response({story:requestRaceExample('zh')})));
  expect(host.querySelector('[data-replay-canvas]')).toBeNull();
 });
});
