import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';
import { readMindosProductVersion, type VersionResolutionOptions } from './health.js';

export const IDLE_UPDATE_STATUS = {
  stage: 'idle',
  stages: [],
  error: null,
  version: null,
  startedAt: null,
};

const DEFAULT_REGISTRIES = [
  'https://registry.npmmirror.com/@geminilight/mindos/latest',
  'https://registry.npmjs.org/@geminilight/mindos/latest',
];

export type UpdateStatusPayload = typeof IDLE_UPDATE_STATUS | Record<string, unknown>;

export type UpdateStatusOptions = {
  statusPath?: string;
};

export type UpdateCheckOptions = VersionResolutionOptions & {
  currentVersion?: string;
  packageJsonPaths?: string[];
  registries?: string[];
  fetcher?: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

export type UpdateCheckPayload = {
  current: string;
  latest: string;
  hasUpdate: boolean;
};

export type ProcessControlSpawn = (
  command: string,
  args: string[],
  options: { detached: true; stdio: 'ignore'; env: NodeJS.ProcessEnv },
) => { unref(): void };

export type ProcessControlOptions = {
  cliPath?: string;
  nodeBin?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runtimeRoot?: string;
  projectRoot?: string;
  spawn?: ProcessControlSpawn;
};

export type RestartPostOptions = ProcessControlOptions & {
  scheduleExit?: (delayMs: number) => void;
};

export function handleUpdateStatusGet(
  options: UpdateStatusOptions = {},
): MindosServerResponse<UpdateStatusPayload> {
  const statusPath = options.statusPath ?? resolve(homedir(), '.mindos', 'update-status.json');
  try {
    const parsed = JSON.parse(readFileSync(statusPath, 'utf-8')) as UpdateStatusPayload;
    return json(parsed);
  } catch {
    return json(IDLE_UPDATE_STATUS);
  }
}

export async function handleUpdateCheckGet(
  options: UpdateCheckOptions = {},
): Promise<MindosServerResponse<UpdateCheckPayload>> {
  const current = options.currentVersion ?? readCurrentVersion(options);
  let latest = current;
  const fetcher = options.fetcher ?? defaultFetchLatest;
  const discoveredVersions: string[] = [];

  for (const registry of options.registries ?? DEFAULT_REGISTRIES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const response = await fetcher(registry, { signal: controller.signal });
        if (!response.ok) continue;
        const data = await response.json();
        const version = data && typeof data === 'object' ? (data as { version?: unknown }).version : undefined;
        if (typeof version === 'string' && version) {
          discoveredVersions.push(version);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      continue;
    }
  }

  for (const version of discoveredVersions) {
    if (compareSemver(version, latest) > 0) latest = version;
  }

  return json({
    current,
    latest,
    hasUpdate: compareSemver(latest, current) > 0,
  });
}

export function handleRestartPost(options: RestartPostOptions = {}): MindosServerResponse<{ ok: true } | { error: string }> {
  try {
    const env = options.env ?? process.env;
    const childEnv = cleanEnvForRestart(env);
    spawnCli('restart', childEnv, options);
    const scheduleExit = options.scheduleExit ?? ((delayMs) => setTimeout(() => process.exit(0), delayMs));
    scheduleExit(1500);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export function handleUpdatePost(options: ProcessControlOptions = {}): MindosServerResponse<{ ok: true } | { error: string }> {
  try {
    const env = options.env ?? process.env;
    const childEnv = cleanEnvForUpdate(env);
    spawnCli('update', childEnv, options);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function readCurrentVersion(options: UpdateCheckOptions): string {
  const pathVersion = options.packageJsonPaths ? readVersionFromPackageJsonPaths(options.packageJsonPaths) : undefined;
  if (pathVersion) return pathVersion;

  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  return readMindosProductVersion({
    cwd,
    env,
    projectRoot: options.projectRoot ?? env.MINDOS_PROJECT_ROOT ?? findWorkspaceRoot(cwd),
  });
}

function readVersionFromPackageJsonPaths(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: unknown };
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // Try next candidate.
    }
  }
  return undefined;
}

function spawnCli(command: 'restart' | 'update', childEnv: NodeJS.ProcessEnv, options: ProcessControlOptions): void {
  const spawn = options.spawn ?? nodeSpawn as ProcessControlSpawn;
  const nodeBin = options.nodeBin ?? childEnv.MINDOS_NODE_BIN ?? process.execPath;
  const cliPath = options.cliPath ?? resolveMindosCliPath({
    env: options.env ?? process.env,
    runtimeRoot: options.runtimeRoot,
    projectRoot: options.projectRoot,
  });
  const child = spawn(nodeBin, [cliPath, command], {
    detached: true,
    stdio: 'ignore',
    env: childEnv,
  });
  child.unref();
}

function cleanEnvForRestart(source: NodeJS.ProcessEnv | Record<string, string | undefined>): NodeJS.ProcessEnv {
  const cleaned = cleanMindosEnv(source);
  const oldWebPort = source.MINDOS_WEB_PORT;
  const oldMcpPort = source.MINDOS_MCP_PORT;
  if (oldWebPort) cleaned.MINDOS_OLD_WEB_PORT = oldWebPort;
  if (oldMcpPort) cleaned.MINDOS_OLD_MCP_PORT = oldMcpPort;
  return cleaned;
}

function cleanEnvForUpdate(source: NodeJS.ProcessEnv | Record<string, string | undefined>): NodeJS.ProcessEnv {
  return cleanMindosEnv(source);
}

function cleanMindosEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(cleaned)) {
    if (key.startsWith('MINDOS_') || key.startsWith('MIND_')) delete cleaned[key];
  }
  delete cleaned.AUTH_TOKEN;
  delete cleaned.WEB_PASSWORD;
  delete cleaned.WEB_SESSION_SECRET;
  delete cleaned.NODE_OPTIONS;
  return cleaned;
}

function resolveMindosCliPath(options: { env: NodeJS.ProcessEnv | Record<string, string | undefined>; runtimeRoot?: string; projectRoot?: string }): string {
  if (options.env.MINDOS_CLI_PATH) return options.env.MINDOS_CLI_PATH;

  const roots = [
    options.projectRoot,
    options.env.MINDOS_PROJECT_ROOT,
    options.runtimeRoot,
    findWorkspaceRoot(process.cwd()),
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  for (const root of roots) {
    const repoCli = resolve(root, 'packages', 'mindos', 'bin', 'cli.js');
    if (existsSync(repoCli)) return repoCli;
    const packageCli = resolve(root, 'bin', 'cli.js');
    if (existsSync(packageCli)) return packageCli;
  }

  return process.argv[1] ? resolve(process.argv[1]) : 'mindos';
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(resolve(current, 'pnpm-workspace.yaml')) ||
      existsSync(resolve(current, 'packages', 'mindos', 'package.json'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

async function defaultFetchLatest(url: string, init: { signal: AbortSignal }) {
  return fetch(url, { signal: init.signal });
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (const index of [0, 1, 2] as const) {
    if (pa[index] !== pb[index]) return pa[index] - pb[index];
  }
  return 0;
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
