import { describe, it, expect } from 'vitest';
import { handleMcpAgentsGet, type MindosMcpAgentProfile } from './mcp-agents.js';

async function profile(status: number | Error, transport = 'http') {
  const response = await handleMcpAgentsGet({
    agents: { cursor: { name: 'Cursor', global: '~/.cursor/mcp.json', project: null, key: 'mcpServers', preferredTransport: 'stdio' } },
    detectAgentPresence: () => true,
    detectInstalled: () => ({ installed: true, transport, url: 'https://example.com/mcp' }),
    pathExists: () => false,
    fetchHead: async () => { if (status instanceof Error) throw status; return { status }; },
    now: () => new Date('2026-09-12T00:00:00Z'),
  });
  return (response.body as { agents: MindosMcpAgentProfile[] }).agents[0]!;
}

describe('configuration presence and endpoint evidence are independent', () => {
  it.each([401, 403])('keeps saved configuration when endpoint requires authorization (%s)', async status => {
    expect(await profile(status)).toMatchObject({ installed: true, connection: { status: 'auth-required', checkedAt: '2026-09-12T00:00:00.000Z' } });
  });
  it.each([500, new Error('offline')])('keeps saved configuration when endpoint is unavailable (%s)', async status => {
    expect(await profile(status)).toMatchObject({ installed: true, connection: { status: 'unreachable' } });
  });
  it('reports HTTP reachability without claiming an Agent handshake', async () => {
    expect(await profile(200)).toMatchObject({ connection: { status: 'reachable' } });
  });
  it('does not consider HEAD 405 or a stdio config a verified connection', async () => {
    expect(await profile(405)).toMatchObject({ connection: { status: 'unverified' } });
    expect(await profile(200, 'stdio')).toMatchObject({ connection: { status: 'unverified' } });
  });
});
