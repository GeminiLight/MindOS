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
    });

    expect(claude).toMatchObject({
      status: 'blocked',
      runtimeStatus: 'missing',
      blockers: ['runtime-available'],
      connection: { status: 'blocked' },
      health: { status: 'blocked' },
      commands: { status: 'blocked' },
    });

    expect(opaque).toMatchObject({
      status: 'limited',
      connection: { status: 'ready', kind: 'stdio' },
      health: { status: 'unknown', mode: 'unknown' },
      commands: { status: 'unknown', discovery: 'unknown' },
      blockers: ['adapter-command-discovery', 'adapter-health-contract'],
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
            blockers: ['adapter-command-discovery', 'adapter-health-contract'],
          }),
        ],
      },
      headers: { 'Cache-Control': 'no-store' },
    });
  });
});
