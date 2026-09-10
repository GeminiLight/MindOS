import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRuntimeDetectionCacheForTest } from '@geminilight/mindos/server';

const mocks = vi.hoisted(() => ({
  resolveCommandPath: vi.fn(),
  resolveCommandPathCandidates: vi.fn(),
  checkNativeRuntimeHealth: vi.fn(),
  detectLocalAcpAgents: vi.fn(),
}));

// The Codex runtime is discovered through the Web detector; without a binary
// every thread route must answer 409 before it ever spawns an app server.
vi.mock('@/lib/acp/detect-local', () => ({
  resolveCommandPath: mocks.resolveCommandPath,
  resolveCommandPathCandidates: mocks.resolveCommandPathCandidates,
  checkNativeRuntimeHealth: mocks.checkNativeRuntimeHealth,
  detectLocalAcpAgents: mocks.detectLocalAcpAgents,
}));

const ROUTES = [
  'app/api/agent-runtimes/codex/models/route.ts',
  'app/api/agent-runtimes/codex/threads/route.ts',
  'app/api/agent-runtimes/codex/threads/[threadId]/route.ts',
  'app/api/agent-runtimes/codex/threads/[threadId]/fork/route.ts',
  'app/api/agent-runtimes/codex/threads/[threadId]/archive/route.ts',
  'app/api/agent-runtimes/codex/threads/[threadId]/unarchive/route.ts',
];

describe('/api/agent-runtimes/codex/threads', () => {
  beforeEach(() => {
    // The core detection cache is process-wide; each test asserts on fresh detector calls.
    resetRuntimeDetectionCacheForTest();
    mocks.resolveCommandPath.mockReset().mockResolvedValue(null);
    mocks.resolveCommandPathCandidates.mockReset().mockResolvedValue([]);
    mocks.checkNativeRuntimeHealth.mockReset().mockResolvedValue({ status: 'available' });
    mocks.detectLocalAcpAgents.mockReset().mockResolvedValue({ installed: [], notInstalled: [] });
  });

  it('answers 409 with a compact message when no Codex executable is installed', async () => {
    const listRoute = await import('../../app/api/agent-runtimes/codex/threads/route');
    const res = await listRoute.GET(new Request('http://localhost/api/agent-runtimes/codex/threads?limit=20'));

    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.error).toMatch(/Codex executable was not detected/);
    expect(JSON.stringify(body)).not.toContain('node:internal');

    const modelsRoute = await import('../../app/api/agent-runtimes/codex/models/route');
    expect((await modelsRoute.GET()).status).toBe(409);
  });

  it('rejects an invalid thread list limit before touching the runtime', async () => {
    const listRoute = await import('../../app/api/agent-runtimes/codex/threads/route');
    const res = await listRoute.GET(new Request('http://localhost/api/agent-runtimes/codex/threads?limit=0'));

    expect(res.status).toBe(400);
    expect(mocks.resolveCommandPath).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on Codex fork with the shared body error and never resolves the runtime', async () => {
    const forkRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/fork/route');
    const malformed = await forkRoute.POST(
      new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/fork', { method: 'POST', body: '{not-json' }),
      { params: Promise.resolve({ threadId: 'thr-existing' }) },
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON body' });
    expect(mocks.resolveCommandPath).not.toHaveBeenCalled();
  });

  it('reaches the runtime gate for an empty fork body and for archive / unarchive', async () => {
    const forkRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/fork/route');
    const archiveRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/archive/route');
    const unarchiveRoute = await import('../../app/api/agent-runtimes/codex/threads/[threadId]/unarchive/route');
    const context = { params: Promise.resolve({ threadId: 'thr-existing' }) };

    const fork = await forkRoute.POST(new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/fork', { method: 'POST' }), context);
    const archive = await archiveRoute.POST(new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/archive', { method: 'POST' }), context);
    const unarchive = await unarchiveRoute.POST(new Request('http://localhost/api/agent-runtimes/codex/threads/thr-existing/unarchive', { method: 'POST' }), context);

    for (const res of [fork, archive, unarchive]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Codex executable was not detected/);
    }
    expect(mocks.resolveCommandPath).toHaveBeenCalled();
  });

  it('keeps every Codex thread route a one-line delegation without native process or filesystem ownership', () => {
    const root = resolve(__dirname, '../..');
    for (const route of ROUTES) {
      const source = readFileSync(resolve(root, route), 'utf-8');
      expect(source, route).toContain('_mindos-adapter');
      expect(source, route).toMatch(/delegateToMindos\('(GET|POST)', '\/api\/agent-runtimes\/codex\//);
      expect(source, route).not.toContain('toNextResponse');
      expect(source, route).not.toMatch(/\bfrom ['"]node:(fs|child_process|os|net)['"]/);
    }
  });
});
