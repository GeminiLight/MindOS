import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpSessionSnapshot } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  detectLocalAcpAgents: vi.fn(),
  resolveCommandPath: vi.fn(),
  resolveCommandPathCandidates: vi.fn(),
  checkNativeRuntimeHealth: vi.fn(),
  getActiveSessionSnapshots: vi.fn(),
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

vi.mock('@/lib/acp/session', () => ({
  getActiveSessionSnapshots: mocks.getActiveSessionSnapshots,
}));

function activeAcpSnapshot(): AcpSessionSnapshot {
  const now = '2026-06-26T00:00:00.000Z';
  return {
    schemaVersion: 1,
    sessionId: 'ses-declared-1',
    agentId: 'declared-acp',
    agentSessionId: 'agent-ses-1',
    state: 'idle',
    cwd: '/tmp/project',
    createdAt: now,
    lastActivityAt: now,
    authMethods: [],
    modes: [{ id: 'default', name: 'Default' }, { id: 'code', name: 'Code' }],
    currentModeId: 'code',
    configOptions: [],
    controls: {
      model: {
        status: 'available',
        source: 'observed',
        configId: 'model',
        currentValue: 'smart',
        options: [{ id: 'cheap', label: 'Cheap' }, { id: 'smart', label: 'Smart' }],
      },
      mode: {
        status: 'available',
        source: 'observed',
        currentValue: 'code',
        options: [{ id: 'default', label: 'Default' }, { id: 'code', label: 'Code' }],
      },
      thoughtLevel: {
        status: 'available',
        source: 'observed',
        configId: 'reasoning_effort',
        currentValue: 'high',
        options: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }],
      },
    },
    availableCommands: [
      { id: 'plan', name: 'plan', description: 'Plan the work' },
    ],
    toolCalls: [
      { toolCallId: 'tool-1', title: 'Read file', status: 'completed' },
    ],
    toolSummary: {
      total: 1,
      pending: 0,
      inProgress: 0,
      completed: 1,
      failed: 0,
    },
    permissionEvents: [
      {
        requestId: 'perm-1',
        sessionId: 'ses-declared-1',
        toolCallId: 'tool-1',
        toolName: 'Read file',
        status: 'resolved',
        options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }],
        selectedOptionId: 'allow',
        outcome: 'allow_once',
        requestedAt: now,
        resolvedAt: now,
      },
    ],
    pendingPermissions: [],
    mcpServers: [{ name: 'filesystem', type: 'stdio' }],
  };
}

beforeEach(() => {
  mocks.resolveCommandPath.mockReset().mockResolvedValue('/usr/local/bin/declared');
  mocks.resolveCommandPathCandidates.mockReset().mockResolvedValue([]);
  mocks.checkNativeRuntimeHealth.mockReset().mockResolvedValue({ status: 'available' });
  mocks.detectLocalAcpAgents.mockReset().mockResolvedValue({
    installed: [
      {
        id: 'declared-acp',
        name: 'Declared ACP',
        binaryPath: '/usr/local/bin/declared',
        status: 'available',
        adapterMetadata: {
          models: [{ id: 'cheap', label: 'Cheap' }],
          commands: [{ name: 'fallback', description: 'Fallback command' }],
          supportsStreaming: true,
          authRequired: false,
        },
      },
    ],
    notInstalled: [],
  });
  mocks.getActiveSessionSnapshots.mockReset().mockReturnValue([activeAcpSnapshot()]);
});

async function importRoute() {
  vi.resetModules();
  return await import('../../app/api/agent-runtimes/session-projections/route');
}

describe('GET /api/agent-runtimes/session-projections', () => {
  it('projects active ACP session controls, commands, tools, and permissions', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/session-projections?runtime=declared-acp'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.projections).toHaveLength(1);
    expect(body.projections[0]).toMatchObject({
      runtimeId: 'declared-acp',
      runtimeKind: 'acp',
      status: 'idle',
      source: 'acp-session-snapshot',
      session: {
        kind: 'acp-session',
        sessionId: 'ses-declared-1',
        externalSessionId: 'agent-ses-1',
      },
      controls: {
        model: {
          status: 'available',
          configId: 'model',
          currentValue: 'smart',
          source: 'session-observed',
        },
        mode: {
          status: 'available',
          currentValue: 'code',
        },
        thoughtLevel: {
          status: 'available',
          configId: 'reasoning_effort',
          currentValue: 'high',
        },
      },
      slashCommands: {
        status: 'available',
        source: 'session-observed',
        commands: [{ id: 'plan', name: 'plan', description: 'Plan the work' }],
      },
      toolEvents: {
        status: 'available',
        summary: { total: 1, completed: 1 },
      },
      permissionEvents: {
        status: 'available',
        pending: [],
      },
      mcpServers: {
        status: 'available',
        servers: [{ name: 'filesystem', type: 'stdio' }],
      },
    });
  });
});
