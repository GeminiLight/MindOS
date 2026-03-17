import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_PATH, MINDOS_DIR } from './constants.js';
import { bold, dim, cyan, green, red, yellow } from './colors.js';

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
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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
  writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// ── Git helpers ─────────────────────────────────────────────────────────────

function isGitRepo(dir) {
  return existsSync(resolve(dir, '.git'));
}

function gitExec(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function getRemoteUrl(cwd) {
  try {
    return gitExec('git remote get-url origin', cwd);
  } catch {
    return null;
  }
}

function getBranch(cwd) {
  try {
    return gitExec('git rev-parse --abbrev-ref HEAD', cwd);
  } catch {
    return 'main';
  }
}

function getUnpushedCount(cwd) {
  try {
    return gitExec('git rev-list --count @{u}..HEAD', cwd);
  } catch {
    return '?';
  }
}

// ── Core sync functions ─────────────────────────────────────────────────────

function autoCommitAndPush(mindRoot) {
  try {
    execSync('git add -A', { cwd: mindRoot, stdio: 'pipe' });
    const status = gitExec('git status --porcelain', mindRoot);
    if (!status) return;
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    execSync(`git commit -m "auto-sync: ${timestamp}"`, { cwd: mindRoot, stdio: 'pipe' });
    execSync('git push', { cwd: mindRoot, stdio: 'pipe' });
    saveSyncState({ ...loadSyncState(), lastSync: new Date().toISOString(), lastError: null });
  } catch (err) {
    saveSyncState({ ...loadSyncState(), lastError: err.message, lastErrorTime: new Date().toISOString() });
  }
}

function autoPull(mindRoot) {
  try {
    execSync('git pull --rebase --autostash', { cwd: mindRoot, stdio: 'pipe' });
    saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
  } catch {
    // rebase conflict → abort → merge
    try { execSync('git rebase --abort', { cwd: mindRoot, stdio: 'pipe' }); } catch {}
    try {
      execSync('git pull --no-rebase', { cwd: mindRoot, stdio: 'pipe' });
      saveSyncState({ ...loadSyncState(), lastPull: new Date().toISOString() });
    } catch {
      // merge conflict → keep both versions
      try {
        const conflicts = gitExec('git diff --name-only --diff-filter=U', mindRoot).split('\n').filter(Boolean);
        for (const file of conflicts) {
          try {
            const theirs = execSync(`git show :3:${file}`, { cwd: mindRoot, encoding: 'utf-8' });
            writeFileSync(resolve(mindRoot, file + '.sync-conflict'), theirs, 'utf-8');
          } catch {}
          try { execSync(`git checkout --ours "${file}"`, { cwd: mindRoot, stdio: 'pipe' }); } catch {}
        }
        execSync('git add -A', { cwd: mindRoot, stdio: 'pipe' });
        execSync('git commit -m "auto-sync: resolved conflicts (kept both versions)"', { cwd: mindRoot, stdio: 'pipe' });
        saveSyncState({
          ...loadSyncState(),
          lastPull: new Date().toISOString(),
          conflicts: conflicts.map(f => ({ file: f, time: new Date().toISOString() })),
        });
      } catch (err) {
        saveSyncState({ ...loadSyncState(), lastError: err.message, lastErrorTime: new Date().toISOString() });
      }
    }
  }

  // Retry any pending pushes (handles previous push failures)
  try {
    const unpushed = gitExec('git rev-list --count @{u}..HEAD', mindRoot);
    if (parseInt(unpushed) > 0) {
      execSync('git push', { cwd: mindRoot, stdio: 'pipe' });
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

  // 1. Ensure git repo
  if (!isGitRepo(mindRoot)) {
    if (!nonInteractive) console.log(dim('Initializing git repository...'));
    execSync('git init', { cwd: mindRoot, stdio: 'pipe' });
    try { execSync('git checkout -b main', { cwd: mindRoot, stdio: 'pipe' }); } catch {}
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
    try { execSync(`git config credential.helper '${helper}'`, { cwd: mindRoot, stdio: 'pipe' }); } catch {}
    // Store the credential via git credential approve
    try {
      const credInput = `protocol=${urlObj.protocol.replace(':', '')}\nhost=${urlObj.host}\nusername=oauth2\npassword=${token}\n\n`;
      execSync('git credential approve', { cwd: mindRoot, input: credInput, stdio: 'pipe' });
    } catch {}
    // For 'store' helper, restrict file permissions AFTER credential file is created
    if (helper === 'store') {
      const credFile = resolve(process.env.HOME || homedir(), '.git-credentials');
      try { execSync(`chmod 600 "${credFile}"`, { stdio: 'pipe' }); } catch {}
    }
  }

  // 4. Set remote
  try {
    execSync(`git remote add origin "${remoteUrl}"`, { cwd: mindRoot, stdio: 'pipe' });
  } catch {
    execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: mindRoot, stdio: 'pipe' });
  }

  // 5. Test connection
  if (!nonInteractive) console.log(dim('Testing connection...'));
  try {
    execSync('git ls-remote --exit-code origin', { cwd: mindRoot, stdio: 'pipe', timeout: 15000 });
    if (!nonInteractive) console.log(green('✔ Connection successful'));
  } catch {
    const errMsg = 'Remote not reachable — check URL and credentials';
    if (nonInteractive) throw new Error(errMsg);
    console.error(red('✘ Could not connect to remote. Check your URL and credentials.'));
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
  try {
    const refs = gitExec('git ls-remote --heads origin', mindRoot);
    if (refs) {
      if (!nonInteractive) console.log(dim('Pulling from remote...'));
      try {
        execSync(`git pull origin ${syncConfig.branch} --allow-unrelated-histories`, { cwd: mindRoot, stdio: nonInteractive ? 'pipe' : 'inherit' });
      } catch {
        if (!nonInteractive) console.log(yellow('Pull completed with warnings. Check for conflicts.'));
      }
    } else {
      if (!nonInteractive) console.log(dim('Pushing to remote...'));
      autoCommitAndPush(mindRoot);
    }
  } catch {
    if (!nonInteractive) console.log(dim('Performing initial push...'));
    autoCommitAndPush(mindRoot);
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
    commitTimer = setTimeout(() => autoCommitAndPush(mindRoot), (config.autoCommitInterval || 30) * 1000);
  });

  // Periodic pull
  const pullInterval = setInterval(() => autoPull(mindRoot), (config.autoPullInterval || 300) * 1000);

  // Pull on startup
  autoPull(mindRoot);

  // Graceful shutdown: flush pending changes before exit
  const gracefulShutdown = () => {
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
  autoPull(mindRoot);
  autoCommitAndPush(mindRoot);
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
