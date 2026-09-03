import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimAgentRunCapsuleRecoveryPlan,
  createAgentRunCapsule,
  createAgentRunCapsuleRecoveryPlan,
  finalizeAgentRunCapsule,
  getAgentRunCapsuleRecoveryPlan,
  getAgentRunCapsule,
  listAgentRunCapsules,
  projectAgentRunCapsule,
} from './store.js';

let mindRoot = '';

describe('agent run capsule store', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-run-capsule-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('persists replay input privately while exposing only a redacted recovery projection', () => {
    const capsule = createAgentRunCapsule(mindRoot, {
      id: 'capsule-run-1',
      runId: 'run-1',
      rootRunId: 'run-1',
      chatSessionId: 'chat-1',
      source: 'interactive',
      request: {
        messages: [
          { role: 'user', content: 'Review deployment with sk-secret-value' },
        ],
        runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
        runtimeBinding: {
          type: 'codex-thread',
          runtime: 'codex',
          runtimeId: 'codex',
          externalSessionId: 'thread-1',
        },
        agentMode: 'default',
        permissionMode: 'ask',
        model: 'gpt-5.6-codex',
        thinkingEffort: 'high',
        context: {
          currentFile: 'Deploy/runbook.md',
          attachedFiles: ['Deploy/checklist.md'],
          uploadedFiles: [{
            name: 'incident.txt',
            content: 'authorization: Bearer private-upload-token',
            mimeType: 'text/plain',
            size: 42,
          }],
          receiptIds: ['receipt-1'],
          assetIds: ['asset-1'],
        },
      },
      provenance: {
        cwd: '/tmp/project',
        gitRevision: 'abc123',
      },
      now: new Date('2026-09-03T10:00:00.000Z'),
    });

    expect(capsule).toMatchObject({
      schemaVersion: 1,
      id: 'capsule-run-1',
      runId: 'run-1',
      status: 'running',
      request: {
        model: 'gpt-5.6-codex',
        thinkingEffort: 'high',
      },
    });
    expect(getAgentRunCapsule(mindRoot, capsule.id)).toEqual(capsule);
    expect(listAgentRunCapsules(mindRoot)).toEqual([capsule]);

    const projection = projectAgentRunCapsule(capsule);
    expect(projection).toMatchObject({
      id: capsule.id,
      runId: capsule.runId,
      inputSummary: 'Review deployment with [REDACTED]',
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      model: 'gpt-5.6-codex',
      thinkingEffort: 'high',
      context: {
        currentFile: 'Deploy/runbook.md',
        attachedFileCount: 1,
        uploadedFileCount: 1,
        receiptIds: ['receipt-1'],
        assetIds: ['asset-1'],
      },
      recovery: {
        retry: { supported: true, mode: 'from-start' },
        fork: { supported: true, mode: 'new-session' },
        resume: { supported: true, sessionId: 'thread-1' },
        rollback: { supported: false },
      },
    });
    expect(JSON.stringify(projection)).not.toContain('private-upload-token');
    expect(JSON.stringify(projection)).not.toContain('sk-secret-value');

    const storedPath = join(
      mindRoot,
      '.mindos',
      'agent-run-capsules',
      '2026',
      '09',
      'capsule-run-1.json',
    );
    expect(JSON.parse(readFileSync(storedPath, 'utf-8'))).toEqual(capsule);
    if (process.platform !== 'win32') {
      expect(statSync(storedPath).mode & 0o777).toBe(0o600);
    }
  });

  it('finalizes status but keeps rollback disabled until a verified executor exists', () => {
    createAgentRunCapsule(mindRoot, capsuleInput({
      provenance: { cwd: '/tmp/project', checkpointArtifactId: 'artifact-checkpoint-1' },
    }));

    const completed = finalizeAgentRunCapsule(mindRoot, 'capsule-run-1', {
      status: 'completed',
      now: new Date('2026-09-03T10:01:00.000Z'),
    });

    expect(completed.status).toBe('completed');
    expect(completed.updatedAt).toBe('2026-09-03T10:01:00.000Z');
    expect(projectAgentRunCapsule(completed).recovery.rollback).toEqual({
      supported: false,
      checkpointArtifactId: 'artifact-checkpoint-1',
      reason: 'A checkpoint was recorded, but no verified rollback executor is available.',
    });
  });

  it('creates idempotent retry, fork, and resume plans without leaking runtime semantics', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());

    const retry = createAgentRunCapsuleRecoveryPlan(mindRoot, 'capsule-run-1', {
      action: 'retry',
      idempotencyKey: 'retry-click-1',
      now: new Date('2026-09-03T10:02:00.000Z'),
    });
    const retryAgain = createAgentRunCapsuleRecoveryPlan(mindRoot, 'capsule-run-1', {
      action: 'retry',
      idempotencyKey: 'retry-click-1',
      now: new Date('2026-09-03T10:03:00.000Z'),
    });
    const fork = createAgentRunCapsuleRecoveryPlan(mindRoot, 'capsule-run-1', {
      action: 'fork',
      idempotencyKey: 'fork-click-1',
    });
    const resume = createAgentRunCapsuleRecoveryPlan(mindRoot, 'capsule-run-1', {
      action: 'resume',
      idempotencyKey: 'resume-click-1',
    });

    expect(retryAgain).toEqual(retry);
    expect(getAgentRunCapsuleRecoveryPlan(mindRoot, retry.id)).toEqual(retry);
    expect(retry.request.runtimeBinding).toBeNull();
    expect(retry.targetChatSessionId).toBe('chat-1');
    expect(fork.request.runtimeBinding).toBeNull();
    expect(fork.targetChatSessionId).toBeUndefined();
    expect(resume.request.runtimeBinding?.externalSessionId).toBe('thread-1');
    expect(resume.targetChatSessionId).toBe('chat-1');
    expect(retry.sourceCapsuleId).toBe('capsule-run-1');
  });

  it('claims a recovery plan exactly once across competing workers', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    const plan = createAgentRunCapsuleRecoveryPlan(mindRoot, 'capsule-run-1', {
      action: 'retry',
      idempotencyKey: 'retry-click-claim',
    });

    expect(claimAgentRunCapsuleRecoveryPlan(mindRoot, plan.id, 'recovery-run-1')).toMatchObject({
      planId: plan.id,
      runId: 'recovery-run-1',
    });
    expect(() => claimAgentRunCapsuleRecoveryPlan(mindRoot, plan.id, 'recovery-run-2'))
      .toThrow(/already claimed.*recovery-run-1/i);
  });

  it('rejects capsules whose serialized replay payload exceeds the storage limit', () => {
    expect(() => createAgentRunCapsule(mindRoot, capsuleInput({
      request: {
        ...capsuleInput().request,
        messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }],
      },
    }))).toThrow(/payload is too large/i);
    expect(listAgentRunCapsules(mindRoot)).toEqual([]);
  });

  it('rejects invalid ids, duplicate capsules, corrupt storage, and unsupported resume', () => {
    expect(() => createAgentRunCapsule(mindRoot, capsuleInput({ id: '../escape' }))).toThrow(/capsule id/i);

    createAgentRunCapsule(mindRoot, capsuleInput());
    expect(() => createAgentRunCapsule(mindRoot, capsuleInput())).toThrow(/already exists/i);

    const storedPath = join(mindRoot, '.mindos', 'agent-run-capsules', '2026', '09', 'capsule-run-1.json');
    writeFileSync(storedPath, '{broken', 'utf-8');
    expect(() => getAgentRunCapsule(mindRoot, 'capsule-run-1')).toThrow(/corrupt/i);

    rmSync(storedPath);
    createAgentRunCapsule(mindRoot, capsuleInput({
      id: 'capsule-run-2',
      runId: 'run-2',
      request: {
        ...capsuleInput().request,
        runtimeBinding: null,
      },
    }));
    expect(() => createAgentRunCapsuleRecoveryPlan(mindRoot, 'capsule-run-2', {
      action: 'resume',
      idempotencyKey: 'resume-click-2',
    })).toThrow(/no reusable runtime session/i);
  });

  it('preserves and rejects structurally corrupt capsule JSON before projection', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    const storedPath = join(mindRoot, '.mindos', 'agent-run-capsules', '2026', '09', 'capsule-run-1.json');
    const malformed = JSON.parse(readFileSync(storedPath, 'utf-8'));
    malformed.request.context.attachedFiles = 'not-an-array';
    writeFileSync(storedPath, `${JSON.stringify(malformed)}\n`, 'utf-8');

    expect(() => listAgentRunCapsules(mindRoot)).toThrow(/corrupt/i);
    expect(readFileSync(storedPath, 'utf-8')).toContain('not-an-array');
  });

  it('preserves and rejects structurally corrupt recovery plans before execution', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    const plan = createAgentRunCapsuleRecoveryPlan(mindRoot, 'capsule-run-1', {
      action: 'retry',
      idempotencyKey: 'corrupt-plan',
    });
    const storedPath = join(
      mindRoot,
      '.mindos',
      'agent-run-capsules',
      'recoveries',
      `${plan.id}.json`,
    );
    const malformed = JSON.parse(readFileSync(storedPath, 'utf-8'));
    delete malformed.request.context;
    writeFileSync(storedPath, `${JSON.stringify(malformed)}\n`, 'utf-8');

    expect(() => getAgentRunCapsuleRecoveryPlan(mindRoot, plan.id)).toThrow(/corrupt/i);
    expect(readFileSync(storedPath, 'utf-8')).not.toContain('"context"');
  });
});

function capsuleInput(overrides: Record<string, unknown> = {}) {
  const input = {
    id: 'capsule-run-1',
    runId: 'run-1',
    rootRunId: 'run-1',
    chatSessionId: 'chat-1',
    source: 'interactive' as const,
    request: {
      messages: [{ role: 'user', content: 'Review deployment' }],
      runtime: { kind: 'codex' as const, id: 'codex', name: 'Codex' },
      runtimeBinding: {
        type: 'codex-thread' as const,
        runtime: 'codex' as const,
        runtimeId: 'codex',
        externalSessionId: 'thread-1',
      },
      agentMode: 'default',
      permissionMode: 'ask',
      context: {
        attachedFiles: [],
        uploadedFiles: [],
        receiptIds: [],
        assetIds: [],
      },
    },
    provenance: { cwd: '/tmp/project' },
    now: new Date('2026-09-03T10:00:00.000Z'),
  };
  return { ...input, ...overrides };
}
