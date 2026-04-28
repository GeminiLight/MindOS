import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const channelAdd = vi.fn();
const channelList = vi.fn();
const channelRemove = vi.fn();
const channelVerify = vi.fn();
const closePrompts = vi.fn();
const promptHidden = vi.fn();
const promptConfirm = vi.fn();

vi.mock('../../../packages/mindos/bin/lib/channel-mgmt.js', () => ({
  channelAdd,
  channelList,
  channelRemove,
  channelVerify,
  formatPlatformStatus: () => '✔',
  getPlatformEmoji: () => '✈️',
}));

vi.mock('../../../packages/mindos/bin/lib/channel-prompts.js', () => ({
  promptHidden,
  promptConfirm,
  closePrompts,
}));

describe('channel command --env mode', () => {
  const originalEnv = process.env;
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads credentials from environment instead of prompting', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    channelAdd.mockResolvedValue({ ok: true, message: 'saved', details: {} });

    const { run } = await import('../../../packages/mindos/bin/commands/channel.js');
    await run(['add', 'telegram'], { env: true });

    expect(promptHidden).not.toHaveBeenCalled();
    expect(channelAdd).toHaveBeenCalledWith(
      'telegram',
      { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
      { skipVerify: false },
    );
    expect(closePrompts).toHaveBeenCalled();
  });

  it('loads alternate wecom env credentials without prompting', async () => {
    process.env.WECOM_WEBHOOK_KEY = 'robot-webhook-key';
    channelAdd.mockResolvedValue({ ok: true, message: 'saved', details: {} });

    const { run } = await import('../../../packages/mindos/bin/commands/channel.js');
    await run(['add', 'wecom'], { env: true });

    expect(promptHidden).not.toHaveBeenCalled();
    expect(channelAdd).toHaveBeenCalledWith(
      'wecom',
      { webhook_key: 'robot-webhook-key' },
      { skipVerify: false },
    );
    expect(closePrompts).toHaveBeenCalled();
  });

  it('fails fast when required env var is missing', async () => {
    const { run } = await import('../../../packages/mindos/bin/commands/channel.js');
    await run(['add', 'telegram'], { env: true });

    expect(channelAdd).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(closePrompts).toHaveBeenCalled();
  });
});
