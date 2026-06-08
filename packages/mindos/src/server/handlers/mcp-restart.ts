import { execFileSync, spawn } from 'node:child_process';
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

export type FindMcpProcessIdsOptions = {
  platform?: NodeJS.Platform;
  execFile?(command: string, args: string[]): string;
  getCommandLine?(pid: number, platform: NodeJS.Platform): string | null;
};

export async function handleMcpRestartPost(
  services: MindosMcpRestartServices,
): Promise<MindosServerResponse<MindosMcpRestartPayload>> {
  try {
    const env = services.env ?? process.env;
    const settings = services.readSettings?.();
    const mcpPort = Number(env.MINDOS_MCP_PORT) || readSettingsNumber(settings, 'mcpPort') || 8781;
    const webPort = env.MINDOS_WEB_PORT || '3456';
    const authToken = readSettingsString(settings, 'authToken') || env.AUTH_TOKEN;
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

    const pathExists = services.pathExists ?? existsSync;
    const { mcpDir, mcpBundle } = resolveMcpRuntime(services.projectRoot, pathExists);
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
  const platform = process.platform;
  for (const pid of findMcpProcessIdsByPort(port, { platform })) {
    try {
      if (platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Process already exited or the platform kill tool is unavailable.
    }
  }
}

export function findMcpProcessIdsByPort(port: number, options: FindMcpProcessIdsOptions = {}): number[] {
  if (!isValidTcpPort(port)) return [];

  const platform = options.platform ?? process.platform;
  const execFile = options.execFile ?? ((command: string, args: string[]) => (
    execFileSync(command, args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }) as string
  ));

  let candidates: number[];
  if (platform === 'win32') {
    try {
      candidates = parseNetstatListeningPids(port, execFile('netstat', ['-ano']));
    } catch {
      return [];
    }
    return filterMindosMcpPids(candidates, platform, options);
  }

  const pids = new Set<number>();
  try {
    for (const pid of parseLsofPids(execFile('lsof', ['-ti', `:${port}`]))) {
      pids.add(pid);
    }
  } catch {
    // lsof may be unavailable in minimal Linux environments.
  }

  if (pids.size === 0) {
    try {
      for (const pid of parseSsListeningPids(port, execFile('ss', ['-tlnp']))) {
        pids.add(pid);
      }
    } catch {
      // No listener or no compatible process listing command.
    }
  }

  return filterMindosMcpPids([...pids], platform, options);
}

export function isMindosMcpCommandLine(commandLine: string): boolean {
  const normalized = commandLine.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/dist/protocols/mcp-server/index.cjs')
    || normalized.includes('/protocols/mcp-server/dist/index.cjs');
}

function filterMindosMcpPids(
  pids: number[],
  platform: NodeJS.Platform,
  options: FindMcpProcessIdsOptions,
): number[] {
  const getCommandLine = options.getCommandLine ?? defaultGetCommandLine;
  return pids.filter((pid) => {
    const commandLine = getCommandLine(pid, platform);
    return typeof commandLine === 'string' && isMindosMcpCommandLine(commandLine);
  });
}

function defaultGetCommandLine(pid: number, platform: NodeJS.Platform): string | null {
  try {
    if (platform === 'win32') {
      try {
        return String(execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue).CommandLine`,
        ], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }));
      } catch {
        return String(execFileSync('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/format:value'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }));
      }
    }
    return String(execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }));
  } catch {
    return null;
  }
}

export function parseNetstatListeningPids(port: number, output: string): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const localAddress = parts[1];
    const pid = Number(parts[parts.length - 1]);
    if (localAddressHasPort(localAddress, port) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function parseLsofPids(output: string): number[] {
  return output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => pid > 0);
}

function parseSsListeningPids(port: number, output: string): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    if (!lineHasPort(line, port)) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(match[1]);
      if (pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

function localAddressHasPort(localAddress: string | undefined, port: number): boolean {
  return localAddress?.endsWith(`:${port}`) ?? false;
}

function lineHasPort(line: string, port: number): boolean {
  return new RegExp(`:${port}(?!\\d)`).test(line);
}

function isValidTcpPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function resolveMcpRuntime(
  projectRoot: string,
  pathExists: (path: string) => boolean,
): { mcpDir: string; mcpBundle: string } {
  const candidates = [
    resolve(projectRoot, 'packages', 'mindos'),
    projectRoot,
  ];

  for (const mcpDir of candidates) {
    const mcpBundle = resolve(mcpDir, 'dist', 'protocols', 'mcp-server', 'index.cjs');
    if (pathExists(mcpBundle)) return { mcpDir, mcpBundle };
  }

  const fallbackDir = candidates[0] ?? projectRoot;
  return {
    mcpDir: fallbackDir,
    mcpBundle: resolve(fallbackDir, 'dist', 'protocols', 'mcp-server', 'index.cjs'),
  };
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
