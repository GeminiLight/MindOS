import { createConnection } from 'node:net';
import { bold, dim, red } from './colors.js';

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
  if (await isPortInUse(port)) {
    console.error(`\n${red('\u2718')} ${bold(`Port ${port} is already in use`)} ${dim(`(${name})`)}`);
    console.error(`\n  ${dim('Stop MindOS:')}       mindos stop`);
    console.error(`  ${dim('Find the process:')}  lsof -i :${port}\n`);
    process.exit(1);
  }
}
