import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_PATH, MINDOS_DIR } from './constants.js';
import { bold, dim, cyan, green, red, yellow } from './colors.js';

// ── Atomic write helper ────────────────────────────────────────────────────

function atomicWriteJSON(filePath, data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

// ── Config helpers ──────────────────────────────────────────────────────────

function loadSyncConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return config.sync || {};
  } catch {
    return {};
  }
}

function saveSyncConfig(syncConfig) {
  let config = {};
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  config.sync = syncConfig;
  atomicWriteJSON(CONFIG_PATH, config);
}

function getMindRoot() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return config.mindRoot;
  } catch {
    return null;
  }
}

const SYNC_STATE_PATH = resolve(MINDOS_DIR, 'sync-state.json');

function loadSyncState() {
  try {
    return JSON.parse(readFileSync(SYNC_STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSyncState(state) {
  if (!existsSync(MINDOS_DIR)) mkdirSync(MINDOS_DIR, { recursive: true });
  atomicWriteJSON(SYNC_STATE_PATH, state);
}

// ── Git helpers ─────────────────────────────────────────────────────────────

function isGitRepo(dir) {
  return existsSync(resolve(dir, '.git'));
}

function gitExec(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
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
function validateSSHSetup(url, mindRoot, nonInteractive) {
  if (!isSSHUrl(url)) return { isSSH: false };

  const sshDir = resolve(homedir(), '.ssh');
  const id_rsa = resolve(sshDir, 'id_rsa');
  const id_ed25519 = resolve(sshDir, 'id_ed25519');
  const hasKey = existsSync(id_rsa) || existsSync(id_ed25519);
  const hasAgent = !!process.env.SSH_AUTH_SOCK;

  if (!hasKey && !hasAgent) {
    const hint = isSSHUrl(url)
      ? `SSH key not found at ${sshDir}/id_rsa or id_ed25519. Create one with:\n` +
        `  ssh-keygen -t ed25519 -f ${id_rsa}\n` +
        `Then verify with: ssh -T git@github.com`
      : '';
    return {
      isSSH: true,
      isValid: false,
      error: `No SSH credentials found. ${hint}`,
    };
  }

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

// ── Core sync functions ─────────────────────────────────────────────────────

function autoCommitAndPush(mindRoot, isSshUrl = false) {
  try {
    const sshEnv = isSshUrl ? getSshEnv() : {};
    execFileSync('git', ['add', '-A'], { cwd: mindRoot, stdio: 'pipe' });
    const status = gitExec(['status', '--porcelain'], mindRoot);
    if (!status) return;
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    execFileSync('git', ['commit', '-m', `auto-sync: ${timestamp}`], { cwd: mindRoot, stdio: 'pipe' });
    execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: mindRoot, stdio: 'pipe', env: { ...process.env, ...sshEnv } });
    saveSyncState({ ...loadSyncState(), lastSync: new Date().toISOString(), lastError: null });
  } catch (err) {
    saveSyncState({ ...loadSyncState(), lastError: err.message, lastErrorTime: new Date().toISOString() });
  }
}

function autoPull(mindRoot, isSshUrl = false) {
  const sshEnv = isSshUrl ? getSshEnv() : {};
  try {
    execFileSync('git', ['pull', '--rebase', '--autostash'], { cwd: mindRoot, stdio: 'pipe', env: { ...process.env, ...sshEnv } });
    saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
  } catch {
    // rebase conflict → abort → merge
    try { execFileSync('git', ['rebase', '--abort'], { cwd: mindRoot, stdio: 'pipe' }); } catch {}
    try {
      execFileSync('git', ['pull', '--no-rebase'], { cwd: mindRoot, stdio: 'pipe' });
      saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
    } catch {
      // merge conflict → keep both versions
      let conflicts = [];
      let conflictWarnings = [];
      try {
        conflicts = gitExec(['diff', '--name-only', '--diff-filter=U'], mindRoot).split('\n').filter(Boolean);
        for (const file of conflicts) {
          try {
            const theirs = execFileSync('git', ['show', `:3:${file}`], { cwd: mindRoot, encoding: 'utf-8' });
            writeFileSync(resolve(mindRoot, file + '.sync-conflict'), theirs, 'utf-8');
          } catch {
            conflictWarnings.push(file);
          }
          try { execFileSync('git', ['checkout', '--ours', file], { cwd: mindRoot, stdio: 'pipe' }); } catch {}
        }
        execFileSync('git', ['add', '-A'], { cwd: mindRoot, stdio: 'pipe' });
        // --no-edit avoids editor prompt for merge commit; --allow-empty handles edge case where ours == theirs
        try {
          execFileSync('git', ['-c', 'core.editor=true', 'commit', '--no-edit'], { cwd: mindRoot, stdio: 'pipe' });
        } catch {
          // If merge commit fails (e.g. nothing to commit), try explicit message
          try {
            execFileSync('git', ['commit', '-m', 'auto-sync: resolved conflicts (kept local versions)', '--allow-empty'], { cwd: mindRoot, stdio: 'pipe' });
          } catch {}
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
    const unpushed = gitExec(['rev-list', '--count', '@{u}..HEAD'], mindRoot);
    if (parseInt(unpushed) > 0) {
      execFileSync('git', ['push'], { cwd: mindRoot, stdio: 'pipe' });
      saveSyncState({ ...loadSyncState(), lastSync: new Date().toISOString(), lastError: null });
    }
  } catch {
    // No upstream tracking or push failed — ignore silently, autoCommitAndPush handles primary pushes
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

  // Pre-flight SSH validation (before git init)
  const sshValidation = validateSSHSetup(remoteUrl, mindRoot, nonInteractive);
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
    try { execFileSync('git', ['checkout', '-b', 'main'], { cwd: mindRoot, stdio: 'pipe' }); } catch {}
  }

  // 1b. Ensure .gitignore exists
  const gitignorePath = resolve(mindRoot, '.gitignore');
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
    ].join('\n'), 'utf-8');
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
    // Store the credential via git credential approve, then verify it stuck
    let credentialStored = false;
    try {
      const credInput = `protocol=${urlObj.protocol.replace(':', '')}\nhost=${urlObj.host}\nusername=oauth2\npassword=${token}\n\n`;
      execFileSync('git', ['credential', 'approve'], { cwd: mindRoot, input: credInput, stdio: 'pipe' });
      // Verify: credential fill should return the password we just stored
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
    // If credential helper didn't actually persist, embed token in URL
    if (!credentialStored) {
      if (!nonInteractive) console.log(dim('Credential helper unavailable, using inline token'));
      const fallbackUrl = new URL(remoteUrl);
      fallbackUrl.username = 'oauth2';
      fallbackUrl.password = token;
      remoteUrl = fallbackUrl.toString();
    }
    // For 'store' helper, restrict file permissions AFTER credential file is created
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

  // 6. Save sync config
  const syncConfig = {
    enabled: true,
    provider: 'git',
    remote: 'origin',
    branch: branch || getBranch(mindRoot),
    autoCommitInterval: 30,
    autoPullInterval: 300,
  };
  saveSyncConfig(syncConfig);
  if (!nonInteractive) console.log(green('✔ Sync configured'));

  // 7. First sync: pull if remote has content, push otherwise
  //    Reuse remoteRefs from step 5 to avoid redundant SSH connection (~3-4s saved)
  const hasRemoteContent = remoteRefs.includes('refs/heads/');
  try {
    if (hasRemoteContent) {
      if (!nonInteractive) console.log(dim('Pulling from remote...'));
      try {
        const pullEnv = isSshUrl ? { ...process.env, ...getSshEnv() } : process.env;
        execFileSync('git', ['pull', 'origin', syncConfig.branch, '--allow-unrelated-histories'], { cwd: mindRoot, stdio: nonInteractive ? 'pipe' : 'inherit', env: pullEnv });
      } catch {
        if (!nonInteractive) console.log(yellow('Pull completed with warnings. Check for conflicts.'));
      }
    } else {
      if (!nonInteractive) console.log(dim('Pushing to remote...'));
      autoCommitAndPush(mindRoot, isSshUrl);
    }
  } catch {
    if (!nonInteractive) console.log(dim('Performing initial push...'));
    autoCommitAndPush(mindRoot, isSshUrl);
  }
  if (!nonInteractive) console.log(green('✔ Initial sync complete\n'));
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
  watcher.on('all', () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => autoCommitAndPush(mindRoot, isSshUrl), (config.autoCommitInterval || 30) * 1000);
  });

  // Periodic pull
  const pullInterval = setInterval(() => autoPull(mindRoot, isSshUrl), (config.autoPullInterval || 300) * 1000);

  // Pull on startup
  autoPull(mindRoot, isSshUrl);

  // Graceful shutdown: flush pending changes before exit
  let shutdownInProgress = false;
  const gracefulShutdown = () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    try { autoCommitAndPush(mindRoot); } catch {}
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

  if (!config.enabled) {
    return { enabled: false };
  }

  const remote = mindRoot ? getRemoteUrl(mindRoot) : null;
  const branch = mindRoot ? getBranch(mindRoot) : null;
  const unpushed = mindRoot ? getUnpushedCount(mindRoot) : '?';

  return {
    enabled: true,
    provider: config.provider || 'git',
    remote: remote || '(not configured)',
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
  const remoteUrl = getRemoteUrl(mindRoot) || '';
  const isSshUrl = isSSHUrl(remoteUrl);
  autoPull(mindRoot, isSshUrl);
  autoCommitAndPush(mindRoot, isSshUrl);
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
    const conflictPath = resolve(mindRoot, c.file + '.sync-conflict');
    if (existsSync(conflictPath)) {
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
