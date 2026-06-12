import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { json, type MindosServerResponse } from '../response.js';

// Git hooks (pre-push etc.) export GIT_DIR — and may export GIT_WORK_TREE,
// GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, GIT_PREFIX, GIT_QUARANTINE_PATH —
// pointing at the hook's own repository. Any git we spawn with that env and a
// different cwd silently operates on the hook's repo instead of mindRoot
// (real incident: a test run under pre-push committed onto the development
// worktree and deleted the tree). These vars are never legitimate input to
// MindOS sync; strip them from every spawned git's env. User-level git env
// (GIT_SSH_COMMAND, GIT_TERMINAL_PROMPT, GIT_AUTHOR_*) stays. Keep the list
// in sync with bin/lib/sync.js.
const GIT_REPO_TARGETING_VARS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
]);

export function sanitizeGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(base).filter(([key]) => !GIT_REPO_TARGETING_VARS.has(key)),
  ) as NodeJS.ProcessEnv;
}

export type MindosSyncConfig = Record<string, any> & {
  mindRoot?: string;
  sync?: {
    enabled?: boolean;
    provider?: string;
    autoCommitInterval?: number;
    autoPullInterval?: number;
  };
  __readError?: string;
  __readErrorPath?: string;
};

export type MindosSyncState = Record<string, any> & {
  lastSync?: string | null;
  lastPull?: string | null;
  conflicts?: unknown;
  lastError?: string | null;
  lastErrorTime?: string | null;
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
  syncDaemon?: {
    start?(mindRoot: string): void;
    stop?(): void;
    reconfigure?(mindRoot: string): void;
    restart?(mindRoot: string): void;
  };
};

const DEFAULT_MINDOS_DIR = join(homedir(), '.mindos');
const DEFAULT_CONFIG_PATH = join(DEFAULT_MINDOS_DIR, 'config.json');
const DEFAULT_SYNC_STATE_PATH = join(DEFAULT_MINDOS_DIR, 'sync-state.json');
const SYNC_LOCK_OWNER_STALE_MS = 5 * 60 * 1000;
const SYNC_LOCK_ALIVE_HARD_STALE_MS = 30 * 60 * 1000;
const PROTECTED_GITIGNORE_ENTRIES = ['*.sync-conflict', 'INSTRUCTION.md'];
const TRACKING_EXEMPT_GITIGNORE_FILES = new Set(['.gitignore']);

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

function ensureProtectedGitignoreEntries(content: string): string {
  const normalizedLines = content.split(/\r?\n/).map(line => line.trim());
  const missing = PROTECTED_GITIGNORE_ENTRIES.filter(entry => !normalizedLines.includes(entry));
  if (missing.length === 0) return content;

  const base = content.trimEnd();
  const appendix = [
    '# MindOS protected sync files',
    ...missing,
    '',
  ].join('\n');
  return base ? `${base}\n\n${appendix}` : `${appendix}`;
}

