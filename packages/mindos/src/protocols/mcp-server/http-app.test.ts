import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer } from './tools.js';
import { startMcpHttpServer, type McpHttpServerHandle } from './http-app.js';

const handles: McpHttpServerHandle[] = [];

afterEach(async () => {
  while (handles.length) await handles.pop()?.close();
});

async function start(options: { authToken?: string; requestedHost?: string } = {}) {
  const handle = await startMcpHttpServer({
    requestedHost: options.requestedHost ?? '127.0.0.1',
    port: 0,
    authToken: options.authToken,
    createMcpServer,
    log: () => {},
  });
  handles.push(handle);
  return handle;
}

function jsonrpc(method: string, params: Record<string, unknown>, id: number) {
  return { jsonrpc: '2.0', method, params, id };
}

async function readJsonRpc(res: Response): Promise<Record<string, unknown>> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) throw new Error(`No SSE data line in response: ${text}`);
    return JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
  }
  return await res.json() as Record<string, unknown>;
}

const ACCEPT = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };

describe('MCP Streamable HTTP over Hono', () => {
  it('initializes a session and lists tools', async () => {
    const { url } = await start();
    const init = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: ACCEPT,
      body: JSON.stringify(jsonrpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      }, 1)),
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    const initResult = await readJsonRpc(init);
    expect((initResult.result as { serverInfo: { name: string } }).serverInfo.name).toBe('mindos-mcp-server');

    const notified = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...ACCEPT, 'Mcp-Session-Id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(notified.status).toBe(202);

    const tools = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...ACCEPT, 'Mcp-Session-Id': sessionId! },
      body: JSON.stringify(jsonrpc('tools/list', {}, 2)),
    });
    expect(tools.status).toBe(200);
    const toolsResult = await readJsonRpc(tools);
    const names = ((toolsResult.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names).toEqual(expect.arrayContaining(['mindos_list_files', 'mindos_read_file', 'mindos_search_notes', 'mindos_bootstrap']));

    const closed = await fetch(`${url}/mcp`, { method: 'DELETE', headers: { 'Mcp-Session-Id': sessionId! } });
    expect(closed.status).toBe(200);
    const gone = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...ACCEPT, 'Mcp-Session-Id': sessionId! },
      body: JSON.stringify(jsonrpc('tools/list', {}, 3)),
    });
    expect(gone.status).toBe(404);
  });

  it('exposes the health probe without auth and answers 401 on the MCP endpoint without a bearer', async () => {
    const { url } = await start({ authToken: 'mcp-secret' });
    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: 'mindos' });

    const noBearer = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: ACCEPT,
      body: JSON.stringify(jsonrpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }, 1)),
    });
    expect(noBearer.status).toBe(401);
    expect(await noBearer.json()).toEqual({ error: 'Unauthorized' });

    const wrong = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...ACCEPT, Authorization: 'Bearer nope' },
      body: JSON.stringify(jsonrpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }, 1)),
    });
    expect(wrong.status).toBe(401);

    const ok = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...ACCEPT, Authorization: 'Bearer mcp-secret' },
      body: JSON.stringify(jsonrpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }, 1)),
    });
    expect(ok.status).toBe(200);
  });

  it('rejects non-initialize requests without a session id before allocating a server', async () => {
    const { url, sessions } = await start();
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: ACCEPT,
      body: JSON.stringify(jsonrpc('tools/list', {}, 1)),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: Mcp-Session-Id header is required for non-initialize requests' },
      id: null,
    });
    expect(sessions.size).toBe(0);

    const unknown = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...ACCEPT, 'Mcp-Session-Id': 'does-not-exist' },
      body: JSON.stringify(jsonrpc('tools/list', {}, 1)),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: -32000, message: 'Session not found' } });
  });

  it('forces a loopback bind when no auth token is configured', async () => {
    const forced = await start({ requestedHost: '0.0.0.0' });
    expect(forced.bind).toEqual({ host: '127.0.0.1', forcedLoopback: true, requestedHost: '0.0.0.0' });
    expect(forced.host).toBe('127.0.0.1');
    const address = forced.server.address();
    expect(address && typeof address !== 'string' ? address.address : address).toBe('127.0.0.1');

    const plain = await start({});
    expect(plain.bind.forcedLoopback).toBe(false);
    expect(plain.host).toBe('127.0.0.1');
  });

  it('applies DNS-rebinding host validation on loopback binds', async () => {
    const { port } = await start();
    // undici may normalise a caller-supplied Host header, so speak raw HTTP.
    const spoofed = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { ...ACCEPT, Host: 'evil.example' },
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(jsonrpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }, 1)));
    });
    expect(spoofed.status).toBe(403);
    expect(JSON.parse(spoofed.body)).toMatchObject({ error: { code: -32000, message: 'Invalid Host: evil.example' } });
  });
});
