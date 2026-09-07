// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { LearningLoop } from '@geminilight/mindos/knowledge';
import EchoMethodComparison from '@/components/echo/learning/EchoMethodComparison';
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en' }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const runtime = { adapter: 'isolated-chat-v1', provider: 'ollama', model: 'qa', endpoint: 'http://localhost:9/v1/chat/completions', temperature: 0, maxOutputTokens: 1024, tools: [] };
const method = { behavior: 'Check evidence', scope: 'Research', check: 'Identify limits', review: { decision: 'approved' } };
const loop = { id: 'learn-' + 'a'.repeat(24), version: 1, archived: false, directMethod: { ...method, revisions: [{ ...method, behavior: 'Check exceptions' }] }, attempts: [] } as unknown as LearningLoop;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function open() { await act(async () => root.render(<EchoMethodComparison loop={loop} attemptIndex={-1} disabled={false} />)); await act(async () => { host.querySelector('summary')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function fill(name: string, value: string) { await act(async () => { const el = host.querySelector(`[name="${name}"]`)!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
it('shows the fixed budget before execution and keeps the same freeze request after an uncertain save', async () => {
  const fetch = vi.fn(async (_url, init) => init?.method === 'POST' ? Response.json({ code: 'storage' }, { status: 500 }) : Response.json({ comparisons: [], unavailableCount: 0, runtime })); vi.stubGlobal('fetch', fetch);
  await open();
  for (const kind of ['use', 'exception', 'retention']) { await fill('comparison-' + kind + '-task', 'Task ' + kind); await fill('comparison-' + kind + '-expected', 'Criterion ' + kind); }
  expect(host.textContent).toContain('12'); expect(host.textContent).toContain('1024');
  const submit = () => act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await submit(); await submit();
  const posts = fetch.mock.calls.filter(call => call[1]?.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[0][1].body).toBe(posts[1][1].body);
  expect((host.querySelector('[name=comparison-use-task]') as HTMLTextAreaElement).value).toBe('Task use'); expect(host.querySelector('[role=alert]')).not.toBeNull();
});
it('shows unavailable configuration without enabling a freeze or sending execution requests', async () => {
  const fetch = vi.fn(async () => Response.json({ comparisons: [], unavailableCount: 0, runtime: null })); vi.stubGlobal('fetch', fetch);
  await open(); expect(host.textContent).toContain('compatible');
  expect(host.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
});
it('preserves a recovered judgment when selecting its saved comparison after returning',async()=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);
 const key='mindos-echo-draft-v1:'+loop.id+':comparison:-1:drafts';
 localStorage.setItem(key,JSON.stringify({schema:1,at:Date.now(),value:{'run-1':{outcome:'uncertain',quote:'Evidence',reason:'Unsubmitted reasoning'}}}));
 const record={id:'comparison-'+'b'.repeat(24),createdAt:new Date().toISOString(),runtime,methods:[{revisionIndex:0},{revisionIndex:1}],repetitions:1,cases:['use','exception','retention'].map(kind=>({kind,task:'Task',expected:'Criterion'})),slots:['use','exception','retention'].flatMap(kind=>[0,1].map(side=>({kind,side,repetition:0}))),runs:[{id:'run-1',slot:0,status:'succeeded',output:'Evidence',reportedModel:'qa'}],assessments:[]};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.includes('?id=')?{comparison:record}:{comparisons:[{id:record.id,createdAt:record.createdAt,revisions:[0,1]}],runtime})));
 await open();const select=host.querySelector('select')!;
 await act(async()=>{select.value=record.id;select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect((host.querySelector('[name="comparison-run-1-quote"]') as HTMLTextAreaElement).value).toBe('Evidence');
 localStorage.removeItem(key);
});
