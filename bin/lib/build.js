import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT, BUILD_STAMP, DEPS_STAMP } from './constants.js';
import { red, dim, yellow } from './colors.js';
import { run } from './utils.js';

export function needsBuild() {
  const nextDir = resolve(ROOT, 'app', '.next');
  if (!existsSync(nextDir)) return true;
  try {
    const builtVersion = readFileSync(BUILD_STAMP, 'utf-8').trim();
    const currentVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
    return builtVersion !== currentVersion;
  } catch {
    return true;
  }
}

export function writeBuildStamp() {
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
  writeFileSync(BUILD_STAMP, version, 'utf-8');
}

export function clearBuildLock() {
  const lockFile = resolve(ROOT, 'app', '.next', 'lock');
  if (existsSync(lockFile)) {
    rmSync(lockFile, { force: true });
  }
}

export function cleanNextDir() {
  const nextDir = resolve(ROOT, 'app', '.next');
  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
  }
}

function depsHash() {
  // Use package.json (not package-lock.json) so we don't need to ship the
  // 560kB lock file in the npm tarball.  package.json changes whenever
  // dependencies are added/removed/bumped, which is the only case that
  // requires a fresh `npm install`.
  const pkgPath = resolve(ROOT, 'app', 'package.json');
  try {
    const content = readFileSync(pkgPath);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function depsChanged() {
  const currentHash = depsHash();
  if (!currentHash) return true;
  try {
    const savedHash = readFileSync(DEPS_STAMP, 'utf-8').trim();
    return savedHash !== currentHash;
  } catch {
    return true;
  }
}

function writeDepsStamp() {
  const hash = depsHash();
  if (hash) {
    try { writeFileSync(DEPS_STAMP, hash, 'utf-8'); } catch {}
  }
}

/** Critical packages that must exist after npm install for the app to work. */
const CRITICAL_DEPS = ['next', '@next/env', 'react', 'react-dom'];

function verifyDeps() {
  const nm = resolve(ROOT, 'app', 'node_modules');
  for (const dep of CRITICAL_DEPS) {
    if (!existsSync(resolve(nm, dep, 'package.json'))) return false;
  }
  return true;
}

export function ensureAppDeps() {
  const appNext = resolve(ROOT, 'app', 'node_modules', 'next', 'package.json');
  const needsInstall = !existsSync(appNext) || depsChanged();
  if (!needsInstall) return;

  try {
    execSync('npm --version', { stdio: 'pipe' });
  } catch {
    console.error(red('\n\u2718 npm not found in PATH.\n'));
    console.error('  MindOS needs npm to install its app dependencies on first run.');
    console.error('  This usually means Node.js is installed via a version manager (nvm, fnm, volta, etc.)');
    console.error('  that only loads in interactive shells, but not in /bin/sh.\n');
    console.error('  Fix: add your Node.js bin directory to a profile that /bin/sh reads (~/.profile).');
    console.error('  Example:');
    console.error(dim('    echo \'export PATH="$HOME/.nvm/versions/node/$(node --version)/bin:$PATH"\' >> ~/.profile'));
    console.error(dim('    source ~/.profile\n'));
    console.error('  Then run `mindos start` again.\n');
    process.exit(1);
  }

  const label = existsSync(appNext)
    ? 'Updating app dependencies (package-lock.json changed)...\n'
    : 'Installing app dependencies (first run)...\n';
  console.log(yellow(label));
  run('npm install --prefer-offline --no-workspaces', resolve(ROOT, 'app'));

  // Verify critical deps — npm tar extraction can silently fail (ENOENT race)
  if (!verifyDeps()) {
    console.log(yellow('Some dependencies are incomplete, retrying with clean install...\n'));
    const nm = resolve(ROOT, 'app', 'node_modules');
    rmSync(nm, { recursive: true, force: true });
    run('npm install --no-workspaces', resolve(ROOT, 'app'));
    if (!verifyDeps()) {
      console.error(red('\n✘ Failed to install dependencies after retry.\n'));
      console.error('  Try manually: cd ' + resolve(ROOT, 'app') + ' && rm -rf node_modules && npm install');
      process.exit(1);
    }
  }

  writeDepsStamp();
}
