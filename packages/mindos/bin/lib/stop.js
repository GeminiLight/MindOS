import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { green, yellow } from './colors.js';
import { loadPids, clearPids } from './pid.js';
import { CLI_PATH, CONFIG_PATH, WEB_APP_DIR } from './constants.js';
import { MCP_BUNDLE } from './mcp-build.js';
import { stripBom } from './jsonc.js';

const isWin = process.platform === 'win32';

/**
 * Portable synchronous sleep using SharedArrayBuffer + Atomics.wait.
 * Falls back to a busy-wait loop on platforms without SharedArrayBuffer.
 */
function syncSleep(ms) {
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch {
    // Busy-wait fallback — only used when SharedArrayBuffer is unavailable
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

/**
 * Kill processes listening on the given port.
 * Uses platform-appropriate tools: lsof/ss on Unix, netstat on Windows.
 * Returns number of processes killed.
 */
export function killByPort(port) {
  const pidsToKill = new Set();

  if (isWin) {
    // Windows: parse `netstat -ano` output for LISTENING on the target port
    try {
      const output = execFileSync('netstat', ['-ano'], { encoding: 'utf-8' });
      for (const line of output.split('\r\n')) {
        if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid > 0) pidsToKill.add(pid);
      }
    } catch { /* netstat unavailable */ }
  } else {
    // Unix Method 1: lsof
    try {
      const output = execFileSync('lsof', ['-ti', `:${port}`], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (output) {
        for (const p of output.split('\n')) {
          const pid = Number(p);
          if (pid > 0) pidsToKill.add(pid);
        }
      }
    } catch { /* lsof not available */ }

    // Unix Method 2: ss -tlnp (fallback)
    if (pidsToKill.size === 0) {
      try {
        const output = execFileSync('ss', ['-tlnp'], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const portRe = new RegExp(`:${port}(?!\\d)`);
        for (const line of output.split('\n')) {
          if (!portRe.test(line)) continue;
          const pidMatch = line.match(/pid=(\d+)/g);
          if (pidMatch) {
            for (const m of pidMatch) {
              const pid = Number(m.slice(4));
              if (pid > 0) pidsToKill.add(pid);
            }
          }
        }
      } catch { /* ss not available */ }
    }
  }

  let killed = 0;
  if (isWin) {
    for (const pid of pidsToKill) {
      try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); killed++; } catch {}
    }
  } else {
    for (const pid of pidsToKill) {
      try { process.kill(pid, 'SIGTERM'); killed++; } catch {}
    }
    if (killed > 0) {
      syncSleep(2000);
      for (const pid of pidsToKill) {
        try {
          process.kill(pid, 0);
          process.kill(pid, 'SIGKILL');
        } catch { /* already dead */ }
      }
    }
  }

  return killed;
}

/**
 * Kill a process and all its children (process group).
 * On Windows, uses taskkill /T for tree kill; on Unix, uses negative PID.
 */
function killTree(pid) {
  if (isWin) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    return true;
  }

  try { process.kill(-pid, 'SIGTERM'); } catch {}
  try { process.kill(pid, 'SIGTERM'); } catch {}

  syncSleep(2000);

  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch {}
  if (alive) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  return true;
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function killMindosFallbackProcesses() {
  if (isWin) return 0;

  const patterns = [
    `${escapeRegexLiteral(CLI_PATH)} start`,
    escapeRegexLiteral(MCP_BUNDLE),
    `${escapeRegexLiteral(WEB_APP_DIR)}.*node_modules/.bin/next`,
  ];

  let killed = 0;
  for (const pattern of patterns) {
    try {
      execFileSync('pkill', ['-f', pattern], { stdio: ['ignore', 'inherit', 'inherit'] });
      killed++;
    } catch { /* no matching MindOS process */ }
  }
  return killed;
}

/**
 * Stop MindOS processes.
 * @param {Object} [opts] - Optional overrides.
 * @param {string[]} [opts.extraPorts] - Additional ports to clean up (e.g. old
 *   ports before a config change).  These are cleaned in addition to the ports
 *   read from the current config file.
 */
export function stopMindos(opts = {}) {
  // In test environment, skip all real process killing to avoid
  // destroying dev servers or other unrelated processes.
  if (process.env.NODE_ENV === 'test') {
    console.log('(test mode: skipping real process stop)');
    return;
  }

  // Read ports from config for port-based cleanup
  let webPort = '3456', mcpPort = '8781', setupPort = null;
  try {
    const config = JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8')));
    if (config.port) webPort = String(config.port);
    if (config.mcpPort) mcpPort = String(config.mcpPort);
    // Temporary port used by GUI setup — may still have a zombie process
    if (config.setupPort) setupPort = String(config.setupPort);
  } catch {}

  const pids = loadPids();
  if (!pids.length) {
    console.log(yellow('No PID file found, trying port-based stop...'));
  } else {
    // Kill saved PIDs (parent process + MCP) and their child processes
    let stopped = 0;
    for (const pid of pids) {
      if (killTree(pid)) stopped++;
    }
    clearPids();
    if (stopped) console.log(green(`\u2714 Stopped ${stopped} process${stopped > 1 ? 'es' : ''}`));
  }

  // Always do port-based cleanup — Next.js spawns worker processes whose PIDs
  // are not recorded in the PID file and would otherwise become orphaned.
  // Include any extra ports (e.g. old ports from before a config change).
  const portsToClean = new Set([webPort, mcpPort]);
  if (setupPort) portsToClean.add(setupPort);
  if (opts.extraPorts) {
    for (const p of opts.extraPorts) portsToClean.add(String(p));
  }

  let portKilled = 0;
  for (const port of portsToClean) {
    portKilled += killByPort(port);
  }

  if (!pids.length && portKilled === 0) {
    // Last resort: pattern match MindOS-owned command lines only.
    if (process.env.NODE_ENV !== 'test') {
      killMindosFallbackProcesses();
    }
  }

  if (!pids.length) console.log(green('\u2714 Done'));
}
