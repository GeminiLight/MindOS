import { execSync } from 'node:child_process';
import { green, yellow, dim } from './colors.js';
import { loadPids, clearPids } from './pid.js';

export function stopMindos() {
  const pids = loadPids();
  if (!pids.length) {
    console.log(yellow('No PID file found, trying pattern-based stop...'));
    try { execSync('pkill -f "next start|next dev" 2>/dev/null || true', { stdio: 'inherit' }); } catch {}
    try { execSync('pkill -f "mcp/src/index"       2>/dev/null || true', { stdio: 'inherit' }); } catch {}
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
