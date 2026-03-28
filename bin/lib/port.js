import { createConnection } from 'node:net';
import { bold, dim, red, yellow } from './colors.js';

export function isPortInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    const cleanup = (result) => { sock.destroy(); resolve(result); };
    sock.setTimeout(500, () => cleanup(false));
    sock.once('connect', () => cleanup(true));
    sock.once('error', (err) => {
      // ECONNREFUSED = nothing listening → port is free
      // EACCES / ENETUNREACH / etc. = treat as unavailable (can't bind either)
      cleanup(err.code !== 'ECONNREFUSED');
    });
  });
}

export async function assertPortFree(port, name) {
  if (!(await isPortInUse(port))) return;

  // Port is occupied — try to clean up orphaned processes from a previous
  // installation (e.g. user deleted MindOS.app from Finder without quitting,
  // leaving behind zombie Next.js / MCP processes on the default ports).
  console.warn(`${yellow('⚠')} Port ${port} in use (${name}) — attempting cleanup...`);
  try {
    const { stopMindos } = await import('./stop.js');
    stopMindos();
    // Wait briefly for ports to release after SIGTERM
    await new Promise(r => setTimeout(r, 1500));
  } catch { /* stopMindos may fail if no config exists yet — that's fine */ }

  // Re-check after cleanup
  if (await isPortInUse(port)) {
    console.error(`\n${red('\u2718')} ${bold(`Port ${port} is still in use after cleanup`)} ${dim(`(${name})`)}`);
    console.error(`\n  ${dim('Stop MindOS:')}       mindos stop`);
    console.error(`  ${dim('Find the process:')}  lsof -i :${port}\n`);
    process.exit(1);
  }
  console.log(`  ${dim('Cleaned up orphaned processes on port')} ${port}`);
}
