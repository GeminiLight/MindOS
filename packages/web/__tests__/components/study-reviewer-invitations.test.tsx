// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { StudyReviewers } from '@/components/echo/research/StudyReviewers';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const id = 'study-' + 'a'.repeat(24);
const grant = { id: 'review-grant-' + 'c'.repeat(24), reviewerId: 'reviewer-' + 'd'.repeat(24), label: 'External reviewer', expiresAt: '2026-10-01T00:00:00Z', status: 'active', accepted: false, itemCount: 2 };
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.spyOn(window, 'confirm').mockReturnValue(false); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<StudyReviewers studyId={id} protocolHash={'b'.repeat(64)} locale="en" />)); await act(async () => { const d = host.querySelector('details')!; d.open = true; d.dispatchEvent(new Event('toggle')); }); }
async function click(text: string) { const b = [...host.querySelectorAll('button')].find(b => b.textContent === text); expect(b, text).toBeDefined(); await act(async () => b!.click()); }
async function fill(name: string, value: string) { const input = host.querySelector(`[name=${name}]`) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
it('keeps an uncertain packet request stable, supports manual link copying, and updates the same reviewer explicitly', async () => {
  let attempts = 0; const sent: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST') { sent.push(JSON.parse(init.body)); if (attempts++ === 0) throw Error('lost response'); return Response.json({ invitation: { ...grant, token: 'x'.repeat(43) } }); }
    return Response.json({ invitations: attempts > 1 ? [grant] : [], availableCount: 2 });
  }));
  await render(); await fill('reviewerLabel', 'External reviewer'); await click('Create review invitation');
  expect(host.querySelector('[role=alert]')).not.toBeNull(); expect((host.querySelector('[name=reviewerLabel]') as HTMLInputElement).disabled).toBe(true);
  await click('Retry this invitation'); expect(sent[1]).toEqual(sent[0]);
  expect((host.querySelector('[name=reviewerLink]') as HTMLTextAreaElement).value).toContain('/study/review/' + id + '#invite=');
  await click('Copy link'); expect(host.textContent).toContain('Select and copy');
  await click('Create updated packet'); expect(sent[2].reviewerId).toBe(grant.reviewerId); expect(sent[2].requestId).not.toBe(sent[0].requestId);
  expect(host.textContent).toContain('Earlier links remain active');
});
it('requires available answers and valid input, and explains unavailable access', async () => {
  let availableCount = 0; let unavailable = false;
  vi.stubGlobal('fetch', vi.fn(async () => unavailable ? Response.json({ code: 'unavailable' }, { status: 503 }) : Response.json({ invitations: [], availableCount })));
  await render(); await fill('reviewerLabel', 'External reviewer');
  const create = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Create review invitation')!;
  expect(create().disabled).toBe(true); expect(host.textContent).toContain('No submitted answers');
  availableCount = 1; await click('Reload reviewers'); await fill('reviewerDays', '181'); expect(create().disabled).toBe(true);
  await fill('reviewerDays', '30'); expect(create().disabled).toBe(false);
  unavailable = true; await click('Reload reviewers'); expect(host.textContent).toContain('Protect this instance'); expect(create().disabled).toBe(true);
});
it('does not revoke on cancel and clears a displayed link after confirmed revocation', async () => {
  let revoked = false;
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST') return Response.json({ invitation: { ...grant, token: 'x'.repeat(43) } });
    if (init?.method === 'PATCH') revoked = true;
    return Response.json({ invitations: [{ ...grant, status: revoked ? 'revoked' : 'active' }], availableCount: 2 });
  }));
  await render(); await click('Create updated packet'); await click('Revoke'); expect(revoked).toBe(false);
  vi.mocked(window.confirm).mockReturnValue(true); await click('Revoke'); expect(revoked).toBe(true); expect(host.querySelector('[name=reviewerLink]')).toBeNull();
});
it('reports an export failure without discarding invitations and can retry the download', async () => {
  let failed = true;
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url).includes('/export?') ? failed ? Response.json({ code: 'storage' }, { status: 500 }) : Response.json({ schemaVersion: 1, participants: [], ratings: [] }) : Response.json({ invitations: [grant], availableCount: 2 })));
  const create = vi.fn(() => 'blob:test'); const revoke = vi.fn();
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await render(); await click('Download study records'); expect(host.textContent).toContain('Could not download'); expect(host.textContent).toContain('External reviewer'); expect(create).not.toHaveBeenCalled();
    failed = false; await click('Download study records'); expect(create).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Download started');
  } finally { await act(async () => root.render(null)); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; }
});
it('lets the owner stop retrying an uncertain invitation after reviewing the consequence', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'POST' ? Response.json({ code: 'conflict' }, { status: 409 }) : Response.json({ invitations: [grant], availableCount: 2 })));
  await render(); await click('Create updated packet'); await click('Stop retrying'); expect((host.querySelector('[name=reviewerLabel]') as HTMLInputElement).disabled).toBe(true);
  vi.mocked(window.confirm).mockReturnValue(true); await click('Stop retrying'); expect((host.querySelector('[name=reviewerLabel]') as HTMLInputElement).disabled).toBe(false); expect(host.textContent).toContain('External reviewer');
});
