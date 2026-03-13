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
 *   mindos update                   — update to latest version
 *   mindos logs                     — tail service logs (~/.mindos/mindos.log)
 *   mindos config show              — print current config (API keys masked)
 *   mindos config set <key> <val>   — update a single config field
 *   mindos config validate          — validate config file
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { ROOT, CONFIG_PATH, BUILD_STAMP, LOG_PATH } from './lib/constants.js';
import { bold, dim, cyan, green, red, yellow } from './lib/colors.js';
import { run } from './lib/utils.js';
import { loadConfig, getStartMode, isDaemonMode } from './lib/config.js';
import { needsBuild, writeBuildStamp, clearBuildLock, cleanNextDir, ensureAppDeps } from './lib/build.js';
import { isPortInUse, assertPortFree } from './lib/port.js';
import { savePids, clearPids } from './lib/pid.js';
import { stopMindos } from './lib/stop.js';
import { getPlatform, ensureMindosDir, waitForHttp, runGatewayCommand } from './lib/gateway.js';
import { printStartupInfo, getLocalIP } from './lib/startup.js';
import { spawnMcp } from './lib/mcp-spawn.js';
import { mcpInstall } from './lib/mcp-install.js';
import { initSync, startSyncDaemon, stopSyncDaemon, getSyncStatus, manualSync, listConflicts, setSyncEnabled } from './lib/sync.js';

// ── Commands ──────────────────────────────────────────────────────────────────

const cmd       = process.argv[2];
const isDaemon  = process.argv.includes('--daemon') || (!cmd && isDaemonMode());
const isVerbose = process.argv.includes('--verbose');
const extra     = process.argv.slice(3).filter(a => a !== '--daemon' && a !== '--verbose').join(' ');

