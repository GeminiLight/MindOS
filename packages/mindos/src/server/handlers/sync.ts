import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
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
  file?: string;
  branch?: string;
  strategy?: string;
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
  runCli?(args: string[], timeoutMs?: number, envOverrides?: Record<string, string | undefined>): Promise<void>;
  syncLockDir?: string;
  env?: Record<string, string | undefined>;
  cliPath?: string;
  nodeBin?: string;
  runtimeRoot?: string;
  projectRoot?: string;
};

const DEFAULT_MINDOS_DIR = join(homedir(), '.mindos');
const DEFAULT_CONFIG_PATH = join(DEFAULT_MINDOS_DIR, 'config.json');
const DEFAULT_SYNC_STATE_PATH = join(DEFAULT_MINDOS_DIR, 'sync-state.json');
const SYNC_LOCK_OWNER_STALE_MS = 5 * 60 * 1000;
const SYNC_LOCK_ALIVE_HARD_STALE_MS = 30 * 60 * 1000;

type SyncLockOwner = {
  pid?: number;
  hostname?: string;
  operation?: string;
  mindRoot?: string;
  startedAt?: string;
  token?: string;
};

class SyncLockedError extends Error {
  code = 'SYNC_LOCKED' as const;

  constructor(readonly owner: SyncLockOwner | null) {
    super(formatSyncLockedMessage(owner));
    this.name = 'SyncLockedError';
  }
}

