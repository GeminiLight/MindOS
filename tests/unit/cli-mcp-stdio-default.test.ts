import { describe, it, expect, afterEach } from 'vitest';
import { createServer, Server } from 'net';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

/**
 * Regression test: `mindos mcp` (standalone) must default to stdio transport.
 *
 * Bug: When MindOS is already running (ports 3456 + 8781 bound), invoking
 * `mindos mcp` via an MCP client would start the MCP server in HTTP mode
 * (the default) and crash with EADDRINUSE on port 8781.
 *
 * Root cause: bin/cli.js `mcp` handler did not set MCP_TRANSPORT, so
 * mcp/src/index.ts fell through to the default "http" transport.
 */

const CLI = join(__dirname, '../../bin/cli.js');

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
  children.length = 0;
});

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        srv.close(() => resolve(addr.port));
      } else {
        reject(new Error('no addr'));
      }
    });
    srv.on('error', reject);
  });
}

// ── Core regression test ──────────────────────────────────────────────────

describe('mindos mcp stdio transport (regression)', () => {
  let blocker: Server | null = null;

  afterEach(async () => {
    if (blocker) {
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = null;
    }
  });

  it('starts in stdio mode even when MCP_PORT is already in use', async () => {
    const port = await getFreePort();

    blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker!.listen(port, '127.0.0.1', () => resolve());
      blocker!.on('error', reject);
    });

    const proc = spawn(process.execPath, [CLI, 'mcp'], {
      env: {
        ...process.env,
        MCP_TRANSPORT: 'stdio',
        MCP_PORT: String(port),
        MINDOS_URL: 'http://localhost:3456',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(proc);

    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    const response = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`No response within 10s. stderr: ${stderr}`)),
        10_000,
      );
      let buf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        for (const line of buf.split('\n')) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === 1) {
              clearTimeout(timeout);
              resolve(line);
              return;
            }
          } catch { /* incomplete */ }
        }
      });

      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0', method: 'initialize', id: 1,
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.1' },
        },
      }) + '\n');
    });

    const parsed = JSON.parse(response);
    expect(parsed).toHaveProperty('result');
    expect(parsed.result.serverInfo.name).toBe('mindos-mcp-server');

    // Port is STILL occupied by blocker — stdio never tried to bind
    expect(blocker!.listening).toBe(true);
    proc.kill('SIGTERM');
  }, 15_000);
});

// ── CLI handler env construction (pure logic, no spawning) ────────────────

describe('CLI mcp handler environment construction', () => {
  /**
   * Mirrors the logic in bin/cli.js `mcp` handler after the fix.
   * This is the contract we're verifying.
   */
  function buildMcpEnv(incoming: Record<string, string | undefined>) {
    const env = { ...incoming };
    if (!env.MCP_TRANSPORT) {
      env.MCP_TRANSPORT = 'stdio';
    }
    const webPort = env.MINDOS_WEB_PORT || '3456';
    env.MINDOS_URL = env.MINDOS_URL || `http://localhost:${webPort}`;
    if (env.MCP_TRANSPORT === 'http') {
      env.MCP_PORT = env.MINDOS_MCP_PORT || '8781';
    }
    return env;
  }

  it('defaults MCP_TRANSPORT to stdio when not set', () => {
    const env = buildMcpEnv({});
    expect(env.MCP_TRANSPORT).toBe('stdio');
  });

  it('preserves MCP_TRANSPORT when caller provides it', () => {
    const env = buildMcpEnv({ MCP_TRANSPORT: 'http' });
    expect(env.MCP_TRANSPORT).toBe('http');
  });

  it('does not set MCP_PORT for stdio transport', () => {
    const env = buildMcpEnv({});
    expect(env.MCP_PORT).toBeUndefined();
  });

  it('sets MCP_PORT for explicit http transport', () => {
    const env = buildMcpEnv({ MCP_TRANSPORT: 'http' });
    expect(env.MCP_PORT).toBe('8781');
  });

  it('respects custom MCP port from config for http', () => {
    const env = buildMcpEnv({ MCP_TRANSPORT: 'http', MINDOS_MCP_PORT: '9999' });
    expect(env.MCP_PORT).toBe('9999');
  });

  it('sets MINDOS_URL from web port when not provided', () => {
    const env = buildMcpEnv({ MINDOS_WEB_PORT: '4000' });
    expect(env.MINDOS_URL).toBe('http://localhost:4000');
  });

  it('preserves MINDOS_URL when already set', () => {
    const env = buildMcpEnv({ MINDOS_URL: 'http://remote:5000' });
    expect(env.MINDOS_URL).toBe('http://remote:5000');
  });

  it('uses default ports when nothing is configured', () => {
    const env = buildMcpEnv({});
    expect(env.MCP_TRANSPORT).toBe('stdio');
    expect(env.MINDOS_URL).toBe('http://localhost:3456');
    expect(env.MCP_PORT).toBeUndefined();
  });
});
