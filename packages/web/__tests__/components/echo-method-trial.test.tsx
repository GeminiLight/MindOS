// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { messages } from '@/lib/i18n';
import EchoMethodTrial from '@/components/echo/learning/EchoMethodTrial';
const open = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAskModal', () => ({ openAskModal: open }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let fail: boolean;
beforeEach(() => { host=document.createElement('div');document.body.append(host);root=createRoot(host);fail=true;open.mockClear();vi.stubGlobal('fetch', vi.fn(async () => fail ? Response.json({code:'conflict'},{status:409}) : Response.json({trial:{path:'Echo/Playbooks/v1.md',title:'Check evidence',assetId:'asset-1',assetVersion:1,contentHash:'a'.repeat(64)}}))); });
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.unstubAllGlobals();});
it('keeps the task after an unavailable method and opens only an editable draft on successful retry', async () => {
 await act(async () => root.render(<EchoMethodTrial id="learn-123" version={3} attemptIndex={-1} p={messages.en.echoLearning} disabled={false} />));
 const input = host.querySelector('textarea')!;
 await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Compare the two new studies');input.dispatchEvent(new Event('input',{bubbles:true})); });
 const submit = () => host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await act(async () => {submit();});
 expect(host.querySelector('[role=alert]')?.textContent).toContain('changed');expect(input.value).toBe('Compare the two new studies');expect(open).not.toHaveBeenCalled();
 fail=false;await act(async () => {submit();});
 expect(open).toHaveBeenCalledWith(expect.stringContaining('Compare the two new studies'),'user',null,{newSession:true,context:{path:'Echo/Playbooks/v1.md',type:'file',label:'Check evidence'}});
 expect(host.textContent).toContain('Draft opened');
});
