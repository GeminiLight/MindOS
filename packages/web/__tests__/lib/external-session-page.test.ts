import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRuntimeSessionPage } from '@/lib/runtime-session-history';
const runtime = (kind: 'claude' | 'codex' | 'acp', id = kind) => ({ id, kind, name: id });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
describe('external session pages', () => {
  it('lists Claude sessions across projects and keeps the next cursor', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => response({ sessions: [{ id: 'c1', cwd: '/other', title: 'Design' }], nextCursor: '30' }));
    vi.stubGlobal('fetch', fetcher);
    const page = await listRuntimeSessionPage(runtime('claude'), { scope: 'all' });
    expect(page.entries[0]).toMatchObject({ id: 'c1', cwd: '/other' });
    expect(page.nextCursor).toBe('30');
    const url = new URL(String(fetcher.mock.calls[0][0]), 'http://test');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('cwd')).toBe(false);
  });
  it('passes Codex pagination, search and archived scope without a project filter', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => response({ data: [{ id: 't2' }], nextCursor: 'next' }));
    vi.stubGlobal('fetch', fetcher);
    const page = await listRuntimeSessionPage(runtime('codex'), { scope: 'all', cwd: '/irrelevant', cursor: 'previous', query: '预算', archived: true });
    const params = new URL(String(fetcher.mock.calls[0][0]), 'http://test').searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ scope: 'all', cursor: 'previous', searchTerm: '预算', archived: 'true' });
    expect(params.has('cwd')).toBe(false);
    expect(page.nextCursor).toBe('next');
  });
  it('does not silently turn an OpenCode database failure into an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL) => response({ error: 'Cannot read OpenCode sessions' }, 500)));
    await expect(listRuntimeSessionPage(runtime('acp', 'opencode'), { scope: 'all' })).rejects.toThrow('Cannot read OpenCode');
  });
  it('requires an actual directory for a current-project request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(listRuntimeSessionPage(runtime('claude'), { scope: 'project' })).rejects.toThrow(/directory/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it('keeps local transcript discovery for ACP agents that do not expose session/list', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url) === '/api/acp/session'
    ? response({ error: 'list unsupported' }, 400)
    : response({ sessions: [{ id: 'kimi-local', cwd: '/original', turns: [{ role: 'user', content: 'earlier' }] }] })));
  const page = await listRuntimeSessionPage(runtime('acp', 'kimi'), { scope: 'all' });
  expect(page.entries.map(e => e.id)).toEqual(['kimi-local']);
});
