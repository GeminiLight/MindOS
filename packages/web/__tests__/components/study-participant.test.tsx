// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ParticipantWorkspace } from '@/components/echo/research/ParticipantWorkspace';
import type { StudyAccessView } from '@geminilight/mindos/knowledge';
(globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let renderer: ReturnType<typeof createRoot>;
let view: StudyAccessView;
let fail = false;
const expiresAt = '2026-10-01T00:00:00Z';
const participant = () => ({ kind: 'participant', expiresAt, participant: { id: 'participant-' + 'a'.repeat(24), studyId: 'study-' + 'b'.repeat(24), version: 2, title: 'Synthetic study', protocolHash: 'c'.repeat(64), locale: 'en', consent: 'Consent', withdrawal: 'Stop or erase', status: 'answering', nextPhase: 'baseline', completedStages: 0, task: { prompt: 'State your own judgment.', budgetSeconds: 60, requestedAt: new Date().toISOString() } } } as unknown as StudyAccessView);
beforeEach(() => { host = document.createElement('div'); document.body.append(host); renderer = createRoot(host); fail = false; view = { kind: 'consent', title: 'Synthetic study', locale: 'en', consent: 'Please review before joining.', withdrawal: 'Stop or erase', protocolHash: 'c'.repeat(64), expiresAt }; vi.spyOn(window, 'confirm').mockReturnValue(false); vi.stubGlobal('fetch', vi.fn(async () => fail ? Response.json({ code: 'storage' }, { status: 500 }) : Response.json({ view }))); });
afterEach(async () => { await act(async () => renderer.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
async function render() { await act(async () => renderer.render(<ParticipantWorkspace studyId={'study-' + 'b'.repeat(24)} locale="en"/>)); }
async function click(text: string) { const b = [...host.querySelectorAll('button')].find(e => e.textContent === text); expect(b, text).toBeDefined(); await act(async () => b!.click()); }
async function fill(name: string, value: string) { const field = host.querySelector(`[name=${name}]`) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
it('clears invitation fragments before exchanging them, and requires active consent', async () => {
    window.history.replaceState({}, '', '/study/participate/study-' + 'b'.repeat(24) + '#invite=' + 'x'.repeat(43));
    await render();
    expect(window.location.hash).toBe('');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('/session');
    expect(host.textContent).toContain('Please review before joining.');
    expect(host.textContent).toContain('This is a workflow pilot.');
    const join = [...host.querySelectorAll('button')].find(b => b.textContent === 'Agree and join');
    expect(join?.disabled).toBe(true);
    await act(async () => (host.querySelector('[name=consent]') as HTMLInputElement).click());
    view = participant();
    await click('Agree and join');
    expect(host.textContent).toContain('State your own judgment.');
});
it('preserves failed answers and blocks accidental leaving, then reports the locked result without inventing help', async () => {
    view = participant();
    await render();
    await fill('answer', 'My independent judgment');
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    await fill('assistance', 'none');
    await fill('familiar', 'no');
    await act(async () => (host.querySelector('[name=confirmAnswer]') as HTMLInputElement).click());
    fail = true;
    await click('Submit and lock answer');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('not confirmed');
    expect((host.querySelector('[name=answer]') as HTMLTextAreaElement).value).toBe('My independent judgment');
    fail = false;
    view = participant();
    if (view.kind === 'participant') {
        view.participant.status = 'ready';
        view.participant.nextPhase = 'coaching';
        view.participant.completedStages = 1;
        view.participant.task = undefined;
        view.participant.version = 3;
    }
    await click('Submit and lock answer');
    expect(host.querySelector('[name=answer]')).toBeNull();
    expect(host.textContent).toContain('Your answer is locked');
    expect(host.textContent).toContain('The assisted stage is not available yet');
});
it('keeps withdrawal choices explicit and supports erasure after access expires', async () => {
    view = { kind: 'expired', title: 'Synthetic study', locale: 'en', withdrawal: 'Stop or erase', expiresAt, version: 3, canErase: true };
    await render();
    expect(host.textContent).toContain('invitation has expired');
    await click('Leave this study');
    expect((host.querySelector('[name=erase]') as HTMLSelectElement)?.value).toBe('retain');
    await act(async () => (host.querySelector('[name=confirmWithdrawal]') as HTMLInputElement).click());
    await fill('erase', 'erase');
    expect((host.querySelector('[name=confirmWithdrawal]') as HTMLInputElement).checked).toBe(false);
    await act(async () => (host.querySelector('[name=confirmWithdrawal]') as HTMLInputElement).click());
    view = participant();
    if (view.kind === 'participant') {
        view.participant.status = 'withdrawn';
        view.participant.erasedAt = expiresAt;
        view.participant.task = undefined;
        view.participant.nextPhase = undefined;
    }
    await click('Confirm withdrawal');
    expect(host.textContent).toContain('Your answers were erased');
});
it('retains the invitation across a development effect replay and still loads consent', async () => {
    window.history.replaceState({}, '', '/study/participate/study-' + 'b'.repeat(24) + '#invite=' + 'x'.repeat(43));
    await act(async () => renderer.render(<React.StrictMode><ParticipantWorkspace studyId={'study-' + 'b'.repeat(24)} locale="en"/></React.StrictMode>));
    expect(host.textContent).toContain('Please review before joining.');
    expect(window.location.hash).toBe('');
});
it('exchanges a new invitation in the same page instead of retaining the previous participant identity', async () => {
    await render();
    await act(async () => (host.querySelector('[name=consent]') as HTMLInputElement).click());
    view = { kind: 'consent', title: 'Another participant', locale: 'en', consent: 'Read again', withdrawal: 'Stop or erase', protocolHash: 'd'.repeat(64), expiresAt };
    await act(async () => {
        window.history.replaceState({}, '', '/study/participate/study-' + 'b'.repeat(24) + '#invite=' + 'y'.repeat(43));
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(host.textContent).toContain('Another participant');
    expect(window.location.hash).toBe('');
    expect((host.querySelector('[name=consent]') as HTMLInputElement).checked).toBe(false);
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string)).toEqual({ token: 'y'.repeat(43) });
});
it('keeps the draft answer through help retries and shows the actual saved reply', async () => {
  view = participant();
  if (view.kind !== 'participant') throw Error();
  view.participant.nextPhase = 'coaching'; view.participant.completedStages = 1;
  view.participant.coachingAvailable = true; view.participant.coaching = { maxTurns: 2, runs: [] };
  await render();
  await fill('answer', 'My reasoning in progress'); await fill('helpQuestion', 'What alternative should I examine?');
  fail = true; await click('Ask for help');
  const first = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string);
  expect(first.action).toBe('help');
  expect((host.querySelector('[name=answer]') as HTMLTextAreaElement).value).toBe('My reasoning in progress');
  expect((host.querySelector('[name=helpQuestion]') as HTMLTextAreaElement).value).toContain('alternative');
  fail = false;
  view.participant.coaching.runs = [{ id: 'help-1', question: first.question, output: 'Compare the competing explanation.', status: 'succeeded', startedAt: expiresAt, deadline: expiresAt }];
  await click('Retry this request');
  const retry = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string);
  expect(retry.requestId).toBe(first.requestId);
  expect(host.textContent).toContain('Compare the competing explanation.');
  expect((host.querySelector('[name=answer]') as HTMLTextAreaElement).value).toBe('My reasoning in progress');
});
it('keeps an unsent help question when the participant cancels withdrawal', async () => {
  view = participant(); if (view.kind !== 'participant') throw Error();
  view.participant.nextPhase = 'coaching'; view.participant.coachingAvailable = true; view.participant.coaching = { maxTurns: 2, runs: [] };
  await render(); await fill('helpQuestion', 'Keep this unsent question');
  await click('Leave this study'); await click('Keep participating');
  expect((host.querySelector('[name=helpQuestion]') as HTMLTextAreaElement).value).toBe('Keep this unsent question');
});
it('treats an explicitly empty replacement invitation as a rejected exchange instead of resuming another identity', async () => {
  view = participant(); await render();
  await act(async () => { window.history.replaceState({}, '', '/study/participate/study-' + 'b'.repeat(24) + '#invite='); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string)).toEqual({ token: '' });
});
