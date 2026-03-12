import { createConnection } from 'node:net';
import { bold, dim, red } from './colors.js';

export function isPortInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
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