export async function handleSyncGet(
  services: MindosSyncServices = {},
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  try {
    const config = readConfig(services);
    const syncConfig = config.sync;
    const state = readState(services);
    const mindRoot = config.mindRoot;
    const conflicts = normalizeConflicts(state.conflicts);
    const configReadError = getConfigReadError(config);

    if (configReadError) {
      return json({
        enabled: false,
        configured: true,
        needsSetup: true,
        provider: 'git',
        remote: '(not configured)',
        branch: 'main',
        lastSync: state.lastSync || null,
        lastPull: state.lastPull || null,
        unpushed: '?',
        conflicts,
        lastError: configReadError,
      });
    }

    if (!syncConfig) {
      return json({ enabled: false });
    }

    if (!syncConfig.enabled) {
      if (!mindRoot) {
        return json({
          enabled: false,
          configured: true,
          needsSetup: true,
          provider: syncConfig.provider || 'git',
          remote: '(not configured)',
          branch: 'main',
          lastSync: state.lastSync || null,
          lastPull: state.lastPull || null,
          unpushed: '?',
          conflicts,
          lastError: state.lastError || 'Knowledge base directory is not configured. Please re-configure sync.',
          autoCommitInterval: syncConfig.autoCommitInterval || 30,
          autoPullInterval: syncConfig.autoPullInterval || 300,
        });
      }

      const hasRepo = callIsGitRepo(services, mindRoot);
      const remote = hasRepo ? callGetRemoteUrl(services, mindRoot) : null;
      if (!hasRepo || !remote) {
        return json({
          enabled: false,
          configured: true,
          needsSetup: true,
          provider: syncConfig.provider || 'git',
          remote: redactGitRemote(remote) || '(not configured)',
          branch: hasRepo ? (callGetBranch(services, mindRoot) || 'main') : 'main',
          lastSync: state.lastSync || null,
          lastPull: state.lastPull || null,
          unpushed: '?',
          conflicts,
          lastError: state.lastError || (!hasRepo
            ? 'Git repository not found in knowledge base directory. Please re-configure sync.'
            : 'Remote not configured. Please re-configure sync.'),
          autoCommitInterval: syncConfig.autoCommitInterval || 30,
          autoPullInterval: syncConfig.autoPullInterval || 300,
        });
      }

      return json({
        enabled: false,
        configured: true,
        provider: syncConfig.provider || 'git',
        remote: redactGitRemote(remote),
        branch: callGetBranch(services, mindRoot) || 'main',
        lastSync: state.lastSync || null,
        lastPull: state.lastPull || null,
        unpushed: callGetUnpushedCount(services, mindRoot),
        conflicts,
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
        branch: hasRepo && mindRoot ? (callGetBranch(services, mindRoot) || 'main') : 'main',
        lastSync: state.lastSync || null,
        lastPull: state.lastPull || null,
        unpushed: '?',
        conflicts,
        lastError: state.lastError || (!hasRepo
          ? 'Git repository not found in knowledge base directory. Please re-configure sync.'
          : 'Remote not configured. Please re-configure sync.'),
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
      conflicts,
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
    const configReadError = getConfigReadError(config);

    if (configReadError && payload.action !== 'reset') {
      return json({ error: configReadError }, { status: 500 });
    }

    const mindRoot = config.mindRoot;

    if (payload.action === 'reset') {
      return handleSyncReset(config, services);
    }

    if (!mindRoot) {
      return json({ error: 'No mindRoot configured' }, { status: 400 });
    }

    switch (payload.action) {
      case 'init':
        return await handleSyncInit(payload, config, services);
      case 'now':
        return await handleSyncNow(mindRoot, services);
      case 'on':
        return handleSyncToggle(mindRoot, config, services, true);
      case 'off':
        return handleSyncToggle(mindRoot, config, services, false);
      case 'gitignore-get':
        return handleGitignoreGet(mindRoot);
      case 'gitignore-save':
        return handleGitignoreSave(mindRoot, payload, services);
      case 'resolve-conflict':
        return handleResolveConflict(mindRoot, payload, services);
      case 'conflict-preview':
        return handleConflictPreview(mindRoot, payload, services);
      case 'update-intervals':
        return handleUpdateIntervals(mindRoot, payload, config, services);
      default:
        return json({ error: `Unknown action: ${payload.action}` }, { status: 400 });
    }
  } catch (error) {
    if (isSyncLockedError(error)) return syncLockedResponse(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function handleSyncToggle(
  mindRoot: string,
  config: MindosSyncConfig,
  services: MindosSyncServices,
  enabled: boolean,
): MindosServerResponse<Record<string, unknown> | { error: string }> {
  return withServerSyncLock(mindRoot, enabled ? 'sync-on' : 'sync-off', services, () => {
    config.sync = { ...(config.sync ?? {}), enabled };
    writeConfig(config, services);
    if (enabled) notifySyncDaemon(services, 'restart', mindRoot);
    else notifySyncDaemon(services, 'stop');
    return json({ ok: true, enabled });
  });
}

function handleSyncReset(
  config: MindosSyncConfig,
  services: MindosSyncServices,
): MindosServerResponse<{ ok: true; enabled: false } | { error: string }> {
  return withServerSyncLock(config.mindRoot ?? null, 'reset', services, () => {
    if (getConfigReadError(config)) {
      backupUnreadableConfig(services);
      writeConfig({}, services);
    } else {
      delete config.sync;
      writeConfig(stripInternalConfigFields(config), services);
    }
    try { writeState({}, services); } catch {}
    notifySyncDaemon(services, 'stop');
    return json({ ok: true, enabled: false });
  });
}

async function handleSyncInit(
  payload: MindosSyncPostPayload,
  config: MindosSyncConfig,
  services: MindosSyncServices,
): Promise<MindosServerResponse<Record<string, unknown> | { error: string }>> {
  const remote = payload.remote?.trim();
  if (!remote) {
    return json({ error: 'Remote URL is required' }, { status: 400 });
  }
  const isHttps = remote.startsWith('https://');
  const isSsh = /^git@[\w.-]+:.+/.test(remote) || /^ssh:\/\/git@[^/]+\/.+/.test(remote);
  if (!isHttps && !isSsh) {
    return json({ error: 'Invalid remote URL — must be HTTPS or SSH format' }, { status: 400 });
  }

  const branch = payload.branch?.trim() || 'main';
  if (!isValidGitBranchName(branch)) {
    return json({ error: 'Invalid branch name' }, { status: 400 });
  }
  const normalizedRemote = normalizeHttpsRemoteCredentials(remote, payload.token?.trim());
  const args = ['sync', 'init', '--non-interactive', '--remote', normalizedRemote.remote, '--branch', branch];
  const envOverrides = normalizedRemote.token ? { MINDOS_SYNC_TOKEN: normalizedRemote.token } : undefined;

  try {
    await runCli(args, 120000, services, envOverrides);
    if (config.mindRoot) notifySyncDaemon(services, 'restart', config.mindRoot);
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

function handleGitignoreGet(mindRoot: string): MindosServerResponse<{ content: string } | { error: string }> {
  try {
    return json({ content: readFileSync(resolveExistingSafe(mindRoot, '.gitignore'), 'utf-8') });
  } catch (error) {
    if (isFsErrorCode(error, 'ENOENT')) return json({ content: '' });
    const message = error instanceof Error ? error.message : String(error);
    if (/access denied|outside root|absolute paths/i.test(message)) return json({ error: 'Access denied' }, { status: 403 });
    return json({ error: message }, { status: 500 });
  }
}

function handleGitignoreSave(
  mindRoot: string,
  payload: MindosSyncPostPayload,
  services: MindosSyncServices,
): MindosServerResponse<{ ok: true; content: string; stoppedTracking: string[]; syncNeeded: boolean; warning?: string } | { error: string }> {
  if (typeof payload.content !== 'string') {
    return json({ error: 'Missing content' }, { status: 400 });
  }
  const content = ensureProtectedGitignoreEntries(payload.content);
  try {
    return withServerSyncLock(mindRoot, 'gitignore-save', services, () => {
      writeFileSync(resolveExistingSafe(mindRoot, '.gitignore'), content, 'utf-8');
      const tracking = stopTrackingIgnoredFiles(mindRoot);
      return json({
        ok: true,
        content,
        stoppedTracking: tracking.files,
        syncNeeded: tracking.files.length > 0,
        ...(tracking.warning ? { warning: tracking.warning } : {}),
      });
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
    const state = readState(services);
    const conflict = findConflict(state, file);
    if (strategy === 'keep-remote') {
      if (conflict?.remoteExists === false) {
        rmSync(originalPath, { force: true });
      } else if (existsSync(conflictPath)) {
        writeFileSync(originalPath, readFileSync(conflictPath, 'utf-8'), 'utf-8');
      } else {
        return json({ error: 'Remote conflict backup is missing' }, { status: 409 });
      }
    } else if (conflict?.localExists === false) {
      rmSync(originalPath, { force: true });
    }
    if (existsSync(conflictPath)) {
      unlinkSync(conflictPath);
    }

    const nextConflicts = normalizeConflicts(state.conflicts).filter((conflict) => conflict.file !== file);
    const nextState: MindosSyncState = { ...state, conflicts: nextConflicts };
    if (nextConflicts.length > 0) {
      writeState(nextState, services);
      return json({ ok: true, uploaded: false, pendingConflicts: nextConflicts.length });
    }

    const upload = commitAndPushResolvedSync(mindRoot, file);
    if (upload.uploaded) {
      nextState.lastSync = new Date().toISOString();
      nextState.lastError = null;
      delete nextState.lastErrorTime;
    } else if (upload.warning) {
      nextState.lastError = upload.warning;
      nextState.lastErrorTime = new Date().toISOString();
    }
    writeState(nextState, services);
    return json({
      ok: true,
      uploaded: upload.uploaded,
      ...(upload.warning ? { warning: upload.warning } : {}),
    });
  });
}

function handleConflictPreview(
  mindRoot: string,
  payload: MindosSyncPostPayload,
  services: MindosSyncServices,
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
  try {
    const conflict = findConflict(readState(services), file);
    if (!existsSync(remotePath)) {
      if (conflict?.remoteExists === false) {
        return json({
          local: conflict?.localExists === false || !existsSync(localPath) ? '' : readFileSync(localPath, 'utf-8'),
          remote: '',
        });
      }
      return json({ error: 'Remote conflict backup is missing' }, { status: 409 });
    }
    return json({
      local: conflict?.localExists === false || !existsSync(localPath) ? '' : readFileSync(localPath, 'utf-8'),
      remote: readFileSync(remotePath, 'utf-8'),
    });
  } catch (error) {
    if (isFsErrorCode(error, 'ENOENT')) {
      return json({ error: 'Remote conflict backup is missing' }, { status: 409 });
    }
    if (isFsErrorCode(error, 'EACCES') || isFsErrorCode(error, 'EPERM')) {
      return json({ error: 'Access denied' }, { status: 403 });
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function handleUpdateIntervals(
  mindRoot: string,
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

  return withServerSyncLock(mindRoot, 'update-intervals', services, () => {
    config.sync = config.sync ?? {};
    if (commitInterval !== undefined) config.sync.autoCommitInterval = commitInterval;
    if (pullInterval !== undefined) config.sync.autoPullInterval = pullInterval;
    writeConfig(config, services);
    if (config.sync.enabled) notifySyncDaemon(services, 'reconfigure', mindRoot);
    return json({
      autoCommitInterval: config.sync.autoCommitInterval || 30,
      autoPullInterval: config.sync.autoPullInterval || 300,
    });
  });
}

type ResolvedSyncUpload = {
  uploaded: boolean;
  warning?: string;
};

type StopTrackingIgnoredResult = {
  files: string[];
  warning?: string;
};

function stopTrackingIgnoredFiles(mindRoot: string): StopTrackingIgnoredResult {
  if (!isRealGitWorkTree(mindRoot)) return { files: [] };
  const trackedFiles = listTrackedGitFiles(mindRoot);
  if (trackedFiles.length === 0) return { files: [] };

  const ignoredTrackedFiles = listIgnoredFilesFromTrackedSet(mindRoot, trackedFiles)
    .filter(file => !TRACKING_EXEMPT_GITIGNORE_FILES.has(file));
  if (ignoredTrackedFiles.length === 0) return { files: [] };

  const stoppedTracking: string[] = [];
  for (const chunk of chunkArray(ignoredTrackedFiles, 100)) {
    try {
      execFileSync('git', ['rm', '--cached', '--ignore-unmatch', '--', ...chunk], {
        cwd: mindRoot,
        stdio: 'pipe',
        env: sanitizeGitEnv(),
        timeout: 60_000,
      });
      stoppedTracking.push(...chunk);
    } catch (error) {
      return {
        files: stoppedTracking,
        warning: gitFailureMessage('Saved .gitignore, but some previously synced files could not be removed from future syncs', error),
      };
    }
  }
  return { files: stoppedTracking };
}

function commitAndPushResolvedSync(mindRoot: string, file: string): ResolvedSyncUpload {
  if (!isRealGitWorkTree(mindRoot)) return { uploaded: false };
  const remote = getOriginRemoteForWrite(mindRoot);
  if (!remote) return { uploaded: false };
  const conflictBackup = `${file}.sync-conflict`;
  const pathspecs = [file, ...(isGitPathTracked(mindRoot, conflictBackup) ? [conflictBackup] : [])];

  try {
    ensureServerGitIdentity(mindRoot);
    const unpushedBefore = getUnpushedCommitCount(mindRoot);
    const resolvedStatus = getGitStatusForPathspecs(mindRoot, pathspecs);
    if (resolvedStatus.trim()) {
      execFileSync('git', ['commit', '--only', '-m', 'auto-sync: resolved sync conflict', '--', ...pathspecs], {
        cwd: mindRoot,
        stdio: 'pipe',
        env: sanitizeGitEnv(),
        timeout: 60_000,
      });
    }
    if (unpushedBefore === null) {
      return {
        uploaded: false,
        warning: 'Conflict resolved locally, but upload is waiting: MindOS could not confirm which commits would be uploaded. Use Sync now when you are ready to upload all local changes.',
      };
    }
    if (unpushedBefore > 0) {
      return {
        uploaded: false,
        warning: `Conflict resolved locally, but upload is waiting: ${unpushedBefore} earlier local commit${unpushedBefore === 1 ? '' : 's'} would also be uploaded. Use Sync now when you are ready to upload all local changes.`,
      };
    }
    execFileSync('git', ['push', '-u', 'origin', 'HEAD'], {
      cwd: mindRoot,
      stdio: 'pipe',
      env: { ...sanitizeGitEnv(), GIT_TERMINAL_PROMPT: '0', ...getGitSshEnvIfNeeded(remote) },
      timeout: 60_000,
    });
    return { uploaded: true };
  } catch (error) {
    return {
      uploaded: false,
      warning: gitFailureMessage('Conflict resolved locally, but upload failed', error),
    };
  }
}

function isRealGitWorkTree(mindRoot: string): boolean {
  try {
    return runGit(mindRoot, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

function getOriginRemoteForWrite(mindRoot: string): string | null {
  try {
    const remote = runGit(mindRoot, ['remote', 'get-url', 'origin']);
    return remote || null;
  } catch {
    return null;
  }
}

function getUnpushedCommitCount(mindRoot: string): number | null {
  try {
    const raw = runGit(mindRoot, ['rev-list', '--count', '@{u}..HEAD']);
    const count = Number.parseInt(raw, 10);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

function getGitStatusForPathspecs(mindRoot: string, pathspecs: string[]): string {
  try {
    return runGit(mindRoot, ['status', '--porcelain=v1', '--', ...pathspecs]);
  } catch {
    return '';
  }
}

function isGitPathTracked(mindRoot: string, pathspec: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', pathspec], {
      cwd: mindRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: sanitizeGitEnv(),
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function listTrackedGitFiles(mindRoot: string): string[] {
  try {
    return splitGitNulOutput(execFileSync('git', ['ls-files', '-z'], {
      cwd: mindRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sanitizeGitEnv(),
      timeout: 30_000,
    }));
  } catch {
    return [];
  }
}

function listIgnoredFilesFromTrackedSet(mindRoot: string, trackedFiles: string[]): string[] {
  if (trackedFiles.length === 0) return [];
  const input = `${trackedFiles.join('\0')}\0`;
  try {
    return splitGitNulOutput(execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
      cwd: mindRoot,
      input,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sanitizeGitEnv(),
      timeout: 30_000,
    }));
  } catch (error) {
    const stdout = typeof error === 'object' && error !== null && 'stdout' in error
      ? Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf-8') : String(error.stdout || '')
      : '';
    return stdout ? splitGitNulOutput(stdout) : [];
  }
}

function splitGitNulOutput(raw: string): string[] {
  return raw.split('\0').filter(item => item.length > 0);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function ensureServerGitIdentity(mindRoot: string): void {
  if (!readServerGitConfig(mindRoot, 'user.email')) {
    execFileSync('git', ['config', 'user.email', 'mindos@local'], { cwd: mindRoot, stdio: 'pipe', env: sanitizeGitEnv(), timeout: 5000 });
  }
  if (!readServerGitConfig(mindRoot, 'user.name')) {
    execFileSync('git', ['config', 'user.name', 'MindOS'], { cwd: mindRoot, stdio: 'pipe', env: sanitizeGitEnv(), timeout: 5000 });
  }
}

function readServerGitConfig(mindRoot: string, key: string): string {
  try {
    return runGit(mindRoot, ['config', '--get', key]);
  } catch {
    return '';
  }
}

function getGitSshEnvIfNeeded(remote: string): Record<string, string> {
  if (!isSshGitRemote(remote)) return {};
  return { GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes' };
}

function isSshGitRemote(remote: string): boolean {
  return /^git@[\w.-]+:.+/.test(remote) || /^ssh:\/\/git@[^/]+\/.+/.test(remote);
}

function gitFailureMessage(prefix: string, error: unknown): string {
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error
    ? Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf-8').trim() : String(error.stderr || '').trim()
    : '';
  const stdout = typeof error === 'object' && error !== null && 'stdout' in error
    ? Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf-8').trim() : String(error.stdout || '').trim()
    : '';
  const detail = stderr || stdout || (error instanceof Error ? error.message : String(error));
  return `${prefix}: ${detail || 'unknown error'}`;
}

function isValidGitBranchName(input: string): boolean {
  const value = input.trim();
  if (!value || value === '@') return false;
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/')) return false;
  if (value.endsWith('.') || value.includes('..') || value.includes('//') || value.includes('@{')) return false;
  if (/[\s~^:?*\[\\\]]/.test(value)) return false;
  return value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

type NormalizedSyncConflict = {
  file: string;
  time?: string;
  noBackup?: boolean;
  localExists?: boolean;
  remoteExists?: boolean;
};

function normalizeConflicts(value: unknown): NormalizedSyncConflict[] {
  const items = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
  const conflicts: NormalizedSyncConflict[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const file = item.trim();
      if (file) conflicts.push({ file });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const file = typeof record.file === 'string' ? record.file.trim() : '';
    if (!file) continue;
    conflicts.push({
      file,
      ...(typeof record.time === 'string' && record.time ? { time: record.time } : {}),
      ...(record.noBackup === true ? { noBackup: true } : {}),
      ...(typeof record.localExists === 'boolean' ? { localExists: record.localExists } : {}),
      ...(typeof record.remoteExists === 'boolean' ? { remoteExists: record.remoteExists } : {}),
    });
  }
  return conflicts;
}

function findConflict(state: MindosSyncState, file: string): NormalizedSyncConflict | null {
  return normalizeConflicts(state.conflicts).find((conflict) => conflict.file === file) ?? null;
}

function notifySyncDaemon(
  services: MindosSyncServices,
  action: 'start' | 'stop' | 'reconfigure' | 'restart',
  mindRoot?: string,
): void {
  try {
    if (action === 'stop') {
      services.syncDaemon?.stop?.();
      return;
    }
    if (!mindRoot) return;
    if (action === 'restart') {
      if (services.syncDaemon?.restart) {
        services.syncDaemon.restart(mindRoot);
      } else {
        services.syncDaemon?.stop?.();
        services.syncDaemon?.start?.(mindRoot);
      }
      return;
    }
    if (action === 'reconfigure') {
      if (services.syncDaemon?.reconfigure) services.syncDaemon.reconfigure(mindRoot);
      else if (services.syncDaemon?.restart) services.syncDaemon.restart(mindRoot);
      return;
    }
    services.syncDaemon?.start?.(mindRoot);
  } catch {
    // Sync config/state has already been persisted. Runtime daemon refresh is
    // best-effort and will also be corrected by the daemon config poller.
  }
}

function readConfig(services: MindosSyncServices): MindosSyncConfig {
  if (services.readConfig) return services.readConfig();
  return readJsonFile(services.configPath ?? DEFAULT_CONFIG_PATH, { reportParseError: true });
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
  if (owner.pid && isProcessAlive(owner.pid)) return false;
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

function readJsonFile<T extends Record<string, any>>(filePath: string, opts: { reportParseError?: boolean } = {}): T {
  let raw = '';
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return {} as T;
  }
  try {
    return JSON.parse(stripBom(raw)) as T;
  } catch (error) {
    if (!opts.reportParseError) return {} as T;
    const detail = error instanceof Error ? error.message : String(error);
    return {
      __readError: `MindOS config file could not be read: ${detail}`,
      __readErrorPath: filePath,
    } as unknown as T;
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

function getConfigReadError(config: MindosSyncConfig): string | null {
  return typeof config.__readError === 'string' && config.__readError ? config.__readError : null;
}

function stripInternalConfigFields(config: MindosSyncConfig): MindosSyncConfig {
  const { __readError, __readErrorPath, ...rest } = config;
  return rest;
}

function backupUnreadableConfig(services: MindosSyncServices): void {
  const configPath = services.configPath ?? DEFAULT_CONFIG_PATH;
  if (services.readConfig || services.writeConfig || !existsSync(configPath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    renameSync(configPath, `${configPath}.broken-${stamp}`);
  } catch {}
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
  let unpushedCommits: number | null = null;
  let dirtyFiles: number | null = null;

  try {
    const raw = runGit(cwd, ['rev-list', '--count', '@{u}..HEAD']);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) unpushedCommits = parsed;
  } catch {}

  try {
    const status = runGit(cwd, ['status', '--porcelain=v1']);
    dirtyFiles = status
      ? status.split('\n').filter(line => line.trim() && !line.slice(3).endsWith('.sync-conflict')).length
      : 0;
  } catch {}

  if (unpushedCommits === null && dirtyFiles === null) return '?';
  if (unpushedCommits === null && dirtyFiles === 0) return '?';
  return String((unpushedCommits || 0) + (dirtyFiles || 0));
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: sanitizeGitEnv(),
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

function looksLikeAccessToken(value: string): boolean {
  return /^(gh[pousr]_|github_pat_|glpat-|pat_)/i.test(value);
}

function normalizeHttpsRemoteCredentials(remote: string, token?: string): { remote: string; token?: string } {
  if (!/^https?:\/\//i.test(remote)) return { remote, token };

  try {
    const parsed = new URL(remote);
    const embeddedPassword = parsed.password ? decodeURIComponent(parsed.password) : '';
    const embeddedUsername = parsed.username ? decodeURIComponent(parsed.username) : '';
    parsed.username = '';
    parsed.password = '';
    return {
      remote: parsed.toString(),
      token: token || embeddedPassword || (looksLikeAccessToken(embeddedUsername) ? embeddedUsername : undefined),
    };
  } catch {
    return { remote, token };
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

  // The child CLI spawns its own git against mindRoot — repo-targeting vars
  // inherited from a git hook must not reach it either.
  const env = { ...sanitizeGitEnv(services.env ?? process.env), ...(envOverrides ?? {}) };
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
