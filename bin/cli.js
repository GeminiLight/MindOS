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
 *   mindos token                    — show current auth token and MCP config snippet
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

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(homedir(), '.mindos', 'config.json');
const PID_PATH    = resolve(homedir(), '.mindos', 'mindos.pid');
const BUILD_STAMP = resolve(ROOT, 'app', '.next', '.mindos-build-version');

// ── Colors ────────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const bold  = (s) => isTTY ? `\x1b[1m${s}\x1b[0m`  : s;
const dim   = (s) => isTTY ? `\x1b[2m${s}\x1b[0m`  : s;
const cyan  = (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red   = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const yellow= (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return;
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.error(`Warning: failed to parse ${CONFIG_PATH}`);
    return;
  }

  const set = (key, val) => {
    if (val && !process.env[key]) process.env[key] = String(val);
  };

  set('MIND_ROOT',          config.mindRoot);
  set('MINDOS_WEB_PORT',    config.port);
  set('MINDOS_MCP_PORT',    config.mcpPort);
  set('AUTH_TOKEN',         config.authToken);
  set('WEB_PASSWORD',       config.webPassword);
  set('AI_PROVIDER',        config.ai?.provider);

  const providers = config.ai?.providers;
  if (providers) {
    set('ANTHROPIC_API_KEY', providers.anthropic?.apiKey);
    set('ANTHROPIC_MODEL',   providers.anthropic?.model);
    set('OPENAI_API_KEY',    providers.openai?.apiKey);
    set('OPENAI_MODEL',      providers.openai?.model);
    set('OPENAI_BASE_URL',   providers.openai?.baseUrl);
  } else {
    set('ANTHROPIC_API_KEY', config.ai?.anthropicApiKey);
    set('ANTHROPIC_MODEL',   config.ai?.anthropicModel);
    set('OPENAI_API_KEY',    config.ai?.openaiApiKey);
    set('OPENAI_MODEL',      config.ai?.openaiModel);
    set('OPENAI_BASE_URL',   config.ai?.openaiBaseUrl);
  }
}

function getStartMode() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).startMode || 'start';
  } catch {
    return 'start';
  }
}

// ── Build helpers ─────────────────────────────────────────────────────────────

function needsBuild() {
  const nextDir = resolve(ROOT, 'app', '.next');
  if (!existsSync(nextDir)) return true;
  try {
    const builtVersion = readFileSync(BUILD_STAMP, 'utf-8').trim();
    const currentVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
    return builtVersion !== currentVersion;
  } catch {
    return true;
  }
}

function writeBuildStamp() {
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
  writeFileSync(BUILD_STAMP, version, 'utf-8');
}

function clearBuildLock() {
  const lockFile = resolve(ROOT, 'app', '.next', 'lock');
  if (existsSync(lockFile)) {
    rmSync(lockFile, { force: true });
  }
}

function ensureAppDeps() {
  // When installed as a global npm package, app/node_modules may not exist.
  // next (and other deps) must be resolvable from app/ for Turbopack to work.
  const appNext = resolve(ROOT, 'app', 'node_modules', 'next', 'package.json');
  if (!existsSync(appNext)) {
    // Check npm is accessible before trying to run it.
    try {
      execSync('npm --version', { stdio: 'pipe' });
    } catch {
      console.error(red('\n✘ npm not found in PATH.\n'));
      console.error('  MindOS needs npm to install its app dependencies on first run.');
      console.error('  This usually means Node.js is installed via a version manager (nvm, fnm, volta, etc.)');
      console.error('  that only loads in interactive shells, but not in /bin/sh.\n');
      console.error('  Fix: add your Node.js bin directory to a profile that /bin/sh reads (~/.profile).');
      console.error('  Example:');
      console.error(dim('    echo \'export PATH="$HOME/.nvm/versions/node/$(node --version)/bin:$PATH"\' >> ~/.profile'));
      console.error(dim('    source ~/.profile\n'));
      console.error('  Then run `mindos start` again.\n');
      process.exit(1);
    }
    console.log(yellow('Installing app dependencies (first run)...\n'));
    // --no-workspaces: prevent npm from hoisting deps to monorepo root.
    // When globally installed, deps must live in app/node_modules/ so that
    // Turbopack can resolve next/package.json from the app/ project directory.
    run('npm install --prefer-offline --no-workspaces', resolve(ROOT, 'app'));
  }
}

