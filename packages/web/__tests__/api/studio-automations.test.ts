import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mocks = vi.hoisted(() => ({
  mindRoot: '',
}));

vi.mock('@geminilight/mindos/server', async () => {
  const actual = await import('../../../mindos/src/server');
  return { ...actual };
});

vi.mock('@/lib/fs', () => ({
  getMindRoot: () => mocks.mindRoot,
}));

async function importRoute() {
  vi.resetModules();
  return await import('../../app/api/studio/automations/route');
}

function legacyStorePath(home: string) {
  return path.join(home, '.mindos', 'schedule-prompts.json');
}

function storePath(mindRoot: string) {
  return path.join(mindRoot, '.mindos', 'automations', 'state.json');
}

function controlPlanePath(mindRoot: string) {
  return path.join(mindRoot, '.mindos', 'runtime-control-plane.json');
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as any;
}

function writeScheduleStore(home: string, jobs: any[]) {
  fs.mkdirSync(path.dirname(legacyStorePath(home)), { recursive: true });
  fs.writeFileSync(legacyStorePath(home), JSON.stringify({ jobs, version: 1 }, null, 2), 'utf-8');
}

const draft = {
  title: 'Daily research radar',
  prompt: 'Scan tracked research directions and write the daily radar.',
  scope: 'mind',
  schedule: 'daily-0900',
  model: 'mindos-auto',
  effort: 'high',
};

let tempHome: string;
let tempMindRoot: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-studio-automation-home-'));
  tempMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-studio-automation-root-'));
  previousHome = process.env.MINDOS_STUDIO_AUTOMATION_HOME;
  process.env.MINDOS_STUDIO_AUTOMATION_HOME = tempHome;
  mocks.mindRoot = tempMindRoot;
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.MINDOS_STUDIO_AUTOMATION_HOME;
  } else {
    process.env.MINDOS_STUDIO_AUTOMATION_HOME = previousHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
  fs.rmSync(tempMindRoot, { recursive: true, force: true });
});

