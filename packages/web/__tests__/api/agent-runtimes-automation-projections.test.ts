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
  return await import('../../app/api/agent-runtimes/automation-projections/route');
}

describe('GET /api/agent-runtimes/automation-projections', () => {
  it('returns remote and unattended readiness from runtime descriptors', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/automation-projections'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    const mindos = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'mindos');
    const codex = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'codex');
    const acp = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      status: 'limited',
      remoteControl: { status: 'limited', supported: true, mode: 'server-runnable' },
      unattendedAutomation: {
        status: 'limited',
        supported: false,
        blockers: ['approval-routing', 'failure-audit', 'scheduler', 'wake-resume'],
      },
    });
    expect(codex).toMatchObject({
      status: 'limited',
      remoteControl: { status: 'limited', supported: true },
      unattendedAutomation: {
        status: 'limited',
        supported: false,
      },
    });
    expect(acp).toMatchObject({
      status: 'limited',
      remoteControl: { status: 'limited', supported: true },
      productPrerequisites: expect.arrayContaining([
        expect.objectContaining({ id: 'scheduler', status: 'missing' }),
      ]),
    });
  });

  it('honors runtime filters', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/automation-projections?runtime=codex'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.projections).toEqual([
      expect.objectContaining({
        runtimeId: 'codex',
        status: 'limited',
      }),
    ]);
  });
});
