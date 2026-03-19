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

/**
 * Run `npm install` with --prefer-offline for speed, auto-fallback to online
 * if the local cache is stale or missing a required package version.
 *
 * @param {string} cwd - Directory to run in
 * @param {string} [extraFlags=''] - Additional npm flags (e.g. '--no-workspaces')
 */
export function npmInstall(cwd, extraFlags = '') {
  const base = `npm install ${extraFlags}`.trim();
  try {
    execSync(`${base} --prefer-offline`, { cwd, stdio: 'inherit', env: process.env });
  } catch {
    // Cache miss or stale packument — retry online
    try {
      execSync(base, { cwd, stdio: 'inherit', env: process.env });
    } catch (err) {
      console.error(`\nFailed to install dependencies in ${cwd}`);
      console.error(`  Try manually: cd ${cwd} && ${base}\n`);
      process.exit(err.status || 1);
    }
  }
}

export function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}
