// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import LongitudinalParticipant from '@/components/echo/longitudinal/LongitudinalParticipant';
import type { LongitudinalView } from '@geminilight/mindos/knowledge';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = 'cohort-' + 'a'.repeat(24);
let host: HTMLDivElement; let renderer: ReturnType<typeof createRoot>;
let view: LongitudinalView; let status = 200; let code = '';
const base = (): LongitudinalView => ({
  id: 'participant-' + 'b'.repeat(24), studyId: id, version: 3, title: 'Synthetic multi-round study', consent: 'Please read this first.', withdrawal: 'You may withdraw and erase.',
  status: 'consent', accessExpired: false, erased: false, round: 0, roundCount: 2, stage: undefined, stageIndex: undefined, task: undefined, previousAnswer: undefined, help: undefined,
  updateAllowed: undefined, dueAt: undefined, method: undefined, revision: undefined, runs: [],
});
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); renderer = createRoot(host);
  view = base(); status = 200; code = '';
  vi.stubGlobal('fetch', vi.fn(async () => status === 200 ? Response.json({ view }) : Response.json({ code }, { status })));
  vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('native confirm must not be used'); });
});
afterEach(async () => { await act(async () => renderer.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); try { localStorage.clear(); } catch { /* memory storage */ } });
const render = () => act(async () => renderer.render(<LongitudinalParticipant id={id} zh={false} />));
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
async function click(text: string) { const b = button(text); expect(b, text).toBeDefined(); await act(async () => b!.click()); }
async function tick(name: string) { const box = host.querySelector(`[name="${name}"]`) as HTMLInputElement; expect(box, name).not.toBeNull(); await act(async () => box.click()); }
async function fill(name: string, value: string) {
  const field = host.querySelector(`[name="${name}"]`) as HTMLTextAreaElement; expect(field, name).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('exchanges the invitation fragment once, then requires an explicit consent checkbox before beginning', async () => {
  window.history.replaceState({}, '', `/study/longitudinal/${id}#token=${'c'.repeat(64)}`);
  await render();
  expect(window.location.hash).toBe('');
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/session');
  expect(host.textContent).toContain('Please read this first.');
  expect(button('Agree and begin')?.disabled).toBe(true);
  await tick('consent');
  view = { ...base(), status: 'answering', stage: 'before', stageIndex: 0, task: 'Judge this claim on your own.' };
  await click('Agree and begin');
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  expect(body).toMatchObject({ action: 'consent', version: 3 });
  expect(host.textContent).toContain('Judge this claim on your own.');
  expect(host.textContent).toContain('Round 1 of 2');
  expect(host.querySelector('[aria-current=step]')?.textContent).toContain('Independent judgment');
});
it('shows the locked judgment, help budget and confirm gate during the assisted stage', async () => {
  view = { ...base(), status: 'answering', stage: 'coaching', stageIndex: 1, task: 'Work through it with help.', previousAnswer: 'My locked first answer', method: 'Check evidence first',
    help: { attempts: 1, maxAttempts: 4, succeeded: 0, maxSucceeded: 2 }, runs: [{ id: 'help-1', question: 'Why?', status: 'failed', output: undefined, failure: 'provider' }] };
  await render();
  expect(host.textContent).toContain('My locked first answer');
  expect(host.textContent).toContain('0 of 2 completed replies · 1 of 4 attempts used');
  expect(host.textContent).toContain('No complete reply was saved');
  expect(button('Ask for help')?.disabled).toBe(true);
  await fill('help-question', 'Which evidence matters?');
  expect(button('Ask for help')?.disabled).toBe(false);
  await fill('independent-answer', 'A considered answer');
  expect(button('Submit and continue')?.disabled).toBe(true);
  await tick('confirmAnswer');
  expect(button('Submit and continue')?.disabled).toBe(false);
  view = { ...base(), status: 'answering', stage: 'after', stageIndex: 2, task: 'A new situation.' };
  await click('Submit and continue');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toMatchObject({ action: 'answer', answer: 'A considered answer' });
  expect(host.textContent).toContain('Your answer is locked.');
  expect(host.textContent).toContain('A new situation.');
  expect(host.textContent).not.toContain('My locked first answer');
});
it('maps access failures to participant copy and keeps withdrawal behind an inline confirmation', async () => {
  view = { ...base(), status: 'revision', updateAllowed: true, method: 'Check evidence first' };
  await render();
  expect(host.textContent).toContain('Check evidence first');
  expect(button('Submit for review')?.disabled).toBe(true);
  const summary = [...host.querySelectorAll('summary')].find(s => s.textContent === 'Withdraw from this study')!;
  await act(async () => { (summary.parentElement as HTMLDetailsElement).open = true; });
  expect(button('Confirm withdrawal')?.disabled).toBe(true);
  await tick('confirmWithdrawal');
  expect(button('Confirm withdrawal')?.disabled).toBe(false);
  status = 401; code = 'unauthorized';
  await click('Confirm withdrawal');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('This link is not available');
  expect(window.confirm).not.toHaveBeenCalled();
});

it('shows loading instead of a missing invitation while progress is being read', async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  await render();
  expect(host.textContent).toContain('Loading saved progress');
  expect(host.textContent).not.toContain('Open your private participant link');
});
it('allows a withdrawn participant to explicitly erase retained data and confirms completion', async () => {
  view = {...base(), status:'withdrawn'};
  await render();
  expect(button('Erase my study data')?.disabled).toBe(true);
  await tick('confirmErasure');
  view = {...view, erased:true, version:4};
  await click('Erase my study data');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toMatchObject({action:'withdraw',erase:true});
  expect(host.textContent).toContain('Your answers, methods and replies have been erased');
  expect(button('Erase my study data')).toBeUndefined();
});
it('uses a fresh help attempt after recovering a confirmed server-side failure', async () => {
  view={...base(),status:'answering',stage:'coaching',stageIndex:1,task:'Practice',help:{attempts:0,maxAttempts:4,succeeded:0,maxSucceeded:2}};
  await render(); await fill('help-question','Explain the evidence');
  vi.mocked(fetch).mockRejectedValueOnce(new Error('connection lost after reservation'));
  await click('Ask for help');
  const lost=JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  view={...view,version:5,help:{attempts:1,maxAttempts:4,succeeded:0,maxSucceeded:2},runs:[{id:'help-1',question:'Explain the evidence',status:'failed',output:undefined,failure:'provider'}]};
  await click('Check saved progress');
  await click('Ask for help');
  const retry=JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  expect(retry.requestId).not.toBe(lost.requestId);
  expect(retry.version).toBe(5);
  expect((host.querySelector('[name="help-question"]') as HTMLTextAreaElement).value).toBe('Explain the evidence');
});

