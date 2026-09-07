// @vitest-environment jsdom
import React, { act } from 'react';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { startLearningLoop, startTransferPractice, getTransferPractice, transferPracticeId, updateTransferPractice } from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
import EchoTransferPractice from '@/components/echo/learning/EchoTransferPractice';
import EchoLearningPanel from '@/components/echo/learning/EchoLearningPanel';
import { messages } from '@/lib/i18n';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from '@/app/api/echo/transfer/route';
import { startLearningCorrection, updateLearningLoop } from '@geminilight/mindos/knowledge';
import { startAgentRun, completeAgentRun, resetAgentRunsForTest } from '@geminilight/mindos/agent';
import { writeRetrievalReceipt } from '@geminilight/mindos/retrieval';
import { openAskModal } from '@/hooks/useAskModal';
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en', t: messages.en }) }));
vi.mock('@/hooks/useAskModal', () => ({ openAskModal: vi.fn(), ASK_HIDE_PANELS_EVENT: 'mindos:hide-ask-panels' }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let home: string; let learningId: string; let fail: boolean; let host: HTMLDivElement; let renderer: ReturnType<typeof createRoot>;
beforeEach(() => {
 home=fs.mkdtempSync(path.join(os.tmpdir(),'transfer-ui-')); vi.spyOn(os,'homedir').mockReturnValue(home); fail=false;
 learningId=startLearningLoop(testMindRoot,{cardId:'transfer-ui',title:'Evidence',content:'Check the source',sessions:[{id:'s',messageRefs:[{messageIndex:0,role:'user',quote:'Evidence matters'}]}]}).id;
 host=document.createElement('div');document.body.append(host);renderer=createRoot(host);
 vi.stubGlobal('fetch', vi.fn(async (_url:string, init?:RequestInit) => {
  if (_url === '/api/echo/learning') return Response.json({ loops: [] });
  if (_url.includes('list=pending')) return Response.json({ practices: [], unavailableCount: 0 });
  if(fail && init?.method==='PATCH')return Response.json({code:'storage'},{status:500});
  const input=init?.body?JSON.parse(String(init.body)):{};
  const practice=init?.method==='POST'?startTransferPractice(testMindRoot,learningId,'en'):init?.method==='PATCH'?updateTransferPractice(testMindRoot,input.id,input):getTransferPractice(testMindRoot,transferPracticeId(learningId));
  return Response.json({practice});
 }));
});
afterEach(async()=>{await act(async()=>renderer.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();fs.rmSync(home,{recursive:true,force:true});});
async function click(text:string){const el=[...host.querySelectorAll('button')].find(e=>e.textContent?.trim()===text);expect(el,text).toBeDefined();await act(async()=>el!.click());}
async function fill(name:string,value:string){const el=host.querySelector(`[name=${name}]`) as HTMLTextAreaElement;expect(el).not.toBeNull();await act(async()=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
it('preserves a failed answer and reveals each phase only after committing the preceding response',async()=>{
 await act(async()=>renderer.render(<EchoTransferPractice learningId={learningId} locale="en" archived={false}/>));
 await act(async()=>{const detail=host.querySelector('details')!;detail.open=true;detail.dispatchEvent(new Event('toggle'));});
 await click('Start this practice');
 expect(host.textContent).toContain('coffee');expect(host.textContent).not.toContain('school');
 await fill('transferAnswer','Association is not enough here.');await fill('transferAssistance','none');await fill('transferFamiliar','no');
 const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
 fail=true;await click('Lock my initial answer');expect((host.querySelector('[name=transferAnswer]') as HTMLTextAreaElement).value).toBe('Association is not enough here.');
 fail=false;await click('Lock my initial answer');await click('Show a reasoning hint');expect(host.textContent).toContain('alternative explanation');
 await fill('transferAnswer','I would also check confounding.');await fill('transferAssistance','none');await fill('transferFamiliar','no');await click('Save and try a new situation');
 expect(host.textContent).toContain('school');expect(host.textContent).not.toContain('Association is not enough here.');expect(host.textContent).not.toContain('Show a reasoning hint');
 await fill('transferAnswer','Normal teaching may explain the difference.');await fill('transferAssistance','notes');await fill('transferFamiliar','no');await click('Save this independent attempt');
 const savedLeave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedLeave); expect(savedLeave.defaultPrevented).toBe(false);
 expect(host.textContent).toContain('Come back for a fresh situation');expect(host.querySelector('[name=transferAnswer]')).toBeNull();expect(host.textContent).not.toContain('workshop');
});
it('keeps an unsent draft accessible when another tab advances the saved step',async()=>{
 await act(async()=>renderer.render(<EchoTransferPractice learningId={learningId} locale="en" archived={false}/>));
 await act(async()=>{const detail=host.querySelector('details')!;detail.open=true;detail.dispatchEvent(new Event('toggle'));});await click('Start this practice');
 await fill('transferAnswer','My unsent reasoning must survive.');await fill('transferAssistance','none');await fill('transferFamiliar','no');
 const view=getTransferPractice(testMindRoot,transferPracticeId(learningId))!;
 updateTransferPractice(testMindRoot,view.id,{version:view.version,action:'answer',answer:'Saved from another tab',confidence:null,assistance:'none',familiar:false});
 await click('Lock my initial answer');await click('Retry');
 expect(host.textContent).toContain('Unsent draft');expect(host.textContent).toContain('My unsent reasoning must survive.');
});

it('opens an existing practice from its return link without starting it again', async () => {
 startTransferPractice(testMindRoot,learningId,'en');
 window.history.replaceState({},'', '/echo/growth?learning='+learningId+'&practice=1');
 try {
  await act(async()=>renderer.render(<EchoTransferPractice learningId={learningId} locale="en" archived={false}/>));
  expect(host.querySelector('details')?.open).toBe(true); expect(host.querySelector('[name=transferAnswer]')).not.toBeNull();
  expect(vi.mocked(fetch).mock.calls.every(([,init])=>init?.method==='GET')).toBe(true);
 } finally { window.history.replaceState({},'', '/'); }
});

it('can return to a private practice even when its original learning record is unavailable', async () => {
 startTransferPractice(testMindRoot,learningId,'en');
 window.history.replaceState({},'', '/echo/growth?learning='+learningId+'&practice=1');
 try {
  await act(async()=>renderer.render(<EchoLearningPanel/>));
  expect(host.textContent).toContain('The original learning record is unavailable');
  expect(host.querySelector('[name=transferAnswer]')).not.toBeNull();
 } finally { window.history.replaceState({},'', '/'); }
});

it('reports a missing saved practice on a return link without silently creating one', async () => {
 window.history.replaceState({},'', '/echo/growth?learning='+learningId+'&practice=1');
 try {
  await act(async()=>renderer.render(<EchoTransferPractice learningId={learningId} locale="en" archived/>));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('The source or practice is no longer available');
  expect(vi.mocked(fetch).mock.calls.every(([,init])=>init?.method==='GET')).toBe(true);
 } finally { window.history.replaceState({},'', '/'); }
});

it('reviews a method match, preserves failed drafts, opens actual help and hides it for the new situation', async () => {
 resetAgentRunsForTest(); vi.mocked(openAskModal).mockClear();
 let loop = startLearningCorrection(testMindRoot, { cardId: 'linked-ui', title: 'Evidence', content: 'Evidence', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'assistant', quote: 'Inspect design.' }] }] }, { behavior: 'Inspect comparison and identification.', scope: 'Evidence interpretation', check: 'Explain alternatives.' });
 loop = updateLearningLoop(testMindRoot, loop.id, { version: loop.version, action: 'approve-agent', attemptIndex: -1 }); learningId = loop.id;
 const optionsResponse = await GET(new NextRequest('http://localhost/api/echo/transfer?learningId='+learningId));
 const options = await optionsResponse.json();
 expect(optionsResponse.status, JSON.stringify(options)).toBe(200);
 expect(options.methods).toHaveLength(1);
 vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  if (fail && init?.method === 'POST') return Response.json({ code: 'storage' }, { status: 500 });
  const request = new NextRequest('http://localhost'+url, { method: init?.method, body: init?.body, headers: init?.headers });
  return init?.method === 'POST' ? POST(request) : init?.method === 'PATCH' ? PATCH(request) : GET(request);
 }));
 await act(async()=>renderer.render(<EchoTransferPractice learningId={learningId} locale="en" archived={false}/>));
 await act(async()=>{const details=host.querySelector('details')!;details.open=true;details.dispatchEvent(new Event('toggle'));});
 await fill('transferMethod','-1:0');
 await fill('transferMatchReason','This method checks the same evidence interpretation skill.');
 await act(async()=> (host.querySelector('[name=transferMatchConfirmed]') as HTMLInputElement).click());
 fail=true;await click('Start this practice');
 expect((host.querySelector('[name=transferMatchReason]') as HTMLTextAreaElement).value).toContain('same evidence');
 fail=false;await click('Start this practice');
 await fill('transferAnswer','The observational comparison cannot establish cause.');await fill('transferAssistance','none');await fill('transferFamiliar','no');await click('Lock my initial answer');
 await click('Prepare a question for an Agent');
 const view=getTransferPractice(testMindRoot,transferPracticeId(learningId))!;
 expect(openAskModal).toHaveBeenCalledWith(expect.stringContaining('The observational comparison'), 'user', null, expect.objectContaining({ newSession:true, context: expect.objectContaining({ path: view.method!.path, type: 'file', label: view.method!.title }) }));
 const stamp=new Date().toISOString();const receiptId='receipt-linked-ui';
 writeRetrievalReceipt(testMindRoot,{id:receiptId,query:vi.mocked(openAskModal).mock.calls.at(-1)![0]!,strategy:'explicit-approved-method-context-v1',outcome:'selected',startedAt:stamp,completedAt:stamp,
  budget:{maxTokens:2000,maxFiles:1,minScore:0,timeoutMs:0},scope:{preferredPaths:[view.method!.path],excludePaths:[]},candidates:[],
  selections:[{assetId:view.method!.assetId,path:view.method!.path,contentHash:view.method!.contentHash,assetVersion:view.method!.assetVersion,truncated:false,estimatedTokens:100,score:1,reason:'approved method'}],totals:{candidateCount:1,selectedCount:1,usedTokens:100}});
 const run=startAgentRun({runtimeId:'claude',displayName:'UI fixture',agentKind:'native-runtime',permissionMode:'read',metadata:{retrievalReceiptIds:[receiptId]}});
 completeAgentRun(run.id,{outputSummary:'Look for plausible confounding in this comparison.'});
 await click('Check for Agent replies');
 expect(host.textContent).not.toContain('Look for plausible confounding');
 await click('View and save this reply');
 expect(host.textContent).toContain('Look for plausible confounding');
 await fill('transferAnswer','Sleep could explain the difference.');await fill('transferAssistance','agent');await fill('transferFamiliar','no');await click('Save and try a new situation');
 expect(host.textContent).not.toContain('Look for plausible confounding');
 expect(getTransferPractice(testMindRoot,view.id)?.helpRuns[0].viewRequestedAt).toBeTruthy();
 resetAgentRunsForTest();
});
