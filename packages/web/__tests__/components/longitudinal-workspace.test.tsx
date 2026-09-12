// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import LongitudinalWorkspace from '@/components/echo/longitudinal/LongitudinalWorkspace';
import ResearchHub from '@/components/echo/research/ResearchHub';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const studyId = 'cohort-' + 'a'.repeat(24); const participantId = 'participant-' + 'b'.repeat(24);
const runtime = { adapter: 'isolated-chat-v1', provider: 'openai', model: 'glm-5.3-flash', endpoint: 'https://example.test/v1/chat/completions', temperature: 1, maxOutputTokens: 4096, tools: [] };
let host: HTMLDivElement; let renderer: ReturnType<typeof createRoot>; let hasRuntime = false; let accessReady = false; let fail = false;
const summary = () => ({ id: studyId, title: 'Pilot cohort', participants: 1, capacity: 2, consented: 1, active: 1, complete: 0, withdrawn: 0, pendingReviews: 1, rounds: 2, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z' });
const protocol = () => ({ title: 'Pilot cohort', hypothesis: 'H', consent: 'C', withdrawal: 'W', reviewedBy: 'qa', reviewNote: 'ok', capacity: 2, delayHours: 24, baselineMethod: 'Check evidence', rubric: 'Rubric', runtime,
  rounds: [{ before: 'B0', coaching: 'C0', after: 'A0', reference: 'R0', updateAllowed: true }, { before: 'B1', coaching: 'C1', after: 'A1', reference: 'R1', updateAllowed: false }] });
const admin = () => ({
  study: { schemaVersion: 2, id: studyId, protocol: protocol(), protocolHash: 'h'.repeat(64), createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
    participants: [{ id: participantId, expiresAt: '2026-12-10T00:00:00.000Z', strategy: 'next-round', version: 6, consentAt: '2026-09-10T00:10:00.000Z',
      rounds: [{ method: 'Check evidence', methodHash: 'm'.repeat(64), methodFromRound: -1, startedAt: '2026-09-10T00:10:00.000Z',
        answers: [{ stage: 'before', answer: 'a', at: '2026-09-10T00:20:00.000Z' }, { stage: 'coaching', answer: 'b', at: '2026-09-10T00:30:00.000Z' }, { stage: 'after', answer: 'c', at: '2026-09-10T00:40:00.000Z' }],
        runs: [], revision: { method: 'Check randomization too', evidence: 'The transfer task hid a confound', submittedAt: '2026-09-10T00:50:00.000Z', decision: 'pending' } }] }] },
  progress: [{ id: participantId, strategy: 'next-round', status: 'review', round: 0, roundCount: 2, stage: undefined, dueAt: undefined, expiresAt: '2026-12-10T00:00:00.000Z', consentAt: '2026-09-10T00:10:00.000Z', withdrawnAt: undefined, erased: false, answers: 3, revisionPending: true, helpSucceeded: 0, helpFailed: 0, helpPending: 0, lastActivityAt: '2026-09-10T00:50:00.000Z' }],
  summary: { invited: 1, capacity: 2, consented: 1, active: 1, complete: 0, withdrawn: 0, pendingReviews: 1, failedRuns: 0, pendingRuns: 0 },
  accessReady,
});
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); renderer = createRoot(host); hasRuntime = false; accessReady = false; fail = false;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (fail) return Response.json({ code: 'storage' }, { status: 500 });
    const url = new URL(String(input), 'http://localhost');
    if (url.searchParams.get('packet')) return Response.json({packetId:'packet-a',record:admin().study,review:{kind:'review-packet',generatedAt:'2026-09-12T01:00:00Z',items:[]},key:{kind:'review-key',items:[]}});
    if (url.searchParams.get('id') || init?.method === 'PATCH') return Response.json(admin());
    return Response.json({ studies: [summary()], unavailableCount: 0, runtime: hasRuntime ? runtime : null, accessReady });
  }));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:study'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* jsdom cannot navigate to blob downloads */ });
});
afterEach(async () => { await act(async () => renderer.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); try { localStorage.clear(); } catch { /* memory storage */ } });
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
async function click(text: string) { const b = button(text); expect(b, text).toBeDefined(); await act(async () => b!.click()); }
async function fill(name: string, value: string) {
  const field = host.querySelector(`[name="${name}"]`) as HTMLInputElement; expect(field, name).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('reports readiness, lists frozen studies with review counts, and blocks freezing until required fields exist', async () => {
  await act(async () => renderer.render(<LongitudinalWorkspace />));
  expect(host.textContent).toContain('Configure a compatible model in AI settings first');
  expect(host.textContent).toContain('Enable a Web password and an access token');
  expect(host.textContent).toContain('Pilot cohort');
  expect(host.textContent).toContain('1 awaiting review');
  expect(host.textContent).toContain('Complete before freezing');
  expect((host.querySelector('[name="confirm-freeze"]') as HTMLInputElement).disabled).toBe(true);
  expect(button('Freeze study')?.disabled).toBe(true);
});
it('opens the study board, gates revision review on reviewer and reason, and exports blind packets', async () => {
  accessReady = true;
  await act(async () => renderer.render(<LongitudinalWorkspace />));
  await click('Open');
  expect(host.querySelector('h1')?.textContent).toBe('Pilot cohort');
  expect(host.textContent).toContain('Method revisions awaiting review · 1');
  expect(host.textContent).toContain('Check randomization too');
  expect(host.textContent).toContain('P1');
  expect(host.textContent).toContain('Updates take effect');
  expect(host.textContent).toContain('Revision awaiting review');
  expect(button('Approve revision')?.disabled).toBe(true);
  await fill(`review-${participantId}:0-by`, 'qa-lead');
  await fill(`review-${participantId}:0-reason`, 'Scope stated, evidence quoted.');
  expect(button('Approve revision')?.disabled).toBe(false);
  await click('Approve revision');
  const review = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
  expect(review).toMatchObject({ action: 'review', decision: 'approved', reviewedBy: 'qa-lead', participantId, round: 0 });
  expect(button('Create participant link')?.disabled).toBe(false);
  await click('Download blind review packet');
  expect(vi.mocked(fetch).mock.calls.some(call => String(call[0]).includes('packet=bundle'))).toBe(true);
  expect(host.textContent).toContain('Download started.');
  await click('Download packet key');
  expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).includes('packet=bundle'))).toHaveLength(1);
  await click('Download study record');
  expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).includes('packet=bundle'))).toHaveLength(1);
  await click('Refresh export snapshot');
  expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).includes('packet=bundle'))).toHaveLength(2);
});
it('renders the research hub with design cards, readiness rows and a retry on failure', async () => {
  hasRuntime = true;
  await act(async () => renderer.render(<ResearchHub locale="en" fourStageCount={2} />));
  expect(host.textContent).toContain('1 frozen · 1 in progress · 1 awaiting review');
  expect(host.textContent).toContain('2 drafts below');
  expect(host.textContent).toContain('Model configured: openai / glm-5.3-flash');
  expect(host.textContent).toContain('Enable a Web password and an access token');
  await act(async () => renderer.unmount());
  fail = true; renderer = createRoot(host);
  await act(async () => renderer.render(<ResearchHub locale="zh" fourStageCount={0} />));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('暂时无法读取就绪状态');
  fail = false;
  await click('重试');
  expect(host.textContent).toContain('1 项已冻结');
});

