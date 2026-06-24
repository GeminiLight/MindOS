import { describe, expect, it } from 'vitest';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import {
  buildAgentRuntimeArtifactProjectionsPayload,
  handleAgentRuntimeArtifactProjectionsGet,
} from './runtime-artifact-projections.js';

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

describe('runtime artifact projections', () => {
  it('projects runtime artifact governance readiness from runtime descriptors', () => {
    const payload = buildAgentRuntimeArtifactProjectionsPayload({ runtimes: runtimes() });

    expect(payload.schemaVersion).toBe(1);
    const mindos = payload.projections.find((projection) => projection.runtimeId === 'mindos');
    const codex = payload.projections.find((projection) => projection.runtimeId === 'codex');
    const claude = payload.projections.find((projection) => projection.runtimeId === 'claude');
    const acp = payload.projections.find((projection) => projection.runtimeId === 'opaque-acp');

    expect(mindos).toMatchObject({
      status: 'limited',
      outputKinds: ['artifact', 'text'],
      reviewableOutputKinds: ['artifact'],
      artifactIndex: { supported: false, status: 'missing' },
      rollback: { supported: false, source: 'none' },
      branchPr: { supported: false },
      blockers: ['artifact-index'],
    });
    expect(codex).toMatchObject({
      status: 'limited',
      outputKinds: ['artifact', 'branch', 'checkpoint', 'diff', 'pr', 'text'],
      reviewableOutputKinds: ['artifact', 'branch', 'checkpoint', 'diff', 'pr'],
      nativeHandoffTargets: expect.arrayContaining(['checkpoint', 'pull-request']),
      rollback: { supported: true, source: 'runtime-checkpoint' },
      branchPr: { supported: true },
      blockers: ['artifact-index'],
    });
    expect(claude).toMatchObject({
      status: 'blocked',
      runtimeStatus: 'missing',
      blockers: expect.arrayContaining(['runtime-available', 'artifact-index']),
    });
    expect(acp).toMatchObject({
      status: 'unknown',
      outputKinds: ['text'],
      reviewableOutputKinds: [],
      nativeReview: { supported: false },
      blockers: ['adapter-artifact-contract', 'artifact-index'],
      reasons: expect.arrayContaining([
        expect.objectContaining({ id: 'runtime-output-contract', status: 'unknown' }),
        expect.objectContaining({ id: 'artifact-projection-contract', status: 'satisfied' }),
      ]),
    });
  });

  it('supports GET filtering by runtime id', async () => {
    const response = await handleAgentRuntimeArtifactProjectionsGet(
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
