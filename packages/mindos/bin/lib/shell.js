/**
 * Shell execution helpers — inheriting stdio.
 */

import { execSync } from 'node:child_process';
import { ROOT } from './constants.js';

/**
 * @param {string} command
 * @param {string} [cwd]
 * @param {Record<string, string | undefined>} [envPatch] merged into process.env (for child only)
 */
export const execInherited = (command, cwd = ROOT, envPatch) => {
  try {
    const env = envPatch ? { ...process.env, ...envPatch } : process.env;
    execSync(command, { cwd, stdio: 'inherit', env });
  } catch (err) {
    process.exit(err.status || 1);
  }
};

/**
 * Run `npm install` with --prefer-offline for speed, auto-fallback to online
 * if the local cache is stale or missing a required package version.
 */
export const npmInstall = (cwd, extraFlags = '') => {
  const base = `npm install ${extraFlags}`.trim();
  try {
    execSync(`${base} --prefer-offline`, { cwd, stdio: 'inherit', env: process.env });
  } catch {
    try {
      execSync(base, { cwd, stdio: 'inherit', env: process.env });
    } catch (err) {
      console.error(`\nFailed to install dependencies in ${cwd}`);
      console.error(`  Try manually: cd ${cwd} && ${base}\n`);
      process.exit(err.status || 1);
    }
  }
};
