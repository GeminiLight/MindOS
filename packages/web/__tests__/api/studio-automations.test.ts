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

function storePath(home: string) {
  return path.join(home, '.mindos', 'schedule-prompts.json');
}

function controlPlanePath(mindRoot: string) {
  return path.join(mindRoot, '.mindos', 'runtime-control-plane.json');
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as any;
}

function writeScheduleStore(home: string, jobs: any[]) {
  fs.mkdirSync(path.dirname(storePath(home)), { recursive: true });
  fs.writeFileSync(storePath(home), JSON.stringify({ jobs, version: 1 }, null, 2), 'utf-8');
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
  it('creates Studio automations in the real Pi schedule store and control plane', async () => {
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
          source: 'schedule-prompt',
          status: 'active',
          schedule: 'daily-0900',
          lastStatus: 'pending',
        }),
      ],
      summary: {
        total: 1,
        enabled: 1,
        paused: 0,
        externalSchedulePromptJobs: 0,
      },
    });

    const store = readJson(storePath(tempHome));
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0]).toMatchObject({
      name: 'Daily research radar',
      schedule: '0 0 9 * * *',
      prompt: draft.prompt,
      enabled: true,
      type: 'cron',
      mindos: {
        schemaVersion: 1,
        source: 'mindos-studio-automation',
        scope: 'mind',
        studioSchedule: 'daily-0900',
        model: 'mindos-auto',
        effort: 'high',
      },
    });

    const controlPlane = readJson(controlPlanePath(tempMindRoot));
    expect(controlPlane.schedules[0]).toMatchObject({
      id: store.jobs[0].mindos.controlPlaneScheduleId,
      title: 'Daily research radar',
      runtimeId: 'mindos',
      status: 'enabled',
      trigger: { type: 'cron', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
      target: { assistantId: 'mindos-pi', command: draft.prompt },
      policy: { permissionMode: 'auto', overlap: 'skip', retry: 'once' },
    });

    const get = await GET();
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      automations: [expect.objectContaining({ id: store.jobs[0].id })],
      summary: { scheduleStorePath: storePath(tempHome), controlPlaneScheduleCount: 1 },
    });
  });

  it('preserves non-Studio schedule_prompt jobs while managing only Studio-owned jobs', async () => {
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
    writeScheduleStore(tempHome, [externalJob]);

    const { GET, POST } = await importRoute();
    const initial = await GET();
    await expect(initial.json()).resolves.toMatchObject({
      automations: [],
      summary: { externalSchedulePromptJobs: 1 },
    });

    const create = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', draft: { ...draft, title: 'Release sweep', scope: 'worktree', schedule: 'weekly-review' } }),
    }));
    const created = await create.json();
    expect(create.status, JSON.stringify(created)).toBe(201);
    expect(created.summary.externalSchedulePromptJobs).toBe(1);

    const store = readJson(storePath(tempHome));
    expect(store.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'upstream-job', prompt: 'Keep this external job' }),
      expect.objectContaining({ name: 'Release sweep', schedule: '0 30 17 * * 5' }),
    ]));
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
    expect(readJson(storePath(tempHome)).jobs[0]).toMatchObject({ id, enabled: false });
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
    expect(readJson(storePath(tempHome)).jobs[0]).toMatchObject({
      id,
      name: 'Release signal sweep',
      schedule: '0 0 */4 * * *',
      enabled: false,
    });

    const remove = await POST(new Request('http://localhost/api/studio/automations', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id }),
    }));
    const removed = await remove.json();
    expect(remove.status, JSON.stringify(removed)).toBe(200);
    expect(removed.automations).toEqual([]);
    expect(readJson(storePath(tempHome)).jobs).toEqual([]);
    expect(readJson(controlPlanePath(tempMindRoot)).schedules[0]).toMatchObject({ id: scheduleId, status: 'archived' });
  });
});
