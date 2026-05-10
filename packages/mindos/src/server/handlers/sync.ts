import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveSafe } from '../../foundation/security/index.js';
import { json, type MindosServerResponse } from '../response.js';

export type MindosSyncConfig = Record<string, any> & {
  mindRoot?: string;
  sync?: {
    enabled?: boolean;
    provider?: string;
    autoCommitInterval?: number;
    autoPullInterval?: number;
  };
};

export type MindosSyncState = Record<string, any> & {
  lastSync?: string | null;
  lastPull?: string | null;
  conflicts?: Array<{ file: string }>;
  lastError?: string | null;
};

export type MindosSyncPostPayload = {
  action?: string;
  remote?: string;
  branch?: string;
  token?: string;
  content?: string;
  autoCommitInterval?: number;
  autoPullInterval?: number;
};

export type MindosSyncServices = {
  configPath?: string;
  statePath?: string;
  readConfig?(): MindosSyncConfig;
  writeConfig?(config: MindosSyncConfig): void;
  readState?(): MindosSyncState;
  writeState?(state: MindosSyncState): void;
  isGitRepo?(dir: string): boolean;
  getRemoteUrl?(cwd: string): string | null;
  getBranch?(cwd: string): string;
  getUnpushedCount?(cwd: string): string;
  runCli?(args: string[], timeoutMs?: number): Promise<void>;
  env?: Record<string, string | undefined>;
  cliPath?: string;
  nodeBin?: string;
  runtimeRoot?: string;
  projectRoot?: string;
};

const DEFAULT_MINDOS_DIR = join(homedir(), '.mindos');
const DEFAULT_CONFIG_PATH = join(DEFAULT_MINDOS_DIR, 'config.json');
const DEFAULT_SYNC_STATE_PATH = join(DEFAULT_MINDOS_DIR, 'sync-state.json');

