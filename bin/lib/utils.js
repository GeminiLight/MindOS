import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { ROOT } from './constants.js';

/**
 * @param {Record<string, string | undefined>} [envPatch] merged into process.env (for child only)
 */
export function run(command, cwd = ROOT, envPatch) {
  try {
    const env = envPatch ? { ...process.env, ...envPatch } : process.env;
    execSync(command, { cwd, stdio: 'inherit', env });
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

/**
 * Parse JSONC — strips single-line and block comments before JSON.parse.
 * VS Code-based editors (Cursor, Windsurf, Cline) use JSONC for config files.
 */
export function parseJsonc(text) {
  // Strip single-line comments (not inside quoted strings)
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (m, g) => g ? '' : m);
  // Strip block comments
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped);
}
