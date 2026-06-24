import { describe, expect, it } from 'vitest';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import type { MindosMcpAgentProfile } from './mcp-agents.js';
import {
  buildAgentRuntimeMcpProjectionsPayload,
  handleAgentRuntimeMcpProjectionsGet,
} from './mcp-runtime-projections.js';

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

function runtimeFixtures() {
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
      source: {
        id: 'claude',
        name: 'Claude Code',
        binaryPath: '/usr/local/bin/claude',
        status: 'available',
      },
    }),
    acpRuntimeDescriptor({
      id: 'opaque-acp',
      name: 'Opaque ACP',
      binaryPath: '/usr/local/bin/opaque',
      status: 'available',
    }, CHECKED_AT),
  ];
}

describe('MCP runtime projections', () => {
  it('builds read-only runtime MCP readiness without exposing server secrets', () => {
    const payload = buildAgentRuntimeMcpProjectionsPayload({
      runtimes: runtimeFixtures(),
      mcpAgents: [
        mcpProfile('mindos', {
          name: 'MindOS',
          configuredMcpServers: ['github', 'filesystem'],
          configuredMcpServerCount: 2,
          configuredMcpSources: ['local:/home/test/.mindos/mcp.json'],
        }),
        mcpProfile('codex', {
          name: 'Codex',
          configuredMcpServers: ['github'],
          configuredMcpServerCount: 1,
          configuredMcpSources: ['local:/home/test/.codex/config.toml'],
        }),
        mcpProfile('claude-code', {
          name: 'Claude Code',
          configuredMcpServers: [],
          configuredMcpServerCount: 0,
          configuredMcpSources: [],
        }),
      ],
      mindosMcpConfig: {
        mcpServers: {
          github: {
            command: 'secret-wrapper',
            env: { GITHUB_TOKEN: 'must-not-leak' },
            mindosAgent: true,
          },
          filesystem: {
            command: 'fs-server',
          },
        },
        settings: {
          mindosAgent: {
            mcpServers: {
              github: true,
            },
          },
        },
      },
    });

    expect(payload.schemaVersion).toBe(1);
    const mindos = payload.projections.find((projection) => projection.runtimeId === 'mindos');
    const codex = payload.projections.find((projection) => projection.runtimeId === 'codex');
    const claude = payload.projections.find((projection) => projection.runtimeId === 'claude');
    const opaque = payload.projections.find((projection) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      status: 'ready',
      mcpAgentKey: 'mindos',
      configuredServers: ['filesystem', 'github'],
      mindosConfigServers: ['filesystem', 'github'],
      projectedServers: ['github'],
      supportsMindosProjection: true,
    });
    expect(codex).toMatchObject({
      status: 'ready',
      mcpAgentKey: 'codex',
      configuredServers: ['github'],
      projectedServers: ['github'],
      supportsNativeConfig: true,
    });
    expect(claude).toMatchObject({
      status: 'projectable',
      mcpAgentKey: 'claude-code',
      configuredServers: [],
      mindosConfigServers: ['filesystem', 'github'],
      blockers: ['runtime-native-mcp-config'],
    });
    expect(opaque).toMatchObject({
      status: 'unknown',
      supportsMindosProjection: false,
      blockers: ['mcp-agent-profile'],
    });
    expect(JSON.stringify(payload)).not.toContain('must-not-leak');
    expect(JSON.stringify(payload)).not.toContain('secret-wrapper');
  });

  it('marks MindOS Agent projectable when canonical MCP exists but runtime allowlist is empty', () => {
    const payload = buildAgentRuntimeMcpProjectionsPayload({
      runtimes: [mindosRuntimeDescriptor(CHECKED_AT)],
      mcpAgents: [mcpProfile('mindos', { name: 'MindOS', configuredMcpServers: ['github'], configuredMcpServerCount: 1 })],
      mindosMcpConfig: {
        mcpServers: {
          github: { command: 'github-mcp' },
        },
      },
    });

    expect(payload.projections[0]).toMatchObject({
      status: 'projectable',
      projectedServers: [],
      blockers: ['mindos-runtime-allowlist'],
      reasons: expect.arrayContaining([
        expect.objectContaining({ id: 'mindos-runtime-allowlist', status: 'missing' }),
      ]),
    });
  });

  it('supports GET filtering by runtime id', async () => {
    const response = await handleAgentRuntimeMcpProjectionsGet(new URLSearchParams('runtime=codex'), {
      listRuntimes: () => runtimeFixtures(),
      listMcpAgents: () => [mcpProfile('codex', {
        name: 'Codex',
        configuredMcpServers: ['github'],
        configuredMcpServerCount: 1,
      })],
      readMcpConfig: () => ({ mcpServers: { github: {} } }),
    });

    expect(response).toMatchObject({
      status: 200,
      body: {
        projections: [
          expect.objectContaining({ runtimeId: 'codex', status: 'ready' }),
        ],
      },
      headers: { 'Cache-Control': 'no-store' },
    });
  });
});
