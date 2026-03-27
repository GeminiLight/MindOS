import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { green, yellow, dim } from './colors.js';
import { loadPids, clearPids } from './pid.js';
import { CONFIG_PATH } from './constants.js';

/**
 * Kill processes listening on the given port.
 * Tries lsof first, then falls back to parsing `ss` output.
 * Returns number of processes killed.
 */
function killByPort(port) {
  const pidsToKill = new Set();

  // Method 1: lsof
  try {
    const output = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (output) {
      for (const p of output.split('\n')) {
        const pid = Number(p);
        if (pid > 0) pidsToKill.add(pid);
      }
    }
  } catch {
    // lsof not available or no processes found
  }

  // Method 2: ss -tlnp (fallback — works when lsof can't see the process)
  if (pidsToKill.size === 0) {
    try {
      const output = execSync(`ss -tlnp 2>/dev/null`, { encoding: 'utf-8' });
      // Match lines like: LISTEN ... *:3003 ... users:(("next-server",pid=12345,fd=21))
      // Match `:PORT` followed by a non-digit to avoid partial matches
      // (e.g. port 80 must not match :8080)
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
    } catch {
      // ss not available
    }
  }

  let killed = 0;
  for (const pid of pidsToKill) {
    try { process.kill(pid, 'SIGTERM'); killed++; } catch {}
  }
  return killed;
}

/**
 * Kill a process and all its children (process group).
 */
function killTree(pid) {
  // Try to kill the entire process group first
  try { process.kill(-pid, 'SIGTERM'); return true; } catch {}
  // Fallback: kill individual process
  try { process.kill(pid, 'SIGTERM'); return true; } catch {}
  return false;
}

/**
 * Stop MindOS processes.
 * @param {Object} [opts] - Optional overrides.
 * @param {string[]} [opts.extraPorts] - Additional ports to clean up (e.g. old
 *   ports before a config change).  These are cleaned in addition to the ports
 *   read from the current config file.
 */
export function stopMindos(opts = {}) {
  // Read ports from config for port-based cleanup
  let webPort = '3456', mcpPort = '8781';
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    if (config.port) webPort = String(config.port);
    if (config.mcpPort) mcpPort = String(config.mcpPort);
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
  if (opts.extraPorts) {
    for (const p of opts.extraPorts) portsToClean.add(String(p));
  }

  let portKilled = 0;
  for (const port of portsToClean) {
    portKilled += killByPort(port);
  }

  if (!pids.length && portKilled === 0) {
    // Last resort: pattern match (for envs without lsof)
    try { execSync('pkill -f "next start|next dev" 2>/dev/null || true', { stdio: ['ignore', 'inherit', 'inherit'] }); } catch {}
    try { execSync('pkill -f "mcp/(src/index|dist/index)" 2>/dev/null || true', { stdio: ['ignore', 'inherit', 'inherit'] }); } catch {}
  }

  if (!pids.length) console.log(green('\u2714 Done'));
}
