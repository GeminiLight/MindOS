import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { CONFIG_PATH, MINDOS_DIR } from './constants.js';
import { bold, dim, cyan, green, red, yellow } from './colors.js';
import { stripBom } from './jsonc.js';
import { resolveInsideRoot } from './safe-path.js';

// ── Atomic write helper ────────────────────────────────────────────────────

function atomicWriteJSON(filePath, data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmp = filePath + '.tmp';
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

// ── Config helpers ──────────────────────────────────────────────────────────

function loadSyncConfig() {
  try {
    return loadMindosConfig().sync || {};
  } catch {
    return {};
  }
}

function loadMindosConfig() {
  return JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8')));
}

function hasSyncConfig() {
  try {
    const config = loadMindosConfig();
    return Object.prototype.hasOwnProperty.call(config, 'sync') && !!config.sync;
  } catch {
    return false;
  }
}

function saveSyncConfig(syncConfig) {
  let config = {};
  try { config = JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8'))); } catch {}
  config.sync = syncConfig;
  atomicWriteJSON(CONFIG_PATH, config);
}

function getMindRoot() {
  try {
    const config = JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8')));
    return config.mindRoot;
  } catch {
    return null;
  }
}

const SYNC_STATE_PATH = resolve(MINDOS_DIR, 'sync-state.json');
const SYNC_LOCK_OWNER_STALE_MS = 5 * 60 * 1000;
const SYNC_LOCK_ALIVE_HARD_STALE_MS = 30 * 60 * 1000;
const SYNC_LOCK_RETRY_MS = 200;
const SYNC_LOCK_DEFAULT_WAIT_MS = 5000;
const activeSyncLockDepth = new Map();
const SYSTEM_IGNORES = [
  'INSTRUCTION.md',
];
const PROTECTED_SYNC_IGNORES = ['*.sync-conflict', ...SYSTEM_IGNORES];

export class SyncLockedError extends Error {
  constructor(owner) {
    super(formatSyncLockedMessage(owner));
    this.name = 'SyncLockedError';
    this.code = 'SYNC_LOCKED';
    this.owner = owner || null;
  }
}

function loadSyncState() {
  try {
    return JSON.parse(stripBom(readFileSync(SYNC_STATE_PATH, 'utf-8')));
  } catch {
    return {};
  }
}

function normalizeConflicts(value) {
  const items = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
  const conflicts = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const file = item.trim();
      if (file) conflicts.push({ file });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const file = typeof item.file === 'string' ? item.file.trim() : '';
    if (!file) continue;
    conflicts.push({
      file,
      ...(typeof item.time === 'string' && item.time ? { time: item.time } : {}),
      ...(item.noBackup === true ? { noBackup: true } : {}),
      ...(typeof item.localExists === 'boolean' ? { localExists: item.localExists } : {}),
      ...(typeof item.remoteExists === 'boolean' ? { remoteExists: item.remoteExists } : {}),
    });
  }
  return conflicts;
}

function saveSyncState(state) {
  if (!existsSync(MINDOS_DIR)) mkdirSync(MINDOS_DIR, { recursive: true });
  atomicWriteJSON(SYNC_STATE_PATH, state);
}

export function getSyncLockPath(mindRoot) {
  const normalized = resolve(mindRoot || '.');
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return resolve(MINDOS_DIR, 'sync-locks', `${hash}.lock`);
}

function readSyncLockOwner(lockPath) {
  try {
    return JSON.parse(stripBom(readFileSync(resolve(lockPath, 'owner.json'), 'utf-8')));
  } catch {
    return null;
  }
}

function getLockAgeMs(lockPath, owner) {
  const startedAt = owner?.startedAt ? new Date(owner.startedAt).getTime() : NaN;
  if (Number.isFinite(startedAt)) return Math.max(0, Date.now() - startedAt);
  try {
    return Math.max(0, Date.now() - statSync(lockPath).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function isSyncLockStale(lockPath) {
  const owner = readSyncLockOwner(lockPath);
  const ageMs = getLockAgeMs(lockPath, owner);
  if (!owner || typeof owner !== 'object') return ageMs > SYNC_LOCK_OWNER_STALE_MS;
  if (owner.hostname && owner.hostname !== hostname()) {
    return ageMs > SYNC_LOCK_ALIVE_HARD_STALE_MS;
  }
  if (owner.pid && !isProcessAlive(owner.pid)) return true;
  if (owner.pid && isProcessAlive(owner.pid)) return false;
  if (!owner.pid) return ageMs > SYNC_LOCK_OWNER_STALE_MS;
  return false;
}

function formatSyncLockedMessage(owner) {
  const parts = [];
  if (owner?.operation) parts.push(`owner=${owner.operation}`);
  if (owner?.pid) parts.push(`pid=${owner.pid}`);
  if (owner?.startedAt) parts.push(`startedAt=${owner.startedAt}`);
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return `SYNC_LOCKED: Sync is already running${suffix}`;
}

export function isSyncLockedError(error) {
  return error?.code === 'SYNC_LOCKED' || /SYNC_LOCKED/i.test(String(error?.message || error));
}

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireSyncLock(mindRoot, operation, options = {}) {
  const lockPath = getSyncLockPath(mindRoot);
  const activeDepth = activeSyncLockDepth.get(lockPath);
  if (activeDepth) {
    activeSyncLockDepth.set(lockPath, activeDepth + 1);
    return { lockPath, reentrant: true, token: null };
  }

  mkdirSync(dirname(lockPath), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const waitMs = Math.max(0, options.waitMs ?? SYNC_LOCK_DEFAULT_WAIT_MS);
  const retryMs = Math.max(25, options.retryMs ?? SYNC_LOCK_RETRY_MS);
  const deadline = Date.now() + waitMs;

  while (true) {
    try {
      mkdirSync(lockPath);
      try {
        writeFileSync(resolve(lockPath, 'owner.json'), JSON.stringify({
          pid: process.pid,
          hostname: hostname(),
          operation,
          mindRoot: resolve(mindRoot || '.'),
          startedAt: new Date().toISOString(),
          token,
        }, null, 2), 'utf-8');
      } catch (writeErr) {
        rmSync(lockPath, { recursive: true, force: true });
        throw writeErr;
      }
      activeSyncLockDepth.set(lockPath, 1);
      return { lockPath, reentrant: false, token };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      if (!isSyncLockStale(lockPath)) {
        const owner = readSyncLockOwner(lockPath);
        if (owner?.pid === process.pid) throw new SyncLockedError(owner);
        if (Date.now() >= deadline) throw new SyncLockedError(owner);
        sleepSync(Math.min(retryMs, Math.max(0, deadline - Date.now())));
        continue;
      }
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
}

export function releaseSyncLock(lock) {
  const depth = activeSyncLockDepth.get(lock.lockPath) || 0;
  if (depth > 1) {
    activeSyncLockDepth.set(lock.lockPath, depth - 1);
    return;
  }
  activeSyncLockDepth.delete(lock.lockPath);
  if (lock.reentrant) return;

  const owner = readSyncLockOwner(lock.lockPath);
  if (owner?.token === lock.token) {
    rmSync(lock.lockPath, { recursive: true, force: true });
  }
}

export function withSyncLock(mindRoot, operation, fn, options = {}) {
  const lock = acquireSyncLock(mindRoot, operation, options);
  try {
    return fn();
  } finally {
    releaseSyncLock(lock);
  }
}

// ── Git helpers ─────────────────────────────────────────────────────────────

function isGitRepo(dir) {
  return existsSync(resolve(dir, '.git'));
}

function gitExec(args, cwd, timeoutMs = 15000) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs }).trim();
}

function gitFailureMessage(prefix, err) {
  const stderr = err?.stderr?.toString?.().trim?.() || '';
  const stdout = err?.stdout?.toString?.().trim?.() || '';
  const detail = stderr || stdout || err?.message || 'unknown error';
  return `${prefix}: ${detail}`;
}

function readGitConfig(cwd, key) {
  try {
    return gitExec(['config', '--get', key], cwd);
  } catch {
    return '';
  }
}

function ensureGitIdentity(cwd) {
  if (!readGitConfig(cwd, 'user.email')) {
    execFileSync('git', ['config', 'user.email', 'mindos@local'], { cwd, stdio: 'pipe', timeout: 5000 });
  }
  if (!readGitConfig(cwd, 'user.name')) {
    execFileSync('git', ['config', 'user.name', 'MindOS'], { cwd, stdio: 'pipe', timeout: 5000 });
  }
}

function normalizeBranchName(branch, cwd) {
  const value = (branch || 'main').trim();
  if (!value) throw new Error('Branch name is required');
  try {
    execFileSync('git', ['check-ref-format', '--branch', value], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return value;
  } catch {
    throw new Error(`Invalid branch name: ${value}`);
  }
}

function remoteHasBranch(remoteRefs, branch) {
  const expected = `refs/heads/${branch}`;
  return remoteRefs.split('\n').some(line => line.trim().split(/\s+/).pop() === expected);
}

function checkoutBranch(mindRoot, branch) {
  if (getBranch(mindRoot) === branch) return;
  try {
    execFileSync('git', ['checkout', branch], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 });
  } catch {
    execFileSync('git', ['checkout', '-b', branch], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 });
  }
}

function redactGitRemote(remote) {
  if (!remote || !/^https?:\/\//i.test(remote)) return remote;
  try {
    const parsed = new URL(remote);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return remote.replace(/^(https?:\/\/)[^/@]+@/i, '$1');
  }
}

function looksLikeAccessToken(value) {
  if (!value) return false;
  return /^(gh[pousr]_|github_pat_|glpat-|pat_)/i.test(value);
}

function normalizeHttpsRemoteCredentials(remote, token) {
  if (!remote || !/^https?:\/\//i.test(remote)) return { remote, token };
  try {
    const parsed = new URL(remote);
    const embeddedPassword = parsed.password ? decodeURIComponent(parsed.password) : '';
    const embeddedUsername = parsed.username ? decodeURIComponent(parsed.username) : '';
    parsed.username = '';
    parsed.password = '';
    return {
      remote: parsed.toString(),
      token: token || embeddedPassword || (looksLikeAccessToken(embeddedUsername) ? embeddedUsername : ''),
    };
  } catch {
    return { remote, token };
  }
}

/** Check if URL is SSH format (git@host:path or ssh://git@host/path) */
function isSSHUrl(url) {
  return /^git@[\w.-]+:.+/.test(url) || /^ssh:\/\/git@[^/]+\/.+/.test(url);
}

/** Get SSH environment for git commands to auto-accept new hosts */
function getSshEnv() {
  // StrictHostKeyChecking=accept-new: auto-add unknown hosts to known_hosts
  // BatchMode=yes: no interactive prompts (fail fast if key not available)
  const sshCmd = 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes';
  return { GIT_SSH_COMMAND: sshCmd };
}

/** Validate SSH setup before attempting to use SSH URL */
function validateSSHSetup(url) {
  if (!isSSHUrl(url)) return { isSSH: false };
  // Do not pre-reject SSH based on default key filenames. Users may rely on
  // ~/.ssh/config, hardware keys, platform agents, or GIT_SSH_COMMAND.
  return { isSSH: true, isValid: true };
}

/** Execute git command with SSH support (auto-add to known_hosts on first connection) */
function gitExecSSH(args, cwd, isSSH = false, timeoutMs = 15000) {
  const opts = { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs };
  if (isSSH) {
    opts.env = { ...process.env, ...getSshEnv() };
  }
  return execFileSync('git', args, opts).trim();
}

function getRemoteUrl(cwd) {
  try {
    return gitExec(['remote', 'get-url', 'origin'], cwd);
  } catch {
    return null;
  }
}

function getBranch(cwd) {
  try {
    return gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  } catch {
    return 'main';
  }
}

function getUnpushedCount(cwd) {
  let unpushedCommits = null;
  let dirtyFiles = null;

  try {
    const raw = gitExec(['rev-list', '--count', '@{u}..HEAD'], cwd);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) unpushedCommits = parsed;
  } catch {}

  try {
    const status = gitExec(['status', '--porcelain=v1'], cwd);
    dirtyFiles = status
      ? status.split('\n').filter(line => line.trim() && !line.slice(3).endsWith('.sync-conflict')).length
      : 0;
  } catch {}

  if (unpushedCommits === null && dirtyFiles === null) {
    return '?';
  }
  if (unpushedCommits === null && dirtyFiles === 0) {
    return '?';
  }

  return String((unpushedCommits || 0) + (dirtyFiles || 0));
}

export function getSyncConflictBackupPath(mindRoot, file) {
  return resolveInsideRoot(mindRoot, `${file}.sync-conflict`);
}

export function getSyncGitignorePath(mindRoot) {
  return resolveInsideRoot(mindRoot, '.gitignore');
}

// ── Core sync functions ─────────────────────────────────────────────────────

function getConflictStageInfo(mindRoot, file) {
  const stages = new Set();
  try {
    const raw = gitExec(['ls-files', '-u', '--', file], mindRoot);
    for (const line of raw.split('\n')) {
      const match = line.match(/^\d+\s+[0-9a-f]+\s+([123])\t/);
      if (match) stages.add(Number(match[1]));
    }
  } catch {}

  return {
    localExists: stages.has(2),
    remoteExists: stages.has(3),
  };
}

function removeWorkingTreeFile(mindRoot, file) {
  rmSync(resolveInsideRoot(mindRoot, file), { force: true });
}

function ensureProtectedSyncGitignore(mindRoot) {
  const gitignorePath = getSyncGitignorePath(mindRoot);
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, [
      '# MindOS auto-generated',
      '.DS_Store',
      'Thumbs.db',
      '*.tmp',
      '*.bak',
      '*.swp',
      '*.sync-conflict',
      'node_modules/',
      '.obsidian/',
      '',
      '# MindOS system files (regenerated on update, not user content)',
      ...SYSTEM_IGNORES,
      '',
    ].join('\n'), 'utf-8');
  } else {
    const existing = readFileSync(gitignorePath, 'utf-8');
    const existingLines = existing.split(/\r?\n/).map(line => line.trim());
    const missing = PROTECTED_SYNC_IGNORES.filter(f => !existingLines.includes(f));
    if (missing.length > 0) {
      const append = '\n# MindOS system files (auto-added)\n' + missing.join('\n') + '\n';
      writeFileSync(gitignorePath, existing.trimEnd() + '\n' + append, 'utf-8');
    }
  }

  for (const file of PROTECTED_SYNC_IGNORES) {
    try { execFileSync('git', ['rm', '--cached', '--ignore-unmatch', file], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 }); } catch {}
  }
}

function stageSyncContentUnlocked(mindRoot) {
  ensureProtectedSyncGitignore(mindRoot);
  execFileSync('git', ['add', '-A'], { cwd: mindRoot, stdio: 'pipe', timeout: 60000 });
}

function hasPendingChangesUnlocked(mindRoot) {
  try {
    const status = gitExec(['status', '--porcelain'], mindRoot);
    return status.split('\n').some(line => line.trim() && !line.slice(3).endsWith('.sync-conflict'));
  } catch {
    return true;
  }
}

function autoCommitAndPush(mindRoot, isSshUrl = false) {
  return withSyncLock(mindRoot, 'commit-push', () => autoCommitAndPushUnlocked(mindRoot, isSshUrl));
}

function autoCommitAndPushUnlocked(mindRoot, isSshUrl = false) {
  commitPendingChangesUnlocked(mindRoot);
  pushHeadUnlocked(mindRoot, isSshUrl);
}

function commitPendingChangesUnlocked(mindRoot) {
  // Stage and commit any pending changes before a pull/push operation. Initial
  // sync needs this too, otherwise a populated remote can overwrite untracked
  // local notes before MindOS has put them under version control.
  try {
    if (!hasPendingChangesUnlocked(mindRoot)) return;
    ensureGitIdentity(mindRoot);
    stageSyncContentUnlocked(mindRoot);
    const status = gitExec(['status', '--porcelain'], mindRoot);
    if (status) {
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      execFileSync('git', ['commit', '-m', `auto-sync: ${timestamp}`], { cwd: mindRoot, stdio: 'pipe', timeout: 60000 });
    }
  } catch (err) {
    const message = gitFailureMessage('Commit failed', err);
    saveSyncState({ ...loadSyncState(), lastError: message, lastErrorTime: new Date().toISOString() });
    throw new Error(message);
  }
}

function pushHeadUnlocked(mindRoot, isSshUrl = false) {
  const sshEnv = isSshUrl ? getSshEnv() : {};
  const pushEnv = { ...process.env, ...sshEnv };

  // Always try to push (even if no new commit — there may be unpushed commits from previous runs)
  try {
    execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: mindRoot, stdio: 'pipe', env: pushEnv, timeout: 60000 });
    saveSyncState({ ...loadSyncState(), lastSync: new Date().toISOString(), lastError: null });
  } catch (err) {
    const message = gitFailureMessage('Push failed', err);
    saveSyncState({ ...loadSyncState(), lastError: message, lastErrorTime: new Date().toISOString() });
    throw new Error(message); // Let caller know push failed
  }
}

