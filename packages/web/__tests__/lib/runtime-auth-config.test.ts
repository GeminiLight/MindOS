import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRuntimeAuthConfig, resetRuntimeAuthConfigCacheForTests } from '@/lib/runtime-auth-config';

describe('readRuntimeAuthConfig', () => {
  const originalHome = process.env.HOME;
  const originalWebPassword = process.env.WEB_PASSWORD;
  const originalAuthToken = process.env.AUTH_TOKEN;
  let tempHome = '';

  function configPath() {
    return path.join(tempHome, '.mindos', 'config.json');
  }

  function writeRawConfig(raw: string) {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), raw, 'utf-8');
    resetRuntimeAuthConfigCacheForTests();
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-runtime-auth-'));
    process.env.HOME = tempHome;
    delete process.env.WEB_PASSWORD;
    delete process.env.AUTH_TOKEN;
    resetRuntimeAuthConfigCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalWebPassword === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = originalWebPassword;
    if (originalAuthToken === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = originalAuthToken;
    fs.rmSync(tempHome, { recursive: true, force: true });
    resetRuntimeAuthConfigCacheForTests();
  });

  it('reads persisted credentials from a valid config.json', () => {
    writeRawConfig(JSON.stringify({ authToken: 'tok', webPassword: 'pw', webSessionSecret: 'sess' }));

    const config = readRuntimeAuthConfig();

    expect(config).toMatchObject({ authToken: 'tok', webPassword: 'pw', webSessionSecret: 'sess', configUnreadable: false });
  });

  it('treats a missing config.json as "no auth configured" rather than unreadable', () => {
    const config = readRuntimeAuthConfig();

    expect(config.authToken).toBeUndefined();
    expect(config.webPassword).toBeUndefined();
    expect(config.configUnreadable).toBe(false);
  });

  it('fails closed when config.json is truncated and warns only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeRawConfig('{"authToken":"tok","webPassword":"pw","webSess');

    const first = readRuntimeAuthConfig();
    const second = readRuntimeAuthConfig();

    expect(first).toMatchObject({ authToken: undefined, webPassword: undefined, configUnreadable: true });
    expect(second.configUnreadable).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('config.json');
  });

  it('recovers once the truncated config.json is repaired', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeRawConfig('{"webPassword":"pw"');
    expect(readRuntimeAuthConfig().configUnreadable).toBe(true);

    writeRawConfig(JSON.stringify({ webPassword: 'pw' }));

    expect(readRuntimeAuthConfig()).toMatchObject({ webPassword: 'pw', configUnreadable: false });
  });

  it('keeps explicit environment credentials while still flagging the unreadable file', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeRawConfig('not json at all');
    process.env.WEB_PASSWORD = 'env-pw';
    process.env.AUTH_TOKEN = 'env-token';

    const config = readRuntimeAuthConfig();

    expect(config.webPassword).toBe('env-pw');
    expect(config.authToken).toBe('env-token');
    expect(config.configUnreadable).toBe(true);
  });
});
