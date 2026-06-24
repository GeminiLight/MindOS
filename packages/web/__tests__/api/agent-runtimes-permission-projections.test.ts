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
  return await import('../../app/api/agent-runtimes/permission-projections/route');
}

describe('GET /api/agent-runtimes/permission-projections', () => {
  it('returns permission projections from runtime descriptors', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/permission-projections'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    const mindos = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'mindos');
    const codex = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'codex');
    const acp = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      requestedPermissionMode: 'ask',
      status: 'ready',
      interactiveApproval: { route: 'mindos-policy' },
      unattendedApproval: {
        status: 'limited',
        blockers: ['durable-approval-queue'],
      },
    });
    expect(codex).toMatchObject({
      status: 'interactive-only',
      harnessPermissionModel: 'runtime-bridged',
      interactiveApproval: { route: 'runtime-permission-bridge' },
      blockers: expect.arrayContaining(['durable-approval-queue']),
    });
    expect(acp).toMatchObject({
      status: 'unknown',
      interactiveApproval: { route: 'unknown' },
      blockers: ['adapter-approval-contract'],
    });
  });

  it('honors runtime and permissionMode filters', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/permission-projections?runtime=mindos&permissionMode=read'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.requestedPermissionMode).toBe('read');
    expect(body.projections).toHaveLength(1);
    expect(body.projections[0]).toMatchObject({
      runtimeId: 'mindos',
      unattendedApproval: { status: 'ready', supported: true },
      policy: { permissionMode: 'read', kbWrite: 'none' },
    });
  });

  it('returns a 400 for invalid permissionMode', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/permission-projections?permissionMode=agent'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'Unsupported permissionMode: agent' });
  });
});