function resolveMergeConflictsKeepingLocal(mindRoot, mergeErr, failurePrefix = 'Pull failed') {
  let conflicts = [];
  const conflictDetails = [];
  try {
    conflicts = gitExec(['diff', '--name-only', '--diff-filter=U'], mindRoot).split('\n').filter(Boolean);
    if (conflicts.length === 0) {
      const message = gitFailureMessage(failurePrefix, mergeErr);
      saveSyncState({
        ...loadSyncState(),
        lastError: message,
        lastErrorTime: new Date().toISOString(),
      });
      const pullFailure = new Error(message);
      pullFailure.code = 'MINDOS_PULL_FAILED';
      throw pullFailure;
    }

    // Keep the local file in place and save the remote version beside it so the
    // settings UI can offer an explicit keep-local / keep-remote choice.
    ensureProtectedSyncGitignore(mindRoot);
    for (const file of conflicts) {
      const stageInfo = getConflictStageInfo(mindRoot, file);
      let noBackup = false;
      if (stageInfo.remoteExists) {
        try {
          const theirs = execFileSync('git', ['show', `:3:${file}`], { cwd: mindRoot, encoding: 'utf-8' });
          writeFileSync(getSyncConflictBackupPath(mindRoot, file), theirs, 'utf-8');
        } catch {
          noBackup = true;
        }
      }
      if (stageInfo.localExists) {
        try { execFileSync('git', ['checkout', '--ours', '--', file], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 }); } catch {}
      } else {
        try { removeWorkingTreeFile(mindRoot, file); } catch {}
      }
      conflictDetails.push({ file, localExists: stageInfo.localExists, remoteExists: stageInfo.remoteExists, noBackup });
    }
    stageSyncContentUnlocked(mindRoot);
    try {
      execFileSync('git', ['-c', 'core.editor=true', 'commit', '--no-edit'], { cwd: mindRoot, stdio: 'pipe', timeout: 60000 });
    } catch (commitErr) {
      try {
        execFileSync('git', ['commit', '-m', 'auto-sync: resolved conflicts (kept local versions)'], { cwd: mindRoot, stdio: 'pipe', timeout: 60000 });
      } catch {
        saveSyncState({
          ...loadSyncState(),
          lastError: gitFailureMessage('Conflict commit failed', commitErr),
          lastErrorTime: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    saveSyncState({ ...loadSyncState(), lastError: err.message, lastErrorTime: new Date().toISOString() });
    if (err?.code === 'MINDOS_PULL_FAILED') throw err;
  }

  if (conflicts.length > 0) {
    const now = new Date().toISOString();
    saveSyncState({
      ...loadSyncState(),
      lastPull: now,
      conflicts: conflictDetails.map(detail => ({
        file: detail.file,
        time: now,
        localExists: detail.localExists,
        remoteExists: detail.remoteExists,
        ...(detail.noBackup ? { noBackup: true } : {}),
      })),
    });
  }
  return conflicts;
}

function autoPull(mindRoot, isSshUrl = false) {
  return withSyncLock(mindRoot, 'pull', () => autoPullUnlocked(mindRoot, isSshUrl));
}

function runBackgroundSync(mindRoot, operation, fn, options = {}) {
  try {
    return withSyncLock(mindRoot, operation, fn, { waitMs: 0, ...options });
  } catch (err) {
    if (isSyncLockedError(err)) return null;
    const message = err?.message || String(err);
    saveSyncState({ ...loadSyncState(), lastError: message, lastErrorTime: new Date().toISOString() });
    return null;
  }
}

function autoPullUnlocked(mindRoot, isSshUrl = false) {
  const sshEnv = isSshUrl ? getSshEnv() : {};
  let hasConflicts = false;
  commitPendingChangesUnlocked(mindRoot);
  try {
    execFileSync('git', ['pull', '--rebase', '--autostash'], { cwd: mindRoot, stdio: 'pipe', env: { ...process.env, ...sshEnv }, timeout: 60000 });
    saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
  } catch {
    // rebase conflict → abort → merge
    try { execFileSync('git', ['rebase', '--abort'], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 }); } catch {}
    try {
      execFileSync('git', ['pull', '--no-rebase'], { cwd: mindRoot, stdio: 'pipe', env: { ...process.env, ...sshEnv }, timeout: 60000 });
      saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
    } catch (mergeErr) {
      hasConflicts = resolveMergeConflictsKeepingLocal(mindRoot, mergeErr, 'Pull failed').length > 0;
    }
  }

  if (hasConflicts) return { conflicts: true };

  // Retry any pending pushes (handles previous push failures)
  try {
    execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: mindRoot, stdio: 'pipe', env: { ...process.env, ...sshEnv }, timeout: 60000 });
    saveSyncState({ ...loadSyncState(), lastSync: new Date().toISOString(), lastError: null });
  } catch (err) {
    // Push failed — will be retried next cycle or by manualSync
    saveSyncState({ ...loadSyncState(), lastError: gitFailureMessage('Push failed', err), lastErrorTime: new Date().toISOString() });
  }
}

