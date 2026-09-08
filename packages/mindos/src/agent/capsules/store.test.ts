import fs, { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAllMindosDatabases, openMindosDatabase } from '../../foundation/storage/sqlite.js';
import {
  CAPSULES_DB_RELATIVE_PATH,
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

function indexDbFile(): string {
  return join(fs.realpathSync(mindRoot), ...CAPSULES_DB_RELATIVE_PATH.split('/'));
}

function indexRows(): Array<{ id: string; status: string | null; path: string; corrupt_message: string | null }> {
  return openMindosDatabase({ file: indexDbFile(), migrations: [] })
    .prepare('SELECT id, status, path, corrupt_message FROM capsules ORDER BY id').all() as Array<{ id: string; status: string | null; path: string; corrupt_message: string | null }>;
}

describe('agent run capsule store', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-run-capsule-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeAllMindosDatabases();
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
        retry: { supported: false },
        fork: { supported: false },
        resume: { supported: false },
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

  it.each(['queued', 'running', 'streaming'] as const)('rejects recovery while the source is %s', (status) => {
    const capsule = createAgentRunCapsule(mindRoot, capsuleInput({ status }));
    for (const action of ['retry', 'fork', 'resume'] as const) {
      expect(projectAgentRunCapsule(capsule).recovery[action].supported).toBe(false);
      expect(() => createAgentRunCapsuleRecoveryPlan(mindRoot, capsule.id, { action, idempotencyKey: action }))
        .toThrow(/still active/i);
    }
  });

  it.each(['missing', 'signed-out', 'archived', 'failed'] as const)('does not resume a %s binding', (status) => {
    const input = capsuleInput();
    const capsule = createAgentRunCapsule(mindRoot, {
      ...input, request: { ...input.request, runtimeBinding: { ...input.request.runtimeBinding, status } },
    });
    expect(projectAgentRunCapsule(capsule).recovery.resume.supported).toBe(false);
    expect(projectAgentRunCapsule(capsule).recovery.retry.supported).toBe(true);
  });

  it('does not infer ACP resume support from an external session id', () => {
    const input = capsuleInput();
    const capsule = createAgentRunCapsule(mindRoot, {
      ...input, request: { ...input.request,
        runtime: { kind: 'acp', id: 'adapter', name: 'Adapter' },
        runtimeBinding: { type: 'acp-session', runtime: 'acp', runtimeId: 'adapter', externalSessionId: 'session' },
      },
    });
    expect(projectAgentRunCapsule(capsule).recovery.resume.supported).toBe(false);
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

    createAgentRunCapsule(mindRoot, capsuleInput({ id: 'healthy-capsule' }));
    const warnings: string[] = [];
    expect(listAgentRunCapsules(mindRoot, { onCorrupt: (warning) => warnings.push(warning) }).map((item) => item.id)).toEqual(['healthy-capsule']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('capsule-run-1.json');
    expect(() => getAgentRunCapsule(mindRoot, 'capsule-run-1')).toThrow(/corrupt/i);
    expect(readFileSync(storedPath, 'utf-8')).toContain('not-an-array');
  });

  it('serves an unchanged capsule directory from cache without re-reading files', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-run-2', runId: 'run-2', now: new Date('2026-09-03T11:00:00.000Z') }));
    const first = listAgentRunCapsules(mindRoot);
    expect(first.map((capsule) => capsule.id)).toEqual(['capsule-run-2', 'capsule-run-1']);

    const readSpy = vi.spyOn(fs, 'readFileSync');
    expect(listAgentRunCapsules(mindRoot)).toEqual(first);
    expect(listAgentRunCapsules(mindRoot)).toEqual(first);
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-2')).toEqual(first[0]);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('caches corrupt capsules too, so the poller does not re-parse a broken file every tick', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    const storedPath = join(mindRoot, '.mindos', 'agent-run-capsules', '2026', '09', 'capsule-run-1.json');
    writeFileSync(storedPath, '{broken', 'utf-8');
    const warnings: string[] = [];
    expect(listAgentRunCapsules(mindRoot, { onCorrupt: (warning) => warnings.push(warning) })).toEqual([]);
    expect(warnings).toHaveLength(1);

    const readSpy = vi.spyOn(fs, 'readFileSync');
    expect(listAgentRunCapsules(mindRoot, { onCorrupt: (warning) => warnings.push(warning) })).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(() => getAgentRunCapsule(mindRoot, 'capsule-run-1')).toThrow(/corrupt/i);
    expect(readSpy).not.toHaveBeenCalled();
    expect(readFileSync(storedPath, 'utf-8')).toBe('{broken');
  });

  it('picks up new, finalized, rewritten, and deleted capsules after listing from cache', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    expect(listAgentRunCapsules(mindRoot).map((capsule) => capsule.id)).toEqual(['capsule-run-1']);

    createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-run-2', runId: 'run-2', now: new Date('2026-09-03T11:00:00.000Z') }));
    expect(listAgentRunCapsules(mindRoot).map((capsule) => capsule.id)).toEqual(['capsule-run-2', 'capsule-run-1']);

    const finalized = finalizeAgentRunCapsule(mindRoot, 'capsule-run-1', { status: 'failed', now: new Date('2026-09-03T12:00:00.000Z') });
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')).toEqual(finalized);
    expect(listAgentRunCapsules(mindRoot).find((capsule) => capsule.id === 'capsule-run-1')?.status).toBe('failed');

    const storedPath = join(mindRoot, '.mindos', 'agent-run-capsules', '2026', '09', 'capsule-run-2.json');
    const rewritten = JSON.parse(readFileSync(storedPath, 'utf-8'));
    rewritten.status = 'canceled';
    writeFileSync(storedPath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf-8');
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-2')?.status).toBe('canceled');
    expect(listAgentRunCapsules(mindRoot).find((capsule) => capsule.id === 'capsule-run-2')?.status).toBe('canceled');

    rmSync(storedPath);
    expect(listAgentRunCapsules(mindRoot).map((capsule) => capsule.id)).toEqual(['capsule-run-1']);
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-2')).toBeNull();
  });

  it('locates capsules by id directly for recent months and falls back to a scan for older ones', () => {
    const old = createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-old', runId: 'run-old', now: new Date('2024-02-10T10:00:00.000Z') }));
    const recent = createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-recent', runId: 'run-recent', now: new Date() }));

    expect(getAgentRunCapsule(mindRoot, 'capsule-old')).toEqual(old);
    expect(getAgentRunCapsule(mindRoot, 'capsule-recent')).toEqual(recent);
    expect(getAgentRunCapsule(mindRoot, 'capsule-missing')).toBeNull();
    expect(finalizeAgentRunCapsule(mindRoot, 'capsule-old', { status: 'failed' }).status).toBe('failed');
    expect(() => finalizeAgentRunCapsule(mindRoot, 'capsule-missing', { status: 'failed' })).toThrow(/not found/i);

    // Direct lookup never trusts the id blindly: an escape attempt is rejected before any path is derived.
    expect(() => getAgentRunCapsule(mindRoot, '../escape')).toThrow(/capsule id/i);
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

  it('indexes capsules in sqlite so get and finalize never list directories', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-old', runId: 'run-old', now: new Date('2024-02-10T10:00:00.000Z') }));
    expect(indexRows()).toEqual([
      expect.objectContaining({ id: 'capsule-old', status: 'completed', path: '.mindos/agent-run-capsules/2024/02/capsule-old.json' }),
      expect.objectContaining({ id: 'capsule-run-1', status: 'completed', path: '.mindos/agent-run-capsules/2026/09/capsule-run-1.json' }),
    ]);

    // First list records every month directory's mtime in the index.
    listAgentRunCapsules(mindRoot);

    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    expect(getAgentRunCapsule(mindRoot, 'capsule-old')?.id).toBe('capsule-old');
    expect(finalizeAgentRunCapsule(mindRoot, 'capsule-old', { status: 'failed' }).status).toBe('failed');
    expect(readdirSpy).not.toHaveBeenCalled();
    expect(indexRows().find((row) => row.id === 'capsule-old')?.status).toBe('failed');

    // Listing re-lists the tiny year directories plus only the month the finalize touched.
    readdirSpy.mockClear();
    listAgentRunCapsules(mindRoot);
    const listedMonths = readdirSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((dir) => /agent-run-capsules[\\/]\d{4}[\\/]\d{2}$/.test(dir));
    expect(listedMonths).toHaveLength(1);
    expect(listedMonths[0]).toMatch(/2024[\\/]02$/);

    // Nothing changed since: no month directory is listed at all.
    readdirSpy.mockClear();
    listAgentRunCapsules(mindRoot);
    expect(readdirSpy.mock.calls.map((call) => String(call[0])).some((dir) => /agent-run-capsules[\\/]\d{4}[\\/]\d{2}$/.test(dir))).toBe(false);
  });

  it('discovers a capsule another process filed directly on disk and indexes it', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    expect(listAgentRunCapsules(mindRoot).map((capsule) => capsule.id)).toEqual(['capsule-run-1']);

    const foreign = { ...createAgentRunCapsule(mkdtempSync(join(tmpdir(), 'mindos-run-capsule-foreign-')), capsuleInput({ id: 'capsule-foreign', runId: 'run-foreign', now: new Date('2026-09-04T10:00:00.000Z') })) };
    const dir = join(mindRoot, '.mindos', 'agent-run-capsules', '2026', '09');
    writeFileSync(join(dir, 'capsule-foreign.json'), `${JSON.stringify(foreign, null, 2)}\n`, 'utf-8');

    expect(listAgentRunCapsules(mindRoot).map((capsule) => capsule.id)).toEqual(['capsule-foreign', 'capsule-run-1']);
    expect(getAgentRunCapsule(mindRoot, 'capsule-foreign')).toEqual(foreign);
    expect(indexRows().map((row) => row.id)).toEqual(['capsule-foreign', 'capsule-run-1']);

    // A capsule filed in an older month, missed by the recent-month probe, is found through a full sync.
    const oldDir = join(mindRoot, '.mindos', 'agent-run-capsules', '2023', '05');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, 'capsule-ancient.json'), `${JSON.stringify({ ...foreign, id: 'capsule-ancient', createdAt: '2023-05-01T00:00:00.000Z', updatedAt: '2023-05-01T00:00:00.000Z' }, null, 2)}\n`, 'utf-8');
    expect(getAgentRunCapsule(mindRoot, 'capsule-ancient')?.id).toBe('capsule-ancient');
    expect(indexRows().map((row) => row.id)).toEqual(['capsule-ancient', 'capsule-foreign', 'capsule-run-1']);
  });

  it('refreshes a stale index row when the file changed underneath it and drops rows for deleted files', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    const storedPath = join(mindRoot, '.mindos', 'agent-run-capsules', '2026', '09', 'capsule-run-1.json');
    const rewritten = JSON.parse(readFileSync(storedPath, 'utf-8'));
    rewritten.status = 'canceled';
    writeFileSync(storedPath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf-8');

    // In-place rewrite: the month directory mtime did not change, the row is refreshed from the file stat.
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')?.status).toBe('canceled');
    expect(indexRows()[0]).toEqual(expect.objectContaining({ id: 'capsule-run-1', status: 'canceled', corrupt_message: null }));

    writeFileSync(storedPath, '{broken', 'utf-8');
    expect(() => getAgentRunCapsule(mindRoot, 'capsule-run-1')).toThrow(/corrupt/i);
    expect(indexRows()[0]?.corrupt_message).toMatch(/corrupt/i);

    rmSync(storedPath);
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')).toBeNull();
    expect(indexRows()).toEqual([]);
  });

  it('rebuilds the index from the directory when the database is missing', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-run-2', runId: 'run-2', now: new Date('2026-09-03T11:00:00.000Z') }));
    closeAllMindosDatabases();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${indexDbFile()}${suffix}`, { force: true });

    expect(listAgentRunCapsules(mindRoot).map((capsule) => capsule.id)).toEqual(['capsule-run-2', 'capsule-run-1']);
    expect(indexRows().map((row) => row.id)).toEqual(['capsule-run-1', 'capsule-run-2']);
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-2')?.id).toBe('capsule-run-2');
  });

  it('ignores index rows that point outside the capsules tree', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    const db = openMindosDatabase({ file: indexDbFile(), migrations: [] });
    db.prepare(`INSERT INTO capsules(id, path, size, mtime_ms) VALUES ('capsule-evil', '../../etc/passwd', 1, 1)`).run();
    db.prepare(`INSERT INTO capsules(id, path, size, mtime_ms) VALUES ('capsule-renamed', '.mindos/agent-run-capsules/2026/09/capsule-run-1.json', 1, 1)`).run();

    expect(listAgentRunCapsules(mindRoot).map((capsule) => capsule.id)).toEqual(['capsule-run-1']);
    expect(getAgentRunCapsule(mindRoot, 'capsule-evil')).toBeNull();
    expect(getAgentRunCapsule(mindRoot, 'capsule-renamed')).toBeNull();
    expect(indexRows().map((row) => row.id)).toEqual(['capsule-run-1']);
  });
});

function capsuleInput(overrides: Record<string, unknown> = {}) {
  const input = {
    id: 'capsule-run-1',
    runId: 'run-1',
    rootRunId: 'run-1',
    chatSessionId: 'chat-1',
    source: 'interactive' as const,
    status: 'completed' as const,
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
