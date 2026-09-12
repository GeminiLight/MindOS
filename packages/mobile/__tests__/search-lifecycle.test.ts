// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const search = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ mindosClient: { search } }));
import { useSearch } from '@/hooks/useSearch';
let root: Root;
let state: ReturnType<typeof useSearch>;
beforeEach(() => {
  vi.useFakeTimers(); search.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount() { function Probe() { state = useSearch(); return null; } await act(async () => root.render(React.createElement(Probe))); }
it('does not restore results from an older request after the query changes', async () => {
  let first!: (value: unknown[]) => void;
  search.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValue([{ path: 'new.md' }]);
  await mount();
  await act(async () => state.changeQuery('old'));
  await act(async () => vi.advanceTimersByTime(400));
  await act(async () => state.changeQuery('new'));
  expect(search.mock.calls[0][1].aborted).toBe(true);
  await act(async () => vi.advanceTimersByTime(400));
  await act(async () => first([{ path: 'old.md' }]));
  expect(state.results).toEqual([{ path: 'new.md' }]);
});
it('clearing cancels the debounce and leaves a quiet empty state', async () => {
  await mount(); await act(async () => state.changeQuery('notes'));
  await act(async () => state.changeQuery(''));
  await act(async () => vi.advanceTimersByTime(400));
  expect(search).not.toHaveBeenCalled(); expect(state.loading).toBe(false); expect(state.searched).toBe(false);
});
it('shows failures and allows an immediate retry', async () => {
  search.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue([]);
  await mount(); await act(async () => state.changeQuery('notes'));
  await act(async () => vi.advanceTimersByTime(400));
  expect(state.error).toBeTruthy();
  await act(async () => state.submit());
  expect(state.error).toBe(''); expect(search).toHaveBeenCalledTimes(2);
});
