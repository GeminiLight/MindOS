import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listContextAssets } from '../../knowledge/context-assets/index.js';
import { emitStudioAutomationEvent } from '../automations/events.js';
import { readRuntimeControlPlane } from './runtime-control-plane.js';
import {
  claimNextDueStudioAutomation,
  handleStudioAutomationsGet,
  handleStudioAutomationsPost,
  readStudioAutomationState,
  recoverStaleStudioAutomationLeases,
  tickStudioAutomationWorker,
} from './studio-automations.js';

describe('Studio durable automations', () => {
  let mindRoot: string;
  let homeDir: string;
  const now = new Date('2026-09-02T00:00:00.000Z');
  const services = () => ({ mindRoot, homeDir, now: () => now });
  const draft = {
    title: 'Daily research radar',
    prompt: 'Scan tracked research directions and write the daily radar.',
    scope: 'mind',
    schedule: 'daily-0900',
    model: 'mindos-auto',
    effort: 'high',
  };

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-durable-automation-root-'));
    homeDir = mkdtempSync(join(tmpdir(), 'mindos-durable-automation-home-'));
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('owns validated CRUD in mindRoot with safe unattended defaults and real next-run time', async () => {
    const created = handleStudioAutomationsPost({ action: 'create', draft }, services());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      schemaVersion: 1,
      automations: [{
        title: draft.title,
        status: 'active',
        source: 'mindos-durable',
        runtime: 'mindos-pi',
        timezone: 'Asia/Shanghai',
        permissionMode: 'read',
        nextRun: '2026-09-02T01:00:00.000Z',
        lastStatus: 'pending',
      }],
    });
    expect(existsSync(join(mindRoot, '.mindos/automations/state.json'))).toBe(true);
    expect(existsSync(join(homeDir, '.mindos/schedule-prompts.json'))).toBe(false);

    const id = 'automations' in created.body ? created.body.automations[0]!.id : '';
    const updated = handleStudioAutomationsPost({
      action: 'update',
      id,
      draft: { ...draft, title: 'Safer radar', schedule: 'every-4-hours', permissionMode: 'auto', timeoutMs: 1 },
    }, services());
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      automations: [{ title: 'Safer radar', permissionMode: 'auto', timeoutMs: 1_000 }],
    });

    const paused = handleStudioAutomationsPost({ action: 'set-status', id, status: 'paused' }, services());
    expect(paused.body).toMatchObject({ automations: [{ status: 'paused', nextRun: 'Paused' }] });
    const invalid = handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, title: '', prompt: '', permissionMode: 'ask' },
    }, services());
    expect(invalid.status).toBe(400);
    expect(handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, schedule: 'whenever' },
    }, services()).status).toBe(400);
    expect(handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, model: 'surprise-runtime' },
    }, services()).status).toBe(400);

    const removed = handleStudioAutomationsPost({ action: 'delete', id }, services());
    expect(removed.body).toMatchObject({ automations: [] });
    expect(readRuntimeControlPlane(mindRoot).schedules[0]).toMatchObject({ status: 'archived' });
  });

  it('validates and preserves exact event metadata filters', () => {
    const eventDraft = {
      ...draft,
      schedule: 'manual',
      trigger: {
        type: 'event',
        sources: ['feishu'],
        events: ['im.message.receive_v1'],
        where: { 'message.chat_type': 'p2p', mentionsBot: true },
        debounceMs: 1_000,
        storm: { windowMs: 60_000, maxEvents: 100 },
      },
    };
    const created = handleStudioAutomationsPost({ action: 'create', draft: eventDraft }, services());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ automations: [{ trigger: { where: eventDraft.trigger.where } }] });

    const nested = handleStudioAutomationsPost({
      action: 'create', draft: { ...eventDraft, trigger: { ...eventDraft.trigger, where: { chat: { type: 'p2p' } } } },
    }, services());
    const unsafe = handleStudioAutomationsPost({
      action: 'create', draft: { ...eventDraft, trigger: { ...eventDraft.trigger, where: { '__proto__.x': true } } },
    }, services());
    expect(nested).toMatchObject({ status: 400, body: { error: expect.stringMatching(/string, finite number, or boolean/i) } });
    expect(unsafe).toMatchObject({ status: 400, body: { error: expect.stringMatching(/field is invalid/i) } });
  });

  it('settles queued event deliveries when their automation is deleted', () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        ...draft,
        schedule: 'manual',
        trigger: {
          type: 'event', sources: ['api'], events: ['release.ready'], debounceMs: 0,
          storm: { windowMs: 60_000, maxEvents: 100 },
        },
      },
    }, services());
    const id = 'automations' in created.body ? created.body.automations[0]!.id : '';
    emitStudioAutomationEvent(mindRoot, {
      source: 'api', key: 'release-delete', type: 'release.ready', occurredAt: now, payload: {},
    });

    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]).toMatchObject({ jobId: id, status: 'pending' });
    expect(handleStudioAutomationsPost({ action: 'delete', id }, services()).status).toBe(200);
    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]).toMatchObject({
      jobId: id,
      status: 'superseded',
      reason: expect.stringMatching(/deleted/i),
    });
  });

  it('migrates only Studio-owned legacy jobs once and disables their old executor', async () => {
    const legacyPath = join(homeDir, '.mindos/schedule-prompts.json');
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      jobs: [
        {
          id: 'studio-legacy-radar',
          name: 'Legacy radar',
          prompt: 'Run the old radar.',
          schedule: '0 0 9 * * *',
          enabled: true,
          type: 'cron',
          createdAt: '2026-09-01T00:00:00.000Z',
          runCount: 3,
          lastStatus: 'running',
          mindos: {
            schemaVersion: 1,
            source: 'mindos-studio-automation',
            scope: 'mind',
            studioSchedule: 'daily-0900',
            model: 'mindos-auto',
            effort: 'high',
            controlPlaneScheduleId: 'studio-automation-legacy-radar',
          },
        },
        {
          id: 'external-job', name: 'External', prompt: 'Keep me', schedule: '0 * * * * *',
          enabled: true, type: 'cron', createdAt: '2026-09-01T00:00:00.000Z', runCount: 1,
        },
      ],
    }, null, 2));

    const first = handleStudioAutomationsGet(services());
    expect(first.body).toMatchObject({
      automations: [{
        id: 'studio-legacy-radar',
        source: 'mindos-durable',
        runCount: 3,
        lastStatus: 'interrupted',
        lastError: expect.stringMatching(/legacy|interrupted/i),
      }],
      summary: { externalSchedulePromptJobs: 1, migratedLegacyJobs: 1 },
    });
    const legacyAfter = JSON.parse(readFileSync(legacyPath, 'utf-8'));
    expect(legacyAfter.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'studio-legacy-radar', enabled: false }),
      expect.objectContaining({ id: 'external-job', enabled: true }),
    ]));

    const second = handleStudioAutomationsGet(services());
    expect(second.body).toMatchObject({
      automations: [expect.objectContaining({ id: 'studio-legacy-radar' })],
      summary: { migratedLegacyJobs: 1 },
    });
    expect(readStudioAutomationState(mindRoot).automations).toHaveLength(1);

    // Simulate a crash after the legacy executor was disabled but before the
    // staged durable job was activated.
    const statePath = join(mindRoot, '.mindos/automations/state.json');
    const stagedState = JSON.parse(readFileSync(statePath, 'utf-8'));
    delete stagedState.migration.completedAt;
    stagedState.migration.pendingLegacyJobs = [{ id: 'studio-legacy-radar', status: 'active' }];
    stagedState.automations[0].status = 'paused';
    delete stagedState.automations[0].nextRunAt;
    writeFileSync(statePath, JSON.stringify(stagedState, null, 2));

    const recovered = handleStudioAutomationsGet(services());
    expect(recovered.body).toMatchObject({
      automations: [expect.objectContaining({ id: 'studio-legacy-radar', status: 'active' })],
    });
    expect(readStudioAutomationState(mindRoot).migration).not.toHaveProperty('pendingLegacyJobs');
  });

  it('preserves a corrupt legacy store, reports a redacted warning, and remains usable', () => {
    const legacyPath = join(homeDir, '.mindos/schedule-prompts.json');
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, '{"token":"sk-secret-token",broken');

    const result = handleStudioAutomationsGet(services());
    expect(result.body).toMatchObject({
      automations: [],
      summary: { migratedLegacyJobs: 0 },
    });
    expect('summary' in result.body ? result.body.summary.migrationWarning : '').not.toContain('sk-secret-token');
    expect(readFileSync(legacyPath, 'utf-8')).toBe('{"token":"sk-secret-token",broken');

    const created = handleStudioAutomationsPost({ action: 'create', draft }, services());
    expect(created.status).toBe(201);
  });

  it('does not overwrite a corrupt durable state file', () => {
    const statePath = join(mindRoot, '.mindos/automations/state.json');
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, '{broken durable state');

    const listed = handleStudioAutomationsGet(services());
    expect(listed.status).toBe(500);
    const created = handleStudioAutomationsPost({ action: 'create', draft }, services());
    expect(created.status).toBe(500);
    expect(readFileSync(statePath, 'utf-8')).toBe('{broken durable state');
  });

  it('fails closed when persisted unattended status or timezone is invalid', () => {
    handleStudioAutomationsPost({ action: 'create', draft }, services());
    const statePath = join(mindRoot, '.mindos/automations/state.json');
    const persisted = JSON.parse(readFileSync(statePath, 'utf-8'));
    persisted.automations[0].status = 'unexpected-status';
    persisted.automations[0].timezone = 'Mars/Olympus';
    writeFileSync(statePath, JSON.stringify(persisted, null, 2));

    const listed = handleStudioAutomationsGet(services());
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      automations: [{ status: 'paused', timezone: 'Asia/Shanghai', nextRun: 'Paused' }],
    });
  });

  it('refuses to write automation state through a symlinked store directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mindos-durable-automation-outside-'));
    try {
      mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
      symlinkSync(outside, join(mindRoot, '.mindos/automations'), 'dir');

      const listed = handleStudioAutomationsGet(services());
      expect(listed.status).toBe(500);
      const created = handleStudioAutomationsPost({ action: 'create', draft }, services());
      expect(created.status).toBe(500);
      expect(existsSync(join(outside, 'state.json'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('claims one occurrence across concurrent ticks and writes a run artifact plus context asset', async () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, schedule: 'manual' },
    }, services());
    const id = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id }, services());

    let finish!: (value: { text: string; thinking: string; toolCalls: never[] }) => void;
    const executor = vi.fn(() => new Promise<{ text: string; thinking: string; toolCalls: never[] }>((resolve) => { finish = resolve; }));
    const firstTick = tickStudioAutomationWorker({ mindRoot, now: () => now, ownerId: 'worker-a', executor });
    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1));
    const competing = await tickStudioAutomationWorker({ mindRoot, now: () => now, ownerId: 'worker-b', executor });
    expect(competing).toMatchObject({ claimed: 0, completed: 0 });
    finish({ text: 'Radar complete.', thinking: '', toolCalls: [] });
    await expect(firstTick).resolves.toMatchObject({ claimed: 1, completed: 1, succeeded: 1 });

    const state = readStudioAutomationState(mindRoot);
    expect(state.automations[0]).toMatchObject({ lastStatus: 'success', runCount: 1 });
    expect(state.automations[0]).not.toHaveProperty('lease');
    const run = state.automations[0]!.history[0]!;
    expect(run).toMatchObject({ status: 'success', attempt: 1 });
    expect(existsSync(join(mindRoot, run.artifactPath!))).toBe(true);
    expect(readFileSync(join(mindRoot, run.artifactPath!), 'utf-8')).toContain('Radar complete.');
    expect(listContextAssets(mindRoot, { kind: 'automation-run' })).toEqual([
      expect.objectContaining({ path: run.artifactPath, source: { kind: 'automation-run', ref: `automation-run:${run.id}` } }),
    ]);
    const controlPlane = readRuntimeControlPlane(mindRoot);
    expect(controlPlane.wakeEvents[0]).toMatchObject({ runId: run.id, status: 'completed' });
    expect(controlPlane.schedules[0]).not.toHaveProperty('nextRunAt');
  });

  it('retries a failed occurrence once, then resumes its normal schedule', async () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, schedule: 'manual' },
    }, services());
    const id = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id }, services());

    const failure = await tickStudioAutomationWorker({
      mindRoot,
      now: () => now,
      ownerId: 'worker-retry',
      executor: async () => { throw new Error('Authorization: Bearer sk-secret-token'); },
    });
    expect(failure).toMatchObject({ failed: 1, retried: 1 });
    let job = readStudioAutomationState(mindRoot).automations[0]!;
    expect(job).toMatchObject({ lastStatus: 'error', nextRunAt: now.toISOString(), retryAttempt: 2 });
    expect(job.lastError).not.toContain('sk-secret-token');

    const retryNow = new Date(now.getTime() + 1);
    const success = await tickStudioAutomationWorker({
      mindRoot,
      now: () => retryNow,
      ownerId: 'worker-retry',
      executor: async () => ({ text: 'Recovered.', thinking: '', toolCalls: [] }),
    });
    expect(success).toMatchObject({ succeeded: 1, retried: 0 });
    job = readStudioAutomationState(mindRoot).automations[0]!;
    expect(job).toMatchObject({ lastStatus: 'success', runCount: 2 });
    expect(job).not.toHaveProperty('nextRunAt');
    expect(job).not.toHaveProperty('retryAttempt');
    expect(job.history.map((run) => run.status)).toEqual(['success', 'error']);
  });

  it('recovers stale leases, times out hung runs, and migrates the legacy local-agent model to Codex', async () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, schedule: 'manual', retry: 'never', timeoutMs: 1_000 },
    }, services());
    const id = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id }, services());
    const claimed = claimNextDueStudioAutomation(mindRoot, {
      ownerId: 'dead-worker', now, leaseMs: 1_000,
    });
    expect(claimed?.lease.ownerId).toBe('dead-worker');
    expect(claimed?.lease.expiresAt).toBe(new Date(now.getTime() + 31_000).toISOString());

    const recoveredAt = new Date(now.getTime() + 32_000);
    const recovered = recoverStaleStudioAutomationLeases(mindRoot, recoveredAt);
    expect(recovered).toHaveLength(1);
    const recoveredJob = readStudioAutomationState(mindRoot).automations[0]!;
    expect(recoveredJob).toMatchObject({
      lastStatus: 'interrupted',
      history: [expect.objectContaining({ artifactPath: expect.any(String) })],
    });
    expect(existsSync(join(mindRoot, recoveredJob.history[0]!.artifactPath!))).toBe(true);
    expect(listContextAssets(mindRoot, { kind: 'automation-run' })).toEqual([
      expect.objectContaining({ path: recoveredJob.history[0]!.artifactPath }),
    ]);
    expect(readRuntimeControlPlane(mindRoot).failureAudits[0]).toMatchObject({ kind: 'runtime', recoverable: false });
    expect(readStudioAutomationState(mindRoot).notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobId: id, kind: 'interrupted' }),
    ]));

    handleStudioAutomationsPost({ action: 'run-now', id }, { mindRoot, now: () => recoveredAt });
    await tickStudioAutomationWorker({
      mindRoot,
      now: () => recoveredAt,
      ownerId: 'timeout-worker',
      executor: (_job, context) => new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    });
    expect(readStudioAutomationState(mindRoot).automations[0]).toMatchObject({ lastStatus: 'timed_out' });
    expect(readStudioAutomationState(mindRoot).notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobId: id, kind: 'timeout' }),
    ]));

    const unsupported = handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, title: 'Unsupported runtime', schedule: 'manual', model: 'local-agent', retry: 'never' },
    }, { mindRoot, now: () => recoveredAt });
    const unsupportedId = 'automations' in unsupported.body ? unsupported.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id: unsupportedId }, { mindRoot, now: () => recoveredAt });
    const executor = vi.fn(async () => { throw new Error('Codex runtime is unavailable.'); });
    await tickStudioAutomationWorker({ mindRoot, now: () => recoveredAt, ownerId: 'safe-worker', executor });
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'codex', runtime: 'codex', permissionMode: 'read' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const unsupportedJob = readStudioAutomationState(mindRoot).automations.find((job) => job.id === unsupportedId)!;
    expect(unsupportedJob.lastStatus).toBe('error');
    expect(unsupportedJob.lastError).toMatch(/unavailable/i);
  });

  it('does not start queued work after it is paused', async () => {
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: { ...draft, schedule: 'manual' },
    }, services());
    const id = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id }, services());
    handleStudioAutomationsPost({ action: 'set-status', id, status: 'paused' }, services());
    const executor = vi.fn();
    await expect(tickStudioAutomationWorker({ mindRoot, now: () => now, executor })).resolves.toMatchObject({ claimed: 0 });
    expect(executor).not.toHaveBeenCalled();
  });
});
