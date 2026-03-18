import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync, renameSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { MINDOS_DIR, LOG_PATH, CLI_PATH, NODE_BIN, CONFIG_PATH } from './constants.js';
import { green, red, dim, cyan, yellow } from './colors.js';
import { isPortInUse } from './port.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Rotate log file when it exceeds 2 MB. Keeps at most one .old backup. */
function rotateLogs() {
  try {
    const stat = statSync(LOG_PATH);
    if (stat.size > 2 * 1024 * 1024) {
      const old = LOG_PATH + '.old';
      try { unlinkSync(old); } catch {}
      renameSync(LOG_PATH, old);
    }
  } catch { /* file doesn't exist yet, nothing to rotate */ }
}

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

/**
 * Parse a log line to extract a user-friendly status hint.
 * Returns null if the line isn't interesting enough to show.
 * @internal Exported for testing only.
 */
export function parseLogHint(line) {
  const l = line.trim();
  if (!l) return null;
  // npm install progress
  if (/added \d+ packages/i.test(l)) return 'dependencies installed';
  // MCP-specific must come before generic "Installing" match
  if (/Installing MCP dependencies/i.test(l)) return 'installing MCP…';
  if (/Installing app dependencies/i.test(l)) return 'installing dependencies…';
  if (/Updating app dependencies/i.test(l)) return 'updating dependencies…';
  // next build progress
  if (/Building MindOS/i.test(l)) return 'building app…';
  if (/Creating.*optimized.*production/i.test(l)) return 'building app…';
  if (/Compil/i.test(l)) return 'compiling…';
  if (/Collecting page data/i.test(l)) return 'collecting page data…';
  if (/Generating static pages/i.test(l)) return 'generating pages…';
  if (/Finalizing page optimization/i.test(l)) return 'optimizing…';
  if (/[○●◐λƒ]\s+\/\S+.*\d+(\.\d+)?\s*kB/i.test(l)) return 'bundling routes…';
  // next start / ready
  if (/▲ Next\.js/i.test(l)) return 'starting server…';
  if (/Ready in/i.test(l)) return 'starting server…';
  return null;
}

