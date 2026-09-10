import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleMcpInstallPost, type MindosMcpAgentDef } from './mcp-install.js';

const agents: Record<string, MindosMcpAgentDef> = {
  cursor: {
    name: 'Cursor',
    project: '.cursor/mcp.json',
    global: '~/.cursor/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.cursor/'],
  },
};

const homes: string[] = [];
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-verify-'));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

type FetchCall = { url: string; init: RequestInit };

function installWith(fetcher: (url: string, init: RequestInit) => Promise<Response>, token?: string) {
  const home = makeHome();
  return handleMcpInstallPost({
    agents: [{ key: 'cursor', scope: 'global', transport: 'http' }],
    url: 'http://127.0.0.1:8567/mcp',
    ...(token ? { token } : {}),
  }, { agents, homeDir: home, fetcher: fetcher as unknown as typeof fetch });
}

describe('http install verification handshake', () => {
  it('verifies with an MCP initialize request and a stream-capable Accept header', async () => {
    const calls: FetchCall[] = [];
    const res = await installWith(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'mindos' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, 'sekret');

    expect((res.body as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({
      status: 'ok',
      transport: 'http',
      verified: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:8567/mcp');
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.method).toBe('initialize');
    expect(body.params).toMatchObject({ capabilities: {}, clientInfo: expect.objectContaining({ name: expect.any(String) }) });
    expect(typeof (body.params as { protocolVersion: unknown }).protocolVersion).toBe('string');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Accept).toContain('application/json');
    expect(headers.Accept).toContain('text/event-stream');
    expect(headers.Authorization).toBe('Bearer sekret');
  });

  it('works against a spec-compliant server that rejects tools/list without a session', async () => {
    // Our own MCP HTTP server answers a bare tools/list with 400; initialize is
    // the only request that is valid without a session id.
    const res = await installWith(async (_url, init) => {
      const method = (JSON.parse(String(init.body)) as { method?: string }).method;
      if (method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: Missing session ID' } }), { status: 400 });
    });
    expect((res.body as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({ verified: true });
  });

  it('reports HTTP failures and network errors without failing the install', async () => {
    const http = await installWith(async () => new Response('nope', { status: 400 }));
    expect((http.body as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({
      status: 'ok',
      verified: false,
      verifyError: 'HTTP 400',
    });

    const network = await installWith(async () => { throw new Error('connect ECONNREFUSED'); });
    expect((network.body as { results: Array<Record<string, unknown>> }).results[0]).toMatchObject({
      status: 'ok',
      verified: false,
      verifyError: 'connect ECONNREFUSED',
    });
  });

  it('sends no Authorization header when the install carries no token', async () => {
    const calls: FetchCall[] = [];
    await installWith(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
