import { describe, expect, it } from 'vitest';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import type { MindosMcpAgentProfile } from './mcp-agents.js';
import {
  buildAgentRuntimeReadinessPayload,
  handleAgentRuntimeReadinessGet,
} from './runtime-readiness.js';

const CHECKED_AT = '2026-06-25T00:00:00.000Z';

function mcpProfile(
  key: string,
  overrides: Partial<MindosMcpAgentProfile> = {},
): MindosMcpAgentProfile {
  return {
    key,
    name: overrides.name ?? key,
    present: true,
    installed: true,
    hasProjectScope: true,
    hasGlobalScope: true,
    preferredTransport: 'stdio',
    format: 'json',
    configKey: 'mcpServers',
    globalPath: `~/.${key}/mcp.json`,
    projectPath: null,
    skillMode: 'unsupported',
    skillWorkspacePath: `~/.${key}/skills`,
    hiddenRootPath: `~/.${key}`,
    hiddenRootPresent: true,
    runtimeConversationSignal: false,
    runtimeUsageSignal: false,
    configuredMcpServers: [],
    configuredMcpServerCount: 0,
    configuredMcpSources: [],
    installedSkillNames: [],
    installedSkillCount: 0,
    installedSkillSourcePath: `~/.${key}/skills`,
    skillCapabilities: {
      mode: 'unsupported',
      workspacePath: `~/.${key}/skills`,
      visibility: 'manual',
      nativeSkillScope: 'none',
      canLinkMindosSkills: false,
      canReceiveLinkedSkills: false,
      canExportNativeSkills: false,
      linkStrategy: 'unsupported',
    },
    isCustom: false,
    ...overrides,
  };
}

function runtimes() {
  return [
    mindosRuntimeDescriptor(CHECKED_AT),
    nativeDescriptor({
      id: 'codex',
      name: 'Codex',
      checkedAt: CHECKED_AT,
      source: {
        id: 'codex-acp',
        name: 'Codex',
        binaryPath: '/usr/local/bin/codex',
        status: 'available',
      },
    }),
    nativeDescriptor({
      id: 'claude',
      name: 'Claude Code',
      checkedAt: CHECKED_AT,
      missing: {
        id: 'claude',
        name: 'Claude Code',
        installCmd: 'npm install -g @anthropic-ai/claude-code',
      },
    }),
    acpRuntimeDescriptor({
      id: 'opaque-acp',
      name: 'Opaque ACP',
      binaryPath: '/usr/local/bin/opaque',
      status: 'available',
    }, CHECKED_AT),
    acpRuntimeDescriptor({
      id: 'declared-acp',
      name: 'Declared ACP',
      binaryPath: '/usr/local/bin/declared',
      status: 'available',
      adapterMetadata: {
        connectionType: 'cli',
        authRequired: true,
        supportsStreaming: true,
        output: {
          kinds: ['text', 'diff', 'artifact'],
          fileChanges: true,
          artifacts: true,
        },
        healthCheck: {
          command: 'declared health',
          timeoutMs: 5_000,
        },
        commands: [
          { name: 'plan', description: 'Create a plan.' },
        ],
      },
    }, CHECKED_AT),
  ];
}

function mcpAgents() {
  return [
    mcpProfile('mindos', {
      name: 'MindOS',
      configuredMcpServers: ['github'],
      configuredMcpServerCount: 1,
      configuredMcpSources: ['local:/tmp/.mindos/mcp.json'],
    }),
    mcpProfile('codex', {
      name: 'Codex',
      configuredMcpServers: ['github'],
      configuredMcpServerCount: 1,
      configuredMcpSources: ['local:/tmp/.codex/config.toml'],
    }),
  ];
}

