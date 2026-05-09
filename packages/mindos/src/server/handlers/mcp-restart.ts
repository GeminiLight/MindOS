import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type MindosMcpRestartSettings = {
  mcpPort?: number;
  authToken?: string;
};

export type MindosMcpRestartServices = {
  readSettings?(): unknown;
  env?: NodeJS.ProcessEnv;
  projectRoot: string;
  execPath?: string;
  killByPort?(port: number): void;
  waitForPortFree?(port: number, timeoutMs: number): Promise<boolean>;
  pathExists?(path: string): boolean;
  spawnDetached?(command: string, args: string[], options: {
    cwd: string;
    detached: true;
    stdio: 'ignore';
    env: NodeJS.ProcessEnv;
  }): { pid?: number; unref(): void };
};

export type MindosMcpRestartPayload =
  | { ok: true; port: number; note: string }
  | { ok: true; pid?: number; port: number }
  | { error: string };

export async function handleMcpRestartPost(
  services: MindosMcpRestartServices,
): Promise<MindosServerResponse<MindosMcpRestartPayload>> {
  try {
    const env = services.env ?? process.env;
    const settings = services.readSettings?.();
    const mcpPort = Number(env.MINDOS_MCP_PORT) || readSettingsNumber(settings, 'mcpPort') || 8781;
    const webPort = env.MINDOS_WEB_PORT || '3456';
    const authToken = env.AUTH_TOKEN || readSettingsString(settings, 'authToken');
    const managed = env.MINDOS_MANAGED === '1';

    const kill = services.killByPort ?? killMcpProcessesByPort;
    kill(mcpPort);

    if (managed) {
      return json({ ok: true, port: mcpPort, note: 'ProcessManager will respawn' });
    }

    const waitForPortFree = services.waitForPortFree ?? defaultWaitForPortFree;
    const portFree = await waitForPortFree(mcpPort, 5000);
    if (!portFree) {
      return json({ error: `MCP port ${mcpPort} still in use after kill` }, { status: 500 });
    }

    const mcpDir = resolve(services.projectRoot, 'packages', 'protocols', 'mcp-server');
    const mcpBundle = resolve(mcpDir, 'dist', 'index.cjs');
    const pathExists = services.pathExists ?? existsSync;
    if (!pathExists(mcpBundle)) {
      return json({ error: 'MCP bundle not found — reinstall @geminilight/mindos' }, { status: 500 });
    }

    const childEnv: NodeJS.ProcessEnv = {
      ...env,
      MCP_TRANSPORT: 'http',
      MCP_PORT: String(mcpPort),
      MCP_HOST: env.MCP_HOST || '0.0.0.0',
      MINDOS_URL: env.MINDOS_URL || `http://127.0.0.1:${webPort}`,
      ...(authToken ? { AUTH_TOKEN: authToken } : {}),
    };

    const spawnDetached = services.spawnDetached ?? defaultSpawnDetached;
    const child = spawnDetached(services.execPath ?? process.execPath, [mcpBundle], {
      cwd: mcpDir,
      detached: true,
      stdio: 'ignore',
      env: childEnv,
    });
    child.unref();

    return json({ ok: true, pid: child.pid, port: mcpPort });
  } catch (error) {
    return errorResponse(error);
  }
}

export function killMcpProcessesByPort(port: number): void {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    return;
  } catch {
    // Fall back to ss below.
  }

  try {
    const output = execSync('ss -tlnp 2>/dev/null', { encoding: 'utf-8' });
    const portRe = new RegExp(`:${port}(?!\\d)`);
    for (const line of output.split('\n')) {
      if (!portRe.test(line)) continue;
      const pidMatch = line.match(/pid=(\d+)/g);
      if (!pidMatch) continue;
      for (const match of pidMatch) {
        const pid = Number(match.slice(4));
        if (pid > 0) {
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
      }
    }
  } catch {
    // No listener or no compatible process listing command.
  }
}

export function defaultWaitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  return waitForPortFreeWithProbe(port, timeoutMs, defaultIsPortInUse);
}

export async function waitForPortFreeWithProbe(
  port: number,
  timeoutMs: number,
  isPortInUse: (port: number) => Promise<boolean>,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPortInUse(port))) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  return false;
}

function defaultIsPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(true));
    server.once('listening', () => {
      server.close();
      resolvePort(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

function defaultSpawnDetached(
  command: string,
  args: string[],
  options: {
    cwd: string;
    detached: true;
    stdio: 'ignore';
    env: NodeJS.ProcessEnv;
  },
): { pid?: number; unref(): void } {
  return spawn(command, args, options);
}

function readSettingsNumber(settings: unknown, key: string): number | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const value = (settings as Record<string, unknown>)[key];
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readSettingsString(settings: unknown, key: string): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