// ── Port check ────────────────────────────────────────────────────────────────

function isPortInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
  });
}

async function assertPortFree(port, name) {
  if (await isPortInUse(port)) {
    console.error(`\n${red('✘')} ${bold(`Port ${port} is already in use`)} ${dim(`(${name})`)}`);
    console.error(`\n  ${dim('Stop MindOS:')}       mindos stop`);
    console.error(`  ${dim('Find the process:')}  lsof -i :${port}\n`);
    process.exit(1);
  }
}

// ── PID file ──────────────────────────────────────────────────────────────────

function savePids(...pids) {
  writeFileSync(PID_PATH, pids.filter(Boolean).join('\n'), 'utf-8');
}

function loadPids() {
  if (!existsSync(PID_PATH)) return [];
  return readFileSync(PID_PATH, 'utf-8').split('\n').map(Number).filter(Boolean);
}

function clearPids() {
  if (existsSync(PID_PATH)) rmSync(PID_PATH);
}

// ── Stop ──────────────────────────────────────────────────────────────────────

function stopMindos() {
  const pids = loadPids();
  if (!pids.length) {
    console.log(yellow('No PID file found, trying pattern-based stop...'));
    try { execSync('pkill -f "next start|next dev" 2>/dev/null || true', { stdio: 'inherit' }); } catch {}
    try { execSync('pkill -f "mcp/src/index"       2>/dev/null || true', { stdio: 'inherit' }); } catch {}
    console.log(green('✔ Done'));
    return;
  }
  let stopped = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      stopped++;
    } catch {
      // process already gone — ignore
    }
  }
  clearPids();
  console.log(stopped
    ? green(`✔ Stopped ${stopped} process${stopped > 1 ? 'es' : ''}`)
    : dim('No running processes found'));
}

// ── Daemon / gateway helpers ───────────────────────────────────────────────────

const MINDOS_DIR = resolve(homedir(), '.mindos');
const LOG_PATH   = resolve(MINDOS_DIR, 'mindos.log');
const CLI_PATH   = resolve(__dirname, 'cli.js');
const NODE_BIN   = process.execPath;

function getPlatform() {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'linux')  return 'systemd';
  return null;
}

function ensureMindosDir() {
  if (!existsSync(MINDOS_DIR)) mkdirSync(MINDOS_DIR, { recursive: true });
}

// ── systemd (Linux) ───────────────────────────────────────────────────────────