// ── Exported API ────────────────────────────────────────────────────────────

let activeWatcher = null;
let activePullInterval = null;
let activeShutdownHandler = null;
let activeCommitTimer = null;
let activeConfigPollInterval = null;
let activeDaemonStartPromise = null;
let activeMindRoot = null;
let activeAutoCommitInterval = null;
let activeAutoPullInterval = null;
let activeIsSshUrl = false;

const DAEMON_CONFIG_POLL_MS = 5000;

/**
 * Interactive sync init — configure remote git repo
 */
export async function initSync(mindRoot, opts = {}) {
  if (!mindRoot) { console.error(red('No mindRoot configured.')); process.exit(1); }

  const nonInteractive = opts.nonInteractive || false;
  let remoteUrl = opts.remote || '';
  let token = opts.token || '';
  let branch = opts.branch || 'main';

  if (nonInteractive) {
    // Non-interactive mode: all params from opts
    if (!remoteUrl) {
      throw new Error('Remote URL is required in non-interactive mode');
    }
  } else {
    // Interactive mode: prompt user
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    // 2. Remote URL
    const currentRemote = getRemoteUrl(mindRoot);
    const defaultUrl = currentRemote || '';
    const urlPrompt = currentRemote
      ? `${bold('Remote URL')} ${dim(`[${currentRemote}]`)}: `
      : `${bold('Remote URL')} ${dim('(HTTPS or SSH)')}: `;
    remoteUrl = (await ask(urlPrompt)).trim() || defaultUrl;

    if (!remoteUrl) {
      console.error(red('Remote URL is required.'));
      rl.close();
      process.exit(1);
    }

    rl.close();

    // 3. Token for HTTPS
    if (remoteUrl.startsWith('https://')) {
      const { promptHidden, closePrompts } = await import('./channel-prompts.js');
      try {
        token = (await promptHidden(`${bold('Access Token')} ${dim('(GitHub PAT / GitLab PAT, leave empty if SSH, hidden)')}: `, { maskInput: true })).trim();
      } finally {
        closePrompts();
      }
    }
  }

  try {
    branch = normalizeBranchName(branch, mindRoot);
  } catch (err) {
    if (nonInteractive) throw err;
    console.error(red(`✘ ${err.message}`));
    process.exit(1);
  }

  const initLock = acquireSyncLock(mindRoot, 'init');
  let previousOrigin = null;
  let previousBranch = null;
  let originMutated = false;
  let branchMutated = false;
  let approvedCredentialInput = null;
  const rollbackInitSideEffects = () => {
    if (branchMutated && previousBranch) {
      try {
        execFileSync('git', ['checkout', previousBranch], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 });
      } catch {}
    }
    if (originMutated) {
      try {
        if (previousOrigin) {
          execFileSync('git', ['remote', 'set-url', 'origin', previousOrigin], { cwd: mindRoot, stdio: 'pipe', timeout: 5000 });
        } else {
          execFileSync('git', ['remote', 'remove', 'origin'], { cwd: mindRoot, stdio: 'pipe', timeout: 5000 });
        }
      } catch {}
    }
    if (approvedCredentialInput) {
      try {
        execFileSync('git', ['credential', 'reject'], { cwd: mindRoot, input: approvedCredentialInput, stdio: 'pipe', timeout: 5000 });
      } catch {}
    }
  };
  try {
    const normalizedRemote = normalizeHttpsRemoteCredentials(remoteUrl, token);
    remoteUrl = normalizedRemote.remote;
    token = normalizedRemote.token;

    // Pre-flight SSH validation (before git init)
    const sshValidation = validateSSHSetup(remoteUrl);
    if (sshValidation.isSSH && !sshValidation.isValid) {
      const err = sshValidation.error;
      if (nonInteractive) throw new Error(err);
      console.error(red(`✘ ${err}`));
      process.exit(1);
    }
    const isSshUrl = sshValidation.isSSH;
    if (!isGitRepo(mindRoot)) {
      if (!nonInteractive) console.log(dim('Initializing git repository...'));
      execFileSync('git', ['init'], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 });
      try {
        execFileSync('git', ['checkout', '-B', branch], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 });
      } catch (err) {
        const message = gitFailureMessage(`Failed to create branch "${branch}"`, err);
        if (nonInteractive) throw new Error(message);
        console.error(red(`✘ ${message}`));
        process.exit(1);
      }
    } else {
      try {
        previousBranch = getBranch(mindRoot);
        checkoutBranch(mindRoot, branch);
        branchMutated = previousBranch && previousBranch !== getBranch(mindRoot);
      } catch (err) {
        const message = gitFailureMessage(`Failed to switch to branch "${branch}"`, err);
        if (nonInteractive) throw new Error(message);
        console.error(red(`✘ ${message}`));
        process.exit(1);
      }
    }

    // 1b. Ensure .gitignore has system file exclusions
    ensureProtectedSyncGitignore(mindRoot);

    // Handle token for HTTPS
    if (token && remoteUrl.startsWith('https://')) {
      const urlObj = new URL(remoteUrl);
      // Choose credential helper by platform
      const platform = process.platform;
      let helper;
      if (platform === 'darwin') helper = 'osxkeychain';
      else if (platform === 'win32') helper = 'manager';
      else helper = 'store';
      try { execFileSync('git', ['config', 'credential.helper', helper], { cwd: mindRoot, stdio: 'pipe', timeout: 5000 }); } catch (e) {
        console.error(`[sync] credential.helper setup failed: ${e.message}`);
      }
      // Store the credential via git credential approve, then verify it stuck.
      let credentialStored = false;
      try {
        const credInput = `protocol=${urlObj.protocol.replace(':', '')}\nhost=${urlObj.host}\nusername=oauth2\npassword=${token}\n\n`;
        execFileSync('git', ['credential', 'approve'], { cwd: mindRoot, input: credInput, stdio: 'pipe', timeout: 5000 });
        approvedCredentialInput = credInput;
        // Verify: credential fill should return the password we just stored.
        try {
          const fillInput = `protocol=${urlObj.protocol.replace(':', '')}\nhost=${urlObj.host}\nusername=oauth2\n\n`;
          const fillResult = execFileSync('git', ['credential', 'fill'], {
            cwd: mindRoot, input: fillInput, encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          });
          credentialStored = fillResult.includes(`password=${token}`);
        } catch {
          credentialStored = false;
        }
      } catch (e) {
        if (!nonInteractive) console.error(`[sync] credential approve failed: ${e.message}`);
      }
      // Do not write tokens into .git/config. If the credential helper cannot
      // persist the credential, fail explicitly so users can fix auth without
      // leaving a secret in the repository remote URL.
      if (!credentialStored) {
        const message = 'Git credential helper did not store the access token. Configure a Git credential helper or use SSH, then try again.';
        saveSyncState({ ...loadSyncState(), lastError: message, lastErrorTime: new Date().toISOString() });
        rollbackInitSideEffects();
        if (nonInteractive) throw new Error(message);
        console.error(red(`✘ ${message}`));
        process.exit(1);
      }
      // For 'store' helper, restrict file permissions after credential file is created.
      if (helper === 'store') {
        const credFile = resolve(process.env.HOME || homedir(), '.git-credentials');
        try { execFileSync('chmod', ['600', credFile], { stdio: 'pipe' }); } catch {}
      }
    }

    // 4. Set remote
    previousOrigin = getRemoteUrl(mindRoot);
    try {
      execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: mindRoot, stdio: 'pipe', timeout: 5000 });
      originMutated = true;
    } catch {
      execFileSync('git', ['remote', 'set-url', 'origin', remoteUrl], { cwd: mindRoot, stdio: 'pipe', timeout: 5000 });
      originMutated = true;
    }

    // 5. Test connection (also captures refs to avoid a second SSH round-trip)
    if (!nonInteractive) console.log(dim('Testing connection...'));
    let remoteRefs = '';
    try {
      remoteRefs = gitExecSSH(['ls-remote', 'origin'], mindRoot, isSshUrl, 15000);
      if (!nonInteractive) console.log(green('✔ Connection successful'));
    } catch (lsErr) {
      const detail = lsErr.stderr ? lsErr.stderr.toString().trim() : '';
      const errMsg = `Remote not reachable${detail ? ': ' + detail : ''} — check URL and credentials`;
      rollbackInitSideEffects();
      if (nonInteractive) throw new Error(errMsg);
      console.error(red(`✘ ${errMsg}`));
      process.exit(1);
    }

    const syncConfig = {
      enabled: true,
      provider: 'git',
      remote: 'origin',
      branch: branch || getBranch(mindRoot),
      autoCommitInterval: 30,
      autoPullInterval: 300,
    };

    // 6. First sync: pull if remote has content, push otherwise.
    //    Reuse remoteRefs from step 5 to avoid redundant SSH connection.
    const hasRemoteContent = remoteRefs.includes('refs/heads/');
    try {
      if (hasRemoteContent) {
        if (!remoteHasBranch(remoteRefs, syncConfig.branch)) {
          const message = `Branch "${syncConfig.branch}" was not found on the remote. Choose an existing branch or create "${syncConfig.branch}" on the remote first.`;
          saveSyncState({ ...loadSyncState(), lastError: message, lastErrorTime: new Date().toISOString() });
          throw new Error(message);
        }
        if (!nonInteractive) console.log(dim('Pulling from remote...'));
        commitPendingChangesUnlocked(mindRoot);
        let hasConflicts = false;
        try {
          const pullEnv = isSshUrl ? { ...process.env, ...getSshEnv() } : process.env;
          execFileSync('git', ['pull', '--no-rebase', 'origin', syncConfig.branch, '--allow-unrelated-histories'], { cwd: mindRoot, stdio: nonInteractive ? 'pipe' : 'inherit', env: pullEnv, timeout: 120000 });
          saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
        } catch (err) {
          hasConflicts = resolveMergeConflictsKeepingLocal(mindRoot, err, 'Initial pull failed').length > 0;
        }
        if (!hasConflicts) pushHeadUnlocked(mindRoot, isSshUrl);
      } else {
        if (!nonInteractive) console.log(dim('Pushing to remote...'));
        autoCommitAndPushUnlocked(mindRoot, isSshUrl);
      }
    } catch (err) {
      rollbackInitSideEffects();
      if (nonInteractive) throw err;
      console.error(red(`✘ ${err.message}`));
      process.exit(1);
    }

    // 7. Save sync config only after the first sync succeeds.
    saveSyncConfig(syncConfig);
    originMutated = false;
    branchMutated = false;
    approvedCredentialInput = null;
    if (!nonInteractive) console.log(green('✔ Sync configured'));
    if (!nonInteractive) console.log(green('✔ Initial sync complete\n'));
  } finally {
    releaseSyncLock(initLock);
  }
}

