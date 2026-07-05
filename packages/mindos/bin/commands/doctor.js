/**
 * mindos doctor — Health check for config, mindRoot, AI keys, Node/npm, build,
 * listening ports, OS daemon, sync, and update availability.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_PATH, PRODUCT_PACKAGE_JSON, WEB_APP_DIR } from '../lib/constants.js';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { isPortInUse } from '../lib/port.js';
import { EXIT } from '../lib/command.js';
import { stripBom } from '../lib/jsonc.js';
import { hasProviderEnvKey, isProviderMissingRequiredKey, providerEnvKeys, resolveAiConfig } from '../lib/ai-config.js';
import { MCP_AGENTS } from '../lib/mcp-agents.js';
import { inspectAgentReadiness, inspectAllAgentReadiness } from '../lib/agent-readiness.js';

export const meta = {
  name: 'doctor',
  group: 'Config',
  summary: 'Check installation health',
  usage: 'mindos doctor [agents [agent-key]]',
  flags: {
    '--json': 'Output as JSON',
  },
  examples: [
    'mindos doctor',
    'mindos doctor --json',
    'mindos doctor agents',
    'mindos doctor agents codex --json',
  ],
};

export function formatShimActivationWarning(platform = process.platform) {
  return platform === 'win32'
    ? '~/.mindos/bin added to your user PATH — open a new terminal to activate'
    : '~/.mindos/bin PATH injected into shell rc files — open a new terminal to activate';
}

export function getShimExecutablePath(platform = process.platform, homeDir = homedir()) {
  return resolve(homeDir, '.mindos', 'bin', platform === 'win32' ? 'mindos.cmd' : 'mindos');
}

function agentStatusLabel(result) {
  if (result.ready) return green('ready');
  if (result.status === 'missing-mcp') return yellow('missing MCP');
  if (result.status === 'missing-skill') return yellow('missing Skill');
  if (result.status === 'missing-command') return yellow('missing command');
  if (result.status === 'invalid-mcp') return red('invalid MCP');
  return yellow(result.status);
}

function printAgentReadiness(result) {
  console.log(`  ${bold(result.name)} ${dim(`(${result.key})`)}  ${agentStatusLabel(result)}`);
  console.log(`    Agent:   ${result.present ? green('detected') : yellow('not detected')}`);
  if (result.mcp.configured) {
    console.log(`    MCP:     ${result.mcp.valid ? green('configured') : red('invalid')} ${dim(`${result.mcp.transport || 'unknown'} · ${result.mcp.configPath}`)}`);
  } else {
    console.log(`    MCP:     ${yellow('missing')}`);
  }
  if (result.command.required) {
    console.log(`    Command: ${result.command.ok ? green('reachable') : red('missing')} ${dim(result.command.source || '')}`);
  }
  console.log(`    Skill:   ${result.skill.installed ? green('installed') : red('missing')} ${dim(`${result.skill.skillName} · ${result.skill.workspacePath}`)}`);
  if (result.actions.length > 0) {
    console.log(`    Fix:     ${cyan(result.actions[0])}`);
  }
  if (result.issues.length > 0) {
    console.log(`    Note:    ${dim(result.issues[0])}`);
  }
}

async function runAgentDoctor(args, flags) {
  const jsonMode = flags.json === true;
  const targetKey = args[0];
  if (targetKey && !MCP_AGENTS[targetKey]) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Unknown agent: ${targetKey}` }, null, 2));
    } else {
      console.error(red(`Unknown agent: ${targetKey}`));
      console.error(dim(`Available: ${Object.keys(MCP_AGENTS).join(', ')}`));
    }
    process.exit(EXIT.NOT_FOUND);
  }

  const results = targetKey
    ? [inspectAgentReadiness(targetKey)]
    : inspectAllAgentReadiness().filter((result) => (
        result.present || result.mcp.configured || result.skill.installed
      ));
  const ok = results.length > 0 && results.every((result) => result.ready);

  if (jsonMode) {
    console.log(JSON.stringify({ ok, count: results.length, agents: results }, null, 2));
  } else {
    console.log(`\n${bold('MindOS Agent Doctor')}\n`);
    if (results.length === 0) {
      console.log(`  ${yellow('!')} No installed or configured agents detected.`);
      console.log(`  ${dim('Run `mindos mcp install <agent-key> -g -y` to connect one.')}\n`);
    } else {
      for (const result of results) {
        printAgentReadiness(result);
        console.log('');
      }
      console.log(ok
        ? `${green('All configured agents are ready.')}\n`
        : `${yellow('Some agents need repair.')} Run ${cyan('mindos mcp install <agent-key> -g -y')} and verify again.\n`);
    }
  }

  if (!ok) process.exit(EXIT.ERROR);
}

export const run = async (args, flags) => {
  if (args[0] === 'agents' || args[0] === 'agent') {
    return runAgentDoctor(args.slice(1), flags);
  }

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
    const ai = resolveAiConfig(config.ai);
    if (!ai.activeProvider || ai.activeProvider === 'skip' || ai.providers.length === 0) {
      warn('AI provider not configured (run `mindos onboard` to set up)');
    } else if (isProviderMissingRequiredKey(ai.activeEntry) && !hasProviderEnvKey(ai.activeEntry)) {
      const envHint = providerEnvKeys(ai.activeEntry).length
        ? ` or env ${providerEnvKeys(ai.activeEntry).join('/')}`
        : '';
      err(`AI provider "${ai.activeEntry.protocol}" has no API key${envHint}`);
      hasError = true;
    } else {
      ok(`AI provider configured  ${dim(ai.activeEntry.protocol)}`);
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

  // 4b. npm reachable from PATH
  try {
    const npmVersion = execFileSync('npm', ['--version'], { stdio: 'pipe' }).toString().trim();
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
  let shimVisible = false;
  try {
    const { isShimInPath } = await import('../lib/cli-shim.js');
    shimVisible = isShimInPath();
  } catch { /* fallback to repair attempt below */ }

  if (shimVisible) {
    ok(`~/.mindos/bin is in PATH`);
  } else {
    try {
      const { ensureCliShim, isShimInPath } = await import('../lib/cli-shim.js');
      ensureCliShim();
      if (isShimInPath()) {
        ok(`~/.mindos/bin is in PATH`);
      } else {
        warn(formatShimActivationWarning());
      }
    } catch {
      const shimExecutable = getShimExecutablePath();
      if (existsSync(shimExecutable)) {
        const shimName = process.platform === 'win32' ? 'mindos.cmd' : 'mindos';
        warn(`~/.mindos/bin/${shimName} exists but is NOT in PATH — AI Agents cannot find the mindos command`);
        if (!jsonMode) {
          if (process.platform === 'win32') {
            console.log(dim('     Fix: add %USERPROFILE%\\.mindos\\bin to your user PATH, then open a new terminal.'));
          } else {
            console.log(dim('     Fix: add to your shell config:'));
            console.log(dim('       export PATH="$HOME/.mindos/bin:$PATH"'));
          }
        }
      }
    }
  }

  const { hasPrebuiltStandalone, needsBuild } = await import('../lib/build.js');

  // 5. Build
  if (hasPrebuiltStandalone()) {
    ok('Production build is up to date (prebuilt standalone)');
  } else if (!existsSync(resolve(WEB_APP_DIR, '.next'))) {
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
      execFileSync('systemctl', ['--user', 'is-active', 'mindos'], { stdio: 'pipe' });
      ok('Systemd service mindos is active');
    } catch {
      warn('Systemd service mindos is not active  (run `mindos gateway start` to start)');
    }
  } else if (platform === 'launchd') {
    try {
      const uid = execFileSync('id', ['-u'], { stdio: 'pipe' }).toString().trim();
      execFileSync('launchctl', ['print', `gui/${uid}/com.mindos.app`], { stdio: 'pipe' });
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
      const currentVersion = (() => { try { return JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version; } catch { return '?'; } })();
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
