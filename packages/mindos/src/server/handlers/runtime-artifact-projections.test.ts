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
      status: 'ready',
      outputKinds: ['artifact', 'text'],
      reviewableOutputKinds: ['artifact'],
      artifactIndex: { supported: true, status: 'ready', recordCount: 0 },
      rollback: { supported: false, source: 'none' },
      branchPr: { supported: false },
    });
    expect(codex).toMatchObject({
      status: 'ready',
      outputKinds: ['artifact', 'branch', 'checkpoint', 'diff', 'pr', 'text'],
      reviewableOutputKinds: ['artifact', 'branch', 'checkpoint', 'diff', 'pr'],
      nativeHandoffTargets: expect.arrayContaining(['checkpoint', 'pull-request']),
      rollback: { supported: true, source: 'runtime-checkpoint' },
      branchPr: { supported: true },
    });
    expect(claude).toMatchObject({
      status: 'blocked',
      runtimeStatus: 'missing',
      artifactIndex: { supported: true, status: 'ready' },
      blockers: expect.arrayContaining(['runtime-available']),
    });
    expect(acp).toMatchObject({
      status: 'unknown',
      outputKinds: ['text'],
      reviewableOutputKinds: [],
      nativeReview: { supported: false },
      artifactIndex: { supported: true, status: 'ready' },
      blockers: ['adapter-artifact-contract'],
      reasons: expect.arrayContaining([
        expect.objectContaining({ id: 'runtime-output-contract', status: 'unknown' }),
        expect.objectContaining({ id: 'artifact-projection-contract', status: 'satisfied' }),
        expect.objectContaining({ id: 'artifact-index', status: 'satisfied' }),
      ]),
    });
  });

  it('includes safe artifact pointer metadata for preview workflows', () => {
    const payload = buildAgentRuntimeArtifactProjectionsPayload({
      runtimes: runtimes(),
      artifacts: [
        {
          schemaVersion: 1,
          id: 'artifact-1',
          runtimeId: 'codex',
          agentKind: 'native-runtime',
          source: 'runtime-output',
          kind: 'file',
          status: 'completed',
          createdAt: 1,
          updatedAt: 2,
          runId: 'run-1',
          toolCallId: 'tool-1',
          toolName: 'write_file',
          path: 'Notes/runtime-report.md',
          line: 12,
          title: 'Runtime report',
          summary: 'Generated runtime report.',
          mimeType: 'text/markdown',
          size: 42,
        },
      ],
    });

    const codex = payload.projections.find((projection) => projection.runtimeId === 'codex');
    expect(codex?.artifactIndex).toMatchObject({
      recordCount: 1,
      recentArtifacts: [
        {
          id: 'artifact-1',
          kind: 'file',
          source: 'runtime-output',
          status: 'completed',
          runId: 'run-1',
          toolCallId: 'tool-1',
          toolName: 'write_file',
          path: 'Notes/runtime-report.md',
          line: 12,
          title: 'Runtime report',
          summary: 'Generated runtime report.',
          mimeType: 'text/markdown',
          size: 42,
          updatedAt: 2,
        },
      ],
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
          expect.objectContaining({ runtimeId: 'codex', status: 'ready' }),
        ],
      },
      headers: { 'Cache-Control': 'no-store' },
    });
  });
});
