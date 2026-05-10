/**
 * Shell execution helpers — inheriting stdio.
 */

import { execFileSync } from 'node:child_process';
import { ROOT } from './constants.js';
import { resolveNpmInvocation } from './npm-invocation.js';

export function quoteManualShellArg(value, platform = process.platform) {
  const text = String(value);
  if (platform === 'win32') {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export function formatManualCdCommand(cwd, command, platform = process.platform) {
  const cd = platform === 'win32'
    ? `cd /d ${quoteManualShellArg(cwd, platform)}`
    : `cd ${quoteManualShellArg(cwd, platform)}`;
  return `${cd} && ${command}`;
}

/**
 * @param {string} command
 * @param {string[]} [args]
 * @param {string} [cwd]
 * @param {Record<string, string | undefined>} [envPatch] merged into process.env (for child only)
 */
export const execInheritedFile = (command, args = [], cwd = ROOT, envPatch) => {
  try {
    const env = envPatch ? { ...process.env, ...envPatch } : process.env;
    execFileSync(command, args, { cwd, stdio: 'inherit', env });
  } catch (err) {
    process.exit(err.status || 1);
  }
};

/**
 * @param {string[]} args
 * @param {string} [cwd]
 * @param {Record<string, string | undefined>} [envPatch] merged into process.env (for child only)
 */
export const execNpmInherited = (args, cwd = ROOT, envPatch) => {
  const invocation = resolveNpmInvocation(args);
  execInheritedFile(invocation.command, invocation.args, cwd, envPatch);
};

/**
 * Run `npm install` with --prefer-offline for speed, auto-fallback to online
 * if the local cache is stale or missing a required package version.
 */
export const npmInstall = (cwd, extraFlags = []) => {
  const flags = Array.isArray(extraFlags)
    ? extraFlags
    : String(extraFlags).trim().split(/\s+/).filter(Boolean);
  const baseArgs = ['install', ...flags];
  const base = `npm ${baseArgs.join(' ')}`;
  try {
    const invocation = resolveNpmInvocation([...baseArgs, '--prefer-offline']);
    execFileSync(invocation.command, invocation.args, { cwd, stdio: 'inherit', env: process.env });
  } catch {
    try {
      const invocation = resolveNpmInvocation(baseArgs);
      execFileSync(invocation.command, invocation.args, { cwd, stdio: 'inherit', env: process.env });
    } catch (err) {
      console.error(`\nFailed to install dependencies in ${cwd}`);
      console.error(`  Try manually: ${formatManualCdCommand(cwd, base)}\n`);
      process.exit(err.status || 1);
    }
  }
};
