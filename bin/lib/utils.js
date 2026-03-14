import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { ROOT } from './constants.js';

export function run(command, cwd = ROOT) {
  try {
    execSync(command, { cwd, stdio: 'inherit', env: process.env });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

export function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}
