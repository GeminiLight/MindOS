import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
}

// ── Exported API ────────────────────────────────────────────────────────────

let activeWatcher = null;
let activePullInterval = null;

/**
 * Interactive sync init — configure remote git repo
 */
export async function initSync(mindRoot) {
  if (!mindRoot) { console.error(red('No mindRoot configured.')); process.exit(1); }

  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));

  // 1. Ensure git repo
  if (!isGitRepo(mindRoot)) {
    console.log(dim('Initializing git repository...'));
    execSync('git init', { cwd: mindRoot, stdio: 'inherit' });
    execSync('git checkout -b main', { cwd: mindRoot, stdio: 'pipe' }).toString();
  }

  // 2. Remote URL
  const currentRemote = getRemoteUrl(mindRoot);
  const defaultUrl = currentRemote || '';
  const urlPrompt = currentRemote
    ? `${bold('Remote URL')} ${dim(`[${currentRemote}]`)}: `
    : `${bold('Remote URL')} ${dim('(HTTPS or SSH)')}: `;
  let remoteUrl = (await ask(urlPrompt)).trim() || defaultUrl;

  if (!remoteUrl) {
    console.error(red('Remote URL is required.'));
    rl.close();
    process.exit(1);
  }

  // 3. Token for HTTPS
  let token = '';
  if (remoteUrl.startsWith('https://')) {
    token = (await ask(`${bold('Access Token')} ${dim('(GitHub PAT / GitLab PAT, leave empty if SSH)')}: `)).trim();
    if (token) {
      // Inject token into URL for credential storage
      const urlObj = new URL(remoteUrl);
      urlObj.username = 'oauth2';
      urlObj.password = token;
      const authUrl = urlObj.toString();
      // Configure credential helper
      try { execSync(`git config credential.helper store`, { cwd: mindRoot, stdio: 'pipe' }); } catch {}
      // Store the credential
      try {
        const credInput = `protocol=${urlObj.protocol.replace(':', '')}\nhost=${urlObj.host}\nusername=oauth2\npassword=${token}\n\n`;
        execSync('git credential approve', { cwd: mindRoot, input: credInput, stdio: 'pipe' });
      } catch {}
    }
  }

  // 4. Set remote
  try {
    execSync(`git remote add origin "${remoteUrl}"`, { cwd: mindRoot, stdio: 'pipe' });
  } catch {
    execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: mindRoot, stdio: 'pipe' });
  }

  // 5. Test connection
  console.log(dim('Testing connection...'));
  try {
    execSync('git ls-remote --exit-code origin', { cwd: mindRoot, stdio: 'pipe' });
    console.log(green('✔ Connection successful'));
  } catch {
    console.error(red('✘ Could not connect to remote. Check your URL and credentials.'));
    rl.close();
    process.exit(1);
  }

  rl.close();

  // 6. Save sync config
  const syncConfig = {
    enabled: true,
    provider: 'git',
    remote: 'origin',
    branch: getBranch(mindRoot),
    autoCommitInterval: 30,
    autoPullInterval: 300,
  };
  saveSyncConfig(syncConfig);
  console.log(green('✔ Sync configured'));

  // 7. First sync: pull if remote has content, push otherwise
  try {
    const refs = gitExec('git ls-remote --heads origin', mindRoot);
    if (refs) {
      console.log(dim('Pulling from remote...'));
      try {
        execSync(`git pull origin ${syncConfig.branch} --allow-unrelated-histories`, { cwd: mindRoot, stdio: 'inherit' });
      } catch {
        // Might fail if empty or conflicts — that's fine for initial setup
        console.log(yellow('Pull completed with warnings. Check for conflicts.'));
      }
    } else {
      console.log(dim('Pushing to remote...'));
      autoCommitAndPush(mindRoot);
    }
  } catch {
    console.log(dim('Performing initial push...'));
    autoCommitAndPush(mindRoot);
  }
  console.log(green('✔ Initial sync complete\n'));
}

/**
 * Start file watcher + periodic pull
 */
export async function startSyncDaemon(mindRoot) {
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

  activeWatcher = watcher;
  activePullInterval = pullInterval;

  return { watcher, pullInterval };
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
    console.error(red('Not a git repository. Run `mindos sync init` first.'));
    process.exit(1);
  }
  console.log(dim('Pulling...'));
  autoPull(mindRoot);
  console.log(dim('Committing & pushing...'));
  autoCommitAndPush(mindRoot);
  console.log(green('✔ Sync complete'));
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