export async function waitForHttp(port, { retries = 60, intervalMs = 2000, label = 'service', logFile = null } = {}) {
  const start = Date.now();
  const elapsed = () => {
    const s = Math.round((Date.now() - start) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  };

  // Track log file position for incremental reads
  let logOffset = 0;
  let lastHint = 'starting…';
  if (logFile) {
    try {
      logOffset = statSync(logFile).size; // start from current end
    } catch { /* file may not exist yet */ }
  }

  /** Read new lines from logFile and update lastHint */
  function updateHintFromLog() {
    if (!logFile) return;
    try {
      const st = statSync(logFile);
      // File was truncated or rotated — reset offset
      if (st.size < logOffset) logOffset = 0;
      if (st.size <= logOffset) return;
      // Read new chunk (at most 4KB to avoid large reads)
      const readSize = Math.min(st.size - logOffset, 4096);
      const buf = Buffer.alloc(readSize);
      const fd = openSync(logFile, 'r');
      try {
        readSync(fd, buf, 0, readSize, logOffset);
      } finally {
        closeSync(fd);
      }
      logOffset = logOffset + readSize;
      const newLines = buf.toString('utf-8').split('\n');
      // Walk lines in order, keep the last interesting hint
      for (const line of newLines) {
        const hint = parseLogHint(line);
        if (hint) lastHint = hint;
      }
    } catch { /* log file may not exist yet or be rotated */ }
  }

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
      if (ok) {
        process.stdout.write(`\r\x1b[K`);
        process.stdout.write(`  ${green('\u2714')} ${label} ready ${dim(`(${elapsed()})`)}\n`);
        return true;
      }
    } catch { /* not ready yet */ }

    // Update hint from real log output
    updateHintFromLog();

    // Rewrite the status line in place
    process.stdout.write(`\r\x1b[K`);
    process.stdout.write(cyan(`  ⏳ Waiting for ${label}`) + dim(` — ${lastHint} (${elapsed()})`));

    await new Promise(r => setTimeout(r, intervalMs));
  }
  process.stdout.write(`\r\x1b[K`);
  process.stdout.write(`  ${red('\u2718')} ${label} did not start ${dim(`(${elapsed()})`)}\n`);
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
    rotateLogs();
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
    execSync('systemctl --user daemon-reload', { stdio: ['ignore', 'inherit', 'inherit'] });
    execSync('systemctl --user enable mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
    execSync('systemctl --user start mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log(green('\u2714 Service installed and started'));
  },

  async start() {
    rotateLogs();
    execSync('systemctl --user start mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
    const ok = await waitForService(() => {
      try {
        const out = execSync('systemctl --user is-active mindos', { encoding: 'utf-8' }).trim();
        return out === 'active';
      } catch { return false; }
    });
    if (!ok) {
      console.error(red('\n\u2718 Service failed to start. Last log output:'));
      try { execSync(`journalctl --user -u mindos -n 30 --no-pager`, { stdio: ['ignore', 'inherit', 'inherit'] }); } catch {}
      process.exit(1);
    }
    console.log(green('\u2714 Service started'));
  },

  stop() {
    execSync('systemctl --user stop mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log(green('\u2714 Service stopped'));
  },

  status() {
    try {
      execSync('systemctl --user status mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch { /* status exits non-zero when stopped */ }
  },

  logs() {
    execSync(`journalctl --user -u mindos -f`, { stdio: ['ignore', 'inherit', 'inherit'] });
  },

  uninstall() {
    try {
      execSync('systemctl --user disable --now mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch { /* may already be stopped */ }
    if (existsSync(SYSTEMD_UNIT)) {
      rmSync(SYSTEMD_UNIT);
      console.log(green(`\u2714 Removed ${SYSTEMD_UNIT}`));
    }
    execSync('systemctl --user daemon-reload', { stdio: ['ignore', 'inherit', 'inherit'] });
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
    rotateLogs();
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
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${LOG_PATH}</string>
  <key>StandardErrorPath</key><string>${LOG_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${homedir()}</string>
    <key>PATH</key><string>${currentPath}</string>
    <key>LAUNCHED_BY_LAUNCHD</key><string>1</string>
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
    rotateLogs();
    execSync(`launchctl kickstart -k gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { stdio: ['ignore', 'inherit', 'inherit'] });
    const ok = await waitForService(() => {
      try {
        const out = execSync(`launchctl print gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { encoding: 'utf-8' });
        return out.includes('state = running');
      } catch { return false; }
    });
    if (!ok) {
      console.error(red('\n\u2718 Service failed to start. Last log output:'));
      try { execSync(`tail -n 30 ${LOG_PATH}`, { stdio: ['ignore', 'inherit', 'inherit'] }); } catch {}
      process.exit(1);
    }
    console.log(green('\u2714 Service started'));
  },

  async stop() {
    // Read ports before bootout so we can wait for them to be freed
    let webPort = 3456, mcpPort = 8781;
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (config.port) webPort = Number(config.port);
      if (config.mcpPort) mcpPort = Number(config.mcpPort);
    } catch {}

    try {
      execSync(`launchctl bootout gui/${launchctlUid()} ${LAUNCHD_PLIST}`, { stdio: ['ignore', 'inherit', 'inherit'] });
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
      execSync(`launchctl print gui/${launchctlUid()}/${LAUNCHD_LABEL}`, { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch {
      console.log(dim('Service is not running'));
    }
  },

  logs() {
    execSync(`tail -f ${LOG_PATH}`, { stdio: ['ignore', 'inherit', 'inherit'] });
  },

  uninstall() {
    try {
      execSync(`launchctl bootout gui/${launchctlUid()} ${LAUNCHD_PLIST}`, { stdio: ['ignore', 'inherit', 'inherit'] });
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
