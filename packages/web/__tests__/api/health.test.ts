import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '@/app/api/health/route';
import { resetRuntimeAuthConfigCacheForTests } from '@/lib/runtime-auth-config';

describe('GET /api/health', () => {
  const originalHome = process.env.HOME;
  const originalWebPassword = process.env.WEB_PASSWORD;
  let tempHome = '';

  function writeConfig(config: Record<string, unknown>) {
    const dir = path.join(tempHome, '.mindos');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), 'utf-8');
    resetRuntimeAuthConfigCacheForTests();
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-health-auth-'));
    process.env.HOME = tempHome;
    delete process.env.WEB_PASSWORD;
    resetRuntimeAuthConfigCacheForTests();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalWebPassword === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = originalWebPassword;
    if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
    resetRuntimeAuthConfigCacheForTests();
  });

  it('reports persisted Web password protection when WEB_PASSWORD is not set', async () => {
    writeConfig({ webPassword: 'persisted-secret', webSessionSecret: 'persisted-session-secret' });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: 'mindos',
      authRequired: true,
    });
  });

  it('reports unprotected when neither env nor persisted Web password exists', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: 'mindos',
      authRequired: false,
    });
  });
});
