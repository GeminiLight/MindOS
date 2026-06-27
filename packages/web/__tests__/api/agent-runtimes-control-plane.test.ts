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
  return await import('../../app/api/agent-runtimes/control-plane/route');
}

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-web-control-plane-'));
  mocks.mindRoot = tempRoot;
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('GET/POST /api/agent-runtimes/control-plane', () => {
  it('persists runtime backend primitives through the Web route adapter', async () => {
    const { GET, POST } = await importRoute();
    const create = await POST(new Request('http://localhost/api/agent-runtimes/control-plane', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create-schedule',
        schedule: {
          id: 'weekly-wiki-health',
          title: 'Weekly wiki health',
          runtimeId: 'mindos',
          trigger: { type: 'cron', cron: '@weekly' },
          inputSummary: 'Run with token=must-not-leak.',
        },
      }),
    }));
    const created = await create.json();

    expect(create.status, JSON.stringify(created)).toBe(201);
    expect(created).toMatchObject({
      ok: true,
      action: 'create-schedule',
      item: {
        id: 'weekly-wiki-health',
        status: 'disabled',
        trigger: { type: 'cron', cron: '@weekly' },
        inputSummary: 'Run with token=[redacted]',
      },
    });

    const response = await GET(new Request('http://localhost/api/agent-runtimes/control-plane?runtime=mindos'));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      schedules: [expect.objectContaining({ id: 'weekly-wiki-health' })],
      summary: { scheduleCount: 1 },
    });
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
  });

  it('returns a stable 400 response for invalid JSON and unsupported actions', async () => {
    const { POST } = await importRoute();
    const invalidJson = await POST(new Request('http://localhost/api/agent-runtimes/control-plane', {
      method: 'POST',
      body: '{',
    }));
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({ error: 'invalid JSON' });

    const unsupported = await POST(new Request('http://localhost/api/agent-runtimes/control-plane', {
      method: 'POST',
      body: JSON.stringify({ action: 'run-now' }),
    }));
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toEqual({
      error: 'Unsupported runtime control-plane action: run-now',
    });
  });
});
