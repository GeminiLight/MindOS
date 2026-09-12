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
  it('reports durable cross-process approvals separately from owner recovery', () => {
    const payload = buildAgentRuntimePermissionProjectionsPayload({ runtimes: runtimes(), permissionMode: 'ask' });
    const native = payload.projections.find(item => item.runtimeId === 'codex')!;
    expect(native.interactiveApproval.scope).toBe('cross-process-run');
    expect(native.reasons).toContainEqual(expect.objectContaining({ id: 'durable-approval-queue', status: 'satisfied' }));
    expect(native.unattendedApproval.supported).toBe(false);
    expect(native.blockers).toContain('approval-owner-recovery');
    expect(native.blockers).not.toContain('durable-approval-queue');
  });

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
        blockers: ['approval-owner-recovery', 'approval-timeout-recovery'],
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
        scope: 'cross-process-run',
      },
      unattendedApproval: {
        status: 'limited',
        supported: false,
        blockers: ['approval-owner-recovery', 'approval-timeout-recovery'],
      },
      blockers: expect.arrayContaining(['approval-owner-recovery', 'approval-timeout-recovery']),
    });
    expect(claude).toMatchObject({
      status: 'blocked',
      runtimeStatus: 'missing',
      blockers: expect.arrayContaining(['runtime-available']),
    });
    // The MindOS ACP client answers session/request_permission, so even an
    // opaque ACP agent projects as interactively approvable through the
    // adapter protocol; only the durable queue for unattended runs is missing.
    expect(acp).toMatchObject({
      status: 'interactive-only',
      harnessPermissionModel: 'runtime-bridged',
      interactiveApproval: {
        supported: true,
        route: 'adapter-protocol',
        scope: 'adapter-specific',
      },
      unattendedApproval: {
        status: 'limited',
        supported: false,
        blockers: ['approval-owner-recovery', 'approval-timeout-recovery'],
      },
      blockers: expect.arrayContaining(['approval-owner-recovery', 'approval-timeout-recovery']),
    });
    expect(acp?.blockers).not.toContain('adapter-approval-contract');
    expect(acp?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'adapter-approval-contract', status: 'satisfied' }),
      expect.objectContaining({ id: 'mindos-permission-bridge', status: 'satisfied' }),
      expect.objectContaining({ id: 'durable-approval-queue', status: 'satisfied' }),
    ]));
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
