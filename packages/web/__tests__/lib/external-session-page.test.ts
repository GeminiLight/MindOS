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

it.each([{}, { sessions: {} }, { sessions: [], nextCursor: 30 }, { sessions: [{ nope: 'id' }] }])('reports malformed native lists instead of pretending the history is empty: %j', async body => {
  vi.stubGlobal('fetch', vi.fn(async () => response(body)));
  await expect(listRuntimeSessionPage(runtime('claude'))).rejects.toThrow(/invalid|unexpected/i);
});

it('keeps independent native and protocol cursors and searches native history across every page', async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined; calls.push({ url: String(url), body });
    if (url === '/api/acp/session') return response({ sessions: [{ id: 'shared' }], nextCursor: body.cursor ? null : 'acp-next' });
    const params = new URL(String(url), 'http://test').searchParams;
    expect(params.get('page')).toBe('1'); expect(params.get('query')).toBe('研究');
    return response({ sessions: [{ id: params.has('cursor') ? 'native-second' : 'shared', cwd: '/native-project' }], nextCursor: params.has('cursor') ? null : '30' });
  }));
  const first = await listRuntimeSessionPage(runtime('acp', 'gemini'), { query: '研究' });
  expect(first.entries).toHaveLength(1); expect(first.entries[0].cwd).toBe('/native-project');
  const second = await listRuntimeSessionPage(runtime('acp', 'gemini'), { query: '研究', cursor: first.nextCursor! });
  expect(second.entries.map(e => e.id)).toContain('native-second'); expect(second.nextCursor).toBeNull();
  expect(calls[2].body?.cursor).toBe('acp-next'); expect(calls[3].url).toContain('cursor=30');
});
it('retains a failed source for retry after the other source finishes', async () => {
  let fail = true; const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url));
    if (url === '/api/acp/session') return response({ sessions: [{ id: 'protocol' }] });
    return fail ? response({ error: 'Native store unreadable' }, 500) : response({ sessions: [{ id: 'native' }] });
  }));
  const first = await listRuntimeSessionPage(runtime('acp', 'qwen'));
  expect(first.entries.map(e => e.id)).toEqual(['protocol']); expect(first.warning).toContain('Native store unreadable'); expect(first.nextCursor).toBeTruthy();
  fail = false;
  const next = await listRuntimeSessionPage(runtime('acp', 'qwen'), { cursor: first.nextCursor! });
  expect(next.entries.map(e => e.id)).toEqual(['native']); expect(next.nextCursor).toBeNull();
  expect(calls.filter(u => u === '/api/acp/session')).toHaveLength(1);
});
it('treats an unsupported protocol as unavailable while an empty native store is a valid empty result', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => String(url) === '/api/acp/session' ? response({ error: 'Agent does not support session/list' }, 501) : response({ sessions: [] })));
  expect(await listRuntimeSessionPage(runtime('acp', 'kimi'))).toMatchObject({ entries: [], nextCursor: null });
});
it('rejects malformed ACP pages rather than silently showing empty history', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => String(url) === '/api/acp/session' ? response({ sessions: {} }) : response({ error: 'unsupported' }, 501)));
  await expect(listRuntimeSessionPage(runtime('acp', 'custom'))).rejects.toThrow(/Unexpected/);
});
it('shows native sessions when the protocol source times out and preserves its retry cursor', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (url !== '/api/acp/session') return response({ sessions: [{ id: 'local' }] });
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }));
    const pending = listRuntimeSessionPage(runtime('acp', 'gemini'));
    await vi.advanceTimersByTimeAsync(12_000);
    const page = await pending;
    expect(page.entries.map(e => e.id)).toEqual(['local']); expect(page.warning).toMatch(/timed out/i);
    expect(JSON.parse(page.nextCursor!).protocol).toBe('');
  } finally { vi.useRealTimers(); }
});