export async function handleSyncGet(
  services: MindosSyncServices = {},
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  try {
    const config = readConfig(services);
    const syncConfig = config.sync ?? {};
    const state = readState(services);
    const mindRoot = config.mindRoot;

    if (!syncConfig.enabled) {
      return json({ enabled: false });
    }

    const hasRepo = !!mindRoot && callIsGitRepo(services, mindRoot);
    const remote = hasRepo && mindRoot ? callGetRemoteUrl(services, mindRoot) : null;
    if (!hasRepo || !remote) {
      return json({
        enabled: true,
        needsSetup: true,
        provider: syncConfig.provider || 'git',
        remote: remote || '(not configured)',
        branch: 'main',
        lastSync: null,
        lastPull: null,
        unpushed: '?',
        conflicts: [],
        lastError: !hasRepo
          ? 'Git repository not found in knowledge base directory. Please re-configure sync.'
          : 'Remote not configured. Please re-configure sync.',
        autoCommitInterval: syncConfig.autoCommitInterval || 30,
        autoPullInterval: syncConfig.autoPullInterval || 300,
      });
    }

    return json({
      enabled: true,
      provider: syncConfig.provider || 'git',
      remote,
      branch: callGetBranch(services, mindRoot) || 'main',
      lastSync: state.lastSync || null,
      lastPull: state.lastPull || null,
      unpushed: callGetUnpushedCount(services, mindRoot),
      conflicts: state.conflicts || [],
      lastError: state.lastError || null,
      autoCommitInterval: syncConfig.autoCommitInterval || 30,
      autoPullInterval: syncConfig.autoPullInterval || 300,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function handleSyncPost(
  body: MindosSyncPostPayload | unknown,
  services: MindosSyncServices = {},
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  try {
    const payload = body && typeof body === 'object' ? body as MindosSyncPostPayload : {};
    const config = readConfig(services);
    const mindRoot = config.mindRoot;

    if (!mindRoot) {
      return json({ error: 'No mindRoot configured' }, { status: 400 });
    }

    switch (payload.action) {
      case 'init':
        return await handleSyncInit(payload, services);
      case 'now':
        return await handleSyncNow(mindRoot, services);
      case 'on':
        config.sync = { ...(config.sync ?? {}), enabled: true };
        writeConfig(config, services);
        return json({ ok: true, enabled: true });
      case 'off':
        config.sync = { ...(config.sync ?? {}), enabled: false };
        writeConfig(config, services);
        return json({ ok: true, enabled: false });
      case 'reset':
        delete config.sync;
        writeConfig(config, services);
        try { writeState({}, services); } catch {}
        return json({ ok: true, enabled: false });
      case 'gitignore-get':
        return handleGitignoreGet(mindRoot);
      case 'gitignore-save':
        return handleGitignoreSave(mindRoot, payload);
      case 'resolve-conflict':
        return handleResolveConflict(mindRoot, payload, services);
      case 'conflict-preview':
        return handleConflictPreview(mindRoot, payload);
      case 'update-intervals':
        return handleUpdateIntervals(payload, config, services);
      default:
        return json({ error: `Unknown action: ${payload.action}` }, { status: 400 });
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

async function handleSyncInit(
  payload: MindosSyncPostPayload,
  services: MindosSyncServices,
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  const remote = payload.remote?.trim();
  if (!remote) {
    return json({ error: 'Remote URL is required' }, { status: 400 });
  }
  const isHttps = remote.startsWith('https://');
  const isSsh = /^git@[\w.-]+:.+/.test(remote);
  if (!isHttps && !isSsh) {
    return json({ error: 'Invalid remote URL — must be HTTPS or SSH format' }, { status: 400 });
  }

  const branch = payload.branch?.trim() || 'main';
  const args = ['sync', 'init', '--non-interactive', '--remote', remote, '--branch', branch];
  if (payload.token) args.push('--token', payload.token);

  try {
    await runCli(args, 120000, services);
    return json({ success: true, message: 'Sync initialized' });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

async function handleSyncNow(
  mindRoot: string,
  services: MindosSyncServices,
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  if (!callIsGitRepo(services, mindRoot)) {
    return json({ error: 'Not a git repository' }, { status: 400 });
  }
  try {
    await runCli(['sync', 'now'], 120000, services);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function handleGitignoreGet(mindRoot: string): MindosServerResponse<{ content: string }> {
  try {
    return json({ content: readFileSync(join(mindRoot, '.gitignore'), 'utf-8') });
  } catch {
    return json({ content: '' });
  }
}

function handleGitignoreSave(
  mindRoot: string,
  payload: MindosSyncPostPayload,
): MindosServerResponse<{ ok: true } | { error: string }> {
  if (typeof payload.content !== 'string') {
    return json({ error: 'Missing content' }, { status: 400 });
  }
  writeFileSync(join(mindRoot, '.gitignore'), payload.content, 'utf-8');
  return json({ ok: true });
}

function handleResolveConflict(
  mindRoot: string,
  payload: MindosSyncPostPayload,
  services: MindosSyncServices,
): MindosServerResponse<Record<string, unknown> | { error: string }> {
  const file = payload.remote;
  const strategy = payload.branch ?? 'keep-local';
  if (!file || typeof file !== 'string') {
    return json({ error: 'Missing file path' }, { status: 400 });
  }
  if (!isPathWithinMindRoot(mindRoot, file)) {
    return json({ error: 'Invalid file path' }, { status: 400 });
  }

  const conflictPath = resolveMindRootPath(mindRoot, `${file}.sync-conflict`);
  const originalPath = resolveMindRootPath(mindRoot, file);
  if (!conflictPath || !originalPath) {
    return json({ error: 'Invalid file path' }, { status: 400 });
  }
  if (strategy === 'keep-remote' && existsSync(conflictPath)) {
    writeFileSync(originalPath, readFileSync(conflictPath, 'utf-8'), 'utf-8');
  }
  if (existsSync(conflictPath)) {
    unlinkSync(conflictPath);
  }

  const state = readState(services);
  if (state.conflicts) {
    state.conflicts = state.conflicts.filter((conflict) => conflict.file !== file);
    writeState(state, services);
  }
  return json({ ok: true });
}

function handleConflictPreview(
  mindRoot: string,
  payload: MindosSyncPostPayload,
): MindosServerResponse<{ local: string; remote: string } | { error: string }> {
  const file = payload.remote;
  if (!file || typeof file !== 'string') {
    return json({ error: 'Missing file path' }, { status: 400 });
  }
  if (!isPathWithinMindRoot(mindRoot, file)) {
    return json({ error: 'Invalid file path' }, { status: 400 });
  }

  const localPath = resolveMindRootPath(mindRoot, file);
  const remotePath = resolveMindRootPath(mindRoot, `${file}.sync-conflict`);
  if (!localPath || !remotePath) {
    return json({ error: 'Invalid file path' }, { status: 400 });
  }
  return json({
    local: existsSync(localPath) ? readFileSync(localPath, 'utf-8') : '',
    remote: existsSync(remotePath) ? readFileSync(remotePath, 'utf-8') : '',
  });
}

function handleUpdateIntervals(
  payload: MindosSyncPostPayload,
  config: MindosSyncConfig,
  services: MindosSyncServices,
): MindosServerResponse<Record<string, unknown> | { error: string }> {
  const commitInterval = typeof payload.autoCommitInterval === 'number' ? payload.autoCommitInterval : undefined;
  const pullInterval = typeof payload.autoPullInterval === 'number' ? payload.autoPullInterval : undefined;
  if (commitInterval === undefined && pullInterval === undefined) {
    return json({ error: 'At least one interval must be provided' }, { status: 400 });
  }
  if (commitInterval !== undefined && (!Number.isInteger(commitInterval) || commitInterval < 10 || commitInterval > 300)) {
    return json({ error: 'autoCommitInterval must be an integer between 10 and 300 seconds' }, { status: 400 });
  }
  if (pullInterval !== undefined && (!Number.isInteger(pullInterval) || pullInterval < 60 || pullInterval > 3600)) {
    return json({ error: 'autoPullInterval must be an integer between 60 and 3600 seconds' }, { status: 400 });
  }

  config.sync = config.sync ?? {};
  if (commitInterval !== undefined) config.sync.autoCommitInterval = commitInterval;
  if (pullInterval !== undefined) config.sync.autoPullInterval = pullInterval;
  writeConfig(config, services);
  return json({
    autoCommitInterval: config.sync.autoCommitInterval || 30,
    autoPullInterval: config.sync.autoPullInterval || 300,
  });
}

function readConfig(services: MindosSyncServices): MindosSyncConfig {
  if (services.readConfig) return services.readConfig();
  return readJsonFile(services.configPath ?? DEFAULT_CONFIG_PATH);
}

function writeConfig(config: MindosSyncConfig, services: MindosSyncServices): void {
  if (services.writeConfig) {
    services.writeConfig(config);
    return;
  }
  atomicWriteJson(services.configPath ?? DEFAULT_CONFIG_PATH, config);
}

function readState(services: MindosSyncServices): MindosSyncState {
  if (services.readState) return services.readState();
  return readJsonFile(services.statePath ?? DEFAULT_SYNC_STATE_PATH);
}

function writeState(state: MindosSyncState, services: MindosSyncServices): void {
  if (services.writeState) {
    services.writeState(state);
    return;
  }
  atomicWriteJson(services.statePath ?? DEFAULT_SYNC_STATE_PATH, state);
}

function readJsonFile<T extends Record<string, any>>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return {} as T;
  }
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  renameSync(tmp, filePath);
}

function callIsGitRepo(services: MindosSyncServices, dir: string): boolean {
  if (services.isGitRepo) return services.isGitRepo(dir);
  return existsSync(join(dir, '.git'));
}

function callGetRemoteUrl(services: MindosSyncServices, cwd: string): string | null {
  if (services.getRemoteUrl) return services.getRemoteUrl(cwd);
  try { return runGit(cwd, ['remote', 'get-url', 'origin']); } catch { return null; }
}

function callGetBranch(services: MindosSyncServices, cwd: string): string {
  if (services.getBranch) return services.getBranch(cwd);
  try { return runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch { return 'main'; }
}

function callGetUnpushedCount(services: MindosSyncServices, cwd: string): string {
  if (services.getUnpushedCount) return services.getUnpushedCount(cwd);
  try { return runGit(cwd, ['rev-list', '--count', '@{u}..HEAD']); } catch { return '?'; }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function isPathWithinMindRoot(mindRoot: string, filePath: string): boolean {
  return resolveMindRootPath(mindRoot, filePath) !== null;
}

function resolveMindRootPath(mindRoot: string, filePath: string): string | null {
  try {
    return resolveSafe(mindRoot, filePath);
  } catch {
    return null;
  }
}

async function runCli(args: string[], timeoutMs: number, services: MindosSyncServices): Promise<void> {
  if (services.runCli) {
    await services.runCli(args, timeoutMs);
    return;
  }

  const env = services.env ?? process.env;
  const nodeBin = services.nodeBin ?? env.MINDOS_NODE_BIN ?? process.execPath;
  const cliPath = services.cliPath ?? resolveMindosCliPath({
    env,
    runtimeRoot: services.runtimeRoot,
    projectRoot: services.projectRoot,
  });

  await new Promise<void>((resolveDone, rejectDone) => {
    execFile(nodeBin, [cliPath, ...args], { timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (error) rejectDone(new Error(stderr?.trim() || error.message));
      else resolveDone();
    });
  });
}

function resolveMindosCliPath(options: { env: Record<string, string | undefined>; runtimeRoot?: string; projectRoot?: string }): string {
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