it('preserves a review draft across a refresh and isolates it from the study list', async () => {
  await act(async () => renderer.render(<LongitudinalWorkspace />));
  await click('Open');
  await fill(`review-${participantId}:0-by`, 'reviewer');
  await fill(`review-${participantId}:0-reason`, 'Evidence needs a narrower scope.');
  await click('Study list'); await click('Open');
  expect((host.querySelector(`[name="review-${participantId}:0-reason"]`) as HTMLTextAreaElement).value).toBe('Evidence needs a narrower scope.');
});
it('provides focused board sections with an explicit empty filter state', async () => {
  await act(async () => renderer.render(<LongitudinalWorkspace />)); await click('Open');
  const nav = host.querySelector('nav[aria-label="Study sections"]');
  expect(nav).not.toBeNull();
  await click('Participants');
  expect(host.querySelector('#pending-reviews-title')?.closest('section')?.hidden).toBe(true);
  await click('Completed');
  expect(host.textContent).toContain('No participants match this view.');
  await click('All');
  expect(host.querySelector('#participants-title')?.closest('section')?.textContent).toContain('P1');
});
it('keeps review notes after a failed save and clears only the confirmed review draft', async () => {
  await act(async () => renderer.render(<LongitudinalWorkspace />)); await click('Open');
  await fill(`review-${participantId}:0-by`, 'reviewer'); await fill(`review-${participantId}:0-reason`, 'Evidence checked.');
  fail=true; await click('Approve revision');
  expect((host.querySelector(`[name="review-${participantId}:0-reason"]`) as HTMLTextAreaElement).value).toBe('Evidence checked.');
  fail=false; await click('Approve revision');
  expect((host.querySelector(`[name="review-${participantId}:0-reason"]`) as HTMLTextAreaElement).value).toBe('');
});
