import { describe, expect, it } from 'vitest';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import {
  buildAgentRuntimeAdapterProjectionsPayload,
  handleAgentRuntimeAdapterProjectionsGet,
} from './runtime-adapter-projections.js';
import type { AcpHandshakeHealthResult } from '../../protocols/acp/index.js';

const CHECKED_AT = '2026-06-25T00:00:00.000Z';

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
      resolvedCommand: {
        cmd: '/usr/local/bin/declared',
        args: ['--stdio'],
        source: 'user-override',
      },
      adapterMetadata: {
        connectionType: 'cli',
        authRequired: true,
        supportsStreaming: true,
        models: [
          { id: 'fast-model', label: 'Fast Model' },
          { id: 'smart-model', label: 'Smart Model' },
        ],
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { stdio: true, http: false, sse: false },
        sessionCapabilities: { loadSession: true, list: true, resume: true, fork: false, close: true },
        output: {
          kinds: ['text', 'diff', 'artifact'],
          fileChanges: true,
          artifacts: true,
        },
        healthCheck: {
          command: 'TOKEN=must-not-leak declared health',
          timeoutMs: 5_000,
          summary: 'Declared ACP exposes an adapter-specific health probe.',
        },
        commands: [
          { name: 'plan', description: 'Create an implementation plan.' },
          { name: 'commit', description: 'Prepare a commit.' },
        ],
      },
    }, CHECKED_AT),
  ];
}

