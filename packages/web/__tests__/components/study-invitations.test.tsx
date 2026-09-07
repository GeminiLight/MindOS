// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi, afterEach } from 'vitest';
import { StudyInvitations } from '@/components/echo/research/StudyInvitations';
(globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<StudyInvitations studyId={'study-' + 'a'.repeat(24)} protocolHash={'b'.repeat(64)} delayDays={7} locale="en"/>)); await act(async () => { (host.querySelector('details') as HTMLDetailsElement).open = true; host.querySelector('details')!.dispatchEvent(new Event('toggle')); }); }
async function click(label: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); }
it('retries an uncertain creation with the same identity and offers a manually copyable private fragment link', async () => {
    let calls = 0;
    const payloads: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { if (init?.method === 'POST') {
        payloads.push(JSON.parse(init.body));
        if (calls++ === 0)
            throw new Error('lost');
        return Response.json({ invitation: { id: 'invitation-' + 'c'.repeat(24), token: 'x'.repeat(43), expiresAt: '2026-10-01T00:00:00Z' } });
    } return Response.json({ invitations: [] }); }));
    await render();
    await click('Create private invitation');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    await click('Create private invitation');
    expect(payloads[0]).toEqual(payloads[1]);
    const value = (host.querySelector('[name=invitationLink]') as HTMLTextAreaElement).value;
    expect(value).toContain('#invite=');
    expect(value).not.toContain('?');
    expect(host.textContent).toContain('Keep this link private');
});
it('explains an unprotected instance without offering a nonfunctional create action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'unavailable' }, { status: 503 })));
    await render();
    expect(host.textContent).toContain('Protect this instance');
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Create private invitation')).toBe(false);
});
it('blocks invitation creation until every local condition configuration matches', async () => {
  let configured = false;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ invitations: [], execution: [{ configured: true }, { configured }] })));
  await render();
  const create = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Create private invitation')!;
  expect(create().disabled).toBe(true); expect(host.textContent).toContain('does not match the frozen protocol');
  configured = true; await click('Reload invitations');
  expect(create().disabled).toBe(false); expect(host.textContent).toContain('does not verify a real model response');
});
