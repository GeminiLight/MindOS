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
  const lockPath = resolve(ROOT, 'app', 'package-lock.json');
  try {
    const content = readFileSync(lockPath);
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
  writeDepsStamp();
}