const SYSTEMD_DIR  = resolve(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_UNIT = resolve(SYSTEMD_DIR, 'mindos.service');

const systemd = {
  install() {
    if (!existsSync(SYSTEMD_DIR)) mkdirSync(SYSTEMD_DIR, { recursive: true });
    ensureMindosDir();
    const currentPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';
    const unit = [
      '[Unit]',
      'Description=MindOS app + MCP server',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      `ExecStart=${NODE_BIN} ${CLI_PATH} start`,
      'Restart=on-failure',
      'RestartSec=3',
      `Environment=HOME=${homedir()}`,
      `Environment=PATH=${currentPath}`,
      `EnvironmentFile=-${resolve(MINDOS_DIR, 'env')}`,
      `StandardOutput=append:${LOG_PATH}`,
      `StandardError=append:${LOG_PATH}`,
      '',
      '[Install]',
      'WantedBy=default.target',
    ].join('\n');
    writeFileSync(SYSTEMD_UNIT, unit, 'utf-8');
    console.log(green(`✔ Wrote ${SYSTEMD_UNIT}`));
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    execSync('systemctl --user enable mindos', { stdio: 'inherit' });
    console.log(green('✔ Service installed and enabled'));
  },

  async start() {
    execSync('systemctl --user start mindos', { stdio: 'inherit' });
    // Wait up to 10s for the service to become active
    const ok = await waitForService(() => {
      try {
        const out = execSync('systemctl --user is-active mindos', { encoding: 'utf-8' }).trim();
        return out === 'active';
      } catch { return false; }
    });
    if (!ok) {
      console.error(red('\n✘ Service failed to start. Last log output:'));
      try { execSync(`journalctl --user -u mindos -n 30 --no-pager`, { stdio: 'inherit' }); } catch {}
      process.exit(1);
    }
    console.log(green('✔ Service started'));
  },

  stop() {
    execSync('systemctl --user stop mindos', { stdio: 'inherit' });
    console.log(green('✔ Service stopped'));
  },

  status() {
    try {
      execSync('systemctl --user status mindos', { stdio: 'inherit' });
    } catch { /* status exits non-zero when stopped */ }
  },

  logs() {
    execSync(`journalctl --user -u mindos -f`, { stdio: 'inherit' });
  },

  uninstall() {
    try {
      execSync('systemctl --user disable --now mindos', { stdio: 'inherit' });
    } catch { /* may already be stopped */ }
    if (existsSync(SYSTEMD_UNIT)) {
      rmSync(SYSTEMD_UNIT);
      console.log(green(`✔ Removed ${SYSTEMD_UNIT}`));
    }
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    console.log(green('✔ Service uninstalled'));
  },
};

// ── launchd (macOS) ───────────────────────────────────────────────────────────

const LAUNCHD_DIR   = resolve(homedir(), 'Library', 'LaunchAgents');
const LAUNCHD_PLIST = resolve(LAUNCHD_DIR, 'com.mindos.app.plist');
const LAUNCHD_LABEL = 'com.mindos.app';

function launchctlUid() {
  return execSync('id -u').toString().trim();
}

const launchd = {
  install() {
    if (!existsSync(LAUNCHD_DIR)) mkdirSync(LAUNCHD_DIR, { recursive: true });
    ensureMindosDir();
    // Capture current PATH so the daemon can find npm/node even when launched by
    // launchd (which only sets a minimal PATH and doesn't source shell profiles).
    const currentPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${CLI_PATH}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_PATH}</string>
  <key>StandardErrorPath</key><string>${LOG_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${homedir()}</string>
    <key>PATH</key><string>${currentPath}</string>
  </dict>
</dict>
</plist>
`;
    writeFileSync(LAUNCHD_PLIST, plist, 'utf-8');
    console.log(green(`✔ Wrote ${LAUNCHD_PLIST}`));
    // Bootout first to ensure the new plist (with updated PATH) takes effect.
    // Safe to ignore errors here — service may not be loaded yet.
    try { execSync(`launchctl bootout gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { stdio: 'pipe' }); } catch {}
    try {
      execSync(`launchctl bootstrap gui/${launchctlUid()} ${LAUNCHD_PLIST}`, { stdio: 'pipe' });
    } catch (e) {
      const msg = (e.stderr?.toString() ?? e.message ?? '').trim();
      console.error(red(`\n✘ launchctl bootstrap failed: ${msg}`));
      console.error(dim('  Try running: launchctl bootout gui/$(id -u)/com.mindos.app  then retry.\n'));
      process.exit(1);
    }
    console.log(green('✔ Service installed'));
  },

  async start() {
    execSync(`launchctl kickstart -k gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { stdio: 'inherit' });
    // Wait up to 10s for the service to become active
    const ok = await waitForService(() => {
      try {
        const out = execSync(`launchctl print gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { encoding: 'utf-8' });
        return out.includes('state = running');
      } catch { return false; }
    });
    if (!ok) {
      console.error(red('\n✘ Service failed to start. Last log output:'));
      try { execSync(`tail -n 30 ${LOG_PATH}`, { stdio: 'inherit' }); } catch {}
      process.exit(1);
    }
    console.log(green('✔ Service started'));
  },

  stop() {
    try {
      execSync(`launchctl bootout gui/${launchctlUid()} ${LAUNCHD_PLIST}`, { stdio: 'inherit' });
    } catch { /* may not be running */ }
    console.log(green('✔ Service stopped'));
  },

  status() {
    try {
      execSync(`launchctl print gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { stdio: 'inherit' });
    } catch {
      console.log(dim('Service is not running'));
    }
  },

  logs() {
    execSync(`tail -f ${LOG_PATH}`, { stdio: 'inherit' });
  },

  uninstall() {
    try {
      execSync(`launchctl bootout gui/${launchctlUid()} ${LAUNCHD_PLIST}`, { stdio: 'inherit' });
    } catch { /* may not be running */ }
    if (existsSync(LAUNCHD_PLIST)) {
      rmSync(LAUNCHD_PLIST);
      console.log(green(`✔ Removed ${LAUNCHD_PLIST}`));
    }
    console.log(green('✔ Service uninstalled'));
  },
};

// ── gateway dispatcher ────────────────────────────────────────────────────────

async function waitForService(check, { retries = 10, intervalMs = 1000 } = {}) {
  for (let i = 0; i < retries; i++) {
    if (check()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return check();
}

async function waitForHttp(port, { retries = 120, intervalMs = 2000, label = 'service' } = {}) {
  process.stdout.write(cyan(`  Waiting for ${label} to be ready`));
  for (let i = 0; i < retries; i++) {
    try {
      const { request } = await import('node:http');
      const ok = await new Promise((resolve) => {
        const req = request({ hostname: '127.0.0.1', port, path: '/', method: 'HEAD', timeout: 1500 },
          (res) => { res.resume(); resolve(res.statusCode < 500); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
      if (ok) { process.stdout.write(` ${green('✔')}\n`); return true; }
    } catch { /* not ready yet */ }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, intervalMs));
  }
  process.stdout.write(` ${red('✘')}\n`);
  return false;
}

async function runGatewayCommand(sub) {
  const platform = getPlatform();
  if (!platform) {
    console.error(red('Daemon mode is not supported on this platform (requires Linux/systemd or macOS/launchd)'));
    process.exit(1);
  }
  const impl = platform === 'systemd' ? systemd : launchd;
  const fn = impl[sub];
  if (!fn) {
    console.error(red(`Unknown gateway subcommand: ${sub}`));
    console.error(dim('Available: install | uninstall | start | stop | status | logs'));
    process.exit(1);
  }
  await fn();
}

// ── Startup info ──────────────────────────────────────────────────────────────

function getLocalIP() {
  try {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function printStartupInfo(webPort, mcpPort) {
  let config = {};
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { /* ignore */ }
  const authToken = config.authToken || '';
  const localIP   = getLocalIP();

  const auth = authToken
    ? `,\n        "headers": { "Authorization": "Bearer ${authToken}" }`
    : '';
  const block = (host) =>
    `  {\n    "mcpServers": {\n      "mindos": {\n        "url": "http://${host}:${mcpPort}/mcp"${auth}\n      }\n    }\n  }`;

  console.log(`\n${'─'.repeat(53)}`);
  console.log(`${bold('🧠 MindOS is starting')}\n`);
  console.log(`  ${green('●')} Web UI   ${cyan(`http://localhost:${webPort}`)}`);
  if (localIP) console.log(`             ${cyan(`http://${localIP}:${webPort}`)}`);
  console.log(`  ${green('●')} MCP      ${cyan(`http://localhost:${mcpPort}/mcp`)}`);
  if (localIP) console.log(`             ${cyan(`http://${localIP}:${mcpPort}/mcp`)}`);
  if (localIP) console.log(dim(`\n  💡 Running on a remote server? Open the Network URL (${localIP}) in your browser,\n     or use SSH port forwarding: ssh -L ${webPort}:localhost:${webPort} user@${localIP}`));
  console.log();
  console.log(bold('Configure MCP in your Agent:'));
  console.log(dim('  Local (same machine):'));
  console.log(block('localhost'));
  if (localIP) {
    console.log(dim('\n  Remote (other device):'));
    console.log(block(localIP));
  }
  if (authToken) {
    console.log(`\n  🔑 ${bold('Auth token:')} ${cyan(authToken)}`);
    console.log(dim('  Run `mindos token` anytime to view it again'));
  }
  console.log(dim('\n  Install Skills (optional):'));
  console.log(dim('  npx skills add https://github.com/GeminiLight/MindOS --skill mindos -g -y'));
  console.log(`${'─'.repeat(53)}\n`);
}

// ── MCP spawn ─────────────────────────────────────────────────────────────────

function spawnMcp(verbose = false) {
  const mcpPort = process.env.MINDOS_MCP_PORT || '8787';
  const webPort = process.env.MINDOS_WEB_PORT || '3000';
  const env = {
    ...process.env,
    MCP_PORT: mcpPort,
    MINDOS_URL: `http://localhost:${webPort}`,
    ...(verbose ? { MCP_VERBOSE: '1' } : {}),
  };
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: resolve(ROOT, 'mcp'),
    stdio: 'inherit',
    env,
  });
  child.on('error', (err) => {
    if (err.message.includes('EADDRINUSE')) {
      console.error(`\n${red('✘')} ${bold(`MCP port ${mcpPort} is already in use`)}`);
      console.error(`  ${dim('Run:')} mindos stop\n`);
    } else {
      console.error(red('MCP server error:'), err.message);
    }
  });
  return child;
}

