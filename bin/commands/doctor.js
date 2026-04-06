/**
 * mindos doctor — Health check for config, mindRoot, AI keys, Node/npm, build,
 * listening ports, OS daemon, sync, and update availability.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_PATH, ROOT } from '../lib/constants.js';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { isPortInUse } from '../lib/port.js';
import { EXIT } from '../lib/command.js';
import { stripBom } from '../lib/jsonc.js';

export const meta = {
  name: 'doctor',
  group: 'Config',
  summary: 'Check installation health',
  usage: 'mindos doctor',
  flags: {
    '--json': 'Output as JSON',
  },
  examples: [
    'mindos doctor',
    'mindos doctor --json',
  ],
};

export const run = async (_args, flags) => {
  const jsonMode = flags.json === true;
  const checks = [];
  const ok = (msg, key) => { checks.push({ status: 'ok', key, msg }); if (!jsonMode) console.log(`  ${green('✔')} ${msg}`); };
  const err = (msg, key) => { checks.push({ status: 'error', key, msg }); if (!jsonMode) console.log(`  ${red('✘')} ${msg}`); };
  const warn = (msg, key) => { checks.push({ status: 'warn', key, msg }); if (!jsonMode) console.log(`  ${yellow('!')} ${msg}`); };

  if (!jsonMode) console.log(`\n${bold('MindOS Doctor')}\n`);
  let hasError = false;

  // 1. config file
  if (!existsSync(CONFIG_PATH)) {
    err(`Config not found at ${dim(CONFIG_PATH)}`, 'config');
    if (!jsonMode) { console.log(`\n  ${dim('Run `mindos onboard` to create it.')}\n`); }
    if (jsonMode) { console.log(JSON.stringify({ ok: false, checks }, null, 2)); }
    process.exit(EXIT.ERROR);
  }
  let config;
  try {
    config = JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8')));
    ok(`Config file found and valid JSON  ${dim(CONFIG_PATH)}`, 'config');
  } catch {
    err(`Config file exists but failed to parse  ${dim(CONFIG_PATH)}`, 'config');
    hasError = true;
  }

  // 2. mindRoot
  if (config) {
    const mindRoot = config.mindRoot;
    if (!mindRoot) {
      err('Config missing required field: mindRoot');
      hasError = true;
    } else if (!existsSync(mindRoot === '~' ? homedir() : mindRoot.replace(/^~[/\\]/, homedir() + '/'))) {
      warn(`mindRoot path does not exist: ${dim(mindRoot)}  (will be created on first start)`);
    } else {
      ok(`Knowledge base path exists  ${dim(mindRoot)}`);
    }
  }

  // 3. AI config
  if (config) {
    const provider = config.ai?.provider;
    const providers = config.ai?.providers;
    const hasAnthropic = providers?.anthropic?.apiKey || config.ai?.anthropicApiKey;
    const hasOpenai = providers?.openai?.apiKey || config.ai?.openaiApiKey;
    if (!provider) {
      warn('AI provider not configured (run `mindos onboard` to set up)');
    } else if (provider === 'anthropic' && !hasAnthropic) {
      err('AI provider is "anthropic" but no API key found');
      hasError = true;
    } else if (provider === 'openai' && !hasOpenai) {
      err('AI provider is "openai" but no API key found');
      hasError = true;
    } else {
      ok(`AI provider configured  ${dim(provider)}`);
    }
  }

  // 4. Node version
  const nodeVersion = process.versions.node;
  const [nodeMajor] = nodeVersion.split('.').map(Number);
  if (nodeMajor < 18) {
    err(`Node.js ${nodeVersion} is below minimum required (18+)`);
    hasError = true;
  } else {
    ok(`Node.js ${nodeVersion}`);
  }

  // 4b. npm reachable from /bin/sh
  try {
    const npmVersion = execSync('npm --version', { stdio: 'pipe' }).toString().trim();
    ok(`npm ${npmVersion} reachable`);
  } catch {
    err('npm not found in PATH — app dependencies cannot be installed');
    if (process.platform === 'win32') {
      console.log(dim('     Ensure Node.js is installed and its bin directory is in your system PATH.'));
      console.log(dim('     Fix: reinstall Node.js from https://nodejs.org (the installer adds it to PATH).'));
    } else {
      console.log(dim('     Node.js may be installed via nvm/fnm/volta and not visible to /bin/sh.'));
      console.log(dim('     Fix: add your Node.js bin path to ~/.profile so non-interactive shells can find it.'));
    }
    hasError = true;
  }

  // 4c. ~/.mindos/bin in PATH (CLI shim)
  const mindosBin = resolve(homedir(), '.mindos', 'bin');
  const pathDirs = (process.env.PATH || '').split(delimiter);
  if (pathDirs.some(d => d === mindosBin || d === '$HOME/.mindos/bin' || d === '~/.mindos/bin')) {
    ok(`~/.mindos/bin is in PATH`);
  } else {
    try {
      const { ensureCliShim, isShimInPath } = await import('../lib/cli-shim.js');
      ensureCliShim();
      if (isShimInPath()) {
        ok(`~/.mindos/bin is in PATH`);
      } else {
        warn(`~/.mindos/bin PATH injected into shell rc files — open a new terminal to activate`);
      }
    } catch {
      if (existsSync(resolve(mindosBin, 'mindos'))) {
        warn(`~/.mindos/bin/mindos exists but is NOT in PATH — AI Agents cannot find the mindos command`);
        if (!jsonMode) {
          console.log(dim('     Fix: add to your shell config:'));
          console.log(dim('       export PATH="$HOME/.mindos/bin:$PATH"'));
        }
      }
    }
  }

  const { hasPrebuiltStandalone, needsBuild } = await import('../lib/build.js');

  // 5. Build
  if (hasPrebuiltStandalone()) {
    ok('Production build is up to date (prebuilt standalone)');
  } else if (!existsSync(resolve(ROOT, 'app', '.next'))) {
    warn(`App not built yet — will build automatically on next ${dim('mindos start')}`);
  } else if (needsBuild()) {
    warn(`Build is outdated — will rebuild automatically on next ${dim('mindos start')}`);
  } else {
    ok('Production build is up to date');
  }

  // 6. Ports
  const webPort = Number(config?.port || process.env.MINDOS_WEB_PORT || 3456);
  const mcpPort = Number(config?.mcpPort || process.env.MINDOS_MCP_PORT || 8781);
  const webInUse = await isPortInUse(webPort);
  const mcpInUse = await isPortInUse(mcpPort);
  if (webInUse) {
    ok(`Web server is listening on port ${webPort}`);
  } else {
    warn(`Web server is not running on port ${webPort}`);
  }
  if (mcpInUse) {
    ok(`MCP server is listening on port ${mcpPort}`);
  } else {
    warn(`MCP server is not running on port ${mcpPort}`);
  }

  // 7. Daemon status
  const { getPlatform } = await import('../lib/gateway.js');
  const platform = getPlatform();
  if (platform === 'systemd') {
    try {
      execSync('systemctl --user is-active mindos', { stdio: 'pipe' });
      ok('Systemd service mindos is active');
    } catch {
      warn('Systemd service mindos is not active  (run `mindos gateway start` to start)');
    }
  } else if (platform === 'launchd') {
    try {
      const uid = execSync('id -u').toString().trim();
      execSync(`launchctl print gui/${uid}/com.mindos.app`, { stdio: 'pipe' });
      ok('LaunchAgent com.mindos.app is loaded');
    } catch {
      warn('LaunchAgent com.mindos.app is not loaded  (run `mindos gateway start` to start)');
    }
  }

  // 8. Sync status
  if (config?.mindRoot) {
    try {
      const { getSyncStatus } = await import('../lib/sync.js');
      const syncStatus = await getSyncStatus(config.mindRoot);
      if (!syncStatus.enabled) {
        warn(`Cross-device sync is not configured  ${dim('(run `mindos sync init` to set up)')}`);
      } else if (syncStatus.lastError) {
        err(`Sync error: ${syncStatus.lastError}`);
        hasError = true;
      } else if (syncStatus.conflicts && syncStatus.conflicts.length > 0) {
        warn(`Sync has ${syncStatus.conflicts.length} unresolved conflict(s)  ${dim('(run `mindos sync conflicts` to view)')}`);
      } else {
        const unpushed = parseInt(syncStatus.unpushed || '0', 10);
        const extra = unpushed > 0 ? `  ${dim(`(${unpushed} unpushed commit(s))`)}` : '';
        ok(`Sync enabled  ${dim(syncStatus.remote || 'origin')}${extra}`);
      }
    } catch {
      warn('Could not check sync status');
    }
  }

  // 9. Update check
  try {
    const { checkForUpdate } = await import('../lib/update-check.js');
    const latestVersion = await Promise.race([
      checkForUpdate(),
      new Promise((r) => setTimeout(() => r(null), 4000)),
    ]);
    if (latestVersion) {
      const currentVersion = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; } })();
      warn(`Update available: v${currentVersion} → ${bold(`v${latestVersion}`)}  ${dim('run `mindos update`')}`);
    } else {
      ok('MindOS is up to date');
    }
  } catch {
    warn('Could not check for updates');
  }

  if (jsonMode) {
    const hasErr = checks.some((c) => c.status === 'error');
    console.log(JSON.stringify({ ok: !hasErr, checks }, null, 2));
  } else {
    console.log(hasError
      ? `\n${red('Some checks failed.')} Run ${cyan('mindos onboard')} to reconfigure.\n`
      : `\n${green('All checks passed.')}\n`);
  }
  if (hasError) process.exit(EXIT.ERROR);
};
