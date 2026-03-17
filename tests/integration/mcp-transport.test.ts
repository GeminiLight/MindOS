/**
 * MCP Transport Connectivity Test
 *
 * Pre-release smoke test: verifies both HTTP and stdio MCP transports
 * can initialize and execute a tool call (mindos_list_files).
 *
 * Prerequisites:
 *   - App server running at MINDOS_URL (default http://localhost:3456)
 *   - `npx tsx` available (mcp/ dev dependency)
 *
 * Run:
 *   cd tests/integration && npx vitest run mcp-transport.test.ts
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { createConnection, Socket } from 'net';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const APP_URL = process.env.MINDOS_URL ?? 'http://localhost:3456';

// Read AUTH_TOKEN from env or config file (same as bin/lib/config.js)
function resolveAuthToken(): string {
  if (process.env.AUTH_TOKEN) return process.env.AUTH_TOKEN;
  try {
    const configPath = join(homedir(), '.mindos', 'config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return config.authToken || '';
    }
  } catch {}
  return '';
}

const AUTH_TOKEN = resolveAuthToken();
const MCP_SRC = join(__dirname, '../../mcp/src/index.ts');
const TSX_BIN = join(__dirname, '../../mcp/node_modules/.bin/tsx');

// Track spawned processes for cleanup
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
});

/** Find a free port by briefly listening on :0 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = require('net').createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** JSON-RPC 2.0 request factory */
function jsonrpc(method: string, params: Record<string, unknown>, id: number) {
  return { jsonrpc: '2.0', method, params, id };
}

/** Wait until a TCP port accepts connections (max waitMs) */
async function waitForPort(port: number, waitMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock: Socket = createConnection({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Port ${port} not ready after ${waitMs}ms`);
}

// ─── HTTP Transport ─────────────────────────────────────────────────────────

describe('MCP HTTP transport', () => {
  let mcpPort: number;
  let proc: ChildProcess;

  it('initializes and lists tools via Streamable HTTP', async () => {
    mcpPort = await getFreePort();

    proc = spawn(TSX_BIN, [MCP_SRC], {
      env: {
        ...process.env,
        MCP_TRANSPORT: 'http',
        MCP_PORT: String(mcpPort),
        MCP_HOST: '127.0.0.1',
        MINDOS_URL: APP_URL,
        AUTH_TOKEN,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(proc);

    // Collect stderr for debugging
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    await waitForPort(mcpPort);

    const endpoint = `http://127.0.0.1:${mcpPort}/mcp`;

    // Build auth headers — MCP HTTP server checks Bearer token when AUTH_TOKEN is set
    const authHeader: Record<string, string> = AUTH_TOKEN
      ? { Authorization: `Bearer ${AUTH_TOKEN}` }
      : {};

    // 1. Initialize
    const initRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...authHeader },
      body: JSON.stringify(jsonrpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }, 1)),
    });

    // Streamable HTTP may return SSE or JSON
    const contentType = initRes.headers.get('content-type') ?? '';
    let initResult: Record<string, unknown>;

    if (contentType.includes('text/event-stream')) {
      // Parse SSE: find the "data:" line with JSON-RPC response
      const text = await initRes.text();
      const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
      expect(dataLine).toBeDefined();
      initResult = JSON.parse(dataLine!.replace('data: ', ''));
    } else {
      initResult = await initRes.json() as Record<string, unknown>;
    }

    expect(initResult).toHaveProperty('result');
    const result = initResult.result as Record<string, unknown>;
    expect(result).toHaveProperty('serverInfo');
    expect((result.serverInfo as Record<string, string>).name).toBe('mindos-mcp-server');

    // Extract session ID from response header (Mcp-Session-Id)
    const sessionId = initRes.headers.get('mcp-session-id');

    // 2. Send initialized notification
    const notifHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...authHeader,
    };
    if (sessionId) notifHeaders['Mcp-Session-Id'] = sessionId;

    await fetch(endpoint, {
      method: 'POST',
      headers: notifHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // 3. List tools
    const toolsHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...authHeader,
    };
    if (sessionId) toolsHeaders['Mcp-Session-Id'] = sessionId;

    const toolsRes = await fetch(endpoint, {
      method: 'POST',
      headers: toolsHeaders,
      body: JSON.stringify(jsonrpc('tools/list', {}, 2)),
    });

    const toolsCt = toolsRes.headers.get('content-type') ?? '';
    let toolsResult: Record<string, unknown>;

    if (toolsCt.includes('text/event-stream')) {
      const text = await toolsRes.text();
      const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
      toolsResult = JSON.parse(dataLine!.replace('data: ', ''));
    } else {
      toolsResult = await toolsRes.json() as Record<string, unknown>;
    }

    expect(toolsResult).toHaveProperty('result');
    const toolsList = (toolsResult.result as Record<string, unknown>).tools as Array<{ name: string }>;
    expect(toolsList.length).toBeGreaterThan(10);

    // Verify known tools exist
    const toolNames = toolsList.map((t) => t.name);
    expect(toolNames).toContain('mindos_list_files');
    expect(toolNames).toContain('mindos_read_file');
    expect(toolNames).toContain('mindos_search_notes');
    expect(toolNames).toContain('mindos_bootstrap');

    // Cleanup
    proc.kill('SIGTERM');
  }, 20_000);
});

