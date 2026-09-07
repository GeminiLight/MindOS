// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import InquirySourceButton from '@/components/echo/inquiries/InquirySourceButton';
const push = vi.hoisted(() => vi.fn());
let locale: 'en' | 'zh' = 'en';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale }),
}));
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  locale = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  push.mockClear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderSource = (text = 'Reply A') => act(async () => root.render(<InquirySourceButton sessionId="chat" messageIndex={1} text={text} />));
async function startSource() {
  await act(async () => { host.querySelector('button')!.click(); await new Promise(r => setTimeout(r, 30)); });
}
it('keeps a successful source link when the interface language changes', async () => {
  const fetch = vi.fn(async () => Response.json({ inquiry: { id: 'inquiry-' + 'a'.repeat(24) } }));
  vi.stubGlobal('fetch', fetch);
  await renderSource(); await startSource(); locale = 'zh'; await renderSource();
  expect(host.querySelector('a')?.textContent).toBe('继续追问');
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('retries an uncertain creation with the original payload after changing language and translates the error', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ code: 'storage' }, { status: 500 })).mockResolvedValueOnce(Response.json({ inquiry: { id: 'inquiry-' + 'a'.repeat(24) } }));
  vi.stubGlobal('fetch', fetch);
  await renderSource(); await startSource(); locale = 'zh'; await renderSource();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('这次请求未能完成');
  await startSource();
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});
it('does not send a source whose digest finishes after that source has been replaced', async () => {
  let resolve!: (value: ArrayBuffer) => void;
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const fetch = vi.fn(async () => Response.json({ inquiry: { id: 'inquiry-' + 'b'.repeat(24) } })); vi.stubGlobal('fetch', fetch);
  await renderSource(); await startSource(); await renderSource('Reply B');
  await act(async () => resolve(new Uint8Array(32).buffer));
  expect(fetch).not.toHaveBeenCalled();
  await startSource(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('retries an unchanged source with the same request and uses a new identity when the reply changes', async () => {
  const bodies: Record<string, string>[] = [];
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return fail
        ? Response.json({ code: 'conflict' }, { status: 409 })
        : Response.json({ inquiry: { id: 'inquiry-' + 'a'.repeat(24) } });
    }),
  );
  const render = async (text: string) =>
    act(async () =>
      root.render(
        <InquirySourceButton sessionId="chat" messageIndex={1} text={text} />,
      ),
    );
  const click = async () =>
    act(async () => {
      host.querySelector('button')!.click();
      await new Promise((r) => setTimeout(r, 30));
    });
  await render('Reply A');
  await click();
  expect(host.querySelector('[role=alert]')).toBeTruthy();
  await click();
  expect(bodies[0]).toEqual(bodies[1]);
  expect(push).not.toHaveBeenCalled();
  await render('Reply B');
  fail = false;
  await click();
  expect(bodies[2].messageHash).not.toBe(bodies[0].messageHash);
  expect(bodies[2].requestId).not.toBe(bodies[0].requestId);
  expect(push).not.toHaveBeenCalled();
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    '/echo/questions?inquiry=' + 'inquiry-' + 'a'.repeat(24),
  );
});