/**
 * Start file watcher + periodic pull
 */
export async function startSyncDaemon(mindRoot) {
  if (activeDaemonStartPromise) return activeDaemonStartPromise;
  activeDaemonStartPromise = startSyncDaemonUnlocked(mindRoot);
  try {
    return await activeDaemonStartPromise;
  } finally {
    activeDaemonStartPromise = null;
  }
}

async function startSyncDaemonUnlocked(mindRoot) {
  const config = loadSyncConfig();
  if (!config.enabled) {
    stopSyncDaemon();
    return null;
  }
  if (!mindRoot || !isGitRepo(mindRoot)) {
    stopSyncDaemon();
    return null;
  }

  const normalizedMindRoot = resolve(mindRoot);
  if (activeWatcher) {
    if (activeMindRoot === normalizedMindRoot) {
      refreshSyncDaemonConfig();
      return null;
    }
    stopSyncDaemon();
  }

  const remoteUrl = getRemoteUrl(mindRoot) || '';
  activeIsSshUrl = isSSHUrl(remoteUrl);
  activeMindRoot = normalizedMindRoot;
  activeAutoCommitInterval = config.autoCommitInterval || 30;
  activeAutoPullInterval = config.autoPullInterval || 300;

  const chokidar = await import('chokidar');

  // File watcher → debounced auto-commit + push
  const watcher = chokidar.watch(mindRoot, {
    ignored: [/(^|[/\\])\.git/, /node_modules/, /\.sync-conflict$/],
    persistent: true,
    ignoreInitial: true,
  });
  const runBackgroundCommit = () => {
    activeCommitTimer = null;
    runBackgroundSync(mindRoot, 'daemon-commit', () => autoCommitAndPushUnlocked(mindRoot, activeIsSshUrl));
  };
  watcher.on('all', () => {
    refreshSyncDaemonConfig();
    if (!activeWatcher) return;
    if (activeCommitTimer) clearTimeout(activeCommitTimer);
    activeCommitTimer = setTimeout(runBackgroundCommit, (activeAutoCommitInterval || 30) * 1000);
  });

  // Periodic pull
  activePullInterval = setInterval(
    () => runBackgroundPull(mindRoot, 'daemon-pull'),
    (activeAutoPullInterval || 300) * 1000,
  );
  activeConfigPollInterval = setInterval(refreshSyncDaemonConfig, DAEMON_CONFIG_POLL_MS);

  // Pull on startup
  runBackgroundPull(mindRoot, 'daemon-startup-pull');

  // Graceful shutdown: flush pending changes before exit
  let shutdownInProgress = false;
  const gracefulShutdown = () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    if (activeCommitTimer) { clearTimeout(activeCommitTimer); activeCommitTimer = null; }
    runBackgroundSync(
      mindRoot,
      'daemon-shutdown-commit',
      () => autoCommitAndPushUnlocked(mindRoot, activeIsSshUrl),
      { waitMs: 1000 },
    );
    stopSyncDaemon();
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  activeWatcher = watcher;
  activeShutdownHandler = gracefulShutdown;

  return { watcher, pullInterval: activePullInterval, gracefulShutdown };
}

