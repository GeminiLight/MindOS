// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonEditor from '@/components/studio/views/PersonEditor';
import MeetingPanel from '@/components/studio/views/MeetingPanel';
import { viewsCopy } from '@/lib/views/copy';
import { readViewDraft, writeViewDraft } from '@/lib/views/drafts';
import { ViewsApiError, type PersonDocument } from '@/lib/views/api';
const mocked=vi.hoisted(()=>({mutate:vi.fn(),read:vi.fn(),materials:vi.fn(),chat:vi.fn()}));
vi.mock('@/lib/views/api',async importOriginal=>({...await importOriginal<typeof import('@/lib/views/api')>(),mutateView:mocked.mutate,getViewPerson:mocked.read,getViewMaterials:mocked.materials}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/hooks/useAskModal',()=>({openAskModal:mocked.chat}));
vi.mock('@/components/ui/dialog',()=>({
 Dialog:({children}:{children:React.ReactNode})=><div>{children}</div>,
 DialogContent:({children}:{children:React.ReactNode})=><div role="dialog">{children}</div>,
 DialogHeader:({children}:{children:React.ReactNode})=><header>{children}</header>,
 DialogTitle:({children}:{children:React.ReactNode})=><h2>{children}</h2>,
 DialogDescription:({children}:{children:React.ReactNode})=><p>{children}</p>,
 DialogFooter:({children}:{children:React.ReactNode})=><footer>{children}</footer>,
}));
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const c=viewsCopy('zh');const rootId='library-a',viewId='view-a';
const person:PersonDocument={id:'person-a',path:'人物/叶.md',name:'叶遥',background:'当前背景',focus:'',revision:'a'.repeat(64),followup:{text:'',date:'',completed:false},interactionCount:1,interactions:[{id:'old',text:'已保存互动',date:'2026-10-01',source:''}],sources:'',managed:true};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function click(text:string){await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click();});}
const input=(label:string)=>{const l=[...host.querySelectorAll('label')].find(l=>l.textContent===label)!;return document.getElementById(l.htmlFor) as HTMLInputElement;};
const scope={rootId,viewId,personId:person.id,kind:'interaction'};
describe('person drafts and conflict recovery',()=>{
 it('keeps the original base until the human has reviewed the newer file',async()=>{
  writeViewDraft(scope,{revision:person.revision,operationId:'12345678-1234-1234-1234-123456789abc',values:{text:'保留的输入',date:'2026-10-12',source:''},updatedAt:100});
  mocked.mutate.mockRejectedValueOnce(new ViewsApiError('REVISION_CONFLICT',409)).mockResolvedValue({rootId,person});
  mocked.read.mockResolvedValue({rootId,person:{...person,revision:'b'.repeat(64),interactions:[{...person.interactions[0],text:'外部新增记录'}]}});
  const saved=vi.fn();await act(async()=>root.render(<PersonEditor rootId={rootId} viewId={viewId} person={person} kind="interaction" c={c} close={vi.fn()} saved={saved}/>));
  expect(input('聊了什么').value).toBe('保留的输入');
  await click(c.saveInteraction);expect(host.textContent).toContain(c.conflictTitle);expect(saved).not.toHaveBeenCalled();
  expect(readViewDraft(scope)?.revision).toBe(person.revision);
  await click(c.readLatest);expect(host.textContent).toContain('外部新增记录');
  await click(c.keepDraft);expect(readViewDraft(scope)?.revision).toBe('b'.repeat(64));
  await click(c.saveInteraction);
  expect(mocked.mutate.mock.calls[1][1]).toMatchObject({expectedRevision:'b'.repeat(64),text:'保留的输入',operationId:'12345678-1234-1234-1234-123456789abc'});
  expect(saved).toHaveBeenCalledWith(person);expect(readViewDraft(scope)).toBeNull();
 });
 it('retains a recovered draft when the library changed',async()=>{
  writeViewDraft(scope,{revision:person.revision,operationId:'operation-a',values:{text:'我的输入',date:'2026-10-12',source:''},updatedAt:100});
  mocked.mutate.mockRejectedValue(new ViewsApiError('ROOT_CHANGED',409));const saved=vi.fn();
  await act(async()=>root.render(<PersonEditor rootId={rootId} viewId={viewId} person={person} kind="interaction" c={c} close={vi.fn()} saved={saved}/>));
  await click(c.saveInteraction);expect(host.textContent).toContain(c.rootChanged);expect(input('聊了什么').value).toBe('我的输入');expect(saved).not.toHaveBeenCalled();expect(readViewDraft(scope)).not.toBeNull();
 });
});
describe('meeting preparation carries only checked available records',()=>{
 it('omits unavailable records, invalidates a preview when choices change and opens an unsent text-only draft',async()=>{
  mocked.materials.mockResolvedValue({rootId,text:'选定材料',items:[],revision:person.revision});
  await act(async()=>root.render(<MeetingPanel rootId={rootId} viewId={viewId} person={person} locale="zh" c={c} close={vi.fn()}/>));
  await click(c.preview);expect(mocked.materials.mock.calls[0][3]).toEqual(['background','interactions']);
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('选定材料');
  const checkbox=[...host.querySelectorAll('label')].find(l=>l.textContent===c.interactions)!.querySelector('input')!;
  await act(async()=>checkbox.click());expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  await click(c.preview);expect(mocked.materials.mock.calls[1][3]).toEqual(['background']);
  await click(c.openDraft);expect(mocked.chat).toHaveBeenCalledWith('选定材料','user',null,{newSession:true});
 });
});
it('connects person validation to the invalid name and clears it after correction', async () => {
 await act(async()=>root.render(<PersonEditor rootId={rootId} viewId={viewId} kind="new" c={c} close={vi.fn()} saved={vi.fn()}/>));
 const name=input(c.name);
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'   ');name.dispatchEvent(new Event('input',{bubbles:true}));});
 await click(c.savePerson);
 expect(name.getAttribute('aria-invalid')).toBe('true');
 expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'林悦');name.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(name.getAttribute('aria-invalid')).not.toBe('true');
 expect(mocked.mutate).not.toHaveBeenCalled();
});
