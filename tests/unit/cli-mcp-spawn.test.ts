import { describe, it, expect } from 'vitest';

/**
 * `mindos start` spawns the MCP HTTP server through mcp-spawn.js. The server
 * only enforces bearer auth when AUTH_TOKEN is set, so the launcher must never
 * hand it a LAN bind host without a token (mirrors
 * packages/mindos/src/protocols/mcp-server/http-security.ts).
 */

async function importMcpSpawn() {
  return await import('../../packages/mindos/bin/lib/mcp-spawn.js');
}

describe('mcp-spawn.js resolveMcpBindHost', () => {
  it('defaults to loopback without a token and to 0.0.0.0 with one', async () => {
    const { resolveMcpBindHost } = await importMcpSpawn();
    expect(resolveMcpBindHost(undefined, undefined)).toEqual({ host: '127.0.0.1', forcedLoopback: false });
    expect(resolveMcpBindHost('', '')).toEqual({ host: '127.0.0.1', forcedLoopback: false });
    expect(resolveMcpBindHost(undefined, 'tok')).toMatchObject({ host: '0.0.0.0', forcedLoopback: false });
  });

  it('forces a requested LAN host back to loopback when no token is configured', async () => {
    const { resolveMcpBindHost } = await importMcpSpawn();
    expect(resolveMcpBindHost('0.0.0.0', undefined)).toEqual({ host: '127.0.0.1', forcedLoopback: true, requestedHost: '0.0.0.0' });
    expect(resolveMcpBindHost('192.168.1.5', '')).toMatchObject({ host: '127.0.0.1', forcedLoopback: true });
    expect(resolveMcpBindHost('::', null)).toMatchObject({ host: '127.0.0.1', forcedLoopback: true });
  });

  it('keeps loopback aliases and honours the requested host once a token exists', async () => {
    const { resolveMcpBindHost } = await importMcpSpawn();
    expect(resolveMcpBindHost('localhost', undefined)).toMatchObject({ host: 'localhost', forcedLoopback: false });
    expect(resolveMcpBindHost('[::1]', undefined)).toMatchObject({ host: '[::1]', forcedLoopback: false });
    expect(resolveMcpBindHost('0.0.0.0', 'tok')).toMatchObject({ host: '0.0.0.0', forcedLoopback: false });
    expect(resolveMcpBindHost('10.0.0.9', 'tok')).toMatchObject({ host: '10.0.0.9', forcedLoopback: false });
  });
});
