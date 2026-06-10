import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockHandleCodexThreadsGet = vi.fn();
const mockHandleCodexThreadGet = vi.fn();
const mockHandleCodexThreadForkPost = vi.fn();
const mockHandleCodexThreadArchivePost = vi.fn();
const mockHandleCodexThreadUnarchivePost = vi.fn();
const mockGetMindRoot = vi.fn(() => '/tmp/mindos-root');

vi.mock('@geminilight/mindos/server', () => ({
  handleCodexThreadsGet: mockHandleCodexThreadsGet,
  handleCodexThreadGet: mockHandleCodexThreadGet,
  handleCodexThreadForkPost: mockHandleCodexThreadForkPost,
  handleCodexThreadArchivePost: mockHandleCodexThreadArchivePost,
  handleCodexThreadUnarchivePost: mockHandleCodexThreadUnarchivePost,
}));

vi.mock('@/lib/fs', () => ({
  getMindRoot: mockGetMindRoot,
}));

describe('/api/agent-runtimes/codex/threads', () => {
  beforeEach(() => {
    mockHandleCodexThreadsGet.mockReset();
    mockHandleCodexThreadGet.mockReset();
    mockHandleCodexThreadForkPost.mockReset();
    mockHandleCodexThreadArchivePost.mockReset();
    mockHandleCodexThreadUnarchivePost.mockReset();
    mockGetMindRoot.mockReset();
    mockGetMindRoot.mockReturnValue('/tmp/mindos-root');
  });

  it('keeps Codex thread list and read routes as thin Product Server adapters', async () => {
    mockHandleCodexThreadsGet.mockResolvedValue({
      status: 200,
      body: { data: [{ id: 'thr-existing' }], nextCursor: null, backwardsCursor: null },
      headers: { 'Cache-Control': 'no-store' },
    });
    mockHandleCodexThreadGet.mockResolvedValue({
      status: 200,
      body: { thread: { id: 'thr-existing', turns: [{ id: 'turn-existing' }] } },
      headers: { 'Cache-Control': 'no-store' },
    });

    const listRoute = await import('../../app/api/agent-runtimes/codex/threads/route');
    const readRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/route');
    const list = await listRoute.GET(new Request('http://localhost/api/agent-runtimes/codex/threads?limit=20'));
    const read = await readRoute.GET(
      new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing?includeTurns=1'),
      { params: Promise.resolve({ threadId: 'thr-existing' }) },
    );

    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [{ id: 'thr-existing' }], nextCursor: null, backwardsCursor: null });
    expect(list.headers.get('Cache-Control')).toBe('no-store');
    expect(await read.json()).toEqual({ thread: { id: 'thr-existing', turns: [{ id: 'turn-existing' }] } });
    expect(mockHandleCodexThreadsGet).toHaveBeenCalledWith(expect.any(URLSearchParams));
    expect(mockHandleCodexThreadsGet.mock.calls[0][0].get('limit')).toBe('20');
    expect(mockHandleCodexThreadsGet.mock.calls[0][0].get('cwd')).toBe('/tmp/mindos-root');
    expect(mockHandleCodexThreadGet).toHaveBeenCalledWith(
      'thr-existing',
      expect.any(URLSearchParams),
    );
    expect(mockHandleCodexThreadGet.mock.calls[0][1].get('includeTurns')).toBe('1');
  });

  it('keeps Codex thread mutation routes as thin Product Server adapters', async () => {
    mockHandleCodexThreadForkPost.mockResolvedValue({
      status: 200,
      body: { thread: { id: 'thr-forked' } },
      headers: { 'Cache-Control': 'no-store' },
    });
    mockHandleCodexThreadArchivePost.mockResolvedValue({
      status: 200,
      body: { ok: true },
      headers: { 'Cache-Control': 'no-store' },
    });
    mockHandleCodexThreadUnarchivePost.mockResolvedValue({
      status: 200,
      body: { thread: { id: 'thr-existing' } },
      headers: { 'Cache-Control': 'no-store' },
    });

    const forkRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/fork/route');
    const archiveRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/archive/route');
    const unarchiveRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/unarchive/route');
    const context = { params: Promise.resolve({ threadId: 'thr-existing' }) };

    const fork = await forkRoute.POST(
      new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/fork', {
        method: 'POST',
        body: JSON.stringify({ cwd: '/tmp/forked' }),
      }),
      context,
    );
    const archive = await archiveRoute.POST(
      new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/archive', { method: 'POST' }),
      context,
    );
    const unarchive = await unarchiveRoute.POST(
      new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/unarchive', { method: 'POST' }),
      context,
    );

    expect(await fork.json()).toEqual({ thread: { id: 'thr-forked' } });
    expect(await archive.json()).toEqual({ ok: true });
    expect(await unarchive.json()).toEqual({ thread: { id: 'thr-existing' } });
    expect(mockHandleCodexThreadForkPost).toHaveBeenCalledWith('thr-existing', { cwd: '/tmp/forked' });
    expect(mockHandleCodexThreadArchivePost).toHaveBeenCalledWith('thr-existing');
    expect(mockHandleCodexThreadUnarchivePost).toHaveBeenCalledWith('thr-existing');
  });

  it('rejects malformed JSON on Codex fork without mutating, while allowing an empty body', async () => {
    mockHandleCodexThreadForkPost.mockResolvedValue({
      status: 200,
      body: { thread: { id: 'thr-forked' } },
      headers: { 'Cache-Control': 'no-store' },
    });

    const forkRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/fork/route');
    const context = { params: Promise.resolve({ threadId: 'thr-existing' }) };

    const malformed = await forkRoute.POST(
      new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/fork', {
        method: 'POST',
        body: '{not-json',
      }),
      context,
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(mockHandleCodexThreadForkPost).not.toHaveBeenCalled();

    const emptyBody = await forkRoute.POST(
      new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/fork', { method: 'POST' }),
      context,
    );

    expect(emptyBody.status).toBe(200);
    expect(await emptyBody.json()).toEqual({ thread: { id: 'thr-forked' } });
    expect(mockHandleCodexThreadForkPost).toHaveBeenCalledWith('thr-existing', { cwd: '/tmp/mindos-root' });
  });

  it('does not put native process or filesystem ownership in Codex thread Next routes', () => {
    const root = resolve(__dirname, '../..');
    const routes = [
      'app/api/agent-runtimes/codex/threads/route.ts',
      'app/api/agent-runtimes/codex/threads/[threadId]/route.ts',
      'app/api/agent-runtimes/codex/threads/[threadId]/fork/route.ts',
      'app/api/agent-runtimes/codex/threads/[threadId]/archive/route.ts',
      'app/api/agent-runtimes/codex/threads/[threadId]/unarchive/route.ts',
    ];

    for (const route of routes) {
      const source = readFileSync(resolve(root, route), 'utf-8');
      expect(source, route).toContain('@geminilight/mindos/server');
      expect(source, route).toContain('toNextResponse');
      expect(source, route).not.toMatch(/\bfrom ['"]node:(fs|child_process|os|net)['"]/);
    }
  });
});
