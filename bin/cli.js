#!/usr/bin/env node

/**
 * MindOS CLI
 *
 * Usage:
 *   mindos onboard                  — interactive setup → writes ~/.mindos/config.json
 *   mindos onboard --install-daemon — setup + install & start as background OS service
 *   mindos start                    — start app + MCP server (production, auto-rebuilds if needed)
 *   mindos start --daemon           — install + start as background OS service
 *   mindos start --verbose          — start with verbose MCP logging
 *   mindos dev                      — start app + MCP server (dev mode)
 *   mindos dev --turbopack          — start with Turbopack (faster HMR)
 *   mindos build                    — build the app for production
 *   mindos mcp                      — start MCP server only
 *   mindos stop                     — stop running MindOS processes
 *   mindos restart                  — stop then start
 *   mindos open                     — open Web UI in the default browser
 *   mindos token                    — show current auth token and MCP config snippet
 *   mindos sync                     — show sync status
 *   mindos sync init                — configure remote git repo for sync
 *   mindos sync now                 — manual trigger sync
 *   mindos sync conflicts           — list conflict files
 *   mindos sync on|off              — enable/disable auto-sync
 *   mindos gateway install          — install background service (systemd/launchd)
 *   mindos gateway uninstall        — remove background service
 *   mindos gateway start            — start the background service
 *   mindos gateway stop             — stop the background service
 *   mindos gateway status           — show service status
 *   mindos gateway logs             — tail service logs
 *   mindos doctor                   — health check (config, ports, build, daemon)
 *   mindos uninstall                — fully uninstall MindOS (stop, remove daemon, npm uninstall)
 *   mindos update                   — update to latest version
 *   mindos logs                     — tail service logs (~/.mindos/mindos.log)
 *   mindos config show              — print current config (API keys masked)
 *   mindos config set <key> <val>   — update a single config field
 *   mindos config unset <key>       — remove a config field
 *   mindos config validate          — validate config file
 */

