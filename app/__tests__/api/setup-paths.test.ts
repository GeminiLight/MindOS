import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

let fakeHome: string;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-setup-home-'));
  fs.mkdirSync(path.join(fakeHome, 'Documents'), { recursive: true });
  fs.mkdirSync(path.join(fakeHome, 'Projects'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, '.hidden'), 'secret', 'utf-8');

  vi.resetModules();
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    return {
      ...actual,
      homedir: () => fakeHome,
    };
  });
});

afterEach(() => {
  vi.doUnmock('node:os');
  vi.restoreAllMocks();
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

async function importCheckPathRoute() {
  return await import('../../app/api/setup/check-path/route');
}

async function importLsRoute() {
  return await import('../../app/api/setup/ls/route');
}

describe('setup path normalization', () => {
  it('treats bare tilde as the home directory in check-path', async () => {
    const { POST } = await importCheckPathRoute();
    const req = new NextRequest('http://localhost/api/setup/check-path', {
      method: 'POST',
      body: JSON.stringify({ path: '~' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.empty).toBe(false);
    expect(body.count).toBe(2);
  });

  it('keeps ls and check-path consistent for bare tilde', async () => {
    const { POST: listDirs } = await importLsRoute();
    const { POST: checkPath } = await importCheckPathRoute();

    const lsReq = new NextRequest('http://localhost/api/setup/ls', {
      method: 'POST',
      body: JSON.stringify({ path: '~' }),
      headers: { 'content-type': 'application/json' },
    });
    const checkReq = new NextRequest('http://localhost/api/setup/check-path', {
      method: 'POST',
      body: JSON.stringify({ path: '~' }),
      headers: { 'content-type': 'application/json' },
    });

    const lsRes = await listDirs(lsReq);
    const checkRes = await checkPath(checkReq);
    const lsBody = await lsRes.json();
    const checkBody = await checkRes.json();

    expect(lsBody.dirs).toEqual(['Documents', 'Projects']);
    expect(checkBody.exists).toBe(true);
    expect(checkBody.count).toBe(lsBody.dirs.length);
  });
});
