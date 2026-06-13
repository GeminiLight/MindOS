import { describe, expect, it } from 'vitest';
import { resolveChannelListStatus } from '@/lib/im/display';
import type { PlatformStatus } from '@/lib/im/platforms';

describe('resolveChannelListStatus', () => {
  it('classifies missing status as unconfigured', () => {
    expect(resolveChannelListStatus(undefined)).toBe('unconfigured');
  });

  it('classifies connected status as configured', () => {
    expect(resolveChannelListStatus({ platform: 'telegram', connected: true, capabilities: [] })).toBe('configured');
  });

  it('classifies ready long-connection webhook as running', () => {
    const status: PlatformStatus = {
      platform: 'feishu',
      connected: true,
      capabilities: ['text'],
      webhook: { state: 'ready', transport: 'long_connection' },
    };
    expect(resolveChannelListStatus(status)).toBe('running');
  });

  it('classifies configured-but-failing status as issue', () => {
    expect(resolveChannelListStatus({ platform: 'discord', connected: false, capabilities: [] })).toBe('issue');
    expect(resolveChannelListStatus({
      platform: 'feishu',
      connected: true,
      capabilities: [],
      webhook: { state: 'error' },
    })).toBe('issue');
  });
});