// ─── stdio Transport ────────────────────────────────────────────────────────

describe('MCP stdio transport', () => {
  it('initializes and lists tools via stdio', async () => {
    const proc = spawn(TSX_BIN, [MCP_SRC], {
      env: {
        ...process.env,
        MCP_TRANSPORT: 'stdio',
        MINDOS_URL: APP_URL,
        AUTH_TOKEN,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(proc);

    // Collect stderr for debugging
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    // Helper: send JSON-RPC over stdin and read response from stdout
    function sendAndReceive(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('stdio response timeout')), 10_000);
        let buf = '';

        const onData = (chunk: Buffer) => {
          buf += chunk.toString();
          // JSON-RPC over stdio uses newline-delimited JSON
          const lines = buf.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              // Match by id (skip notifications which have no id)
              if (parsed.id === msg.id) {
                clearTimeout(timeout);
                proc.stdout?.off('data', onData);
                resolve(parsed);
                return;
              }
            } catch {
              // incomplete JSON, keep buffering
            }
          }
        };

        proc.stdout?.on('data', onData);
        proc.stdin?.write(JSON.stringify(msg) + '\n');
      });
    }

    // 1. Initialize
    const initRes = await sendAndReceive(jsonrpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, 1));

    expect(initRes).toHaveProperty('result');
    const result = initRes.result as Record<string, unknown>;
    expect(result).toHaveProperty('serverInfo');
    expect((result.serverInfo as Record<string, string>).name).toBe('mindos-mcp-server');

    // 2. Send initialized notification (no response expected)
    proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    // Small delay for notification processing
    await new Promise((r) => setTimeout(r, 200));

    // 3. List tools
    const toolsRes = await sendAndReceive(jsonrpc('tools/list', {}, 2));

    expect(toolsRes).toHaveProperty('result');
    const toolsList = (toolsRes.result as Record<string, unknown>).tools as Array<{ name: string }>;
    expect(toolsList.length).toBeGreaterThan(10);

    const toolNames = toolsList.map((t) => t.name);
    expect(toolNames).toContain('mindos_list_files');
    expect(toolNames).toContain('mindos_read_file');
    expect(toolNames).toContain('mindos_search_notes');
    expect(toolNames).toContain('mindos_bootstrap');

    // Cleanup
    proc.kill('SIGTERM');
  }, 20_000);
});

// ─── Tool Call (requires running App server) ────────────────────────────────

describe('MCP tool call via stdio', () => {
  it('calls mindos_list_files and gets response', async () => {
    const proc = spawn(TSX_BIN, [MCP_SRC], {
      env: {
        ...process.env,
        MCP_TRANSPORT: 'stdio',
        MINDOS_URL: APP_URL,
        AUTH_TOKEN,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(proc);

    let buf = '';
    function sendAndReceive(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('stdio response timeout')), 10_000);

        const onData = (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          // Keep the last incomplete line in buffer
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.id === msg.id) {
                clearTimeout(timeout);
                proc.stdout?.off('data', onData);
                resolve(parsed);
                return;
              }
            } catch { /* incomplete */ }
          }
        };

        proc.stdout?.on('data', onData);
        proc.stdin?.write(JSON.stringify(msg) + '\n');
      });
    }

    // Initialize
    await sendAndReceive(jsonrpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, 1));

    proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise((r) => setTimeout(r, 200));

    // Call mindos_list_files — this actually hits the App API
    const callRes = await sendAndReceive(jsonrpc('tools/call', {
      name: 'mindos_list_files',
      arguments: { response_format: 'json' },
    }, 3));

    expect(callRes).toHaveProperty('result');
    const callResult = callRes.result as Record<string, unknown>;
    expect(callResult).toHaveProperty('content');
    const content = callResult.content as Array<{ type: string; text: string }>;
    expect(content.length).toBeGreaterThan(0);
    expect(content[0].type).toBe('text');
    // Should contain file listing (non-empty KB)
    expect(content[0].text.length).toBeGreaterThan(0);

    proc.kill('SIGTERM');
  }, 20_000);
});
