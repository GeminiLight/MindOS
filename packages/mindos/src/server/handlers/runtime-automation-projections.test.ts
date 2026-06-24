import { describe, expect, it } from 'vitest';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import {
  buildAgentRuntimeAutomationProjectionsPayload,
  handleAgentRuntimeAutomationProjectionsGet,
} from './runtime-automation-projections.js';

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

describe('runtime automation projections', () => {
  it('separates remote control from unattended 24/7 readiness', () => {
    const payload = buildAgentRuntimeAutomationProjectionsPayload({ runtimes: runtimes() });

    expect(payload.schemaVersion).toBe(1);
    const mindos = payload.projections.find((projection) => projection.runtimeId === 'mindos');
    const codex = payload.projections.find((projection) => projection.runtimeId === 'codex');
    const claude = payload.projections.find((projection) => projection.runtimeId === 'claude');
    const acp = payload.projections.find((projection) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      status: 'limited',
      remoteControl: {
        status: 'limited',
        supported: true,
        mode: 'server-runnable',
      },
      unattendedAutomation: {
        status: 'limited',
        supported: false,
        support: 'limited',
        blockers: ['approval-routing', 'failure-audit', 'scheduler', 'wake-resume'],
      },
      productPrerequisites: expect.arrayContaining([
        expect.objectContaining({ id: 'scheduler', status: 'missing' }),
        expect.objectContaining({ id: 'approval-routing', status: 'missing' }),
        expect.objectContaining({ id: 'wake-resume', status: 'missing' }),
        expect.objectContaining({ id: 'failure-audit', status: 'missing' }),
      ]),
      blockers: ['approval-routing', 'failure-audit', 'scheduler', 'wake-resume'],
    });
    expect(codex).toMatchObject({
      status: 'limited',
      remoteControl: {
        status: 'limited',
        supported: true,
        mode: 'server-runnable',
      },
      unattendedAutomation: {
        status: 'limited',
        supported: false,
        blockers: ['approval-routing', 'failure-audit', 'scheduler', 'wake-resume'],
      },
    });
    expect(claude).toMatchObject({
      status: 'blocked',
      runtimeStatus: 'missing',
      remoteControl: { status: 'blocked', supported: false },
      unattendedAutomation: { status: 'blocked', supported: false },
      blockers: expect.arrayContaining(['runtime-available']),
    });
    expect(acp).toMatchObject({
      status: 'limited',
      remoteControl: { status: 'limited', supported: true },
      unattendedAutomation: {
        status: 'limited',
        blockers: ['approval-routing', 'failure-audit', 'scheduler', 'wake-resume'],
      },
    });
  });

  it('supports GET filtering by runtime id', async () => {
    const response = await handleAgentRuntimeAutomationProjectionsGet(
      new URLSearchParams('runtime=codex'),
      { listRuntimes: () => runtimes() },
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        projections: [
          expect.objectContaining({ runtimeId: 'codex', status: 'limited' }),
        ],
      },
      headers: { 'Cache-Control': 'no-store' },
    });
  });
});