export async function handleSyncGet(
  services: MindosSyncServices = {},
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  try {
    const config = readConfig(services);
    const syncConfig = config.sync ?? {};
    const state = readState(services);
    const mindRoot = config.mindRoot;

    if (!syncConfig.enabled) {
      if (!mindRoot) return json({ enabled: false });

      const hasRepo = callIsGitRepo(services, mindRoot);
      const remote = hasRepo ? callGetRemoteUrl(services, mindRoot) : null;
      if (!hasRepo || !remote) return json({ enabled: false });

      return json({
        enabled: false,
        configured: true,
        provider: syncConfig.provider || 'git',
        remote: redactGitRemote(remote),
        branch: callGetBranch(services, mindRoot) || 'main',
        lastSync: state.lastSync || null,
        lastPull: state.lastPull || null,
        unpushed: callGetUnpushedCount(services, mindRoot),
        conflicts: state.conflicts || [],
        lastError: state.lastError || null,
        autoCommitInterval: syncConfig.autoCommitInterval || 30,
        autoPullInterval: syncConfig.autoPullInterval || 300,
      });
    }

    const hasRepo = !!mindRoot && callIsGitRepo(services, mindRoot);
    const remote = hasRepo && mindRoot ? callGetRemoteUrl(services, mindRoot) : null;
    if (!hasRepo || !remote) {
      return json({
        enabled: true,
        needsSetup: true,
        provider: syncConfig.provider || 'git',
        remote: redactGitRemote(remote) || '(not configured)',
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
      remote: redactGitRemote(remote),
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
    if (isSyncLockedError(error)) return syncLockedResponse(error);
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

    if (payload.action === 'reset') {
      return handleSyncReset(config, services);
    }

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
      case 'gitignore-get':
        return handleGitignoreGet(mindRoot);
      case 'gitignore-save':
        return handleGitignoreSave(mindRoot, payload, services);
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
    if (isSyncLockedError(error)) return syncLockedResponse(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function handleSyncReset(
  config: MindosSyncConfig,
  services: MindosSyncServices,
): MindosServerResponse<{ ok: true; enabled: false } | { error: string }> {
  return withServerSyncLock(config.mindRoot ?? null, 'reset', services, () => {
    delete config.sync;
    writeConfig(config, services);
    try { writeState({}, services); } catch {}
    return json({ ok: true, enabled: false });
  });
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
  const envOverrides = payload.token ? { MINDOS_SYNC_TOKEN: payload.token } : undefined;

  try {
    await runCli(args, 120000, services, envOverrides);
    return json({ success: true, message: 'Sync initialized' });
  } catch (error) {
    if (isSyncLockedError(error)) return syncLockedResponse(error);
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
    if (isSyncLockedError(error)) return syncLockedResponse(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function handleGitignoreGet(mindRoot: string): MindosServerResponse<{ content: string }> {
  try {
    return json({ content: readFileSync(resolveExistingSafe(mindRoot, '.gitignore'), 'utf-8') });
  } catch {
    return json({ content: '' });
  }
}

function handleGitignoreSave(
  mindRoot: string,
  payload: MindosSyncPostPayload,
  services: MindosSyncServices,
): MindosServerResponse<{ ok: true } | { error: string }> {
  if (typeof payload.content !== 'string') {
    return json({ error: 'Missing content' }, { status: 400 });
  }
  const content = payload.content;
  try {
    return withServerSyncLock(mindRoot, 'gitignore-save', services, () => {
      writeFileSync(resolveExistingSafe(mindRoot, '.gitignore'), content, 'utf-8');
      return json({ ok: true });
    });
  } catch (error) {
    if (isSyncLockedError(error)) return syncLockedResponse(error);
    const message = error instanceof Error ? error.message : String(error);
    if (/access denied|outside root|absolute paths/i.test(message)) return json({ error: 'Access denied' }, { status: 403 });
    return json({ error: message }, { status: 500 });
  }
}

function handleResolveConflict(
  mindRoot: string,
  payload: MindosSyncPostPayload,
  services: MindosSyncServices,
): MindosServerResponse<Record<string, unknown> | { error: string }> {
  const file = payload.file ?? payload.remote;
  const strategy = payload.strategy ?? payload.branch ?? 'keep-local';
  if (!file || typeof file !== 'string') {
    return json({ error: 'Missing file path' }, { status: 400 });
  }
  if (strategy !== 'keep-local' && strategy !== 'keep-remote') {
    return json({ error: 'Invalid conflict resolution strategy' }, { status: 400 });
  }
  if (!isPathWithinMindRoot(mindRoot, file)) {
    return json({ error: 'Invalid file path' }, { status: 400 });
  }

  const conflictPath = resolveMindRootPath(mindRoot, `${file}.sync-conflict`);
  const originalPath = resolveMindRootPath(mindRoot, file);
  if (!conflictPath || !originalPath) {
    return json({ error: 'Invalid file path' }, { status: 400 });
  }

  return withServerSyncLock(mindRoot, 'resolve-conflict', services, () => {
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
  });
}

function handleConflictPreview(
  mindRoot: string,
  payload: MindosSyncPostPayload,
): MindosServerResponse<{ local: string; remote: string } | { error: string }> {
  const file = payload.file ?? payload.remote;
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

function withServerSyncLock<T>(
  mindRoot: string | null | undefined,
  operation: string,
  services: MindosSyncServices,
  callback: () => T,
): T {
  if (!mindRoot) return callback();
  const lock = acquireServerSyncLock(mindRoot, operation, services);
  try {
    return callback();
  } finally {
    releaseServerSyncLock(lock);
  }
}

type ServerSyncLock = {
  lockPath: string;
  token: string;
};

export function getServerSyncLockPath(
  mindRoot: string,
  services: Pick<MindosSyncServices, 'syncLockDir'> = {},
): string {
  const normalized = resolve(mindRoot || '.');
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return join(services.syncLockDir ?? join(DEFAULT_MINDOS_DIR, 'sync-locks'), `${hash}.lock`);
}

function acquireServerSyncLock(
  mindRoot: string,
  operation: string,
  services: MindosSyncServices,
): ServerSyncLock {
  const lockPath = getServerSyncLockPath(mindRoot, services);
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomUUID();

  while (true) {
    try {
      mkdirSync(lockPath);
      try {
        writeFileSync(join(lockPath, 'owner.json'), `${JSON.stringify({
          pid: process.pid,
          hostname: hostname(),
          operation,
          mindRoot: resolve(mindRoot),
          startedAt: new Date().toISOString(),
          token,
        }, null, 2)}\n`, 'utf-8');
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      return { lockPath, token };
    } catch (error) {
      if (!isFsErrorCode(error, 'EEXIST')) throw error;
      if (!isServerSyncLockStale(lockPath)) {
        throw new SyncLockedError(readServerSyncLockOwner(lockPath));
      }
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
}

function releaseServerSyncLock(lock: ServerSyncLock): void {
  const owner = readServerSyncLockOwner(lock.lockPath);
  if (owner?.token === lock.token) {
    rmSync(lock.lockPath, { recursive: true, force: true });
  }
}

function readServerSyncLockOwner(lockPath: string): SyncLockOwner | null {
  try {
    return JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf-8')) as SyncLockOwner;
  } catch {
    return null;
  }
}

function isServerSyncLockStale(lockPath: string): boolean {
  const owner = readServerSyncLockOwner(lockPath);
  const ageMs = getServerSyncLockAgeMs(lockPath, owner);
  if (!owner || typeof owner !== 'object') return ageMs > SYNC_LOCK_OWNER_STALE_MS;
  if (owner.hostname && owner.hostname !== hostname()) {
    return ageMs > SYNC_LOCK_ALIVE_HARD_STALE_MS;
  }
  if (owner.pid && !isProcessAlive(owner.pid)) return true;
  if (owner.pid && isProcessAlive(owner.pid)) return ageMs > SYNC_LOCK_ALIVE_HARD_STALE_MS;
  return ageMs > SYNC_LOCK_OWNER_STALE_MS;
}

function getServerSyncLockAgeMs(lockPath: string, owner: SyncLockOwner | null): number {
  const startedAt = owner?.startedAt ? new Date(owner.startedAt).getTime() : NaN;
  if (Number.isFinite(startedAt)) return Math.max(0, Date.now() - startedAt);
  try {
    return Math.max(0, Date.now() - statSync(lockPath).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isFsErrorCode(error, 'EPERM');
  }
}

function formatSyncLockedMessage(owner: SyncLockOwner | null): string {
  const parts: string[] = [];
  if (owner?.operation) parts.push(`owner=${owner.operation}`);
  if (owner?.pid) parts.push(`pid=${owner.pid}`);
  if (owner?.startedAt) parts.push(`startedAt=${owner.startedAt}`);
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return `SYNC_LOCKED: Sync is already running${suffix}`;
}

function isSyncLockedError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'SYNC_LOCKED' || /SYNC_LOCKED/i.test(message);
}

function syncLockedResponse(error: unknown): MindosServerResponse<{ error: string }> {
  const message = error instanceof SyncLockedError
    ? error.message
    : normalizeSyncLockedMessage(error instanceof Error ? error.message : String(error));
  return json({ error: message }, { status: 423 });
}

function normalizeSyncLockedMessage(message: string): string {
  const trimmed = stripAnsi(message).trim();
  if (/^SYNC_LOCKED:/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/SYNC_LOCKED:.*$/ims);
  return match ? match[0].trim() : 'SYNC_LOCKED: Sync is already running';
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '');
}

function isFsErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
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

export function redactGitRemote(remote: string | null | undefined): string | null {
  if (!remote) return null;
  if (!/^https?:\/\//i.test(remote)) return remote;

  try {
    const parsed = new URL(remote);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return remote.replace(/^(https?:\/\/)[^/@]+@/i, '$1');
  }
}

function isPathWithinMindRoot(mindRoot: string, filePath: string): boolean {
  return resolveMindRootPath(mindRoot, filePath) !== null;
}

function resolveMindRootPath(mindRoot: string, filePath: string): string | null {
  try {
    return resolveExistingSafe(mindRoot, filePath);
  } catch {
    return null;
  }
}

async function runCli(
  args: string[],
  timeoutMs: number,
  services: MindosSyncServices,
  envOverrides?: Record<string, string | undefined>,
): Promise<void> {
  if (services.runCli) {
    await services.runCli(args, timeoutMs, envOverrides);
    return;
  }

  const env = { ...(services.env ?? process.env), ...(envOverrides ?? {}) };
  const nodeBin = services.nodeBin ?? env.MINDOS_NODE_BIN ?? process.execPath;
  const cliPath = services.cliPath ?? resolveMindosCliPath({
    env,
    runtimeRoot: services.runtimeRoot,
    projectRoot: services.projectRoot,
  });

  await new Promise<void>((resolveDone, rejectDone) => {
    execFile(nodeBin, [cliPath, ...args], { timeout: timeoutMs, encoding: 'utf-8', env }, (error, stdout, stderr) => {
      if (error) rejectDone(new Error(formatProcessError(error, stdout, stderr)));
      else resolveDone();
    });
  });
}

function formatProcessError(
  error: Error,
  stdout: string | Buffer | null | undefined,
  stderr: string | Buffer | null | undefined,
): string {
  const details = [
    normalizeProcessOutput(stderr),
    normalizeProcessOutput(stdout),
    error.message,
  ].filter(Boolean);
  const message = details[0] ?? 'Command failed';
  return message.length > 4000 ? `${message.slice(0, 4000)}...` : message;
}

function normalizeProcessOutput(value: string | Buffer | null | undefined): string {
  if (!value) return '';
  return value.toString().trim();
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
