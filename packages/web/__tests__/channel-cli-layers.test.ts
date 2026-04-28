import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome: string;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-channel-home-'));
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('channel config layer', () => {
  it('keeps CLI and app validation aligned for alternative credential sets', async () => {
    const { validateChannelConfig } = await import('../../../packages/mindos/bin/lib/channel-config.js');
    const { validatePlatformConfig } = await import('@/lib/im/config');

    expect(validateChannelConfig('wecom', { webhook_key: 'abc123' })).toEqual({ valid: true });
    expect(validatePlatformConfig('wecom', { webhook_key: 'abc123' })).toEqual({ valid: true });

    expect(validateChannelConfig('wecom', { corp_id: 'wxcorp', corp_secret: 'corp-secret' })).toEqual({ valid: true });
    expect(validatePlatformConfig('wecom', { corp_id: 'wxcorp', corp_secret: 'corp-secret' })).toEqual({ valid: true });

    expect(validateChannelConfig('dingtalk', { webhook_url: 'https://example.com/hook' })).toEqual({ valid: true });
    expect(validatePlatformConfig('dingtalk', { webhook_url: 'https://example.com/hook' })).toEqual({ valid: true });

    expect(validateChannelConfig('dingtalk', { client_id: 'ding-app', client_secret: 'ding-secret' })).toEqual({ valid: true });
    expect(validatePlatformConfig('dingtalk', { client_id: 'ding-app', client_secret: 'ding-secret' })).toEqual({ valid: true });
  });

  it('rejects telegram tokens consistently in CLI and app validation', async () => {
    const { validateChannelConfig } = await import('../../../packages/mindos/bin/lib/channel-config.js');
    const { validatePlatformConfig } = await import('@/lib/im/config');

    expect(validateChannelConfig('telegram', { bot_token: 'bad-token' }).valid).toBe(false);
    expect(validatePlatformConfig('telegram', { bot_token: 'bad-token' }).valid).toBe(false);
  });

  it('writes config with optimistic mtime protection', async () => {
    const { writeChannelConfig, readChannelConfig, getChannelConfigMtime } = await import('../../../packages/mindos/bin/lib/channel-config.js');
    writeChannelConfig({ providers: { telegram: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' } } });
    const mtime = getChannelConfigMtime();

    const configPath = path.join(fakeHome, '.mindos', 'im.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ providers: { discord: { bot_token: 'abc'.repeat(10) } } }), 'utf-8');

    expect(() => {
      writeChannelConfig({ providers: { telegram: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' } } }, { expectedMtime: mtime - 1 });
    }).toThrow('Configuration changed on disk. Retry your command.');

    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(onDisk).toEqual({ providers: { discord: { bot_token: 'abc'.repeat(10) } } });
  });
});

describe('channel management layer', () => {
  it('saves config when skipVerify is enabled', async () => {
    const { channelAdd, channelVerify } = await import('../../../packages/mindos/bin/lib/channel-mgmt.js');
    const add = await channelAdd('telegram', { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' }, { skipVerify: true });
    expect(add.ok).toBe(true);
    expect(add.message).toContain('verification skipped');

    const verify = await channelVerify('telegram', { skipVerify: true });
    expect(verify.valid).toBe(true);
    expect(verify.details?.status).toBe('Format valid only');
  });

  it('does not save config when remote verification fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized: check bot_token' }),
    }));

    const { channelAdd } = await import('../../../packages/mindos/bin/lib/channel-mgmt.js');
    const result = await channelAdd('telegram', { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Use --skip-verify');

    const configPath = path.join(fakeHome, '.mindos', 'im.json');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('surfaces timeout guidance when remote verification times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })));

    const { channelAdd } = await import('../../../packages/mindos/bin/lib/channel-mgmt.js');
    const result = await channelAdd('telegram', { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Verification timed out');
    expect(result.error).toContain('Use --skip-verify');
  });
});
