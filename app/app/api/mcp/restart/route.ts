export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_PATH = resolve(homedir(), '.mindos', 'config.json');

function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return {}; }
}

/**
 * Kill process(es) listening on the given port.
 * Tries lsof first, falls back to ss + manual kill.
 */
function killByPort(port: number) {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    return;
  } catch { /* lsof not available */ }
  try {
    const output = execSync('ss -tlnp 2>/dev/null', { encoding: 'utf-8' });
    const portRe = new RegExp(`:${port}(?!\\d)`);
    for (const line of output.split('\n')) {
      if (!portRe.test(line)) continue;
      const pidMatch = line.match(/pid=(\d+)/g);
      if (pidMatch) {
        for (const m of pidMatch) {
          const pid = Number(m.slice(4));
          if (pid > 0) try { process.kill(pid, 'SIGKILL'); } catch {}
        }
      }
    }
  } catch { /* no process to kill */ }
}

/**
 * POST /api/mcp/restart — kill the MCP server process and spawn a new one.
 *
 * Unlike /api/restart which restarts the entire MindOS (Web + MCP),
 * this endpoint only restarts the MCP server. The Web UI stays up.
 *
 * When running under Desktop's ProcessManager, the crash handler
 * auto-respawns MCP when it exits. We wait for the port to free,
 * then spawn only if nothing re-bound (i.e. CLI mode with no crash
 * handler). This avoids spawning a duplicate that races for the port.
 */
export async function POST() {
  try {
    const cfg = readConfig();
    const mcpPort = Number(process.env.MINDOS_MCP_PORT) || Number(cfg.mcpPort) || 8781;
    const webPort = process.env.MINDOS_WEB_PORT || '3456';
    const authToken = process.env.AUTH_TOKEN || (cfg.authToken as string | undefined);
    const managed = process.env.MINDOS_MANAGED === '1';

    // Step 1: Kill process on MCP port
    killByPort(mcpPort);

    if (managed) {
      // Desktop ProcessManager will auto-respawn MCP via its crash handler.
      return NextResponse.json({ ok: true, port: mcpPort, note: 'ProcessManager will respawn' });
    }

    // Step 2 (CLI mode only): Wait for port to free, then spawn a new MCP
    const portFree = await waitForPortFree(mcpPort, 5000);
    if (!portFree) {
      return NextResponse.json({ error: `MCP port ${mcpPort} still in use after kill` }, { status: 500 });
    }

    const root = process.env.MINDOS_PROJECT_ROOT || resolve(process.cwd(), '..');
    const mcpDir = resolve(root, 'mcp');

    const mcpBundle = resolve(mcpDir, 'dist', 'index.cjs');
    if (!existsSync(mcpBundle)) {
      return NextResponse.json({ error: 'MCP bundle not found — reinstall @geminilight/mindos' }, { status: 500 });
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MCP_TRANSPORT: 'http',
      MCP_PORT: String(mcpPort),
      MCP_HOST: process.env.MCP_HOST || '0.0.0.0',
      MINDOS_URL: process.env.MINDOS_URL || `http://127.0.0.1:${webPort}`,
      ...(authToken ? { AUTH_TOKEN: authToken } : {}),
    };

    const child = spawn(process.execPath, [mcpBundle], {
      cwd: mcpDir,
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.unref();

    return NextResponse.json({ ok: true, pid: child.pid, port: mcpPort });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((res) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', () => res(true));
    server.once('listening', () => { server.close(); res(false); });
    server.listen(port, '127.0.0.1');
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPortInUse(port))) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}
