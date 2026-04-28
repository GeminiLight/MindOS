/**
 * mindos logs — Tail service logs (cross-platform, no external tools)
 */

import { existsSync, readFileSync, statSync, watch as fsWatch, openSync, readSync, closeSync } from 'node:fs';
import { LOG_PATH } from '../lib/constants.js';
import { dim } from '../lib/colors.js';

export const meta = {
  name: 'logs',
  group: 'Config',
  summary: 'Tail service logs',
  usage: 'mindos logs',
  examples: [
    'mindos logs',
  ],
};

function tailLines(filePath, count) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  return lines.slice(-count).join('\n');
}

function followFile(filePath) {
  let size = statSync(filePath).size;

  const readNew = () => {
    let newSize;
    try { newSize = statSync(filePath).size; } catch { return; }
    if (newSize <= size) { size = newSize; return; }
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(newSize - size);
      readSync(fd, buf, 0, buf.length, size);
      process.stdout.write(buf.toString('utf-8'));
    } finally {
      closeSync(fd);
    }
    size = newSize;
  };

  const watcher = fsWatch(filePath, { persistent: true }, readNew);
  // Also poll as a fallback — fs.watch is unreliable on some network/VM mounts
  const interval = setInterval(readNew, 1000);

  process.on('SIGINT', () => { watcher.close(); clearInterval(interval); process.exit(0); });
  process.on('SIGTERM', () => { watcher.close(); clearInterval(interval); process.exit(0); });
}

export const run = async (args, flags) => {
  const { ensureMindosDir } = await import('../lib/gateway.js');
  await ensureMindosDir();

  if (!existsSync(LOG_PATH)) {
    console.log(dim(`No log file yet at ${LOG_PATH}`));
    console.log(dim('Logs are created when starting MindOS (mindos start, mindos onboard, or daemon mode).'));
    process.exit(0);
  }

  const noFollow = flags['no-follow'] === true;
  console.log(tailLines(LOG_PATH, 100));

  if (!noFollow) {
    followFile(LOG_PATH);
  }
};