describe('GET/POST /api/studio/automations', () => {
  it('creates Studio automations in the product-owned durable store and control plane', async () => {
    const { GET, POST } = await importRoute();
    const response = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', draft }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      schemaVersion: 1,
      automations: [
        expect.objectContaining({
          title: 'Daily research radar',
          runtime: 'mindos-pi',
          source: 'mindos-durable',
          status: 'active',
          schedule: 'daily-0900',
          permissionMode: 'read',
          lastStatus: 'pending',
        }),
      ],
      summary: {
        total: 1,
        enabled: 1,
        paused: 0,
        externalSchedulePromptJobs: 0,
      },
      worker: null,
    });

    const store = readJson(storePath(tempMindRoot));
    expect(store.automations).toHaveLength(1);
    expect(store.automations[0]).toMatchObject({
      title: 'Daily research radar',
      schedule: 'daily-0900',
      prompt: draft.prompt,
      status: 'active',
      source: 'mindos-durable',
      permissionMode: 'read',
    });
    expect(fs.existsSync(legacyStorePath(tempHome))).toBe(false);

    const controlPlane = readJson(controlPlanePath(tempMindRoot));
    expect(controlPlane.schedules[0]).toMatchObject({
      id: store.automations[0].controlPlaneScheduleId,
      title: 'Daily research radar',
      runtimeId: 'mindos',
      status: 'enabled',
      trigger: { type: 'cron', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      target: { assistantId: 'mindos-pi', command: draft.prompt },
      policy: { permissionMode: 'read', overlap: 'skip', retry: 'once' },
    });

    const get = await GET();
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      automations: [expect.objectContaining({ id: store.automations[0].id })],
      summary: { scheduleStorePath: storePath(tempMindRoot), controlPlaneScheduleCount: 1 },
    });
  });

  it('migrates Studio legacy jobs once and preserves unrelated schedule_prompt jobs', async () => {
    const externalJob = {
      id: 'upstream-job',
      name: 'Upstream job',
      schedule: '0 * * * * *',
      prompt: 'Keep this external job',
      enabled: true,
      type: 'cron',
      createdAt: '2026-06-30T00:00:00.000Z',
      runCount: 0,
    };
    writeScheduleStore(tempHome, [
      externalJob,
      {
        id: 'studio-legacy-radar',
        name: 'Legacy radar',
        schedule: '0 0 9 * * *',
        prompt: 'Legacy Studio job',
        enabled: true,
        type: 'cron',
        createdAt: '2026-06-30T00:00:00.000Z',
        runCount: 2,
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
    ]);

    const { GET, POST } = await importRoute();
    const initial = await GET();
    await expect(initial.json()).resolves.toMatchObject({
      automations: [expect.objectContaining({
        id: 'studio-legacy-radar',
        source: 'mindos-durable',
        runCount: 2,
      })],
      summary: { migratedLegacyJobs: 1, externalSchedulePromptJobs: 1 },
    });
    expect(readJson(legacyStorePath(tempHome)).jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'upstream-job', enabled: true }),
      expect.objectContaining({ id: 'studio-legacy-radar', enabled: false }),
    ]));

    const create = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', draft: { ...draft, title: 'Release sweep', scope: 'worktree', schedule: 'weekly-review' } }),
    }));
    const created = await create.json();
    expect(create.status, JSON.stringify(created)).toBe(201);
    expect(created.summary.externalSchedulePromptJobs).toBe(1);

    const store = readJson(storePath(tempMindRoot));
    expect(store.automations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'studio-legacy-radar', title: 'Legacy radar' }),
      expect.objectContaining({ title: 'Release sweep', schedule: 'weekly-review' }),
    ]));
    expect(readJson(legacyStorePath(tempHome)).jobs).toHaveLength(2);
  });

  it('updates, pauses, and deletes Studio jobs without losing paused state before deletion', async () => {
    const { POST } = await importRoute();
    const create = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', draft }),
    }));
    const created = await create.json();
    const id = created.automations[0].id;
    const scheduleId = created.automations[0].controlPlaneScheduleId;

    const pause = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'set-status', id, status: 'paused' }),
    }));
    const paused = await pause.json();
    expect(pause.status, JSON.stringify(paused)).toBe(200);
    expect(paused.automations[0]).toMatchObject({ id, status: 'paused', nextRun: 'Paused' });
    expect(readJson(storePath(tempMindRoot)).automations[0]).toMatchObject({ id, status: 'paused' });
    expect(readJson(controlPlanePath(tempMindRoot)).schedules[0]).toMatchObject({ id: scheduleId, status: 'paused' });

    const update = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update',
        id,
        draft: { ...draft, title: 'Release signal sweep', schedule: 'every-4-hours', model: 'claude-code' },
      }),
    }));
    const updated = await update.json();
    expect(update.status, JSON.stringify(updated)).toBe(200);
    expect(updated.automations[0]).toMatchObject({
      id,
      title: 'Release signal sweep',
      status: 'paused',
      schedule: 'every-4-hours',
      model: 'claude-code',
    });
    expect(readJson(storePath(tempMindRoot)).automations[0]).toMatchObject({
      id,
      title: 'Release signal sweep',
      schedule: 'every-4-hours',
      status: 'paused',
    });

    const remove = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id }),
    }));
    const removed = await remove.json();
    expect(remove.status, JSON.stringify(removed)).toBe(200);
    expect(removed.automations).toEqual([]);
    expect(readJson(storePath(tempMindRoot)).automations).toEqual([]);
    expect(readJson(controlPlanePath(tempMindRoot)).schedules[0]).toMatchObject({ id: scheduleId, status: 'archived' });
  });

  it('queues run-now for the independent executor without running work inside the request', async () => {
    const { POST } = await importRoute();
    const create = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', draft: { ...draft, schedule: 'manual' } }),
    }));
    const created = await create.json();
    const id = created.automations[0].id;

    const run = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'run-now', id }),
    }));
    const body = await run.json();
    expect(run.status, JSON.stringify(body)).toBe(202);
    expect(body).toMatchObject({
      automations: [expect.objectContaining({ id, lastStatus: 'pending' })],
    });
  });

  it('returns run-now without waiting for the durable worker to finish', async () => {
    const { POST } = await importRoute();
    const create = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', draft: { ...draft, schedule: 'manual' } }),
    }));
    const created = await create.json();
    const responsePromise = POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'run-now', id: created.automations[0].id }),
    })).then((response) => ({ kind: 'response' as const, response }));
    const outcome = await Promise.race([
      responsePromise,
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 50)),
    ]);

    expect(outcome.kind).toBe('response');
    if (outcome.kind === 'response') expect(outcome.response.status).toBe(202);
  });
});