function runBackgroundPull(mindRoot, operation) {
  runBackgroundSync(mindRoot, operation, () => autoPullUnlocked(mindRoot, activeIsSshUrl));
}

function refreshSyncDaemonConfig() {
  if (!activeMindRoot) return;
  const config = loadSyncConfig();
  if (!config.enabled || !isGitRepo(activeMindRoot)) {
    stopSyncDaemon();
    return;
  }

  const remoteUrl = getRemoteUrl(activeMindRoot) || '';
  activeIsSshUrl = isSSHUrl(remoteUrl);
  activeAutoCommitInterval = config.autoCommitInterval || 30;

  const nextPullInterval = config.autoPullInterval || 300;
  if (activeAutoPullInterval !== nextPullInterval) {
    activeAutoPullInterval = nextPullInterval;
    if (activePullInterval) clearInterval(activePullInterval);
    activePullInterval = setInterval(
      () => runBackgroundPull(activeMindRoot, 'daemon-pull'),
      activeAutoPullInterval * 1000,
    );
  }
}

/**
 * Stop sync daemon
 */
export function stopSyncDaemon() {
  if (activeCommitTimer) {
    clearTimeout(activeCommitTimer);
    activeCommitTimer = null;
  }
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
  if (activePullInterval) {
    clearInterval(activePullInterval);
    activePullInterval = null;
  }
  if (activeConfigPollInterval) {
    clearInterval(activeConfigPollInterval);
    activeConfigPollInterval = null;
  }
  if (activeShutdownHandler) {
    process.removeListener('SIGTERM', activeShutdownHandler);
    process.removeListener('SIGINT', activeShutdownHandler);
    activeShutdownHandler = null;
  }
  activeMindRoot = null;
  activeAutoCommitInterval = null;
  activeAutoPullInterval = null;
  activeIsSshUrl = false;
}

