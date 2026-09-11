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
  status: 'consent', round: 0, roundCount: 2, stage: undefined, stageIndex: undefined, task: undefined, previousAnswer: undefined, help: undefined,
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
