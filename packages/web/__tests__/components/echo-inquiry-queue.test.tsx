// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InquiryQueue from '@/components/echo/inquiries/InquiryQueue';

let locale: 'en' | 'zh' = 'en';
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
const row = (n: number, archived = false) => ({ id: 'inquiry-' + n.toString(16).padStart(24, '0'), title: 'Question ' + n, version: 1, archived, updatedAt: `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`, stage: 'decided' });
const response = (inquiries: unknown[] = [], unavailableCount = 0) => Response.json({ inquiries, unavailableCount });
beforeEach(() => {
  locale = 'en'; host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async () => response()); vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<InquiryQueue />));
async function refresh() { await act(async () => (host.querySelector('button') as HTMLButtonElement).click()); }

it('offers the three newest active questions and a path to all questions, without inferring completion', async () => {
  fetchMock.mockImplementation(async () => response([row(2), row(5, true), row(4), row(1), row(3)]));
  await render();
  expect([...host.querySelectorAll('li a')].map(a => a.textContent)).toEqual(['Question 4', 'Question 3', 'Question 2']);
  expect(host.querySelector('a[href="/echo/questions"]')?.textContent).toContain('View all questions');
  expect(host.textContent).toContain('Decision recorded'); expect(host.textContent).not.toContain('Completed');
  expect(fetchMock.mock.calls[0][0]).toBe('/api/echo/inquiries');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
});
it('keeps saved links after a network failure and refreshes the archive state on retry', async () => {
  fetchMock.mockResolvedValueOnce(response([row(1)])).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(response([row(1, true)]));
  await render(); await refresh();
  expect(host.querySelector('[role=alert]')).toBeTruthy(); expect(host.textContent).toContain('Question 1');
  await refresh();
  expect(host.querySelector('[role=alert]')).toBeNull(); expect(host.querySelector('li')).toBeNull();
  expect(host.textContent).toContain('No active questions');
});
it('isolates malformed summaries and reports unreadable records without inventing an empty state', async () => {
  fetchMock.mockResolvedValueOnce(response([row(1), { ...row(2), id: '../../private' }], 1));
  await render(); expect(host.querySelectorAll('li')).toHaveLength(1);
  expect(host.textContent).toContain('Some questions could not be read');
  fetchMock.mockResolvedValueOnce(response([], 2)); await refresh();
  expect(host.textContent).not.toContain('No active questions');
});
it('reports invalid responses and can recover to a localized empty state', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ inquiries: null })).mockResolvedValueOnce(response());
  await render(); expect(host.querySelector('[role=alert]')).toBeTruthy();
  locale = 'zh'; await render(); await refresh();
  expect(host.textContent).toContain('暂无继续中的问题');
  expect(host.querySelector('[role=alert]')).toBeNull();
});
it('ignores stale reads after a saved question and coalesces focus events while loading', async () => {
  const reads: Array<(value: Response) => void> = [];
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => reads.push(resolve)));
  await render();
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
  expect(reads).toHaveLength(1);
  await act(async () => window.dispatchEvent(new Event('echo-inquiry-updated')));
  expect(reads).toHaveLength(2);
  await act(async () => reads[1](response([row(2)])));
  await act(async () => reads[0](response([row(1)])));
  expect(host.textContent).toContain('Question 2'); expect(host.textContent).not.toContain('Question 1');
});
it('finishes loading after StrictMode effect cleanup and does not leave an aborted request active', async () => {
  fetchMock.mockImplementation(async () => response([row(1)]));
  await act(async () => root.render(<StrictMode><InquiryQueue /></StrictMode>));
  expect(host.textContent).toContain('Question 1');
  expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
});
