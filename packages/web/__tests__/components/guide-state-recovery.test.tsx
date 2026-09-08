// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGuideState } from '@/components/useGuideState';
import { createGuideStore } from '@/components/guide-state-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let state: ReturnType<typeof useGuideState>;
let store: ReturnType<typeof createGuideStore>;
const api = vi.fn();
const guide = { active: true, dismissed: false, step1Done: false, askedAI: false, agentPromptDone: false, nextStepIndex: 0, template: 'empty' };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function Harness() { state = useGuideState(store); return <span>{state.error}</span>; }
beforeEach(() => { host = document.createElement('div'); root = createRoot(host); vi.stubGlobal('fetch', api); api.mockReset(); store = createGuideStore(); });
afterEach(async () => {
  await act(async () => root.unmount());
  if (store.getSnapshot().pending) { api.mockResolvedValue(ok({})); await store.retry(); }
  vi.unstubAllGlobals(); vi.useRealTimers();
});
async function mount() { await act(async () => root.render(<Harness />)); }

it('loads guide and active model readiness, then saves a choice', async () => {
  api.mockResolvedValueOnce(ok({ guideState: guide, activeProvider: 'p', providerConfigs: [{ id: 'p' }] })).mockResolvedValue(ok({}));
  await mount(); expect(state.aiConfigured).toBe(true);
  await act(async () => { state.patchGuide({ step1Done: true }); });
  expect(state.guideState?.step1Done).toBe(true); expect(state.error).toBe(null);
});
it('keeps a failed dismissal available for retry and prevents focus refresh from overwriting it', async () => {
  api.mockResolvedValueOnce(ok({ guideState: guide })).mockResolvedValueOnce(new Response('', { status: 500 }));
  await mount();
  await act(async () => { state.patchGuide({ dismissed: true }); });
  expect(state.guideState?.dismissed).toBe(true); expect(state.error).toBe('save');
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(api).toHaveBeenCalledTimes(2);
  api.mockResolvedValue(ok({}));
  await act(async () => { await state.retry(); });
  expect(state.error).toBe(null); expect(state.pending).toBe(false);
  expect(JSON.parse(api.mock.calls[2][1].body)).toEqual({ guideState: { dismissed: true } });
});
it('serializes newer choices behind an in-flight save without losing either field', async () => {
  let finish!: (r: Response) => void;
  api.mockResolvedValueOnce(ok({ guideState: guide })).mockImplementationOnce(() => new Promise(r => { finish = r; })).mockResolvedValue(ok({}));
  await mount();
  await act(async () => { state.patchGuide({ step1Done: true }); });
  await act(async () => { state.patchGuide({ dismissed: true }); });
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => finish(ok({})));
  expect(JSON.parse(api.mock.calls[2][1].body).guideState).toEqual({ step1Done: true, dismissed: true });
  expect(state.pending).toBe(false);
});
it('saves a dismissal queued between the previous acknowledgement and its cleanup', async () => {
  const acknowledgement = ok({});
  Object.defineProperty(acknowledgement, 'ok', { get: () => {
    // The acknowledgement has resumed the writer, but its finalizer has not run.
    queueMicrotask(() => state.patchGuide({ dismissed: true }));
    return true;
  } });
  api.mockResolvedValueOnce(ok({ guideState: guide })).mockResolvedValueOnce(acknowledgement).mockResolvedValue(ok({}));
  await mount();
  await act(async () => { state.patchGuide({ step1Done: true }); });
  expect(api).toHaveBeenCalledTimes(3);
  expect(JSON.parse(api.mock.calls[2][1].body)).toEqual({ guideState: { dismissed: true } });
  expect(state.guideState?.dismissed).toBe(true);
  expect(state.pending).toBe(false); expect(state.saving).toBe(false); expect(state.error).toBe(null);
});
it('does not automatically retry a failed latest choice while clearing the writer', async () => {
  vi.useFakeTimers();
  api.mockResolvedValueOnce(ok({ guideState: guide })).mockResolvedValue(new Response('', { status: 503 }));
  await mount();
  await act(async () => { state.patchGuide({ dismissed: true }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(api).toHaveBeenCalledTimes(2);
  expect(state.pending).toBe(true); expect(state.saving).toBe(false); expect(state.error).toBe('save');
  api.mockResolvedValue(ok({}));
  await act(async () => { await state.retry(); });
  expect(api).toHaveBeenCalledTimes(3);
  expect(state.pending).toBe(false); expect(state.error).toBe(null);
});
it('shows a retryable load error instead of treating an HTTP failure as an empty guide', async () => {
  api.mockResolvedValueOnce(new Response('{}', { status: 503 })); await mount();
  expect(state.error).toBe('load');
  api.mockResolvedValue(ok({ guideState: guide }));
  await act(async () => { await state.retry(); }); expect(state.guideState?.active).toBe(true); expect(state.error).toBe(null);
});
it('ignores a stale GET that resolves after a local choice', async () => {
  let finish!: (r: Response) => void;
  api.mockResolvedValueOnce(ok({ guideState: guide })).mockImplementationOnce(() => new Promise(r => { finish = r; })).mockResolvedValue(ok({}));
  await mount(); await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => { state.patchGuide({ step1Done: true }); });
  await act(async () => finish(ok({ guideState: guide })));
  expect(state.guideState?.step1Done).toBe(true);
});
it('drains queued choices after leaving the page while the first save is pending', async () => {
  let finish!: (response: Response) => void;
  api.mockResolvedValueOnce(ok({ guideState: guide })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(ok({}));
  await mount();
  await act(async () => { state.patchGuide({ step1Done: true }); });
  await act(async () => { state.patchGuide({ dismissed: true }); });
  await act(async () => root.unmount());
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
  await act(async () => finish(ok({})));
  expect(api).toHaveBeenCalledTimes(3);
  expect(JSON.parse(api.mock.calls[2][1].body).guideState).toEqual({ step1Done: true, dismissed: true });
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
});
it('retains failed choices across page remounts without replacing them with server state', async () => {
  api.mockImplementation(async (_url: string, options?: RequestInit) => options?.method
    ? new Response('', { status: 503 }) : ok({ guideState: guide }));
  await mount();
  await act(async () => { state.patchGuide({ dismissed: true }); });
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  expect(state.guideState?.dismissed).toBe(true);
  expect(state.pending).toBe(true); expect(state.error).toBe('save');
  expect(api).toHaveBeenCalledTimes(2);
  api.mockResolvedValue(ok({}));
  await act(async () => { await state.retry(); });
  expect(JSON.parse(api.mock.calls[2][1].body)).toEqual({ guideState: { dismissed: true } });
  expect(state.pending).toBe(false); expect(state.error).toBe(null);
});
it('recovers a failure that arrives after the last subscriber has left', async () => {
  let finish!: (response: Response) => void;
  api.mockResolvedValueOnce(ok({ guideState: guide })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  await act(async () => { state.patchGuide({ dismissed: true }); });
  await act(async () => root.unmount());
  await act(async () => finish(new Response('', { status: 503 })));
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
  root = createRoot(host);
  await mount();
  expect(state.guideState?.dismissed).toBe(true);
  expect(state.error).toBe('save'); expect(state.pending).toBe(true);
  expect(api).toHaveBeenCalledTimes(2);
  api.mockResolvedValue(ok({}));
  await act(async () => { await state.retry(); });
  expect(state.pending).toBe(false);
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
});
