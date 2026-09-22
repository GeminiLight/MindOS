// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExternalSessionHistory } from '@/hooks/useExternalSessionHistory';
import { listRuntimeSessionPage } from '@/lib/runtime-session-page';
import type { AgentRuntimeIdentity } from '@/lib/types';
vi.mock('@/lib/runtime-session-page', () => ({ listRuntimeSessionPage: vi.fn() }));
const list = vi.mocked(listRuntimeSessionPage);
const claude: AgentRuntimeIdentity = { id: 'claude', kind: 'claude', name: 'Claude' };
const codex: AgentRuntimeIdentity = { id: 'codex', kind: 'codex', name: 'Codex' };
let latest: ReturnType<typeof useExternalSessionHistory>;
let root: ReturnType<typeof createRoot>;
function Harness({ runtime = claude, enabled = true, cwd = '/project' }: { runtime?: AgentRuntimeIdentity; enabled?: boolean; cwd?: string }) {
  latest = useExternalSessionHistory(runtime, cwd, enabled); return null;
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); list.mockReset(); root = createRoot(document.createElement('div'));
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });
async function render(runtime = claude) { await act(async () => { root.render(<Harness runtime={runtime} />); }); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
describe('external history request ownership', () => {
  it('loads all projects and appends pages once even after duplicate clicks', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' });
    await render();
    expect(list).toHaveBeenCalledWith(claude, expect.objectContaining({ scope: 'all' }));
    let finish!: (page: Awaited<ReturnType<typeof listRuntimeSessionPage>>) => void;
    list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => { latest.loadMore(); latest.loadMore(); });
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ entries: [{ id: '1', runtime: claude }, { id: '2', runtime: claude }], nextCursor: null }); });
    expect(latest.entries.map(e => e.id)).toEqual(['1', '2']);
  });
  it('discards late pages from the previously selected Agent', async () => {
    let finish!: (page: Awaited<ReturnType<typeof listRuntimeSessionPage>>) => void;
    list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    const signal = list.mock.calls[0][1]?.signal;
    list.mockResolvedValueOnce({ entries: [{ id: 'codex-1', runtime: codex }], nextCursor: null });
    await render(codex); expect(signal?.aborted).toBe(true);
    await act(async () => { finish({ entries: [{ id: 'claude-old', runtime: claude }], nextCursor: '30' }); });
    expect(latest.entries.map(e => e.id)).toEqual(['codex-1']);
    expect(latest.cursor).toBeNull();
  });
  it('keeps loaded entries when a later page fails and allows retry', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' }); await render();
    list.mockRejectedValueOnce(new Error('offline'));
    await act(async () => latest.loadMore());
    expect(latest.error).toBe('offline'); expect(latest.entries).toHaveLength(1); expect(latest.cursor).toBe('30');
    list.mockResolvedValueOnce({ entries: [{ id: '2', runtime: claude }], nextCursor: null });
    await act(async () => latest.loadMore());
    expect(latest.error).toBeNull(); expect(latest.entries).toHaveLength(2);
  });
  it('resets pagination before a debounced global search', async () => {
    list.mockResolvedValue({ entries: [], nextCursor: '30' }); await render();
    await act(async () => latest.setQuery('预算'));
    expect(latest.cursor).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(list.mock.lastCall?.[1]).toMatchObject({ query: '预算', cursor: undefined, scope: 'all' });
  });
});

describe('refresh and recovery', () => {
  it('retains all loaded pages and their cursor after a refresh fails', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' }); await render();
    list.mockResolvedValueOnce({ entries: [{ id: '2', runtime: claude }], nextCursor: '60' });
    await act(async () => latest.loadMore());
    list.mockRejectedValueOnce(new Error('offline'));
    await act(async () => latest.refresh());
    expect(latest.entries.map(e => e.id)).toEqual(['1', '2']); expect(latest.cursor).toBe('60');
    list.mockResolvedValueOnce({ entries: [{ id: 'fresh', runtime: claude }], nextCursor: null });
    await act(async () => latest.retry());
    expect(list.mock.lastCall?.[1]?.cursor).toBeUndefined();
    expect(latest.entries.map(e => e.id)).toEqual(['fresh']);
  });
  it('retries the failed next page without discarding earlier pages', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' }); await render();
    list.mockRejectedValueOnce(new Error('offline')); await act(async () => latest.loadMore());
    list.mockResolvedValueOnce({ entries: [{ id: '2', runtime: claude }], nextCursor: null });
    await act(async () => latest.retry());
    expect(list.mock.lastCall?.[1]?.cursor).toBe('30'); expect(latest.entries).toHaveLength(2);
  });
  it('rejects a repeated cursor before publishing an invalid page', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' }); await render();
    list.mockResolvedValueOnce({ entries: [{ id: 'bad', runtime: claude }], nextCursor: '30' });
    await act(async () => latest.loadMore());
    expect(latest.entries.map(e => e.id)).toEqual(['1']); expect(latest.error).toMatch(/repeated/);
  });
});


