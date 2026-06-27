import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectLocalAcpAgents: vi.fn(),
  resolveCommandPath: vi.fn(),
  resolveCommandPathCandidates: vi.fn(),
  checkNativeRuntimeHealth: vi.fn(),
}));

vi.mock('@geminilight/mindos/server', async () => {
  const actual = await import('../../../mindos/src/server');
  return { ...actual };
});

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({
    ai: { activeProvider: '', providers: [] },
    acpAgents: {},
  }),
}));

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mocks.detectLocalAcpAgents,
  resolveCommandPath: mocks.resolveCommandPath,
  resolveCommandPathCandidates: mocks.resolveCommandPathCandidates,
  checkNativeRuntimeHealth: mocks.checkNativeRuntimeHealth,
}));

beforeEach(() => {
  mocks.resolveCommandPath.mockReset().mockImplementation(async (command: string) => {
    if (command === 'codex') return '/usr/local/bin/codex';
    if (command === 'claude') return '/usr/local/bin/claude';
    return null;
  });
  mocks.resolveCommandPathCandidates.mockReset().mockResolvedValue([]);
  mocks.checkNativeRuntimeHealth.mockReset().mockResolvedValue({ status: 'available' });
  mocks.detectLocalAcpAgents.mockReset().mockResolvedValue({
    installed: [
      { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'available' },
      { id: 'opaque-acp', name: 'Opaque ACP', binaryPath: '/usr/local/bin/opaque', status: 'available' },
    ],
    notInstalled: [],
  });
});

async function importRoute() {
  vi.resetModules();
  return await import('../../app/api/agent-runtimes/artifact-projections/route');
}

describe('GET /api/agent-runtimes/artifact-projections', () => {
  it('returns artifact projections from runtime descriptors', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/artifact-projections'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    const mindos = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'mindos');
    const codex = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'codex');
    const acp = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      status: 'ready',
      reviewableOutputKinds: ['artifact'],
      artifactIndex: { status: 'ready' },
    });
    expect(mindos.blockers ?? []).not.toContain('artifact-index');
    expect(codex).toMatchObject({
      status: 'ready',
      reviewableOutputKinds: ['artifact', 'branch', 'checkpoint', 'diff', 'pr'],
      nativeHandoffTargets: expect.arrayContaining(['branch', 'pull-request']),
      rollback: { supported: true },
      branchPr: { supported: true },
      artifactIndex: { status: 'ready' },
    });
    expect(codex.blockers ?? []).not.toContain('artifact-index');
    expect(acp).toMatchObject({
      status: 'unknown',
      reviewableOutputKinds: [],
      nativeReview: { supported: false },
      artifactIndex: { status: 'ready' },
      blockers: ['adapter-artifact-contract'],
    });
  });

  it('honors runtime filters', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/artifact-projections?runtime=codex'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.projections).toEqual([
      expect.objectContaining({
        runtimeId: 'codex',
        status: 'ready',
      }),
    ]);
  });
});
