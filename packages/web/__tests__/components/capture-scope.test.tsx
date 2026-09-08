// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useCaptureScope } from '@/components/inbox/useCaptureScope';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let state: ReturnType<typeof useCaptureScope>;
const fetchMock = vi.fn();
function Harness() { state = useCaptureScope(); return null; }
const json = (rootId: string) => new Response(JSON.stringify({ rootId }));
beforeEach(() => { root = createRoot(document.createElement('div')); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); document.documentElement.dataset.mindRootId = 'static-build-fixture'; });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); delete document.documentElement.dataset.mindRootId; });
it('uses runtime identity instead of the static shell identity', async () => {
  fetchMock.mockResolvedValue(json('vault-a')); await act(async () => root.render(<Harness />));
  expect(state.scope).toBe('vault-a'); expect(state.ready).toBe(true);
});
it('blocks old vault content during a settings change and switches to the new identity', async () => {
  fetchMock.mockResolvedValueOnce(json('vault-a')); await act(async () => root.render(<Harness />));
  let finish!: (r: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(r => { finish = r; }));
  await act(async () => window.dispatchEvent(new Event('mindos:settings-changed')));
  expect(state.ready).toBe(false);
  await act(async () => finish(json('vault-b')));
  expect(state.scope).toBe('vault-b'); expect(state.ready).toBe(true);
});
it('fails closed on an invalid identity and permits explicit recovery', async () => {
  fetchMock.mockResolvedValueOnce(new Response('{}')); await act(async () => root.render(<Harness />));
  expect(state.ready).toBe(false); expect(state.error).toBe(true);
  fetchMock.mockResolvedValue(json('vault-a')); await act(async () => { await state.refresh(); });
  expect(state.scope).toBe('vault-a'); expect(state.error).toBe(false);
});
it('rejects a stale confirmation when another refresh has already selected a new vault', async () => {
  fetchMock.mockResolvedValueOnce(json('vault-a')); await act(async () => root.render(<Harness />));
  let finish!: (r: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(r => { finish = r; })).mockResolvedValue(json('vault-b'));
  let old!: Promise<string | null>;
  await act(async () => { old = state.refresh(); });
  await act(async () => { await state.refresh(); });
  await act(async () => finish(json('vault-a')));
  expect(await old).toBe(null); expect(state.scope).toBe('vault-b');
});
