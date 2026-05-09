import { describe, expect, it } from 'vitest';

describe('mindos start host binding', () => {
  it('binds to localhost by default', async () => {
    const { resolveWebHost } = await import('../../packages/mindos/bin/commands/start.js');

    expect(resolveWebHost({}, {})).toBe('127.0.0.1');
  });

  it('binds to all interfaces only when LAN access is enabled in settings', async () => {
    const { resolveWebHost } = await import('../../packages/mindos/bin/commands/start.js');

    expect(resolveWebHost({ allowNetworkAccess: true }, {})).toBe('0.0.0.0');
    expect(resolveWebHost({ allowNetworkAccess: false }, {})).toBe('127.0.0.1');
  });

  it('keeps an explicit MINDOS_WEB_HOST override for advanced deployments', async () => {
    const { resolveWebHost } = await import('../../packages/mindos/bin/commands/start.js');

    expect(resolveWebHost({ allowNetworkAccess: false }, { MINDOS_WEB_HOST: '::' })).toBe('::');
  });
});