const commands = {
  // ── onboard ────────────────────────────────────────────────────────────────
  onboard: async () => {
    const daemonFlag = process.argv.includes('--install-daemon') ? ' --install-daemon' : '';
    run(`node ${resolve(ROOT, 'scripts/setup.js')}${daemonFlag}`);
  },
  init:  () => run(`node ${resolve(ROOT, 'scripts/setup.js')}`),
  setup: () => run(`node ${resolve(ROOT, 'scripts/setup.js')}`),

  // ── open ───────────────────────────────────────────────────────────────────
  open: () => {
    loadConfig();
    const webPort = process.env.MINDOS_WEB_PORT || '3000';
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
    const mcpPort = config.mcpPort || 8787;
    const localIP = getLocalIP();

    const localUrl = `http://localhost:${mcpPort}/mcp`;
    const sep = '━'.repeat(40);

    console.log(`\n${bold('🔑 Auth token:')} ${cyan(token)}\n`);

    // Claude Code
    console.log(`${sep}`);
    console.log(`${bold('Claude Code')}`);
    console.log(`${sep}`);
    console.log(dim('一键安装:') + ` mindos mcp install claude-code -g -y`);
    console.log(dim('\n手动配置 (~/.claude.json):'));
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
    console.log(dim('一键安装:') + ` mindos mcp install codebuddy -g -y`);
    console.log(dim('\n手动配置 (~/.claude-internal/.claude.json):'));
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
    console.log(dim('一键安装:') + ` mindos mcp install cursor -g -y`);
    console.log(dim('\n手动配置 (~/.cursor/mcp.json):'));
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
      console.log(`${bold('Remote (其他设备)')}`);
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
    const webPort = process.env.MINDOS_WEB_PORT || '3000';
    const mcpPort = process.env.MINDOS_MCP_PORT || '8787';
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
    printStartupInfo(webPort, mcpPort);
    run(`npx next dev -p ${webPort} ${extra}`, resolve(ROOT, 'app'));
  },

  // ── start ──────────────────────────────────────────────────────────────────
  start: async () => {
    if (isDaemon) {
      const platform = getPlatform();
      if (!platform) {
        console.warn(yellow('Warning: daemon mode not supported on this platform. Falling back to foreground.'));
      } else {
        loadConfig();
        const webPort = process.env.MINDOS_WEB_PORT || '3000';
        const mcpPort = process.env.MINDOS_MCP_PORT || '8787';
        console.log(cyan(`Installing MindOS as a background service (${platform})...`));
        await runGatewayCommand('install');
        await runGatewayCommand('start');
        console.log(dim('  (First run may take a few minutes to install dependencies and build the app.)'));
        console.log(dim('  Follow live progress with:  mindos logs\n'));
        const ready = await waitForHttp(Number(webPort), { retries: 120, intervalMs: 2000, label: 'Web UI' });
        if (!ready) {
          console.error(red('\n✘ Service started but Web UI did not become ready in time.'));
          console.error(dim('  Check logs with: mindos logs\n'));
          process.exit(1);
        }
        printStartupInfo(webPort, mcpPort);
        // System notification
        try {
          if (process.platform === 'darwin') {
            execSync(`osascript -e 'display notification "http://localhost:${webPort}" with title "MindOS 已就绪"'`, { stdio: 'ignore' });
          } else if (process.platform === 'linux') {
            execSync(`notify-send "MindOS 已就绪" "http://localhost:${webPort}"`, { stdio: 'ignore' });
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
    const webPort = process.env.MINDOS_WEB_PORT || '3000';
    const mcpPort = process.env.MINDOS_MCP_PORT || '8787';
    await assertPortFree(Number(webPort), 'web');
    await assertPortFree(Number(mcpPort), 'mcp');
    ensureAppDeps();
    if (needsBuild()) {
      console.log(yellow('Building MindOS (first run or new version detected)...\n'));
      cleanNextDir();
      run('npx next build', resolve(ROOT, 'app'));
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
    printStartupInfo(webPort, mcpPort);
    run(`npx next start -p ${webPort} ${extra}`, resolve(ROOT, 'app'));
  },

  // ── build ──────────────────────────────────────────────────────────────────
  build: () => {
    ensureAppDeps();
    cleanNextDir();
    run(`npx next build ${extra}`, resolve(ROOT, 'app'));
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
      run('npm install --prefer-offline --no-workspaces', resolve(ROOT, 'mcp'));
    }
    // Map config env vars to what the MCP server expects
    const mcpPort = process.env.MINDOS_MCP_PORT || '8787';
    const webPort = process.env.MINDOS_WEB_PORT || '3000';
    process.env.MCP_PORT   = mcpPort;
    process.env.MINDOS_URL = `http://localhost:${webPort}`;
    run(`npx tsx src/index.ts`, resolve(ROOT, 'mcp'));
  },

  // ── stop / restart ─────────────────────────────────────────────────────────
  stop: () => stopMindos(),

  restart: async () => {
    stopMindos();
    await new Promise((r) => setTimeout(r, 1500));
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
    const webPort = Number(config?.port || process.env.MINDOS_WEB_PORT || 3000);
    const mcpPort = Number(config?.mcpPort || process.env.MINDOS_MCP_PORT || 8787);
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

    console.log(hasError
      ? `\n${red('Some checks failed.')} Run ${cyan('mindos onboard')} to reconfigure.\n`
      : `\n${green('All checks passed.')}\n`);
    if (hasError) process.exit(1);
  },

  // ── update ─────────────────────────────────────────────────────────────────
  update: async () => {
    const currentVersion = (() => {
      try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; }
    })();
    console.log(`\n${bold('⬆  Updating MindOS...')}  ${dim(`(current: ${currentVersion})`)}\n`);
    try {
      execSync('npm install -g @geminilight/mindos@latest', { stdio: 'inherit' });
    } catch {
      console.error(red('Update failed. Try: npm install -g @geminilight/mindos@latest'));
      process.exit(1);
    }
    if (existsSync(BUILD_STAMP)) rmSync(BUILD_STAMP);
    const newVersion = (() => {
      try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; }
    })();
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
      console.log(cyan('\n  Daemon is running — restarting to apply the new version...'));
      await runGatewayCommand('stop');
      await runGatewayCommand('install');
      await runGatewayCommand('start');
      const webPort = process.env.MINDOS_WEB_PORT || '3000';
      console.log(dim('  (Waiting for Web UI to come back up...)'));
      const ready = await waitForHttp(Number(webPort), { retries: 120, intervalMs: 2000, label: 'Web UI' });
      if (ready) {
        console.log(green('✔ MindOS restarted and ready.\n'));
      } else {
        console.error(red('✘ MindOS did not come back up in time. Check logs: mindos logs\n'));
        process.exit(1);
      }
    } else {
      console.log(dim('  Run `mindos start` — it will rebuild automatically.\n'));
    }
  },

  // ── logs ───────────────────────────────────────────────────────────────────
  logs: () => {
    ensureMindosDir();
    if (!existsSync(LOG_PATH)) {
      console.log(dim(`No log file yet at ${LOG_PATH}`));
      console.log(dim('Logs are written when running in daemon mode (mindos start --daemon).'));
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
      console.log(`\n${bold('📋 MindOS Config')}  ${dim(CONFIG_PATH)}\n`);
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
      const coerced = isNaN(Number(val)) ? val : Number(val);
      obj[parts[parts.length - 1]] = coerced;
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`${green('✔')} Set ${cyan(key)} = ${bold(String(coerced))}`);
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

${bold('Examples:')}
  ${dim('mindos config set port 3002')}
  ${dim('mindos config set ai.provider openai')}
`);
  },

  // ── sync ──────────────────────────────────────────────────────────────────
  sync: async () => {
    const sub = process.argv[3];
    loadConfig();
    const mindRoot = process.env.MIND_ROOT;

    if (sub === 'init') {
      await initSync(mindRoot);
      return;
    }

    if (sub === 'now') {
      manualSync(mindRoot);
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

const resolvedCmd = cmd || (existsSync(CONFIG_PATH) ? getStartMode() : null);

if (!resolvedCmd || !commands[resolvedCmd]) {
  const row = (c, d) => `  ${cyan(c.padEnd(36))}${dim(d)}`;
  console.log(`
${bold('🧠 MindOS CLI')}

${bold('Usage:')}
${row('mindos onboard',                    'Interactive setup (writes ~/.mindos/config.json)')}
${row('mindos onboard --install-daemon',   'Setup + install & start as background OS service')}
${row('mindos start',                      'Start app + MCP server (production, auto-rebuilds if needed)')}
${row('mindos start --daemon',             'Install + start as background OS service (survives terminal close)')}
${row('mindos start --verbose',            'Start with verbose MCP logging')}
${row('mindos dev',                        'Start app + MCP server (dev mode)')}
${row('mindos dev --turbopack',            'Start with Turbopack (faster HMR)')}
${row('mindos stop',                       'Stop running MindOS processes')}
${row('mindos restart',                    'Stop then start again')}
${row('mindos build',                      'Build the app for production')}
${row('mindos mcp',                        'Start MCP server only')}
${row('mindos mcp install [agent]',        'Install MindOS MCP config into Agent (claude-code/cursor/windsurf/…) [-g]')}
${row('mindos open',                       'Open Web UI in the default browser')}
${row('mindos token',                      'Show current auth token and MCP config snippet')}
${row('mindos sync',                       'Show sync status (init/now/conflicts/on/off)')}
${row('mindos gateway <subcommand>',       'Manage background service (install/uninstall/start/stop/status/logs)')}
${row('mindos doctor',                     'Health check (config, ports, build, daemon)')}
${row('mindos update',                     'Update MindOS to the latest version')}
${row('mindos logs',                       'Tail service logs (~/.mindos/mindos.log)')}
${row('mindos config <subcommand>',        'View/update config (show/validate/set)')}
${row('mindos',                            'Start using mode saved in ~/.mindos/config.json')}
`);
  process.exit(cmd ? 1 : 0);
}

commands[resolvedCmd]();