it('keeps draft guidance in the participant language even if the owner uses English', async () => {
  view = {...base(),status:'answering',stage:'before',stageIndex:0,task:'独立任务'};
  await act(async () => renderer.render(<LongitudinalParticipant id={id} zh />));
  await fill('independent-answer','本地保存的作答');
  expect(host.textContent).toContain('草稿');
  expect(host.textContent).not.toContain('Unsubmitted drafts');
});
it('explains how to return during the waiting period and never starts a round automatically', async () => {
  view = {...base(),status:'waiting',dueAt:'2026-09-15T00:00:00.000Z'};
  await render();
  expect(host.textContent).toContain('Return using the same private link');
  expect(host.querySelector('time')?.dateTime).toBe(view.dueAt);
  expect(button('Start next round')).toBeUndefined();
  expect(vi.mocked(fetch).mock.calls.filter(c=>c[1]?.method==='PATCH')).toHaveLength(0);
});
it('shows a pending final help attempt before the exhausted-budget message', async () => {
  view={...base(),status:'answering',stage:'coaching',stageIndex:1,task:'Practice',help:{attempts:4,maxAttempts:4,succeeded:1,maxSucceeded:2},runs:[{id:'help-last',question:'Explain',status:'pending',output:undefined,failure:undefined}]};
  await render();
  expect(host.textContent).toContain('A reply is still being prepared');
  expect(host.textContent).not.toContain('The help limit for this round is reached');
  expect(button('Submit and continue')?.disabled).toBe(true);
});
it('keeps an unsent answer and shows local draft failure when storage is unavailable', async () => {
  view={...base(),status:'answering',stage:'before',stageIndex:0,task:'Judge independently'};
  await render();
  vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('quota');});
  await fill('independent-answer','My work stays in the form.');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Draft storage is unavailable');
  expect((host.querySelector('[name="independent-answer"]') as HTMLTextAreaElement).value).toBe('My work stays in the form.');
});
