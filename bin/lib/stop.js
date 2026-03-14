import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { green, yellow, dim } from './colors.js';
import { loadPids, clearPids } from './pid.js';
import { CONFIG_PATH } from './constants.js';

/**
 * Kill processes listening on the given port.
 * Returns number of processes killed.
 */
function killByPort(port) {
  let killed = 0;
  try {
    const output = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (output) {
      for (const p of output.split('\n')) {
        const pid = Number(p);
        if (pid > 0) {
          try { process.kill(pid, 'SIGTERM'); killed++; } catch {}
        }
      }
    }
  } catch {
    // lsof not available or no processes found
  }
  return killed;
}

export function stopMindos() {
  const pids = loadPids();
  if (!pids.length) {
    console.log(yellow('No PID file found, trying port-based stop...'));
    // Read ports from config
    let webPort = '3000', mcpPort = '8787';
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (config.port) webPort = String(config.port);
      if (config.mcpPort) mcpPort = String(config.mcpPort);
    } catch {}
    let stopped = 0;
    for (const port of [webPort, mcpPort]) {
      stopped += killByPort(port);
    }
    if (stopped === 0) {
      // Fallback: pkill pattern match (for envs without lsof)
      try { execSync('pkill -f "next start|next dev" 2>/dev/null || true', { stdio: 'inherit' }); } catch {}
      try { execSync('pkill -f "mcp/src/index"       2>/dev/null || true', { stdio: 'inherit' }); } catch {}
    }
    console.log(green('\u2714 Done'));
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
    ? green(`\u2714 Stopped ${stopped} process${stopped > 1 ? 'es' : ''}`)
    : dim('No running processes found'));
}
