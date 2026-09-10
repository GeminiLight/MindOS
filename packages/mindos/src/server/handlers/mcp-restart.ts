import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveMcpBindHost } from '../../protocols/mcp-server/http-security.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosServerEventEmitter } from '../events/bus.js';

/**
 * Marker the managed restart writes before killing the MCP so the Desktop
 * ProcessManager (which owns the process) can tell the exit apart from a
 * crash. Desktop passes the exact path in `MINDOS_MCP_RESTART_INTENT`; the
 * default mirrors its config dir.
 */
export const MINDOS_MCP_RESTART_INTENT_FILE = 'mcp-restart.intent';
/** How long a managed or spawned MCP may take to answer /api/health before the restart reports `healthy: false`. */
const MCP_HEALTH_TIMEOUT_MS = 15_000;

export type MindosMcpRestartSettings = {
  mcpPort?: number;
  authToken?: string;
};

export type MindosMcpRestartServices = {
  readSettings?(): unknown;
  env?: NodeJS.ProcessEnv;
  projectRoot: string;
  homeDir?: string;
  /** Overrides the intent file location (tests); otherwise env `MINDOS_MCP_RESTART_INTENT`, then `~/.mindos/mcp-restart.intent`. */
  restartIntentPath?: string;
  execPath?: string;
  killByPort?(port: number): void;
  waitForPortFree?(port: number, timeoutMs: number): Promise<boolean>;
  /** Polls the MCP `/api/health` until it answers or `timeoutMs` passes. */
  waitForMcpHealth?(port: number, timeoutMs: number): Promise<boolean>;
  pathExists?(path: string): boolean;
  spawnDetached?(command: string, args: string[], options: {
    cwd: string;
    detached: true;
    stdio: 'ignore';
    env: NodeJS.ProcessEnv;
  }): { pid?: number; unref(): void };
  /** Receives `mcp.changed` once the restarted MCP answers /api/health. */
  events?: MindosServerEventEmitter;
};

export type MindosMcpRestartPayload =
  | { ok: true; port: number; note: string; healthy: boolean }
  | { ok: true; pid?: number; port: number; healthy: boolean }
  | { error: string };

export type FindMcpProcessIdsOptions = {
  platform?: NodeJS.Platform;
  execFile?(command: string, args: string[]): string;
  getCommandLine?(pid: number, platform: NodeJS.Platform): string | null;
};

export function resolveMcpRestartIntentPath(
  services: Pick<MindosMcpRestartServices, 'homeDir' | 'restartIntentPath' | 'env'>,
): string {
  if (services.restartIntentPath) return services.restartIntentPath;
  const fromEnv = services.env?.MINDOS_MCP_RESTART_INTENT?.trim();
  if (fromEnv) return fromEnv;
  return join(services.homeDir ?? homedir(), '.mindos', MINDOS_MCP_RESTART_INTENT_FILE);
}

function writeMcpRestartIntent(intentPath: string, port: number): void {
  mkdirSync(dirname(intentPath), { recursive: true });
  const payload = { port, requestedAt: new Date().toISOString(), requestedBy: process.pid };
  const tmp = `${intentPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, intentPath);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

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
    const waitForMcpHealth = services.waitForMcpHealth ?? defaultWaitForMcpHealth;

    const kill = services.killByPort ?? killMcpProcessesByPort;

    if (managed) {
      // The ProcessManager owns the MCP: leave it a marker first so the exit we
      // are about to cause is respawned as a restart, not counted as a crash.
      writeMcpRestartIntent(resolveMcpRestartIntentPath({ ...services, env }), mcpPort);
      kill(mcpPort);
      const healthy = await waitForMcpHealth(mcpPort, MCP_HEALTH_TIMEOUT_MS);
      if (healthy) services.events?.emit({ type: 'mcp.changed' });
      return json({
        ok: true,
        port: mcpPort,
        healthy,
        note: healthy ? 'ProcessManager will respawn' : 'ProcessManager is respawning; MCP not healthy yet',
      });
    }

    kill(mcpPort);

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
      // Unauthenticated MCP must stay on loopback; MCP_HOST only widens the bind with a token.
      MCP_HOST: resolveMcpBindHost(env.MCP_HOST, authToken).host,
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

    const healthy = await waitForMcpHealth(mcpPort, MCP_HEALTH_TIMEOUT_MS);
    if (healthy) services.events?.emit({ type: 'mcp.changed' });
    return json({ ok: true, pid: child.pid, port: mcpPort, healthy });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Poll the MCP `/api/health` (loopback) until it reports `{ ok: true, service: 'mindos' }` or the deadline passes. */
export async function defaultWaitForMcpHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeMcpHealth(port, 2000)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  return false;
}

async function probeMcpHealth(port: number, timeoutMs: number): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null) as { ok?: unknown; service?: unknown } | null;
    return body?.ok === true && body.service === 'mindos';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
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
