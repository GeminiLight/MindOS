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
      {
        id: 'declared-acp',
        name: 'Declared ACP',
        binaryPath: '/usr/local/bin/declared',
        status: 'available',
        adapterMetadata: {
          healthCheck: {
            command: 'TOKEN=must-not-leak declared health',
            timeoutMs: 5_000,
            summary: 'Declared ACP exposes a health probe.',
          },
          commands: [
            { name: 'plan', description: 'Create a plan.' },
            { name: 'commit', description: 'Prepare a commit.' },
          ],
        },
      },
      { id: 'opaque-acp', name: 'Opaque ACP', binaryPath: '/usr/local/bin/opaque', status: 'available' },
    ],
    notInstalled: [],
  });
});

async function importRoute() {
  vi.resetModules();
  return await import('../../app/api/agent-runtimes/adapter-projections/route');
}

describe('GET /api/agent-runtimes/adapter-projections', () => {
  it('returns adapter projections from runtime descriptors without leaking health commands', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/adapter-projections'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(JSON.stringify(body)).not.toContain('must-not-leak');

    const mindos = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'mindos');
    const codex = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'codex');
    const declared = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'declared-acp');
    const opaque = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      status: 'ready',
      connection: { kind: 'internal' },
      configuration: { modelSelection: 'mindos-session' },
      health: { mode: 'mindos-native' },
      commands: { discovery: 'mindos-skills' },
    });
    expect(codex).toMatchObject({
      status: 'ready',
      connection: { kind: 'app-server' },
      configuration: { modelSelection: 'runtime-native' },
      health: { mode: 'mindos-native' },
      commands: { discovery: 'runtime-event' },
    });
    expect(declared).toMatchObject({
      status: 'ready',
      connection: { kind: 'stdio' },
      health: { mode: 'adapter-declared', hasCommand: true, timeoutMs: 5_000 },
      commands: { discovery: 'adapter-declared', commandNames: ['commit', 'plan'] },
    });
    expect(opaque).toMatchObject({
      status: 'limited',
      blockers: ['adapter-command-discovery', 'adapter-health-contract'],
    });
  });

  it('honors runtime filters', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/adapter-projections?runtime=opaque-acp'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.projections).toEqual([
      expect.objectContaining({
        runtimeId: 'opaque-acp',
        status: 'limited',
      }),
    ]);
  });
});