it('does not offer a list retry for an unrelated history-open failure', async () => {
  list.mockResolvedValueOnce({ entries: [], nextCursor: null }); await render();
  act(() => latest.setError('This conversation could not be opened'));
  expect(latest.canRetry).toBe(false);
});
it('cancels a pending search debounce when the user explicitly refreshes', async () => {
  list.mockResolvedValue({ entries: [], nextCursor: null }); await render();
  act(() => latest.setQuery('budget'));
  await act(async () => latest.refresh());
  const calls = list.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(list).toHaveBeenCalledTimes(calls);
});
it('retries only the incomplete source without discarding the successful source', async () => {
  list.mockResolvedValueOnce({ entries: [{ id: 'local', runtime: claude }], nextCursor: 'source-cursor', warning: 'Protocol offline' });
  await render(); expect(latest.error).toBe('Protocol offline'); expect(latest.canRetry).toBe(true);
  list.mockResolvedValueOnce({ entries: [{ id: 'remote', runtime: claude }], nextCursor: null });
  await act(async () => latest.retry());
  expect(list.mock.lastCall?.[1]?.cursor).toBe('source-cursor');
  expect(latest.entries.map(e => e.id)).toEqual(['local', 'remote']); expect(latest.error).toBeNull();
});

describe('returning to local history', () => {
  const visibility = async (enabled: boolean, cwd = '/project') => { await act(async () => { root.render(<Harness enabled={enabled} cwd={cwd} />); }); };
  it('retains every loaded page and cursor on a quick reopen, including across cwd changes in all-project scope', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' }); await render();
    list.mockResolvedValueOnce({ entries: [{ id: '2', runtime: claude }], nextCursor: '60' }); await act(async () => latest.loadMore());
    await visibility(false); await visibility(true, '/another');
    expect(latest.entries.map(e => e.id)).toEqual(['1', '2']); expect(latest.cursor).toBe('60'); expect(list).toHaveBeenCalledTimes(2);
    expect(latest.loading).toBe(false);
  });
  it('refreshes expired results without blanking them, then preserves them if offline', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: 'old', runtime: claude }], nextCursor: '30' }); await render(); await visibility(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    let fail!: (cause: Error) => void; list.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    await visibility(true); expect(latest.entries[0]?.id).toBe('old'); expect(latest.loading).toBe(true);
    await act(async () => fail(new Error('offline'))); expect(latest.entries[0]?.id).toBe('old'); expect(latest.canRetry).toBe(true);
  });
  it('cancels an unfinished next page on close and keeps its cursor available after reopening', async () => {
    list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' }); await render();
    let finish!: (page: Awaited<ReturnType<typeof list>>) => void;
    list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); act(() => latest.loadMore());
    const signal = list.mock.lastCall?.[1]?.signal; await visibility(false); expect(signal?.aborted).toBe(true); await visibility(true);
    await act(async () => finish({ entries: [{ id: 'late', runtime: claude }], nextCursor: null }));
    expect(latest.entries.map(e => e.id)).toEqual(['1']); expect(latest.cursor).toBe('30');
    list.mockResolvedValueOnce({ entries: [{ id: '2', runtime: claude }], nextCursor: null }); await act(async () => latest.loadMore());
    expect(list.mock.lastCall?.[1]?.cursor).toBe('30'); expect(latest.entries).toHaveLength(2);
  });
  it('caches an empty successful result but always honors explicit refresh', async () => {
    list.mockResolvedValue({ entries: [], nextCursor: null }); await render(); await visibility(false); await visibility(true);
    expect(list).toHaveBeenCalledTimes(1); await act(async () => latest.refresh()); expect(list).toHaveBeenCalledTimes(2);
  });
});
it('does not extend the first-page freshness deadline when appending a later page', async () => {
  list.mockResolvedValueOnce({ entries: [{ id: '1', runtime: claude }], nextCursor: '30' }); await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
  list.mockResolvedValueOnce({ entries: [{ id: '2', runtime: claude }], nextCursor: null }); await act(async () => latest.loadMore());
  await act(async () => { root.render(<Harness enabled={false} />); await vi.advanceTimersByTimeAsync(6_000); });
  list.mockResolvedValueOnce({ entries: [{ id: 'fresh', runtime: claude }], nextCursor: null }); await render();
  expect(latest.entries.map(e => e.id)).toEqual(['fresh']); expect(list).toHaveBeenCalledTimes(3);
});
it('never renders the previous Agent rows during the first render of a switch', async () => {
  const snapshots: string[][] = [];
  function Probe({ runtime }: { runtime: AgentRuntimeIdentity }) {
    const history = useExternalSessionHistory(runtime, '/project', true);
    snapshots.push(history.entries.map(entry => entry.id)); return null;
  }
  list.mockResolvedValueOnce({ entries: [{ id: 'old-agent', runtime: claude }], nextCursor: null });
  await act(async () => root.render(<Probe runtime={claude} />)); snapshots.length = 0;
  list.mockResolvedValueOnce({ entries: [{ id: 'new-agent', runtime: codex }], nextCursor: null });
  await act(async () => root.render(<Probe runtime={codex} />));
  expect(snapshots.some(ids => ids.includes('old-agent'))).toBe(false);
});