// ── Commands ──────────────────────────────────────────────────────────────────

const cmd       = process.argv[2];
const isDaemon  = process.argv.includes('--daemon');
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

  // ── token ──────────────────────────────────────────────────────────────────
  token: () => {
    if (!existsSync(CONFIG_PATH)) {
      console.error(red('No config found. Run `mindos onboard` first.'));
      process.exit(1);
    }
    let token = '';
    try { token = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).authToken || ''; } catch {}
    if (!token) {
      console.log(dim('No auth token set. Run `mindos onboard` to configure one.'));
      process.exit(0);
    }
    console.log(`\n${bold('🔑 Auth token:')} ${cyan(token)}\n`);
    console.log(dim('Add to your Agent MCP config:'));
    console.log(`  "headers": { "Authorization": "Bearer ${cyan(token)}" }\n`);
    console.log(dim('Run `mindos onboard` to regenerate.\n'));
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
    process.on('exit', clearPids);
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
      clearBuildLock();
      run('npx next build', resolve(ROOT, 'app'));
      writeBuildStamp();
    }
    const mcp = spawnMcp(isVerbose);
    savePids(process.pid, mcp.pid);
    process.on('exit', clearPids);
    printStartupInfo(webPort, mcpPort);
    run(`npx next start -p ${webPort} ${extra}`, resolve(ROOT, 'app'));
  },

  // ── build ──────────────────────────────────────────────────────────────────
  build: () => {
    ensureAppDeps();
    clearBuildLock();
    run(`npx next build ${extra}`, resolve(ROOT, 'app'));
    writeBuildStamp();
  },

  mcp: () => { loadConfig(); run(`npx tsx src/index.ts`, resolve(ROOT, 'mcp')); },

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
        execSync(`launchctl print gui/${launchctlUid()}/com.mindos.app`, { stdio: 'pipe' });
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
    // Clear build stamp so next `mindos start` rebuilds if version changed
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

    // If daemon is running, restart it so the new version takes effect immediately
    const platform = getPlatform();
    let daemonRunning = false;
    if (platform === 'systemd') {
      try { execSync('systemctl --user is-active mindos', { stdio: 'pipe' }); daemonRunning = true; } catch {}
    } else if (platform === 'launchd') {
      try { execSync(`launchctl print gui/${launchctlUid()}/com.mindos.app`, { stdio: 'pipe' }); daemonRunning = true; } catch {}
    }

    if (daemonRunning) {
      console.log(cyan('\n  Daemon is running — restarting to apply the new version...'));
      await runGatewayCommand('stop');
      await runGatewayCommand('install'); // regenerate plist/unit with updated PATH and binary
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
      // Mask API keys for display
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
      // Support dot-notation for nested keys (e.g. ai.provider)
      const parts = key.split('.');
      let obj = config;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof obj[parts[i]] !== 'object' || !obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      // Coerce numbers
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
${row('mindos token',                      'Show current auth token and MCP config snippet')}
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

// ── run helper ────────────────────────────────────────────────────────────────

function run(command, cwd = ROOT) {
  try {
    execSync(command, { cwd, stdio: 'inherit', env: process.env });
  } catch {
    process.exit(1);
  }
}