describe('runtime readiness projections', () => {
  it('aggregates lifecycle, permission, MCP, artifact, remote, and team readiness by use case', () => {
    const payload = buildAgentRuntimeReadinessPayload({
      runtimes: runtimes(),
      mcpAgents: mcpAgents(),
      mindosMcpConfig: {
        mcpServers: {
          github: {
            command: 'secret-wrapper',
            env: { GITHUB_TOKEN: 'must-not-leak' },
            mindosAgent: true,
          },
        },
      },
      permissionMode: 'ask',
    });

    expect(payload.schemaVersion).toBe(1);
    expect(payload.requestedPermissionMode).toBe('ask');
    expect(JSON.stringify(payload)).not.toContain('must-not-leak');
    expect(JSON.stringify(payload)).not.toContain('secret-wrapper');

    const mindos = payload.projections.find((projection) => projection.runtimeId === 'mindos');
    const codex = payload.projections.find((projection) => projection.runtimeId === 'codex');
    const claude = payload.projections.find((projection) => projection.runtimeId === 'claude');
    const acp = payload.projections.find((projection) => projection.runtimeId === 'opaque-acp');
    const declared = payload.projections.find((projection) => projection.runtimeId === 'declared-acp');

    expect(mindos).toMatchObject({
      overallStatus: 'usable',
      recommendations: expect.arrayContaining([
        expect.objectContaining({ useCase: 'interactive-turn', confidence: 'strong' }),
        expect.objectContaining({ useCase: 'mcp-tooling', confidence: 'strong' }),
        expect.objectContaining({ useCase: 'remote-control', confidence: 'conditional' }),
      ]),
      gaps: expect.arrayContaining([
        expect.objectContaining({ id: 'scheduler', category: 'mindos-product', severity: 'warning' }),
        expect.objectContaining({ id: 'mailbox', category: 'mindos-product', severity: 'warning' }),
      ]),
    });
    expect(mindos?.gaps.map((gap) => gap.id)).not.toContain('artifact-index');
    expect(mindos?.useCases.find((entry) => entry.id === 'adapter-contract')).toMatchObject({
      source: 'adapter-projection',
      sourceStatus: 'ready',
      status: 'ready',
      details: expect.objectContaining({
        connection: expect.objectContaining({ kind: 'internal' }),
        health: expect.objectContaining({ mode: 'mindos-native' }),
      }),
    });
    expect(mindos?.useCases.find((entry) => entry.id === 'permission-governance')).toMatchObject({
      source: 'permission-projection',
      sourceStatus: 'ready',
      status: 'ready',
      details: expect.objectContaining({ requestedPermissionMode: 'ask' }),
    });
    expect(mindos?.useCases.find((entry) => entry.id === 'mcp-tooling')).toMatchObject({
      source: 'mcp-projection',
      sourceStatus: 'ready',
      status: 'ready',
      details: expect.objectContaining({ projectedServerCount: 1 }),
    });

    expect(codex).toMatchObject({
      overallStatus: 'usable',
      recommendations: expect.arrayContaining([
        expect.objectContaining({ useCase: 'coding-workflow', confidence: 'strong' }),
        expect.objectContaining({ useCase: 'artifact-governance', confidence: 'strong' }),
      ]),
      gaps: expect.arrayContaining([
        expect.objectContaining({ id: 'durable-approval-queue', category: 'mindos-product', severity: 'warning' }),
      ]),
    });
    expect(codex?.gaps.map((gap) => gap.id)).not.toContain('artifact-index');
    expect(codex?.useCases.find((entry) => entry.id === 'permission-governance')).toMatchObject({
      sourceStatus: 'interactive-only',
      status: 'usable',
    });

    expect(claude).toMatchObject({
      overallStatus: 'blocked',
      runtimeStatus: 'missing',
      blockers: expect.arrayContaining(['runtime-available']),
      gaps: expect.arrayContaining([
        expect.objectContaining({ id: 'runtime-available', severity: 'blocking' }),
      ]),
    });
    expect(claude?.useCases.every((entry) => entry.status === 'blocked')).toBe(true);

    expect(acp).toMatchObject({
      overallStatus: 'limited',
      gaps: expect.arrayContaining([
        expect.objectContaining({ id: 'adapter-health-contract', category: 'adapter-contract' }),
        expect.objectContaining({ id: 'adapter-command-discovery', category: 'adapter-contract' }),
        expect.objectContaining({ id: 'adapter-output-contract', category: 'adapter-contract' }),
        expect.objectContaining({ id: 'adapter-approval-contract', category: 'adapter-contract' }),
        expect.objectContaining({ id: 'adapter-artifact-contract', category: 'adapter-contract' }),
      ]),
    });
    expect(acp?.useCases.find((entry) => entry.id === 'adapter-contract')).toMatchObject({
      source: 'adapter-projection',
      sourceStatus: 'limited',
      status: 'limited',
    });
    expect(acp?.useCases.find((entry) => entry.id === 'artifact-governance')).toMatchObject({
      source: 'artifact-projection',
      sourceStatus: 'unknown',
      status: 'unknown',
    });

    expect(declared?.gaps.map((gap) => gap.id)).not.toContain('adapter-artifact-contract');
    expect(declared?.gaps.map((gap) => gap.id)).not.toContain('adapter-output-contract');
    expect(declared?.useCases.find((entry) => entry.id === 'adapter-contract')).toMatchObject({
      source: 'adapter-projection',
      sourceStatus: 'ready',
      details: expect.objectContaining({
        output: expect.objectContaining({
          status: 'ready',
          discovery: 'adapter-declared',
          reviewableOutputKinds: ['artifact', 'diff'],
        }),
      }),
    });
    expect(declared?.useCases.find((entry) => entry.id === 'artifact-governance')).toMatchObject({
      source: 'artifact-projection',
      sourceStatus: 'ready',
      status: 'ready',
      details: expect.objectContaining({
        reviewableOutputKinds: ['artifact', 'diff'],
      }),
    });
  });

  it('supports GET filtering by runtime id and permission mode', async () => {
    const response = await handleAgentRuntimeReadinessGet(
      new URLSearchParams('runtime=codex&permissionMode=read'),
      {
        listRuntimes: () => runtimes(),
        listMcpAgents: () => mcpAgents(),
        readMcpConfig: () => ({ mcpServers: { github: { mindosAgent: true } } }),
      },
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        requestedPermissionMode: 'read',
        projections: [
          expect.objectContaining({ runtimeId: 'codex', overallStatus: 'usable' }),
        ],
      },
      headers: { 'Cache-Control': 'no-store' },
    });
  });

  it('rejects unsupported permission modes', async () => {
    const response = await handleAgentRuntimeReadinessGet(
      new URLSearchParams('permissionMode=magic'),
      {
        listRuntimes: () => runtimes(),
        listMcpAgents: () => mcpAgents(),
      },
    );

    expect(response).toMatchObject({
      status: 400,
      body: { error: 'Unsupported permissionMode: magic' },
    });
  });
});
