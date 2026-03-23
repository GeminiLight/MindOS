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
 */
export async function POST() {
  try {
    const cfg = readConfig();
    const mcpPort = (cfg.mcpPort as number) ?? 8781;
    const webPort = process.env.MINDOS_WEB_PORT || '3456';
    const authToken = cfg.authToken as string | undefined;

    // Step 1: Kill process on MCP port
    killByPort(mcpPort);

    // Step 2: Wait briefly for port to free
    await new Promise(r => setTimeout(r, 1000));

    // Step 3: Spawn new MCP server
    const root = resolve(process.cwd(), '..');
    const mcpDir = resolve(root, 'mcp');

    if (!existsSync(resolve(mcpDir, 'node_modules'))) {
      return NextResponse.json({ error: 'MCP dependencies not installed' }, { status: 500 });
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      MCP_PORT: String(mcpPort),
      MCP_HOST: process.env.MCP_HOST || '0.0.0.0',
      MINDOS_URL: process.env.MINDOS_URL || `http://127.0.0.1:${webPort}`,
    };
    if (authToken) env.AUTH_TOKEN = authToken;

    const child = spawn('npx', ['tsx', 'src/index.ts'], {
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
