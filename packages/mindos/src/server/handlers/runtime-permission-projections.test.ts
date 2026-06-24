import { describe, expect, it } from 'vitest';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import {
  buildAgentRuntimePermissionProjectionsPayload,
  handleAgentRuntimePermissionProjectionsGet,
} from './runtime-permission-projections.js';

const CHECKED_AT = '2026-06-25T00:00:00.000Z';

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
  ];
}

describe('runtime permission projections', () => {
  it('projects Pi, native, and ACP permission readiness for ask mode', () => {
    const payload = buildAgentRuntimePermissionProjectionsPayload({
      runtimes: runtimes(),
      permissionMode: 'ask',
    });

    expect(payload).toMatchObject({
      schemaVersion: 1,
      requestedPermissionMode: 'ask',
    });
    const mindos = payload.projections.find((projection) => projection.runtimeId === 'mindos');
    const codex = payload.projections.find((projection) => projection.runtimeId === 'codex');
    const claude = payload.projections.find((projection) => projection.runtimeId === 'claude');
    const acp = payload.projections.find((projection) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      status: 'ready',
      permissionOwner: 'mindos',
      harnessPermissionModel: 'mindos-only',
      interactiveApproval: {
        supported: true,
        route: 'mindos-policy',
        scope: 'turn-policy',
      },
      unattendedApproval: {
        status: 'limited',
        supported: false,
        blockers: ['durable-approval-queue'],
      },
      policy: {
        permissionMode: 'ask',
        kbWrite: 'bounded',
        terminal: false,
        mcp: false,
        delegation: false,
      },
    });
    expect(mindos?.policyModes).toEqual(expect.arrayContaining([
      expect.objectContaining({ permissionMode: 'read', kbWrite: 'none' }),
      expect.objectContaining({ permissionMode: 'full', terminal: true, mcp: true, userExtensions: true }),
    ]));
    expect(codex).toMatchObject({
      status: 'interactive-only',
      permissionOwner: 'external',
      harnessPermissionModel: 'runtime-bridged',
      interactiveApproval: {
        supported: true,
        route: 'runtime-permission-bridge',
        scope: 'in-process-run',
      },
      unattendedApproval: {
        status: 'limited',
        supported: false,
        blockers: ['durable-approval-queue', 'approval-timeout-recovery'],
      },
      blockers: expect.arrayContaining(['durable-approval-queue', 'approval-timeout-recovery']),
    });
    expect(claude).toMatchObject({
      status: 'blocked',
      runtimeStatus: 'missing',
      blockers: expect.arrayContaining(['runtime-available']),
    });
    expect(acp).toMatchObject({
      status: 'unknown',
      harnessPermissionModel: 'none',
      interactiveApproval: {
        supported: false,
        route: 'unknown',
        scope: 'adapter-specific',
      },
      unattendedApproval: {
        status: 'unknown',
        blockers: ['adapter-approval-contract'],
      },
    });
  });

  it('marks read mode as permission-ready for unattended Pi runs', () => {
    const payload = buildAgentRuntimePermissionProjectionsPayload({
      runtimes: [mindosRuntimeDescriptor(CHECKED_AT)],
      permissionMode: 'read',
    });

    expect(payload.projections[0]).toMatchObject({
      requestedPermissionMode: 'read',
      unattendedApproval: {
        status: 'ready',
        supported: true,
      },
      policy: {
        permissionMode: 'read',
        kbWrite: 'none',
        terminal: false,
        mcp: false,
        im: false,
        schedule: false,
        userExtensions: false,
      },
    });
    expect(payload.projections[0]?.blockers).toBeUndefined();
  });

  it('filters GET results and rejects invalid permission modes', async () => {
    const ok = await handleAgentRuntimePermissionProjectionsGet(
      new URLSearchParams('runtime=codex&permissionMode=full'),
      { listRuntimes: () => runtimes() },
    );
    expect(ok).toMatchObject({
      status: 200,
      body: {
        requestedPermissionMode: 'full',
        projections: [
          expect.objectContaining({ runtimeId: 'codex', requestedPermissionMode: 'full' }),
        ],
      },
      headers: { 'Cache-Control': 'no-store' },
    });

    const bad = await handleAgentRuntimePermissionProjectionsGet(
      new URLSearchParams('permissionMode=agent'),
      { listRuntimes: () => runtimes() },
    );
    expect(bad).toMatchObject({
      status: 400,
      body: { error: 'Unsupported permissionMode: agent' },
    });
  });
});
