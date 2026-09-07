// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { messages } from '@/lib/i18n';
import EchoCorrectionButton from '@/components/echo/learning/EchoCorrectionButton';
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en', t: messages.en }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let fail: boolean; let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
 host=document.createElement('div');document.body.append(host);root=createRoot(host);fail=true;
 vi.stubGlobal('crypto', webcrypto);
 fetchMock=vi.fn(async () => fail ? Response.json({ code:'conflict' },{status:409}) : Response.json({loop:{id:'learn-test'}}));vi.stubGlobal('fetch',fetchMock);
});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.unstubAllGlobals();});
async function click(label:string){const button=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()===label||el.getAttribute('aria-label')===label);expect(button).toBeDefined();await act(async()=>button!.click());}
async function fill(name:string,value:string){const input=document.querySelector(`[name=${name}]`) as HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
it('preserves a correction after a changed source error and saves only a reviewable proposal',async()=>{
 await act(async()=>root.render(<EchoCorrectionButton sessionId="source" messageIndex={1} text="This proves causation." />));
 await click('Keep a correction');
 await fill('correctionBehavior','Check research design');await fill('correctionScope','Research only');await fill('correctionCheck','Support causal claims with evidence');
 await click('Save proposal');
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 expect(document.querySelector('[role=alert]')?.textContent).toContain('conversation');
 expect((document.querySelector('[name=correctionBehavior]') as HTMLTextAreaElement).value).toBe('Check research design');
 fail=false;await click('Save proposal');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 expect(document.body.textContent).toContain('Method proposal saved');
 expect(document.querySelector('a[href="/echo/growth?learning=learn-test"]')).not.toBeNull();
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({sessionId:'source',messageIndex:1,messageHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
});
