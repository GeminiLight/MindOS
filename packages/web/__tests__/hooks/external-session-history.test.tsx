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
function Harness({ runtime = claude }: { runtime?: AgentRuntimeIdentity }) {
  latest = useExternalSessionHistory(runtime, '/project', true); return null;
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
