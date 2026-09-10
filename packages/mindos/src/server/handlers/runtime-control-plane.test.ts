import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStateDatabase, readLease, releaseLease, tryAcquireLease } from '../../foundation/storage/leases.js';
import { closeAllMindosDatabases } from '../../foundation/storage/sqlite.js';
import {
  MINDOS_RUNTIME_CONTROL_PLANE_FILE,
  RUNTIME_CONTROL_PLANE_LEASE,
  handleRuntimeControlPlaneGet,
  handleRuntimeControlPlanePost,
  readRuntimeControlPlane,
  subscribeRuntimeControlPlaneMutations,
} from './runtime-control-plane.js';

let mindRoot: string;
let now: Date;

const services = {
  get mindRoot() {
    return mindRoot;
  },
  now: () => now,
};

describe('runtime control-plane primitives', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-runtime-control-plane-'));
    now = new Date('2026-06-27T00:00:00.000Z');
  });

  afterEach(() => {
    closeAllMindosDatabases();
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('persists safe schedule, approval, wake, failure, mailbox, and task primitives', async () => {
    const schedule = handleRuntimeControlPlanePost({
      action: 'create-schedule',
      schedule: {
        id: 'daily-check',
        title: 'Daily connection check',
        runtimeId: 'mindos',
        status: 'enabled',
        trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        target: { assistantId: 'ops', command: 'agent connection check', cwdHint: '/not/executed' },
        policy: { permissionMode: 'read', overlap: 'skip', retry: 'once', timeoutMs: 120000 },
        inputSummary: 'Check runtime status with apiKey=must-not-leak.',
      },
    }, services);

    expect(schedule.status).toBe(201);
    expect(schedule.body).toMatchObject({
      ok: true,
      action: 'create-schedule',
      item: {
        id: 'daily-check',
        runtimeId: 'mindos',
        status: 'enabled',
        trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        policy: { permissionMode: 'read', overlap: 'skip', retry: 'once', timeoutMs: 120000 },
        inputSummary: 'Check runtime status with apiKey=[redacted]',
      },
      snapshot: {
        summary: { scheduleCount: 1, enabledScheduleCount: 1 },
      },
    });

    const approval = handleRuntimeControlPlanePost({
      action: 'enqueue-approval',
      approval: {
        id: 'approval-1',
        runtimeId: 'codex',
        scheduleId: 'daily-check',
        runId: 'run-1',
        scope: 'write',
        summary: 'Approve writing report. token=must-not-leak',
      },
    }, services);
    expect(approval.body).toMatchObject({
      item: {
        id: 'approval-1',
        status: 'pending',
        summary: 'Approve writing report. token=[redacted]',
      },
    });

    now = new Date('2026-06-27T00:01:00.000Z');
    const resolved = handleRuntimeControlPlanePost({
      action: 'resolve-approval',
      approvalId: 'approval-1',
      decision: 'reject',
    }, services);
    expect(resolved.body).toMatchObject({
      item: {
        id: 'approval-1',
        status: 'rejected',
        decision: 'reject',
        resolvedAt: '2026-06-27T00:01:00.000Z',
      },
    });

    handleRuntimeControlPlanePost({
      action: 'record-wake',
      wake: { id: 'wake-1', runtimeId: 'mindos', scheduleId: 'daily-check', status: 'missed', triggerAt: '2026-06-27T09:00:00+08:00' },
    }, services);
    handleRuntimeControlPlanePost({
      action: 'record-failure',
      failure: { id: 'failure-1', runtimeId: 'mindos', scheduleId: 'daily-check', kind: 'timeout', summary: 'Timed out.', recoverable: true },
    }, services);
    handleRuntimeControlPlanePost({
      action: 'send-message',
      message: { id: 'message-1', fromRuntimeId: 'mindos', toRuntimeId: 'codex', subject: 'Review', summary: 'Please review.' },
    }, services);
    handleRuntimeControlPlanePost({
      action: 'upsert-task',
      task: { id: 'task-1', title: 'Review runtime report', status: 'doing', priority: 'high', assigneeRuntimeId: 'codex', sourceMessageId: 'message-1' },
    }, services);

    const snapshot = readRuntimeControlPlane(mindRoot);
    expect(snapshot).toMatchObject({
      schedules: [expect.objectContaining({ id: 'daily-check' })],
      approvalQueue: [expect.objectContaining({ id: 'approval-1', status: 'rejected' })],
      wakeEvents: [expect.objectContaining({ id: 'wake-1', status: 'missed' })],
      failureAudits: [expect.objectContaining({ id: 'failure-1', recoverable: true })],
      mailbox: [expect.objectContaining({ id: 'message-1', status: 'queued' })],
      tasks: [expect.objectContaining({ id: 'task-1', status: 'doing' })],
      summary: {
        scheduleCount: 1,
        enabledScheduleCount: 1,
        pendingApprovalCount: 0,
        pendingWakeCount: 0,
        openTaskCount: 1,
        queuedMessageCount: 1,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');

    const file = join(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).not.toContain('must-not-leak');
  });

  it('filters snapshots by runtime id without mutating stored data', async () => {
    handleRuntimeControlPlanePost({
      action: 'create-schedule',
      schedule: { id: 'codex-job', title: 'Codex job', runtimeId: 'codex', trigger: { type: 'manual' } },
    }, services);
    handleRuntimeControlPlanePost({
      action: 'create-schedule',
      schedule: { id: 'mindos-job', title: 'MindOS job', runtimeId: 'mindos', trigger: { type: 'manual' } },
    }, services);

    const response = await handleRuntimeControlPlaneGet(new URLSearchParams('runtime=codex'), services);
    expect(response).toMatchObject({
      status: 200,
      body: {
        schedules: [expect.objectContaining({ id: 'codex-job' })],
        summary: { scheduleCount: 1 },
      },
      headers: { 'Cache-Control': 'no-store' },
    });
    expect(readRuntimeControlPlane(mindRoot).summary.scheduleCount).toBe(2);
  });

  it('rejects unsafe or executable-looking schedule payloads', () => {
    const invalidCron = handleRuntimeControlPlanePost({
      action: 'create-schedule',
      schedule: {
        title: 'Bad cron',
        runtimeId: 'mindos',
        trigger: { type: 'cron', cron: 'bad cron with spaces and $TOKEN' },
      },
    }, services);
    expect(invalidCron).toMatchObject({
      status: 400,
      body: { error: 'Cron trigger requires a safe 5/6-field expression or @daily-style macro.' },
    });

    const invalidRuntime = handleRuntimeControlPlanePost({
      action: 'create-schedule',
      schedule: { title: 'Bad runtime', runtimeId: '../codex', trigger: { type: 'manual' } },
    }, services);
    expect(invalidRuntime).toMatchObject({
      status: 400,
      body: { error: 'Schedule requires runtimeId.' },
    });
  });

  it('refuses writes through a symlinked .mindos directory outside mindRoot', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mindos-runtime-control-plane-outside-'));
    symlinkSync(outside, join(mindRoot, '.mindos'), 'dir');

    expect(() => handleRuntimeControlPlanePost({
      action: 'create-schedule',
      schedule: { title: 'Unsafe write', runtimeId: 'mindos', trigger: { type: 'manual' } },
    }, services)).toThrow(/Access denied/);

    rmSync(outside, { recursive: true, force: true });
  });
  it('refuses to mutate a corrupt state file, preserves it aside and recovers on the next write', async () => {
    const file = join(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ "schedules": [ not json', 'utf-8');

    const refused = handleRuntimeControlPlanePost({ action: 'upsert-task', task: { id: 'task-1', title: 'First' } }, services);
    expect(refused.status).toBe(500);
    expect((refused.body as { error: string }).error).toMatch(/corrupt/i);
    expect(existsSync(file)).toBe(false);
    const preserved = readdirSync(dirname(file)).filter((name) => name.startsWith('runtime-control-plane.json.corrupt-'));
    expect(preserved).toHaveLength(1);
    expect(readFileSync(join(dirname(file), preserved[0]!), 'utf-8')).toBe('{ "schedules": [ not json');

    const recovered = handleRuntimeControlPlanePost({ action: 'upsert-task', task: { id: 'task-1', title: 'First' } }, services);
    expect(recovered.status).toBe(201);
    expect(readRuntimeControlPlane(mindRoot).tasks).toEqual([expect.objectContaining({ id: 'task-1' })]);
  });

  it('reports a corrupt state file on read instead of returning an empty snapshot', async () => {
    const file = join(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'garbage', 'utf-8');

    expect(() => readRuntimeControlPlane(mindRoot)).toThrow(/corrupt/i);
    const response = await handleRuntimeControlPlaneGet(new URLSearchParams(), services);
    expect(response.status).toBe(500);
    expect((response.body as { error: string }).error).toMatch(/corrupt/i);
    // Reads never move the file: only a serialized mutation may set it aside.
    expect(readFileSync(file, 'utf-8')).toBe('garbage');
  });

  it('returns 409 without touching the file while another writer holds the lease', () => {
    const file = join(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE);
    const db = openStateDatabase(mindRoot);
    const held = tryAcquireLease(db, { ...RUNTIME_CONTROL_PLANE_LEASE, ttlMs: 30_000 });
    expect(held.ok).toBe(true);
    if (!held.ok) return;

    const busy = handleRuntimeControlPlanePost({ action: 'upsert-task', task: { id: 'task-1', title: 'First' } }, services);
    expect(busy.status).toBe(409);
    expect((busy.body as { error: string }).error).toMatch(/busy/i);
    expect(busy.headers?.['Retry-After']).toBe('1');
    expect(existsSync(file)).toBe(false);

    releaseLease(db, held.lease);
    const ok = handleRuntimeControlPlanePost({ action: 'upsert-task', task: { id: 'task-1', title: 'First' } }, services);
    expect(ok.status).toBe(201);
    expect(readLease(db, RUNTIME_CONTROL_PLANE_LEASE)).toBeNull();
  });

  it('writes the state file with owner-only permissions', () => {
    handleRuntimeControlPlanePost({ action: 'upsert-task', task: { id: 'task-1', title: 'First' } }, services);
    const file = join(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE);
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(dirname(file)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('notifies in-process subscribers once per committed mutation and supports unsubscribe', () => {
    const seen: Array<{ action: string; itemId: string; mindRoot: string }> = [];
    const unsubscribe = subscribeRuntimeControlPlaneMutations((event) => {
      seen.push({ action: event.action, itemId: event.item.id, mindRoot: event.mindRoot });
    });

    handleRuntimeControlPlanePost({ action: 'upsert-task', task: { id: 'task-1', title: 'First' } }, services);
    handleRuntimeControlPlanePost({ action: 'upsert-task', task: { title: '' } }, services);
    expect(seen).toEqual([{ action: 'upsert-task', itemId: 'task-1', mindRoot }]);

    unsubscribe();
    handleRuntimeControlPlanePost({ action: 'upsert-task', task: { id: 'task-2', title: 'Second' } }, services);
    expect(seen).toHaveLength(1);
  });
});