import { execSync, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { ROOT, CONFIG_PATH, BUILD_STAMP, LOG_PATH, MINDOS_DIR } from './lib/constants.js';
import { bold, dim, cyan, green, red, yellow } from './lib/colors.js';

// Resolve the local next binary to avoid npx pulling a mismatched global version
const NEXT_BIN = resolve(ROOT, 'app', 'node_modules', '.bin', 'next');
import { run, npmInstall } from './lib/utils.js';
import { loadConfig, getStartMode, isDaemonMode } from './lib/config.js';
import { needsBuild, writeBuildStamp, cleanNextDir, ensureAppDeps } from './lib/build.js';
import { isPortInUse, assertPortFree } from './lib/port.js';
import { savePids, clearPids } from './lib/pid.js';
import { stopMindos } from './lib/stop.js';
import { getPlatform, ensureMindosDir, waitForHttp, waitForPortFree, runGatewayCommand } from './lib/gateway.js';
import { printStartupInfo, getLocalIP } from './lib/startup.js';
import { spawnMcp } from './lib/mcp-spawn.js';
import { mcpInstall } from './lib/mcp-install.js';
import { initSync, startSyncDaemon, stopSyncDaemon, getSyncStatus, manualSync, listConflicts, setSyncEnabled } from './lib/sync.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Dynamically resolve the new ROOT after `npm install -g`.
 * This is needed because constants are evaluated at module load time.
 */
function getUpdatedRoot() {
  try {
    const mindosBin = execSync('which mindos', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (mindosBin) {
      // mindos bin is usually at <root>/bin/cli.js or a symlink to it
      let cliPath;
      try {
        cliPath = execSync(`readlink -f "${mindosBin}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      } catch {
        try {
          cliPath = execSync(`realpath "${mindosBin}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        } catch {
          cliPath = mindosBin;
        }
      }
      if (cliPath) {
        // cliPath is like /path/to/node_modules/@geminilight/mindos/bin/cli.js
        // ROOT is /path/to/node_modules/@geminilight/mindos
        return resolve(dirname(cliPath), '..');
      }
    }
  } catch {}
  // Fallback to static ROOT
  return ROOT;
}

/**
 * Build the app in the given root if the build stamp doesn't match the package version.
 * Used by `mindos update` to pre-build before restarting the daemon.
 */
function buildIfNeeded(newRoot) {
  const newBuildStamp = resolve(newRoot, 'app', '.next', '.mindos-build-version');
  const newNextBin = resolve(newRoot, 'app', 'node_modules', '.bin', 'next');

  let needBuild = true;
  try {
    const builtVersion = readFileSync(newBuildStamp, 'utf-8').trim();
    const pkgVersion = JSON.parse(readFileSync(resolve(newRoot, 'package.json'), 'utf-8')).version;
    needBuild = builtVersion !== pkgVersion;
  } catch {
    needBuild = true;
  }

  if (!needBuild) return;

  console.log(yellow('\n  Building MindOS (version change detected)...\n'));
  const appPkg = resolve(newRoot, 'app', 'package.json');
  if (existsSync(appPkg)) {
    run('npm install', resolve(newRoot, 'app'));
  }
  const nextDir = resolve(newRoot, 'app', '.next');
  if (existsSync(nextDir)) {
    run(`rm -rf "${nextDir}"`, newRoot);
  }
  run('node scripts/gen-renderer-index.js', newRoot);
  run(`${newNextBin} build`, resolve(newRoot, 'app'));
  const version = JSON.parse(readFileSync(resolve(newRoot, 'package.json'), 'utf-8')).version;
  writeFileSync(newBuildStamp, version, 'utf-8');
}

// ── Commands ──────────────────────────────────────────────────────────────────

const cmd       = process.argv[2];

// ── --version / -v ──────────────────────────────────────────────────────────
// --help / -h is handled at entry section (resolvedCmd = null → help block)
if (cmd === '--version' || cmd === '-v') {
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
  console.log(`mindos/${version} node/${process.version} ${process.platform}-${process.arch}`);
  process.exit(0);
}

const isDaemon  = process.argv.includes('--daemon') || (!cmd && isDaemonMode());
const isVerbose = process.argv.includes('--verbose');
const extra     = process.argv.slice(3).filter(a => a !== '--daemon' && a !== '--verbose').join(' ');

const commands = {
  // ── onboard ────────────────────────────────────────────────────────────────
  onboard: async () => {
    const daemonFlag = process.argv.includes('--install-daemon') ? ' --install-daemon' : '';
    run(`node ${resolve(ROOT, 'scripts/setup.js')}${daemonFlag}`);
  },
  init:  async () => commands.onboard(),
  setup: async () => commands.onboard(),

  // ── open ───────────────────────────────────────────────────────────────────
  open: () => {
    loadConfig();
    const webPort = process.env.MINDOS_WEB_PORT || '3456';
    const url = `http://localhost:${webPort}`;
    let cmd;
    if (process.platform === 'darwin') {
      cmd = 'open';
    } else if (process.platform === 'linux') {
      // WSL detection
      try {
        const uname = execSync('uname -r', { encoding: 'utf-8' });
        cmd = uname.toLowerCase().includes('microsoft') ? 'wslview' : 'xdg-open';
      } catch {
        cmd = 'xdg-open';
      }
    } else {
      cmd = 'start';
    }
    try {
      execSync(`${cmd} ${url}`, { stdio: 'ignore' });
      console.log(`${green('✔')} Opening ${cyan(url)}`);
    } catch {
      console.log(dim(`Could not open browser automatically. Visit: ${cyan(url)}`));
    }
  },

  // ── token ──────────────────────────────────────────────────────────────────
  token: () => {
    if (!existsSync(CONFIG_PATH)) {
      console.error(red('No config found. Run `mindos onboard` first.'));
      process.exit(1);
    }
    let config = {};
    try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
    const token = config.authToken || '';
    if (!token) {
      console.log(dim('No auth token set. Run `mindos onboard` to configure one.'));
      process.exit(0);
    }
    const mcpPort = config.mcpPort || 8781;
    const localIP = getLocalIP();

    const localUrl = `http://localhost:${mcpPort}/mcp`;
    const sep = '━'.repeat(40);

    console.log(`\n${bold('🔑 Auth token:')} ${cyan(token)}\n`);

    // Claude Code
    console.log(`${sep}`);
    console.log(`${bold('Claude Code')}`);
    console.log(`${sep}`);
    console.log(dim('Quick install:') + ` mindos mcp install claude-code -g -y`);
    console.log(dim('\nManual config (~/.claude.json):'));
    console.log(JSON.stringify({
      mcpServers: {
        mindos: {
          url: localUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }, null, 2));

    // CodeBuddy (Claude Code Internal)
    console.log(`\n${sep}`);
    console.log(`${bold('CodeBuddy (Claude Code Internal)')}`);
    console.log(`${sep}`);
    console.log(dim('Quick install:') + ` mindos mcp install codebuddy -g -y`);
    console.log(dim('\nManual config (~/.claude-internal/.claude.json):'));
    console.log(JSON.stringify({
      mcpServers: {
        mindos: {
          url: localUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }, null, 2));

    // Cursor
    console.log(`\n${sep}`);
    console.log(`${bold('Cursor')}`);
    console.log(`${sep}`);
    console.log(dim('Quick install:') + ` mindos mcp install cursor -g -y`);
    console.log(dim('\nManual config (~/.cursor/mcp.json):'));
    console.log(JSON.stringify({
      mcpServers: {
        mindos: {
          url: localUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }, null, 2));

    // Remote
    if (localIP) {
      const remoteUrl = `http://${localIP}:${mcpPort}/mcp`;
      console.log(`\n${sep}`);
      console.log(`${bold('Remote (other devices)')}`);
      console.log(`${sep}`);
      console.log(`URL: ${cyan(remoteUrl)}`);
      console.log(JSON.stringify({
        mcpServers: {
          mindos: {
            url: remoteUrl,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }, null, 2));
    }

    console.log(dim('\nRun `mindos onboard` to regenerate.\n'));
  },

  // ── dev ────────────────────────────────────────────────────────────────────
  dev: async () => {
    loadConfig();
    process.env.MINDOS_CLI_PATH = resolve(ROOT, 'bin', 'cli.js');
    process.env.MINDOS_NODE_BIN = process.execPath;
    const webPort = process.env.MINDOS_WEB_PORT || '3456';
    const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
    await assertPortFree(Number(webPort), 'web');
    await assertPortFree(Number(mcpPort), 'mcp');
    ensureAppDeps();
    const mcp = spawnMcp(isVerbose);
    savePids(process.pid, mcp.pid);
    process.on('exit', () => { stopSyncDaemon(); clearPids(); });
    // Start sync daemon if enabled
    const devMindRoot = process.env.MIND_ROOT;
    if (devMindRoot) {
      startSyncDaemon(devMindRoot).catch(() => {});
    }
    await printStartupInfo(webPort, mcpPort);
    run(`${NEXT_BIN} dev -p ${webPort} ${extra}`, resolve(ROOT, 'app'));
  },

  // ── start ──────────────────────────────────────────────────────────────────
  start: async () => {
    // Check for incomplete setup
    if (existsSync(CONFIG_PATH)) {
      try {
        const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
        if (cfg.setupPending === true) {
          console.log(`\n  ${yellow('⚠ Setup was not completed.')} Run ${cyan('mindos onboard')} to finish, or ${cyan('mindos config set setupPending false')} to dismiss.\n`);
        }
      } catch {}
    }
    if (isDaemon) {
      const platform = getPlatform();
      if (!platform) {
        console.warn(yellow('Warning: daemon mode not supported on this platform. Falling back to foreground.'));
      } else {
        loadConfig();
        const webPort = process.env.MINDOS_WEB_PORT || '3456';
        const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
        console.log(cyan(`Installing MindOS as a background service (${platform})...`));
        await runGatewayCommand('install');
        // install() already starts the service via launchctl bootstrap + RunAtLoad=true.
        // Do NOT call start() here — kickstart -k would kill the just-started process,
        // causing a port-conflict race condition with KeepAlive restart loops.
        console.log(dim('  (First run may take a few minutes to install dependencies and build the app.)'));
        const ready = await waitForHttp(Number(webPort), { retries: 180, intervalMs: 2000, label: 'Web UI', logFile: LOG_PATH });
        if (!ready) {
          console.error(red('\n✘ Service started but Web UI did not become ready in time.'));
          console.error(dim('  Check logs with: mindos logs\n'));
          process.exit(1);
        }
        await printStartupInfo(webPort, mcpPort);
        // System notification
        try {
          if (process.platform === 'darwin') {
            execSync(`osascript -e 'display notification "http://localhost:${webPort}" with title "MindOS Ready"'`, { stdio: 'ignore' });
          } else if (process.platform === 'linux') {
            execSync(`notify-send "MindOS Ready" "http://localhost:${webPort}"`, { stdio: 'ignore' });
          }
        } catch { /* notification is best-effort */ }
        console.log(`${green('✔ MindOS is running as a background service')}`);
        console.log(dim('  View logs:    mindos logs'));
        console.log(dim('  Stop:         mindos gateway stop'));
        console.log(dim('  Uninstall:    mindos gateway uninstall\n'));
        return;
      }
    }
    loadConfig();
    const webPort = process.env.MINDOS_WEB_PORT || '3456';
    const mcpPort = process.env.MINDOS_MCP_PORT || '8781';

    // ── Auto-migrate user-rules.md to root user-skill-rules.md ─────────────
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      const mr = cfg.mindRoot;
      if (mr && existsSync(mr)) {
        const isZh = cfg.disabledSkills?.includes('mindos');
        const sName = isZh ? 'mindos-zh' : 'mindos';
        const sDir = resolve(mr, '.agents', 'skills', sName);
        const rootUserRules = resolve(mr, 'user-skill-rules.md');

        // Migrate: .agents/skills/{name}/user-rules.md → {mindRoot}/user-skill-rules.md
        if (!existsSync(rootUserRules)) {
          const oldUserRules = resolve(sDir, 'user-rules.md');
          if (existsSync(oldUserRules)) {
            cpSync(oldUserRules, rootUserRules);
            console.log(`  ${green('✓')} ${dim('Migrated user-rules.md → user-skill-rules.md')}`);
          }
        }
      }
    } catch { /* best-effort, don't block startup */ }

    // When launched by a daemon manager (launchd/systemd), wait for ports to
    // free instead of exiting immediately — the previous instance may still be
    // shutting down after a restart/update.
    const launchedByDaemon = process.env.LAUNCHED_BY_LAUNCHD === '1'
      || !!process.env.INVOCATION_ID; /* systemd sets INVOCATION_ID */

    if (launchedByDaemon) {
      const webOk = await waitForPortFree(Number(webPort), { retries: 60, intervalMs: 500 });
      const mcpOk = await waitForPortFree(Number(mcpPort), { retries: 60, intervalMs: 500 });
      if (!webOk || !mcpOk) {
        console.error('Ports still in use after 30s, exiting.');
        process.exit(1);  // KeepAlive will retry after ThrottleInterval
      }
    } else {
      await assertPortFree(Number(webPort), 'web');
      await assertPortFree(Number(mcpPort), 'mcp');
    }
    process.env.MINDOS_CLI_PATH = resolve(ROOT, 'bin', 'cli.js');
    process.env.MINDOS_NODE_BIN = process.execPath;
    ensureAppDeps();
    if (needsBuild()) {
      console.log(yellow('Building MindOS (first run or new version detected)...\n'));
      cleanNextDir();
      run('node scripts/gen-renderer-index.js', ROOT);
      run(`${NEXT_BIN} build`, resolve(ROOT, 'app'));
      writeBuildStamp();
    }
    const mcp = spawnMcp(isVerbose);
    savePids(process.pid, mcp.pid);
    process.on('exit', () => { stopSyncDaemon(); clearPids(); });
    // Start sync daemon if enabled
    const mindRoot = process.env.MIND_ROOT;
    if (mindRoot) {
      startSyncDaemon(mindRoot).catch(() => {});
    }
    await printStartupInfo(webPort, mcpPort);
    run(`${NEXT_BIN} start -p ${webPort} ${extra}`, resolve(ROOT, 'app'));
  },

  // ── build ──────────────────────────────────────────────────────────────────
  build: () => {
    ensureAppDeps();
    cleanNextDir();
    run('node scripts/gen-renderer-index.js', ROOT);
    run(`${NEXT_BIN} build ${extra}`, resolve(ROOT, 'app'));
    writeBuildStamp();
  },

  mcp: async () => {
    const sub = process.argv[3];
    const restArgs = process.argv.slice(3);
    const hasInstallFlags = restArgs.some(a => ['-g', '--global', '-y', '--yes'].includes(a));
    if (sub === 'install' || hasInstallFlags) { await mcpInstall(); return; }
    loadConfig();
    const mcpSdk = resolve(ROOT, 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
    if (!existsSync(mcpSdk)) {
      console.log(yellow('Installing MCP dependencies (first run)...\n'));
      npmInstall(resolve(ROOT, 'mcp'), '--no-workspaces');
    }
    // Map config env vars to what the MCP server expects
    const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
    const webPort = process.env.MINDOS_WEB_PORT || '3456';
    process.env.MCP_PORT   = mcpPort;
    process.env.MINDOS_URL = `http://localhost:${webPort}`;
    run(`npx tsx src/index.ts`, resolve(ROOT, 'mcp'));
  },

  // ── stop / restart ─────────────────────────────────────────────────────────
  stop: () => stopMindos(),

  restart: async () => {
    // Capture old ports BEFORE loadConfig overwrites env vars, so we can
    // clean up processes that are still listening on the previous ports
    // (e.g. user changed ports in the GUI and config was already saved).
    // Sources: (1) MINDOS_OLD_* set by /api/restart when it strips the
    //              current env, (2) current MINDOS_*_PORT env vars.
    const oldWebPort = process.env.MINDOS_OLD_WEB_PORT || process.env.MINDOS_WEB_PORT;
    const oldMcpPort = process.env.MINDOS_OLD_MCP_PORT || process.env.MINDOS_MCP_PORT;

    loadConfig();

    // After loadConfig, env vars reflect the NEW config (or old if unchanged).
    const newWebPort = Number(process.env.MINDOS_WEB_PORT || '3456');
    const newMcpPort = Number(process.env.MINDOS_MCP_PORT || '8781');

    // Collect old ports that differ from new ones — processes may still be
    // listening there even though config already points to the new ports.
    const extraPorts = [];
    if (oldWebPort && Number(oldWebPort) !== newWebPort) extraPorts.push(oldWebPort);
    if (oldMcpPort && Number(oldMcpPort) !== newMcpPort) extraPorts.push(oldMcpPort);

    stopMindos({ extraPorts });

    // Wait until ALL ports (old + new) are actually free (up to 15s)
    const allPorts = new Set([newWebPort, newMcpPort]);
    for (const p of extraPorts) allPorts.add(Number(p));

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      let anyBusy = false;
      for (const p of allPorts) {
        if (await isPortInUse(p)) { anyBusy = true; break; }
      }
      if (!anyBusy) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await commands[getStartMode()]();
  },

  // ── gateway ────────────────────────────────────────────────────────────────
  gateway: async () => {
    const sub = process.argv[3];
    if (!sub) {
      const row = (c, d) => `  ${cyan(c.padEnd(32))}${dim(d)}`;
      console.log(`
${bold('mindos gateway')} — manage MindOS as a background OS service

${bold('Subcommands:')}
${row('mindos gateway install',   'Install and enable the service (systemd/launchd)')}
${row('mindos gateway uninstall', 'Disable and remove the service')}
${row('mindos gateway start',     'Start the service')}
${row('mindos gateway stop',      'Stop the service')}
${row('mindos gateway status',    'Show service status')}
${row('mindos gateway logs',      'Tail service logs')}

${dim('Shortcut: mindos start --daemon  →  install + start in one step')}
`);
      return;
    }
    await runGatewayCommand(sub);
  },

  // ── init-skills ──────────────────────────────────────────────────────────
  'init-skills': async () => {
    console.log(`\n${bold('📦 Initialize Skill Rules')}\n`);

    if (!existsSync(CONFIG_PATH)) {
      console.log(`  ${red('✘')} Config not found. Run ${cyan('mindos onboard')} first.\n`);
      process.exit(1);
    }
    let config;
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      console.log(`  ${red('✘')} Failed to parse config at ${dim(CONFIG_PATH)}\n`);
      process.exit(1);
    }
    const mindRoot = config.mindRoot;
    if (!mindRoot || !existsSync(mindRoot)) {
      console.log(`  ${red('✘')} Knowledge base not found: ${dim(mindRoot || '(not set)')}\n`);
      process.exit(1);
    }

    // Skill operating rules are now built into SKILL.md (shipped with the app).
    // This command only initializes user-skill-rules.md for personalization.
    const dest = resolve(mindRoot, 'user-skill-rules.md');
    if (existsSync(dest)) {
      console.log(`  ${dim('skip')}  user-skill-rules.md (already exists)\n`);
    } else {
      const isZh = config.disabledSkills?.includes('mindos');
      const lang = isZh ? 'zh' : 'en';
      const src = resolve(ROOT, 'templates', 'skill-rules', lang, 'user-rules.md');
      if (existsSync(src)) {
        cpSync(src, dest);
        console.log(`  ${green('✓')}  user-skill-rules.md created at ${dim(mindRoot)}\n`);
      } else {
        console.log(`  ${dim('skip')}  Template not found, create user-skill-rules.md manually if needed.\n`);
      }
    }
    console.log(`  ${dim('Note: Operating rules are now built into the app. No install needed.')}\n`);
  },

  // ── doctor ─────────────────────────────────────────────────────────────────
  doctor: async () => {
    const ok  = (msg) => console.log(`  ${green('✔')} ${msg}`);
    const err = (msg) => console.log(`  ${red('✘')} ${msg}`);
    const warn= (msg) => console.log(`  ${yellow('!')} ${msg}`);

    console.log(`\n${bold('🩺 MindOS Doctor')}\n`);
    let hasError = false;

    // 1. config file
    if (!existsSync(CONFIG_PATH)) {
      err(`Config not found at ${dim(CONFIG_PATH)}`);
      console.log(`\n  ${dim('Run `mindos onboard` to create it.')}\n`);
      process.exit(1);
    }
    let config;
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      ok(`Config file found and valid JSON  ${dim(CONFIG_PATH)}`);
    } catch {
      err(`Config file exists but failed to parse  ${dim(CONFIG_PATH)}`);
      hasError = true;
    }

    // 2. mindRoot
    if (config) {
      const mindRoot = config.mindRoot;
      if (!mindRoot) {
        err('Config missing required field: mindRoot');
        hasError = true;
      } else if (!existsSync(mindRoot.replace(/^~/, homedir()))) {
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
      const hasOpenai    = providers?.openai?.apiKey    || config.ai?.openaiApiKey;
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
      console.log(dim('     Node.js may be installed via nvm/fnm/volta and not visible to /bin/sh.'));
      console.log(dim('     Fix: add your Node.js bin path to ~/.profile so non-interactive shells can find it.'));
      hasError = true;
    }

    // 5. Build
    if (!existsSync(resolve(ROOT, 'app', '.next'))) {
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
        const syncStatus = getSyncStatus(config.mindRoot);
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
      const { checkForUpdate } = await import('./lib/update-check.js');
      const latestVersion = await Promise.race([
        checkForUpdate(),
        new Promise(r => setTimeout(() => r(null), 4000)),
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

    console.log(hasError
      ? `\n${red('Some checks failed.')} Run ${cyan('mindos onboard')} to reconfigure.\n`
      : `\n${green('All checks passed.')}\n`);
    if (hasError) process.exit(1);
  },

  // ── update ─────────────────────────────────────────────────────────────────
  update: async () => {
    const { writeUpdateStatus, writeUpdateFailed, clearUpdateStatus } = await import('./lib/update-status.js');
    const currentVersion = (() => {
      try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; }
    })();
    console.log(`\n${bold('⬆  Updating MindOS...')}  ${dim(`(current: ${currentVersion})`)}\n`);

    // Stage 1: Download
    writeUpdateStatus('downloading', { fromVersion: currentVersion });
    try {
      execSync('npm install -g @geminilight/mindos@latest', { stdio: 'inherit' });
    } catch {
      writeUpdateFailed('downloading', 'npm install failed', { fromVersion: currentVersion });
      console.error(red('Update failed. Try: npm install -g @geminilight/mindos@latest'));
      process.exit(1);
    }
    if (existsSync(BUILD_STAMP)) rmSync(BUILD_STAMP);

    // Resolve the new installation path (after npm install -g, ROOT is stale)
    const updatedRoot = getUpdatedRoot();
    const newVersion = (() => {
      try { return JSON.parse(readFileSync(resolve(updatedRoot, 'package.json'), 'utf-8')).version; } catch { return '?'; }
    })();
    const vOpts = { fromVersion: currentVersion, toVersion: newVersion };

    // Stage 2: Skills
    writeUpdateStatus('skills', vOpts);
    try {
      const { checkSkillVersions, updateSkill } = await import('./lib/skill-check.js');
      const mismatches = checkSkillVersions(updatedRoot);
      for (const m of mismatches) {
        updateSkill(m.bundledPath, m.installPath);
        console.log(`  ${green('✓')} ${dim(`Skill ${m.name}: v${m.installed} → v${m.bundled}`)}`);
      }
    } catch { /* best-effort */ }

    if (newVersion !== currentVersion) {
      console.log(`\n${green(`✔ Updated ${currentVersion} → ${newVersion}`)}`);
    } else {
      console.log(`\n${green('✔ Already on the latest version')} ${dim(`(${currentVersion})`)}\n`);
      return;
    }

    const updatePlatform = getPlatform();
    let daemonRunning = false;
    if (updatePlatform === 'systemd') {
      try { execSync('systemctl --user is-active mindos', { stdio: 'pipe' }); daemonRunning = true; } catch {}
    } else if (updatePlatform === 'launchd') {
      try {
        const uid = execSync('id -u').toString().trim();
        execSync(`launchctl print gui/${uid}/com.mindos.app`, { stdio: 'pipe' });
        daemonRunning = true;
      } catch {}
    }

    if (daemonRunning) {
      console.log(cyan('\n  Daemon is running — stopping to apply the new version...'));
      await runGatewayCommand('stop');

      // Stage 3: Rebuild
      writeUpdateStatus('rebuilding', vOpts);
      buildIfNeeded(updatedRoot);

      // Stage 4: Restart
      writeUpdateStatus('restarting', vOpts);
      await runGatewayCommand('install');
      // install() starts the service:
      //   - systemd: daemon-reload + enable + start
      //   - launchd: bootstrap (RunAtLoad=true auto-starts)
      // Do NOT call start() again — on macOS kickstart -k would kill the
      // just-started process, causing a port-conflict race with KeepAlive.
      const updateConfig = (() => {
        try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
      })();
      const webPort = updateConfig.port ?? 3456;
      const mcpPort = updateConfig.mcpPort ?? 8781;
      console.log(dim('  (Waiting for Web UI to come back up — first run after update includes a rebuild...)'));
      const ready = await waitForHttp(Number(webPort), { retries: 120, intervalMs: 2000, label: 'Web UI', logFile: LOG_PATH });
      if (ready) {
        const localIP = getLocalIP();
        console.log(`\n${'─'.repeat(53)}`);
        console.log(`${green('✔')} ${bold(`MindOS updated: ${currentVersion} → ${newVersion}`)}\n`);
        console.log(`  ${green('●')} Web UI   ${cyan(`http://localhost:${webPort}`)}`);
        if (localIP) console.log(`             ${cyan(`http://${localIP}:${webPort}`)}`);
        console.log(`  ${green('●')} MCP      ${cyan(`http://localhost:${mcpPort}/mcp`)}`);
        console.log(`\n  ${dim('View changelog:')}  ${cyan('https://github.com/GeminiLight/MindOS/releases')}`);
        console.log(`${'─'.repeat(53)}\n`);
        writeUpdateStatus('done', vOpts);
      } else {
        writeUpdateFailed('restarting', 'Server did not come back up in time', vOpts);
        console.error(red('✘ MindOS did not come back up in time. Check logs: mindos logs\n'));
        process.exit(1);
      }
    } else {
      // Non-daemon mode: check if a MindOS instance is currently running
      // (e.g. user started via `mindos start`, or GUI triggered this update).
      // If so, stop it and restart from the NEW installation path.
      const updateConfig = (() => {
        try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
      })();
      const webPort = Number(updateConfig.port ?? 3456);
      const mcpPort = Number(updateConfig.mcpPort ?? 8781);

      const wasRunning = await isPortInUse(webPort) || await isPortInUse(mcpPort);

      if (wasRunning) {
        console.log(cyan('\n  MindOS is running — restarting to apply the new version...'));
        stopMindos();
        // Wait for ports to free (up to 15s)
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const busy = await isPortInUse(webPort) || await isPortInUse(mcpPort);
          if (!busy) break;
          await new Promise((r) => setTimeout(r, 500));
        }

        // Stage 3: Rebuild
        writeUpdateStatus('rebuilding', vOpts);
        buildIfNeeded(updatedRoot);

        // Stage 4: Restart
        writeUpdateStatus('restarting', vOpts);
        const newCliPath = resolve(updatedRoot, 'bin', 'cli.js');
        const childEnv = { ...process.env };
        delete childEnv.MINDOS_WEB_PORT;
        delete childEnv.MINDOS_MCP_PORT;
        delete childEnv.MIND_ROOT;
        delete childEnv.AUTH_TOKEN;
        delete childEnv.WEB_PASSWORD;
        const child = nodeSpawn(
          process.execPath, [newCliPath, 'start'],
          { detached: true, stdio: 'ignore', env: childEnv },
        );
        child.unref();

        console.log(dim('  (Waiting for Web UI to come back up...)'));
        const ready = await waitForHttp(webPort, { retries: 120, intervalMs: 2000, label: 'Web UI', logFile: LOG_PATH });
        if (ready) {
          const localIP = getLocalIP();
          console.log(`\n${'─'.repeat(53)}`);
          console.log(`${green('✔')} ${bold(`MindOS updated: ${currentVersion} → ${newVersion}`)}\n`);
          console.log(`  ${green('●')} Web UI   ${cyan(`http://localhost:${webPort}`)}`);
          if (localIP) console.log(`             ${cyan(`http://${localIP}:${webPort}`)}`);
          console.log(`  ${green('●')} MCP      ${cyan(`http://localhost:${mcpPort}/mcp`)}`);
          console.log(`\n  ${dim('View changelog:')}  ${cyan('https://github.com/GeminiLight/MindOS/releases')}`);
          console.log(`${'─'.repeat(53)}\n`);
          writeUpdateStatus('done', vOpts);
        } else {
          writeUpdateFailed('restarting', 'Server did not come back up in time', vOpts);
          console.error(red('✘ MindOS did not come back up in time. Check logs: mindos logs\n'));
          process.exit(1);
        }
      } else {
        // No running instance — just build and tell user to start manually
        buildIfNeeded(updatedRoot);
        console.log(`\n${green('✔')} ${bold(`Updated: ${currentVersion} → ${newVersion}`)}`);
        console.log(dim('  Run `mindos start` to start the updated version.'));
        console.log(`  ${dim('View changelog:')}  ${cyan('https://github.com/GeminiLight/MindOS/releases')}\n`);
      }
    }
  },

  // ── uninstall ───────────────────────────────────────────────────────────────
  uninstall: async () => {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Buffer lines eagerly — readline.question() loses buffered lines when
    // piped stdin delivers multiple lines at once (Node.js known behavior).
    const lineBuffer = [];
    let lineResolve = null;
    rl.on('line', (line) => {
      if (lineResolve) {
        const r = lineResolve;
        lineResolve = null;
        r(line);
      } else {
        lineBuffer.push(line);
      }
    });
    // On EOF with no pending resolve, close gracefully
    rl.on('close', () => {
      if (lineResolve) { lineResolve(''); lineResolve = null; }
    });

    function prompt(question) {
      process.stdout.write(question + ' ');
      if (lineBuffer.length > 0) return Promise.resolve(lineBuffer.shift());
      return new Promise((resolve) => { lineResolve = resolve; });
    }

    async function confirm(question) {
      const a = (await prompt(question + ' [y/N]')).trim().toLowerCase();
      return a === 'y' || a === 'yes';
    }

    async function askInput(question) {
      return (await prompt(question)).trim();
    }

    async function askPassword(question) {
      // Mute echoed keystrokes
      const stdout = process.stdout;
      const origWrite = stdout.write.bind(stdout);
      stdout.write = (chunk, ...args) => {
        // Suppress everything except the prompt itself
        if (typeof chunk === 'string' && chunk.includes(question)) return origWrite(chunk, ...args);
        return true;
      };
      const answer = await prompt(question);
      stdout.write = origWrite;
      console.log(); // newline after hidden input
      return answer.trim();
    }

    const done = () => rl.close();

    console.log(`\n${bold('🗑  MindOS Uninstall')}\n`);
    console.log('  This will:');
    console.log(`  ${green('✓')} Stop running MindOS processes`);
    console.log(`  ${green('✓')} Remove background service (if installed)`);
    console.log(`  ${green('✓')} Uninstall npm package\n`);

    if (!await confirm('Proceed?')) {
      console.log(dim('\n  Aborted.\n'));
      done();
      return;
    }

    // 1. Stop processes
    console.log(`\n${cyan('Stopping MindOS...')}`);
    try { stopMindos(); } catch { /* may not be running */ }

    // 2. Remove daemon (skip if platform unsupported)
    if (getPlatform()) {
      try {
        await runGatewayCommand('uninstall');
      } catch {
        // Daemon may not be installed — that's fine
      }
    }

    // Read config before potentially deleting ~/.mindos/
    let config = {};
    try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
    const mindRoot = config.mindRoot?.replace(/^~/, homedir());

    // 3. Ask to remove ~/.mindos/
    if (existsSync(MINDOS_DIR)) {
      if (await confirm(`Remove config directory (${dim(MINDOS_DIR)})?`)) {
        rmSync(MINDOS_DIR, { recursive: true, force: true });
        console.log(`${green('✔')} Removed ${dim(MINDOS_DIR)}`);
      } else {
        console.log(dim(`  Kept ${MINDOS_DIR}`));
      }
    }

    // 4. Ask to remove knowledge base (triple protection: confirm → type YES → password)
    if (mindRoot && existsSync(mindRoot)) {
      if (await confirm(`Remove knowledge base (${dim(mindRoot)})?`)) {
        const typed = await askInput(`${yellow('⚠  This is irreversible.')} Type ${bold('YES')} to confirm:`);
        if (typed === 'YES') {
          const webPassword = config.webPassword;
          let authorized = true;
          if (webPassword) {
            const pw = await askPassword('Enter web password:');
            if (pw !== webPassword) {
              console.log(red('  Wrong password. Knowledge base kept.'));
              authorized = false;
            }
          }
          if (authorized) {
            rmSync(mindRoot, { recursive: true, force: true });
            console.log(`${green('✔')} Removed ${dim(mindRoot)}`);
          }
        } else {
          console.log(dim('  Knowledge base kept.'));
        }
      } else {
        console.log(dim(`  Kept ${mindRoot}`));
      }
    }

    // 5. npm uninstall -g
    console.log(`\n${cyan('Uninstalling npm package...')}`);
    try {
      execSync('npm uninstall -g @geminilight/mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch {
      console.log(yellow('  npm uninstall failed — you may need to run manually:'));
      console.log(dim('  npm uninstall -g @geminilight/mindos'));
    }

    console.log(`\n${green('✔ MindOS uninstalled.')}\n`);
    done();
  },

  // ── logs ───────────────────────────────────────────────────────────────────
  logs: () => {
    ensureMindosDir();
    if (!existsSync(LOG_PATH)) {
      console.log(dim(`No log file yet at ${LOG_PATH}`));
      console.log(dim('Logs are created when starting MindOS (mindos start, mindos onboard, or daemon mode).'));
      process.exit(0);
    }
    const noFollow = process.argv.includes('--no-follow');
    if (noFollow) {
      execSync(`tail -n 100 ${LOG_PATH}`, { stdio: 'inherit' });
    } else {
      execSync(`tail -f ${LOG_PATH}`, { stdio: 'inherit' });
    }
  },

  // ── config ─────────────────────────────────────────────────────────────────
  config: () => {
    const sub = process.argv[3];

    function maskKey(val) {
      if (!val) return val;
      if (val.length <= 8) return '****';
      return val.slice(0, 6) + '****';
    }

    if (sub === 'show') {
      if (!existsSync(CONFIG_PATH)) {
        console.error(red('No config found. Run `mindos onboard` first.'));
        process.exit(1);
      }
      let config;
      try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {
        console.error(red('Failed to parse config file.'));
        process.exit(1);
      }
      const display = JSON.parse(JSON.stringify(config));
      if (display.ai?.providers?.anthropic?.apiKey)
        display.ai.providers.anthropic.apiKey = maskKey(display.ai.providers.anthropic.apiKey);
      if (display.ai?.providers?.openai?.apiKey)
        display.ai.providers.openai.apiKey = maskKey(display.ai.providers.openai.apiKey);
      if (display.ai?.anthropicApiKey)
        display.ai.anthropicApiKey = maskKey(display.ai.anthropicApiKey);
      if (display.ai?.openaiApiKey)
        display.ai.openaiApiKey = maskKey(display.ai.openaiApiKey);
      if (display.authToken)
        display.authToken = maskKey(display.authToken);
      if (display.webPassword)
        display.webPassword = maskKey(display.webPassword);
      console.log(`\n${bold('📋 MindOS Config')}  ${dim(`v${(() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; } })()}`)}  ${dim(CONFIG_PATH)}\n`);
      console.log(JSON.stringify(display, null, 2));
      console.log();
      return;
    }

    if (sub === 'validate') {
      if (!existsSync(CONFIG_PATH)) {
        console.error(red('No config found. Run `mindos onboard` first.'));
        process.exit(1);
      }
      let config;
      try {
        config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      } catch (e) {
        console.error(red(`✘ Invalid JSON: ${e.message}`));
        process.exit(1);
      }
      const issues = [];
      if (!config.mindRoot) issues.push('missing required field: mindRoot');
      if (!config.ai?.provider) issues.push('missing field: ai.provider');
      if (config.ai?.provider === 'anthropic') {
        const key = config.ai?.providers?.anthropic?.apiKey || config.ai?.anthropicApiKey;
        if (!key) issues.push('ai.provider is "anthropic" but no API key found');
      }
      if (config.ai?.provider === 'openai') {
        const key = config.ai?.providers?.openai?.apiKey || config.ai?.openaiApiKey;
        if (!key) issues.push('ai.provider is "openai" but no API key found');
      }
      if (issues.length) {
        console.error(`\n${red('✘ Config has issues:')}`);
        issues.forEach(i => console.error(`  ${red('•')} ${i}`));
        console.error(`\n  ${dim('Run `mindos onboard` to fix.\n')}`);
        process.exit(1);
      }
      console.log(`\n${green('✔ Config is valid')}\n`);
      return;
    }

    if (sub === 'set') {
      const key = process.argv[4];
      const val = process.argv[5];
      if (!key || val === undefined) {
        console.error(red('Usage: mindos config set <key> <value>'));
        console.error(dim('  Examples:'));
        console.error(dim('    mindos config set port 3002'));
        console.error(dim('    mindos config set mcpPort 8788'));
        console.error(dim('    mindos config set ai.provider openai'));
        process.exit(1);
      }
      if (!existsSync(CONFIG_PATH)) {
        console.error(red('No config found. Run `mindos onboard` first.'));
        process.exit(1);
      }
      let config;
      try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {
        console.error(red('Failed to parse config file.'));
        process.exit(1);
      }
      const parts = key.split('.');
      let obj = config;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof obj[parts[i]] !== 'object' || !obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      // Coerce string values to appropriate types
      function coerceValue(v) {
        if (v === 'true') return true;
        if (v === 'false') return false;
        if (v === 'null') return null;
        if (v === '""' || v === "''") return '';
        if (v.trim() !== '' && !isNaN(Number(v))) return Number(v);
        return v;
      }
      const coerced = coerceValue(val);
      obj[parts[parts.length - 1]] = coerced;
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`${green('✔')} Set ${cyan(key)} = ${bold(String(coerced))}`);
      return;
    }

    if (sub === 'unset') {
      const key = process.argv[4];
      if (!key) {
        console.error(red('Usage: mindos config unset <key>'));
        process.exit(1);
      }
      if (!existsSync(CONFIG_PATH)) {
        console.error(red('No config found. Run `mindos onboard` first.'));
        process.exit(1);
      }
      let config;
      try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {
        console.error(red('Failed to parse config file.'));
        process.exit(1);
      }
      const parts = key.split('.');
      let obj = config;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) { console.log(dim(`Key "${key}" not found`)); return; }
        obj = obj[parts[i]];
      }
      if (!(parts[parts.length - 1] in obj)) { console.log(dim(`Key "${key}" not found`)); return; }
      delete obj[parts[parts.length - 1]];
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`${green('✔')} Removed ${cyan(key)}`);
      return;
    }

    // no subcommand or unknown → show help
    const row = (c, d) => `  ${cyan(c.padEnd(32))}${dim(d)}`;
    console.log(`
${bold('mindos config')} — view and update MindOS configuration

${bold('Subcommands:')}
${row('mindos config show',          'Print current config (API keys masked)')}
${row('mindos config validate',      'Validate config file')}
${row('mindos config set <key> <v>', 'Update a single field (dot-notation supported)')}
${row('mindos config unset <key>',   'Remove a config field')}

${bold('Examples:')}
  ${dim('mindos config set port 3002')}
  ${dim('mindos config set ai.provider openai')}
  ${dim('mindos config set setupPending false')}
  ${dim('mindos config unset webPassword')}
`);
  },

  // ── sync ──────────────────────────────────────────────────────────────────
  sync: async () => {
    const sub = process.argv[3];
    loadConfig();
    const mindRoot = process.env.MIND_ROOT;

    if (sub === 'init') {
      // Parse --non-interactive --remote <url> --branch <branch> --token <token>
      const args = process.argv.slice(4);
      const flagIdx = (flag) => args.indexOf(flag);
      const flagVal = (flag) => { const i = flagIdx(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : ''; };
      const nonInteractive = args.includes('--non-interactive');

      if (nonInteractive) {
        await initSync(mindRoot, {
          nonInteractive: true,
          remote: flagVal('--remote'),
          token: flagVal('--token'),
          branch: flagVal('--branch') || 'main',
        });
      } else {
        await initSync(mindRoot);
      }
      return;
    }

    if (sub === 'now') {
      try {
        console.log(dim('Pulling...'));
        manualSync(mindRoot);
        console.log(green('✔ Sync complete'));
      } catch (err) {
        console.error(red(err.message));
        process.exit(1);
      }
      return;
    }

    if (sub === 'conflicts') {
      listConflicts(mindRoot);
      return;
    }

    if (sub === 'on') {
      setSyncEnabled(true);
      return;
    }

    if (sub === 'off') {
      setSyncEnabled(false);
      stopSyncDaemon();
      return;
    }

    // Unknown subcommand check
    if (sub) {
      const validSubs = ['init', 'now', 'conflicts', 'on', 'off'];
      if (!validSubs.includes(sub)) {
        console.error(red(`Unknown sync subcommand: ${sub}`));
        console.error(dim(`Available: ${validSubs.join(' | ')}`));
        process.exit(1);
      }
    }

    // default: sync status
    const status = getSyncStatus(mindRoot);
    if (!status.enabled) {
      console.log(`\n${bold('🔄 Sync Status')}`);
      console.log(dim('  Not configured. Run `mindos sync init` to set up.\n'));
      return;
    }
    const ago = status.lastSync
      ? (() => {
          const diff = Date.now() - new Date(status.lastSync).getTime();
          if (diff < 60000) return 'just now';
          if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
          return `${Math.floor(diff / 3600000)} hours ago`;
        })()
      : 'never';

    console.log(`\n${bold('🔄 Sync Status')}`);
    console.log(`  ${dim('Provider:')}    ${cyan(`${status.provider} (${status.remote})`)}`);
    console.log(`  ${dim('Branch:')}      ${cyan(status.branch)}`);
    console.log(`  ${dim('Last sync:')}   ${ago}`);
    console.log(`  ${dim('Unpushed:')}    ${status.unpushed} commits`);
    console.log(`  ${dim('Conflicts:')}   ${status.conflicts.length ? yellow(`${status.conflicts.length} file(s)`) : green('none')}`);
    console.log(`  ${dim('Auto-sync:')}   ${green('● enabled')} ${dim(`(commit: ${status.autoCommitInterval}s, pull: ${status.autoPullInterval / 60}min)`)}`);
    if (status.lastError) {
      console.log(`  ${dim('Last error:')}  ${red(status.lastError)}`);
    }
    console.log();
  },
};

// ── Entry ─────────────────────────────────────────────────────────────────────

const resolvedCmd = (cmd === '--help' || cmd === '-h') ? null : (cmd || (existsSync(CONFIG_PATH) ? getStartMode() : null));

if (!resolvedCmd || !commands[resolvedCmd]) {
  const pkgVersion = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; } })();
  const row = (c, d) => `  ${cyan(c.padEnd(36))}${dim(d)}`;
  console.log(`
${bold('🧠 MindOS CLI')} ${dim(`v${pkgVersion}`)}

${bold('Core:')}
${row('mindos onboard',                    'Interactive setup (aliases: init, setup)')}
${row('mindos onboard --install-daemon',   'Setup + install & start as background OS service')}
${row('mindos start',                      'Start app + MCP server (production, auto-rebuilds if needed)')}
${row('mindos start --daemon',             'Install + start as background OS service (survives terminal close)')}
${row('mindos start --verbose',            'Start with verbose MCP logging')}
${row('mindos dev',                        'Start app + MCP server (dev mode)')}
${row('mindos dev --turbopack',            'Start with Turbopack (faster HMR)')}
${row('mindos stop',                       'Stop running MindOS processes')}
${row('mindos restart',                    'Stop then start again')}
${row('mindos build',                      'Build the app for production')}
${row('mindos open',                       'Open Web UI in the default browser')}

${bold('MCP:')}
${row('mindos mcp',                        'Start MCP server only')}
${row('mindos mcp install [agent]',        'Install MindOS MCP config into Agent (claude-code/cursor/windsurf/…) [-g]')}
${row('mindos token',                      'Show current auth token and MCP config snippet')}

${bold('Sync:')}
${row('mindos sync',                       'Show sync status (init/now/conflicts/on/off)')}

${bold('Gateway (Background Service):')}
${row('mindos gateway <subcommand>',       'Manage background service (install/uninstall/start/stop/status/logs)')}

${bold('Config & Diagnostics:')}
${row('mindos config <subcommand>',        'View/update config (show/validate/set/unset)')}
${row('mindos doctor',                     'Health check (config, ports, build, daemon)')}
${row('mindos init-skills',                 'Create user-skill-rules.md for personalization')}
${row('mindos update',                     'Update MindOS to the latest version')}
${row('mindos uninstall',                  'Fully uninstall MindOS (stop, remove daemon, npm uninstall)')}
${row('mindos logs',                       'Tail service logs (~/.mindos/mindos.log)')}
${row('mindos',                            'Start using mode saved in ~/.mindos/config.json')}
`);
  const isHelp = (cmd === '--help' || cmd === '-h');
  process.exit((cmd && !isHelp) ? 1 : 0);
}

commands[resolvedCmd]();
