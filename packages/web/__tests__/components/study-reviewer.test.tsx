// @vitest-environment jsdom
import React, { act } from 'react'; import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ReviewerWorkspace } from '@/components/echo/research/ReviewerWorkspace';
import type { StudyReviewAccessView } from '@geminilight/mindos/knowledge';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>; let view: StudyReviewAccessView; let fail = false;
const id = 'study-' + 'a'.repeat(24);
const workspace = (): StudyReviewAccessView => ({ kind: 'workspace', locale: 'en', protocolHash: 'b'.repeat(64), expiresAt: '2026-10-01T00:00:00Z', rubric: [{ id: 'reason', label: 'Reasoning', description: 'Use evidence', maxScore: 3 }], items: [{ id: 'work-' + 'c'.repeat(24), prompt: 'Synthetic task', answer: 'Synthetic answer', reference: 'Frozen reference' }, { id: 'work-' + 'd'.repeat(24), prompt: 'Second task', answer: 'Second answer', reference: 'Second reference' }], assessments: [] });
beforeEach(() => { fail = false; view = { kind: 'briefing', locale: 'en', protocolHash: 'b'.repeat(64), expiresAt: '2026-10-01T00:00:00Z' }; host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.spyOn(window, 'confirm').mockReturnValue(false); vi.stubGlobal('fetch', vi.fn(async () => fail ? Response.json({ code: 'storage' }, { status: 500 }) : Response.json({ view }))); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
async function render(strict = false) { await act(async () => root.render(strict ? <React.StrictMode><ReviewerWorkspace studyId={id} locale="en" /></React.StrictMode> : <ReviewerWorkspace studyId={id} locale="en" />)); }
async function click(text: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent === text); expect(button, text).toBeDefined(); await act(async () => button!.click()); }
async function fill(name: string, value: string) { const input = host.querySelector(`[name="${name}"]`) as HTMLInputElement; expect(input).not.toBeNull(); await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
it('scrubs the invitation and keeps reviewer acknowledgement explicit through effect replay', async () => {
  window.history.replaceState({}, '', '/study/review/' + id + '#invite=' + 'x'.repeat(43)); await render(true);
  expect(window.location.hash).toBe(''); expect(host.textContent).toContain('Review independently');
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Open review packet')?.disabled).toBe(true);
  await act(async () => (host.querySelector('[name=acknowledge]') as HTMLInputElement).click()); view = workspace(); await click('Open review packet');
  expect(host.textContent).toContain('Synthetic answer'); expect(host.textContent).toContain('Frozen reference');
});
it('preserves failed scores, retries one submission, and keeps revisions in the same packet', async () => {
  view = workspace(); await render(); await fill('score-reason', '2'); await fill('rationale', 'Considers alternatives.');
  await click('Next work'); expect(host.textContent).toContain('Synthetic answer');
  fail = true; await click('Save assessment');
  const first = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string);
  expect((host.querySelector('[name=rationale]') as HTMLTextAreaElement).value).toBe('Considers alternatives.');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  fail = false; if (view.kind !== 'workspace') throw Error(); view.assessments = [{ itemId: view.items[0].id, version: 1, scores: { reason: 2 }, rationale: 'Considers alternatives.', recordedAt: '2026-09-07T10:00:00Z' }];
  await click('Retry this assessment'); const retry = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string); expect(retry).toEqual(first);
  expect(host.textContent).toContain('Assessment saved');
  await fill('rationale', 'Refined assessment'); await click('Save revision');
  const revision = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body as string); expect(revision.version).toBe(1); expect(revision.requestId).not.toBe(first.requestId);
});
it('shows removed work without offering a stale assessment and does not prefill missing scores as zero', async () => {
  view = workspace(); await render(); expect((host.querySelector('[name=score-reason]') as HTMLInputElement).value).toBe('');
  if (view.kind !== 'workspace') throw Error(); view.items = [];
  await click('Reload packet'); expect(host.textContent).toContain('No available work'); expect(host.querySelector('[name=rationale]')).toBeNull();
});
it('keeps just-saved work visible in the unreviewed queue and prevents an unchanged resubmission', async () => {
  view = workspace(); await render(); await click('Not yet reviewed'); await fill('score-reason', '2'); await fill('rationale', 'Uses evidence');
  if (view.kind !== 'workspace') throw Error(); view.assessments = [{ itemId: view.items[0].id, version: 1, scores: { reason: 2 }, rationale: 'Uses evidence', recordedAt: '2026-09-07T10:00:00Z' }];
  await click('Save assessment'); expect(host.textContent).toContain('Assessment saved');
  const before = vi.mocked(fetch).mock.calls.length;
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  await click('Next work'); expect(host.textContent).toContain('Second answer');
});
it('describes a packet reload as loading rather than saving an assessment', async () => {
  view = workspace(); await render(); let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  await click('Reload packet'); expect(host.textContent).toContain('Loading review packet'); expect(host.textContent).not.toContain('Saving assessment');
  await act(async () => resolve(Response.json({ view })));
});
