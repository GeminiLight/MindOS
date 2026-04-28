import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome;
let savedHome;
let savedUserProfile;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-channel-mgmt-'));
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  vi.resetModules();
});

afterEach(() => {
  process.env.HOME = savedHome;
  process.env.USERPROFILE = savedUserProfile;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('channel management business logic', () => {
  it('lists incomplete and configured providers distinctly', async () => {
    const { writeChannelConfig } = await import('../../../packages/mindos/bin/lib/channel-config.js');
    writeChannelConfig({
      providers: {
        telegram: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
        feishu: { app_id: 'cli_a1b2c3' },
      },
    });

    const { channelList } = await import('../../../packages/mindos/bin/lib/channel-mgmt.js');
    const result = await channelList();

    expect(result.platforms.find((item) => item.platform === 'telegram')?.status).toBe('configured');
    expect(result.platforms.find((item) => item.platform === 'feishu')?.status).toBe('incomplete');
  });

  it('removes an existing provider from config', async () => {
    const { channelAdd, channelRemove } = await import('../../../packages/mindos/bin/lib/channel-mgmt.js');
    await channelAdd('telegram', { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' }, { skipVerify: true });

    const removed = await channelRemove('telegram');
    expect(removed.ok).toBe(true);

    const configPath = path.join(fakeHome, '.mindos', 'im.json');
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(onDisk.providers.telegram).toBeUndefined();
  });

  it('accepts wecom alternate credential sets', async () => {
    const { channelAdd } = await import('../../../packages/mindos/bin/lib/channel-mgmt.js');

    const webhookMode = await channelAdd('wecom', { webhook_key: 'robot_webhook_key' }, { skipVerify: true });
    expect(webhookMode.ok).toBe(true);

    const corpMode = await channelAdd('wecom', { corp_id: 'wxcorp', corp_secret: 'corp-secret' }, { skipVerify: true });
    expect(corpMode.ok).toBe(true);
  });

  it('accepts dingtalk alternate credential sets', async () => {
    const { channelAdd } = await import('../../../packages/mindos/bin/lib/channel-mgmt.js');

    const webhookMode = await channelAdd('dingtalk', { webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=abc' }, { skipVerify: true });
    expect(webhookMode.ok).toBe(true);

    const appMode = await channelAdd('dingtalk', { client_id: 'ding-app', client_secret: 'ding-secret' }, { skipVerify: true });
    expect(appMode.ok).toBe(true);
  });
});
