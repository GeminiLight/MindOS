// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import EchoLearningStartButton from '@/components/echo/learning/EchoLearningStartButton';
import EchoSegmentPage from '@/app/echo/[segment]/page';
import { messages } from '@/lib/i18n';
const nav = vi.hoisted(() => ({ push: vi.fn(), notFound: vi.fn(() => { throw new Error('not-found'); }) }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, notFound: nav.notFound }));
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en', t: messages.en }) }));
vi.mock('@/components/echo/EchoSegmentPageClient', () => ({ default: ({ segment }: { segment: string }) => <div>{segment}</div> }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const id = 'learn-' + 'a'.repeat(24);
it('opens the saved learning record from an insight without starting duplicate records', async () => {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
 const fetch = vi.fn(async () => Response.json({ loop: { id } })); vi.stubGlobal('fetch', fetch);
 try {
  await act(async () => root.render(<EchoLearningStartButton cardId="real-insight" enabled />));
  await act(async () => { host.querySelector('button')!.click(); host.querySelector('button')!.click(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(nav.push).toHaveBeenCalledWith('/echo/learning?learning=' + id);
 } finally { await act(async () => root.unmount()); host.remove(); }
});
it('preserves the selected record and independent practice in legacy bookmarks', async () => {
 for (const segment of ['growth', 'practice']) {
  const result = await EchoSegmentPage({ params: Promise.resolve({ segment }), searchParams: Promise.resolve({ learning: id, practice: '1' }) });
  expect(result.props.href).toBe('/echo/learning?learning=' + id + '&practice=1');
 }
});
it('does not redirect plain insights or malformed and repeated learning parameters', async () => {
 for (const learning of [undefined, 'https://example.com', ['one', 'two']]) {
  const result = await EchoSegmentPage({ params: Promise.resolve({ segment: 'growth' }), searchParams: Promise.resolve({ learning }) });
  expect(result.props).toEqual({ segment: 'growth' });
 }
});