describe('runtime adapter projections', () => {
  it('projects adapter contract readiness across connection, configuration, health, and commands', () => {
    const payload = buildAgentRuntimeAdapterProjectionsPayload({
      runtimes: runtimeFixtures(),
    });

    expect(payload.schemaVersion).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('must-not-leak');

    const mindos = payload.projections.find((projection) => projection.runtimeId === 'mindos');
    const codex = payload.projections.find((projection) => projection.runtimeId === 'codex');
    const claude = payload.projections.find((projection) => projection.runtimeId === 'claude');
    const opaque = payload.projections.find((projection) => projection.runtimeId === 'opaque-acp');
    const declared = payload.projections.find((projection) => projection.runtimeId === 'declared-acp');

    expect(mindos).toMatchObject({
      status: 'ready',
      connection: { status: 'ready', kind: 'internal', owner: 'mindos' },
      configuration: {
        status: 'ready',
        modelSelection: 'mindos-session',
        credentials: 'mindos-settings',
        settings: 'mindos-settings',
      },
      health: { status: 'ready', mode: 'mindos-native', owner: 'mindos' },
      commands: { status: 'ready', discovery: 'mindos-skills', commandCount: 0 },
      output: {
        status: 'ready',
        discovery: 'mindos-default',
        outputKinds: ['artifact', 'text'],
        reviewableOutputKinds: ['artifact'],
        supportsArtifacts: true,
      },
      protocol: { status: 'ready', supportsStreaming: true, authRequired: false, modelCount: 0 },
    });

    expect(codex).toMatchObject({
      status: 'ready',
      connection: { status: 'ready', kind: 'app-server', owner: 'mindos' },
      configuration: {
        status: 'ready',
        modelSelection: 'runtime-native',
        credentials: 'runtime-native',
        settings: 'runtime-native',
      },
      health: { status: 'ready', mode: 'mindos-native' },
      commands: { status: 'ready', discovery: 'runtime-event' },
      output: {
        status: 'ready',
        discovery: 'runtime-native',
        outputKinds: ['artifact', 'branch', 'checkpoint', 'diff', 'pr', 'text'],
        reviewableOutputKinds: ['artifact', 'branch', 'checkpoint', 'diff', 'pr'],
        supportsFileChanges: true,
        supportsPullRequests: true,
      },
      protocol: { status: 'ready', supportsStreaming: true, authRequired: true, modelCount: 0 },
    });

    expect(claude).toMatchObject({
      status: 'blocked',
      runtimeStatus: 'missing',
      blockers: ['runtime-available'],
      connection: { status: 'blocked' },
      health: { status: 'blocked' },
      commands: { status: 'blocked' },
      output: { status: 'blocked' },
      protocol: { status: 'blocked' },
    });

    expect(opaque).toMatchObject({
      status: 'limited',
      connection: { status: 'ready', kind: 'stdio' },
      health: { status: 'unknown', mode: 'unknown' },
      commands: { status: 'unknown', discovery: 'unknown' },
      output: { status: 'unknown', discovery: 'unknown', outputKinds: ['text'], reviewableOutputKinds: [] },
      protocol: { status: 'limited', supportsStreaming: null, authRequired: null },
      blockers: [
        'adapter-command-discovery',
        'adapter-health-contract',
        'adapter-output-contract',
        'adapter-protocol-auth',
        'adapter-protocol-streaming',
      ],
    });

    expect(declared).toMatchObject({
      status: 'ready',
      connection: {
        status: 'ready',
        kind: 'stdio',
        hasCommand: true,
        commandSource: 'user-override',
      },
      configuration: {
        status: 'ready',
        credentials: 'adapter-declared',
        settings: 'adapter-declared',
      },
      health: {
        status: 'ready',
        mode: 'adapter-declared',
        hasCommand: true,
        timeoutMs: 5_000,
      },
      commands: {
        status: 'ready',
        discovery: 'adapter-declared',
        commandCount: 2,
        commandNames: ['commit', 'plan'],
      },
      output: {
        status: 'ready',
        discovery: 'adapter-declared',
        outputKinds: ['artifact', 'diff', 'text'],
        reviewableOutputKinds: ['artifact', 'diff'],
        supportsFileChanges: true,
        supportsArtifacts: true,
      },
      protocol: {
        status: 'ready',
        declaredConnectionType: 'cli',
        supportsStreaming: true,
        authRequired: true,
        modelCount: 2,
        models: [
          { id: 'fast-model', label: 'Fast Model' },
          { id: 'smart-model', label: 'Smart Model' },
        ],
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { stdio: true, http: false, sse: false },
        sessionCapabilities: { loadSession: true, list: true, resume: true, fork: false, close: true },
      },
    });
  });

  it('supports GET filtering by runtime id', async () => {
    const response = await handleAgentRuntimeAdapterProjectionsGet(new URLSearchParams('runtime=opaque-acp'), {
      listRuntimes: () => runtimeFixtures(),
    });

    expect(response).toMatchObject({
      status: 200,
      body: {
        projections: [
          expect.objectContaining({
          runtimeId: 'opaque-acp',
          status: 'limited',
          blockers: [
            'adapter-command-discovery',
            'adapter-health-contract',
            'adapter-output-contract',
            'adapter-protocol-auth',
            'adapter-protocol-streaming',
          ],
        }),
      ],
      },
      headers: { 'Cache-Control': 'no-store' },
    });
  });

  it('keeps non-stdio ACP connection declarations limited until transport support exists', () => {
    const payload = buildAgentRuntimeAdapterProjectionsPayload({
      runtimes: [
        acpRuntimeDescriptor({
          id: 'http-acp',
          name: 'HTTP ACP',
          binaryPath: '/usr/local/bin/http-acp',
          status: 'available',
          adapterMetadata: {
            connectionType: 'http',
            supportsStreaming: true,
            authRequired: true,
          },
        }, CHECKED_AT),
      ],
    });

    expect(payload.projections[0]).toMatchObject({
      runtimeId: 'http-acp',
      status: 'limited',
      protocol: {
        status: 'limited',
        declaredConnectionType: 'http',
        supportsStreaming: true,
        authRequired: true,
      },
      blockers: ['adapter-command-discovery', 'adapter-health-contract', 'adapter-output-contract', 'adapter-protocol-connection'],
    });
  });

  it('uses cached ACP handshake success as concrete adapter health evidence', () => {
    const handshake: AcpHandshakeHealthResult = {
      schemaVersion: 1,
      agentId: 'opaque-acp',
      status: 'ready',
      stage: 'session-new',
      checkedAt: '2026-06-28T00:00:00.000Z',
      expiresAt: '2026-06-28T00:05:00.000Z',
      cached: true,
      session: {
        sessionId: 'ses-local',
        externalSessionId: 'agent-session-1',
        supportsLoadSession: true,
        supportsListSessions: true,
        supportsClose: true,
        modeCount: 2,
        configOptionCount: 1,
        mcpServerCount: 1,
        authMethodCount: 0,
      },
    };

    const payload = buildAgentRuntimeAdapterProjectionsPayload({
      runtimes: runtimeFixtures(),
      acpHandshakeHealth: [handshake],
    });
    const opaque = payload.projections.find((projection) => projection.runtimeId === 'opaque-acp');

    expect(opaque).toMatchObject({
      runtimeId: 'opaque-acp',
      health: {
        status: 'ready',
        handshake: {
          status: 'ready',
          stage: 'session-new',
          cached: true,
          supportsLoadSession: true,
          supportsListSessions: true,
          supportsClose: true,
          modeCount: 2,
          configOptionCount: 1,
          mcpServerCount: 1,
        },
      },
    });
    expect(opaque?.health.blockers ?? []).not.toContain('adapter-health-contract');
    expect(opaque?.blockers ?? []).not.toContain('adapter-health-contract');
  });

  it('treats cached ACP handshake failure as an adapter blocker', () => {
    const handshake: AcpHandshakeHealthResult = {
      schemaVersion: 1,
      agentId: 'declared-acp',
      status: 'failed',
      stage: 'initialize',
      checkedAt: '2026-06-28T00:00:00.000Z',
      expiresAt: '2026-06-28T00:05:00.000Z',
      message: 'Command not found',
    };

    const payload = buildAgentRuntimeAdapterProjectionsPayload({
      runtimes: runtimeFixtures(),
      acpHandshakeHealth: [handshake],
    });
    const declared = payload.projections.find((projection) => projection.runtimeId === 'declared-acp');

    expect(declared).toMatchObject({
      runtimeId: 'declared-acp',
      status: 'blocked',
      blockers: expect.arrayContaining(['acp-handshake']),
      health: {
        status: 'blocked',
        blockers: ['acp-handshake'],
        handshake: {
          status: 'failed',
          stage: 'initialize',
          message: 'Command not found',
        },
      },
    });
  });
});
