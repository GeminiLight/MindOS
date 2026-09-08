// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useResourceCount } from '@/hooks/useResourceCount';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, state: ReturnType<typeof useResourceCount>;
const load = vi.fn();
function Harness() { state = useResourceCount(load); return null; }
beforeEach(async () => { load.mockReset(); root = createRoot(document.createElement('div')); await act(async () => root.render(<Harness />)); });
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
it('distinguishes unknown, zero, and a failed refresh without erasing the last known count', async () => {
  expect(state.count).toBe(null);
  load.mockResolvedValueOnce(0); await act(async () => { await state.refresh(); }); expect(state.count).toBe(0);
  load.mockResolvedValueOnce(5); await act(async () => { await state.refresh(); });
  load.mockRejectedValueOnce(new Error('offline')); await act(async () => { await state.refresh(); });
  expect(state.count).toBe(5); expect(state.error).toBe(true);
  load.mockResolvedValueOnce(6); await act(async () => { await state.refresh(); }); expect(state.count).toBe(6); expect(state.error).toBe(false);
});
it('ignores an older response and rejects invalid counts', async () => {
  let finish!: (n: number) => void;
  load.mockImplementationOnce(() => new Promise(r => { finish = r; })).mockResolvedValueOnce(7);
  let old!: Promise<void>; await act(async () => { old = state.refresh(); });
  await act(async () => { await state.refresh(); }); await act(async () => { finish(2); await old; });
  expect(state.count).toBe(7);
  for (const n of [NaN, -1, Infinity]) { load.mockResolvedValueOnce(n); await act(async () => { await state.refresh(); }); expect(state.error).toBe(true); expect(state.count).toBe(7); }
});
it('times out a hanging source and allows a later retry', async () => {
  vi.useFakeTimers(); load.mockReturnValueOnce(new Promise(() => {}));
  let pending!: Promise<void>; await act(async () => { pending = state.refresh(); await vi.advanceTimersByTimeAsync(15_001); await pending; });
  expect(state.error).toBe(true); expect(state.count).toBe(null);
  load.mockResolvedValueOnce(3); await act(async () => { await state.refresh(); }); expect(state.count).toBe(3);
});