/**
 * Get current sync status
 */
export function getSyncStatus(mindRoot) {
  const config = loadSyncConfig();
  const state = loadSyncState();
  const hasRepo = mindRoot ? isGitRepo(mindRoot) : false;
  const remote = hasRepo && mindRoot ? getRemoteUrl(mindRoot) : null;
  const conflicts = normalizeConflicts(state.conflicts);

  if (!config.enabled) {
    if (!hasSyncConfig()) return { enabled: false };
    if (remote && mindRoot) {
      return {
        enabled: false,
        configured: true,
        provider: config.provider || 'git',
        remote: redactGitRemote(remote),
        branch: getBranch(mindRoot) || 'main',
        lastSync: state.lastSync || null,
        lastPull: state.lastPull || null,
        unpushed: getUnpushedCount(mindRoot),
        conflicts,
        lastError: state.lastError || null,
        autoCommitInterval: config.autoCommitInterval || 30,
        autoPullInterval: config.autoPullInterval || 300,
      };
    }
    return {
      enabled: false,
      configured: true,
      needsSetup: true,
      provider: config.provider || 'git',
      remote: redactGitRemote(remote) || '(not configured)',
      branch: hasRepo && mindRoot ? (getBranch(mindRoot) || 'main') : 'main',
      lastSync: state.lastSync || null,
      lastPull: state.lastPull || null,
      unpushed: '?',
      conflicts,
      lastError: state.lastError || (!hasRepo
        ? 'Git repository not found in knowledge base directory. Please re-configure sync.'
        : 'Remote not configured. Please re-configure sync.'),
      autoCommitInterval: config.autoCommitInterval || 30,
      autoPullInterval: config.autoPullInterval || 300,
    };
  }

  const branch = mindRoot ? getBranch(mindRoot) : null;
  const unpushed = mindRoot ? getUnpushedCount(mindRoot) : '?';

  return {
    enabled: true,
    provider: config.provider || 'git',
    remote: redactGitRemote(remote) || '(not configured)',
    branch: branch || 'main',
    lastSync: state.lastSync || null,
    lastPull: state.lastPull || null,
    unpushed,
    conflicts,
    needsSetup: !remote,
    lastError: state.lastError || (remote
      ? null
      : (!hasRepo
          ? 'Git repository not found in knowledge base directory. Please re-configure sync.'
          : 'Remote not configured. Please re-configure sync.')),
    autoCommitInterval: config.autoCommitInterval || 30,
    autoPullInterval: config.autoPullInterval || 300,
  };
}

