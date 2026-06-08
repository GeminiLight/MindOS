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
    const config = JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8')));
    return config.sync || {};
  } catch {
    return {};
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
  if (owner.pid && isProcessAlive(owner.pid)) return ageMs > SYNC_LOCK_ALIVE_HARD_STALE_MS;
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

/** Check if URL is SSH format (git@host:path) */
function isSSHUrl(url) {
  return /^git@[\w.-]+:.+/.test(url);
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
  try {
    return gitExec(['rev-list', '--count', '@{u}..HEAD'], cwd);
  } catch {
    return '?';
  }
}

export function getSyncConflictBackupPath(mindRoot, file) {
  return resolveInsideRoot(mindRoot, `${file}.sync-conflict`);
}

export function getSyncGitignorePath(mindRoot) {
  return resolveInsideRoot(mindRoot, '.gitignore');
}

// ── Core sync functions ─────────────────────────────────────────────────────

function autoCommitAndPush(mindRoot, isSshUrl = false) {
  return withSyncLock(mindRoot, 'commit-push', () => autoCommitAndPushUnlocked(mindRoot, isSshUrl));
}

function autoCommitAndPushUnlocked(mindRoot, isSshUrl = false) {
  const sshEnv = isSshUrl ? getSshEnv() : {};
  const pushEnv = { ...process.env, ...sshEnv };

  // Stage and commit any pending changes
  try {
    ensureGitIdentity(mindRoot);
    execFileSync('git', ['add', '-A'], { cwd: mindRoot, stdio: 'pipe', timeout: 60000 });
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
      let conflicts = [];
      let conflictWarnings = [];
      try {
        conflicts = gitExec(['diff', '--name-only', '--diff-filter=U'], mindRoot).split('\n').filter(Boolean);
        if (conflicts.length === 0) {
          saveSyncState({
            ...loadSyncState(),
            lastError: gitFailureMessage('Pull failed', mergeErr),
            lastErrorTime: new Date().toISOString(),
          });
          return;
        }

        // merge conflict → keep both versions
        for (const file of conflicts) {
          try {
            const theirs = execFileSync('git', ['show', `:3:${file}`], { cwd: mindRoot, encoding: 'utf-8' });
            writeFileSync(getSyncConflictBackupPath(mindRoot, file), theirs, 'utf-8');
          } catch {
            conflictWarnings.push(file);
          }
          try { execFileSync('git', ['checkout', '--ours', file], { cwd: mindRoot, stdio: 'pipe', timeout: 15000 }); } catch {}
        }
        execFileSync('git', ['add', '-A'], { cwd: mindRoot, stdio: 'pipe', timeout: 60000 });
        // --no-edit avoids editor prompt for merge commit. Do not create empty
        // "resolved conflicts" commits when Git has no actual merge changes.
        try {
          execFileSync('git', ['-c', 'core.editor=true', 'commit', '--no-edit'], { cwd: mindRoot, stdio: 'pipe', timeout: 60000 });
        } catch (commitErr) {
          // If merge commit fails (e.g. nothing to commit), try explicit message
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
        // Even if commit fails, record the error — conflicts are still saved below
        saveSyncState({ ...loadSyncState(), lastError: err.message, lastErrorTime: new Date().toISOString() });
      }
      // Always save conflicts (even if commit failed) so UI can show resolution buttons
      if (conflicts.length > 0) {
        saveSyncState({
          ...loadSyncState(),
          lastPull: new Date().toISOString(),
          conflicts: conflicts.map(f => ({ file: f, time: new Date().toISOString(), noBackup: conflictWarnings.includes(f) })),
        });
      }
    }
  }

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

    // 3. Token for HTTPS
    if (remoteUrl.startsWith('https://')) {
      token = (await ask(`${bold('Access Token')} ${dim('(GitHub PAT / GitLab PAT, leave empty if SSH)')}: `)).trim();
    }

    rl.close();
  }

  try {
    branch = normalizeBranchName(branch, mindRoot);
  } catch (err) {
    if (nonInteractive) throw err;
    console.error(red(`✘ ${err.message}`));
    process.exit(1);
  }

  const initLock = acquireSyncLock(mindRoot, 'init');
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
      execFileSync('git', ['init'], { cwd: mindRoot, stdio: 'pipe' });
      try {
        execFileSync('git', ['checkout', '-B', branch], { cwd: mindRoot, stdio: 'pipe' });
      } catch (err) {
        const message = gitFailureMessage(`Failed to create branch "${branch}"`, err);
        if (nonInteractive) throw new Error(message);
        console.error(red(`✘ ${message}`));
        process.exit(1);
      }
    } else {
      try {
        checkoutBranch(mindRoot, branch);
      } catch (err) {
        const message = gitFailureMessage(`Failed to switch to branch "${branch}"`, err);
        if (nonInteractive) throw new Error(message);
        console.error(red(`✘ ${message}`));
        process.exit(1);
      }
    }

    // 1b. Ensure .gitignore has system file exclusions
    const gitignorePath = getSyncGitignorePath(mindRoot);
    const SYSTEM_IGNORES = [
      'INSTRUCTION.md',
    ];
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
      // Existing .gitignore: append missing system file entries.
      const existing = readFileSync(gitignorePath, 'utf-8');
      const missing = SYSTEM_IGNORES.filter(f => !existing.includes(f));
      if (missing.length > 0) {
        const append = '\n# MindOS system files (auto-added)\n' + missing.join('\n') + '\n';
        writeFileSync(gitignorePath, existing.trimEnd() + '\n' + append, 'utf-8');
      }
    }

    // Remove system files from git tracking if already committed
    for (const file of SYSTEM_IGNORES) {
      try { execFileSync('git', ['rm', '--cached', '--ignore-unmatch', file], { cwd: mindRoot, stdio: 'pipe' }); } catch {}
    }

    // Handle token for HTTPS
    if (token && remoteUrl.startsWith('https://')) {
      const urlObj = new URL(remoteUrl);
      // Choose credential helper by platform
      const platform = process.platform;
      let helper;
      if (platform === 'darwin') helper = 'osxkeychain';
      else if (platform === 'win32') helper = 'manager';
      else helper = 'store';
      try { execFileSync('git', ['config', 'credential.helper', helper], { cwd: mindRoot, stdio: 'pipe' }); } catch (e) {
        console.error(`[sync] credential.helper setup failed: ${e.message}`);
      }
      // Store the credential via git credential approve, then verify it stuck.
      let credentialStored = false;
      try {
        const credInput = `protocol=${urlObj.protocol.replace(':', '')}\nhost=${urlObj.host}\nusername=oauth2\npassword=${token}\n\n`;
        execFileSync('git', ['credential', 'approve'], { cwd: mindRoot, input: credInput, stdio: 'pipe' });
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
    try {
      execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: mindRoot, stdio: 'pipe' });
    } catch {
      execFileSync('git', ['remote', 'set-url', 'origin', remoteUrl], { cwd: mindRoot, stdio: 'pipe' });
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
        if (!nonInteractive) console.log(dim('Pulling from remote...'));
        try {
          const pullEnv = isSshUrl ? { ...process.env, ...getSshEnv() } : process.env;
          execFileSync('git', ['pull', 'origin', syncConfig.branch, '--allow-unrelated-histories'], { cwd: mindRoot, stdio: nonInteractive ? 'pipe' : 'inherit', env: pullEnv });
          saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
          autoCommitAndPushUnlocked(mindRoot, isSshUrl);
        } catch (err) {
          const message = gitFailureMessage('Initial pull failed', err);
          saveSyncState({ ...loadSyncState(), lastError: message, lastErrorTime: new Date().toISOString() });
          throw new Error(message);
        }
      } else {
        if (!nonInteractive) console.log(dim('Pushing to remote...'));
        autoCommitAndPushUnlocked(mindRoot, isSshUrl);
      }
    } catch (err) {
      if (nonInteractive) throw err;
      console.error(red(`✘ ${err.message}`));
      process.exit(1);
    }

    // 7. Save sync config only after the first sync succeeds.
    saveSyncConfig(syncConfig);
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
  if (activeWatcher) return null; // already running — idempotent guard
  const config = loadSyncConfig();
  if (!config.enabled) return null;
  if (!mindRoot || !isGitRepo(mindRoot)) return null;

  const remoteUrl = getRemoteUrl(mindRoot) || '';
  const isSshUrl = isSSHUrl(remoteUrl);

  const chokidar = await import('chokidar');

  // File watcher → debounced auto-commit + push
  let commitTimer = null;
  const watcher = chokidar.watch(mindRoot, {
    ignored: [/(^|[/\\])\.git/, /node_modules/, /\.sync-conflict$/],
    persistent: true,
    ignoreInitial: true,
  });
  const runBackgroundCommit = () => {
    runBackgroundSync(mindRoot, 'daemon-commit', () => autoCommitAndPushUnlocked(mindRoot, isSshUrl));
  };
  watcher.on('all', () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(runBackgroundCommit, (config.autoCommitInterval || 30) * 1000);
  });

  // Periodic pull
  const runBackgroundPull = (operation) => {
    runBackgroundSync(mindRoot, operation, () => autoPullUnlocked(mindRoot, isSshUrl));
  };
  const pullInterval = setInterval(() => runBackgroundPull('daemon-pull'), (config.autoPullInterval || 300) * 1000);

  // Pull on startup
  runBackgroundPull('daemon-startup-pull');

  // Graceful shutdown: flush pending changes before exit
  let shutdownInProgress = false;
  const gracefulShutdown = () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    runBackgroundSync(
      mindRoot,
      'daemon-shutdown-commit',
      () => autoCommitAndPushUnlocked(mindRoot, isSshUrl),
      { waitMs: 1000 },
    );
    stopSyncDaemon();
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  activeWatcher = watcher;
  activePullInterval = pullInterval;
  activeShutdownHandler = gracefulShutdown;

  return { watcher, pullInterval, gracefulShutdown };
}

/**
 * Stop sync daemon
 */
export function stopSyncDaemon() {
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
  if (activePullInterval) {
    clearInterval(activePullInterval);
    activePullInterval = null;
  }
  if (activeShutdownHandler) {
    process.removeListener('SIGTERM', activeShutdownHandler);
    process.removeListener('SIGINT', activeShutdownHandler);
    activeShutdownHandler = null;
  }
}

/**
 * Get current sync status
 */
export function getSyncStatus(mindRoot) {
  const config = loadSyncConfig();
  const state = loadSyncState();
  const hasRepo = mindRoot ? isGitRepo(mindRoot) : false;
  const remote = hasRepo && mindRoot ? getRemoteUrl(mindRoot) : null;

  if (!config.enabled) {
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
        conflicts: state.conflicts || [],
        lastError: state.lastError || null,
        autoCommitInterval: config.autoCommitInterval || 30,
        autoPullInterval: config.autoPullInterval || 300,
      };
    }
    return { enabled: false };
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
    conflicts: state.conflicts || [],
    lastError: state.lastError || null,
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
    autoPullUnlocked(mindRoot, isSshUrl);
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
