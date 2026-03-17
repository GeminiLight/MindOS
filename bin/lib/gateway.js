import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { MINDOS_DIR, LOG_PATH, CLI_PATH, NODE_BIN, CONFIG_PATH } from './constants.js';
import { green, red, dim, cyan, yellow } from './colors.js';
import { isPortInUse } from './port.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getPlatform() {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'linux')  return 'systemd';
  return null;
}

export function ensureMindosDir() {
  if (!existsSync(MINDOS_DIR)) mkdirSync(MINDOS_DIR, { recursive: true });
}

export async function waitForService(check, { retries = 10, intervalMs = 1000 } = {}) {
  for (let i = 0; i < retries; i++) {
    if (check()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return check();
}

/**
 * Wait until a port is free (no process listening).
 * Returns true if port is free, false on timeout.
 */
export async function waitForPortFree(port, { retries = 30, intervalMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    if (!(await isPortInUse(port))) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return !(await isPortInUse(port));
}

export async function waitForHttp(port, { retries = 120, intervalMs = 2000, label = 'service' } = {}) {
  process.stdout.write(cyan(`  Waiting for ${label} to be ready`));
  for (let i = 0; i < retries; i++) {
    try {
      const { request } = await import('node:http');
      const ok = await new Promise((resolve) => {
        const req = request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 1500 },
          (res) => { res.resume(); resolve(res.statusCode < 500); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
      if (ok) { process.stdout.write(` ${green('\u2714')}\n`); return true; }
    } catch { /* not ready yet */ }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, intervalMs));
  }
  process.stdout.write(` ${red('\u2718')}\n`);
  return false;
}

function launchctlUid() {
  return execSync('id -u').toString().trim();
}

// ── systemd (Linux) ──────────────────────────────────────────────────────────

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
    console.log(green(`\u2714 Wrote ${SYSTEMD_UNIT}`));
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    execSync('systemctl --user enable mindos', { stdio: 'inherit' });
    console.log(green('\u2714 Service installed and enabled'));
  },

  async start() {
    execSync('systemctl --user start mindos', { stdio: 'inherit' });
    const ok = await waitForService(() => {
      try {
        const out = execSync('systemctl --user is-active mindos', { encoding: 'utf-8' }).trim();
        return out === 'active';
      } catch { return false; }
    });
    if (!ok) {
      console.error(red('\n\u2718 Service failed to start. Last log output:'));
      try { execSync(`journalctl --user -u mindos -n 30 --no-pager`, { stdio: 'inherit' }); } catch {}
      process.exit(1);
    }
    console.log(green('\u2714 Service started'));
  },

  stop() {
    execSync('systemctl --user stop mindos', { stdio: 'inherit' });
    console.log(green('\u2714 Service stopped'));
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
      console.log(green(`\u2714 Removed ${SYSTEMD_UNIT}`));
    }
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    console.log(green('\u2714 Service uninstalled'));
  },
};

// ── launchd (macOS) ──────────────────────────────────────────────────────────

const LAUNCHD_DIR   = resolve(homedir(), 'Library', 'LaunchAgents');
const LAUNCHD_PLIST = resolve(LAUNCHD_DIR, 'com.mindos.app.plist');
const LAUNCHD_LABEL = 'com.mindos.app';

const launchd = {
  install() {
    if (!existsSync(LAUNCHD_DIR)) mkdirSync(LAUNCHD_DIR, { recursive: true });
    ensureMindosDir();
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
    console.log(green(`\u2714 Wrote ${LAUNCHD_PLIST}`));
    try { execSync(`launchctl bootout gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { stdio: 'pipe' }); } catch {}
    try {
      execSync(`launchctl bootstrap gui/${launchctlUid()} ${LAUNCHD_PLIST}`, { stdio: 'pipe' });
    } catch (e) {
      const msg = (e.stderr?.toString() ?? e.message ?? '').trim();
      console.error(red(`\n\u2718 launchctl bootstrap failed: ${msg}`));
      console.error(dim('  Try running: launchctl bootout gui/$(id -u)/com.mindos.app  then retry.\n'));
      process.exit(1);
    }
    console.log(green('\u2714 Service installed'));
  },

  async start() {
    execSync(`launchctl kickstart -k gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { stdio: 'inherit' });
    const ok = await waitForService(() => {
      try {
        const out = execSync(`launchctl print gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { encoding: 'utf-8' });
        return out.includes('state = running');
      } catch { return false; }
    });
    if (!ok) {
      console.error(red('\n\u2718 Service failed to start. Last log output:'));
      try { execSync(`tail -n 30 ${LOG_PATH}`, { stdio: 'inherit' }); } catch {}
      process.exit(1);
    }
    console.log(green('\u2714 Service started'));
  },

  async stop() {
    // Read ports before bootout so we can wait for them to be freed
    let webPort = 3000, mcpPort = 8787;
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (config.port) webPort = Number(config.port);
      if (config.mcpPort) mcpPort = Number(config.mcpPort);
    } catch {}

    try {
      execSync(`launchctl bootout gui/${launchctlUid()} ${LAUNCHD_PLIST}`, { stdio: 'inherit' });
    } catch { /* may not be running */ }

    // launchctl bootout is async — wait for ports to actually be freed
    let [webFree, mcpFree] = await Promise.all([
      waitForPortFree(webPort),
      waitForPortFree(mcpPort),
    ]);
    if (!webFree || !mcpFree) {
      console.log(yellow('Ports still in use after bootout, force-killing...'));
      const { stopMindos } = await import('./stop.js');
      stopMindos();
      // stopMindos() sends SIGTERM synchronously — wait for processes to exit
      [webFree, mcpFree] = await Promise.all([
        waitForPortFree(webPort),
        waitForPortFree(mcpPort),
      ]);
      if (!webFree || !mcpFree) {
        console.error(red('Warning: ports still in use after force-kill. Continuing anyway.'));
      }
    }
    console.log(green('\u2714 Service stopped'));
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
      console.log(green(`\u2714 Removed ${LAUNCHD_PLIST}`));
    }
    console.log(green('\u2714 Service uninstalled'));
  },
};

// ── Gateway dispatcher ───────────────────────────────────────────────────────

export async function runGatewayCommand(sub) {
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