/**
 * Manual trigger of full sync cycle
 */
export function manualSync(mindRoot) {
  if (!mindRoot || !isGitRepo(mindRoot)) {
    throw new Error('Not a git repository. Run `mindos sync init` first.');
  }
  withSyncLock(mindRoot, 'manual-sync', () => {
    const remoteUrl = getRemoteUrl(mindRoot) || '';
    const isSshUrl = isSSHUrl(remoteUrl);
    const pullResult = autoPullUnlocked(mindRoot, isSshUrl);
    if (pullResult?.conflicts) return;
    autoCommitAndPushUnlocked(mindRoot, isSshUrl); // throws on push failure → API returns error
  });
}

/**
 * List conflict files
 */
export function listConflicts(mindRoot) {
  const state = loadSyncState();
  const conflicts = state.conflicts || [];
  if (!conflicts.length) {
    console.log(green('No conflicts'));
    return [];
  }
  console.log(bold(`${conflicts.length} conflict(s):\n`));
  for (const c of conflicts) {
    console.log(`  ${yellow('●')} ${c.file}  ${dim(c.time)}`);
    let conflictPath = null;
    try { conflictPath = getSyncConflictBackupPath(mindRoot, c.file); } catch {}
    if (conflictPath && existsSync(conflictPath)) {
      console.log(dim(`    Remote version saved: ${c.file}.sync-conflict`));
    }
  }
  console.log();
  return conflicts;
}

/**
 * Enable/disable sync
 */
export function setSyncEnabled(enabled) {
  const config = loadSyncConfig();
  config.enabled = enabled;
  saveSyncConfig(config);
  console.log(enabled ? green('✔ Auto-sync enabled') : yellow('Auto-sync disabled'));
}
