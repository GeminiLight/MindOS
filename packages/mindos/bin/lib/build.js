import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  ROOT,
  WEB_APP_DIR,
  BUILD_STAMP,
  DEPS_STAMP,
  STANDALONE_SERVER,
  STANDALONE_STAMP,
  PRODUCT_PACKAGE_JSON,
  PACKAGE_ROOT,
} from './constants.js';
import { red, dim, yellow } from './colors.js';
import { execInherited as run, npmInstall } from './shell.js';
import { safeRmSync, assertNotSymlink } from './safe-rm.js';

export function needsBuild() {
  // Prefer prebuilt standalone shipped with the npm package.
  // If _standalone/server.js exists and its version stamp matches, skip build entirely.
  if (existsSync(STANDALONE_SERVER)) {
    try {
      const builtVersion = readFileSync(STANDALONE_STAMP, 'utf-8').trim();
      const currentVersion = JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
      if (builtVersion === currentVersion) return false;
    } catch { /* stamp unreadable — fall through to legacy check */ }
  }

  // Fallback: check local packages/web/.next/ build (for dev installs or after `mindos build`)
  const nextDir = resolve(WEB_APP_DIR, '.next');
  if (!existsSync(nextDir)) return true;
  try {
    const builtVersion = readFileSync(BUILD_STAMP, 'utf-8').trim();
    const currentVersion = JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
    return builtVersion !== currentVersion;
  } catch {
    return true;
  }
}

export function writeBuildStamp() {
  const version = JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
  writeFileSync(BUILD_STAMP, version, 'utf-8');
}

export function clearBuildLock() {
  const lockFile = resolve(WEB_APP_DIR, '.next', 'lock');
  if (existsSync(lockFile)) {
    try {
      assertNotSymlink(lockFile);
      rmSync(lockFile, { force: true });
    } catch (err) {
      console.warn(`Warning: Failed to clear build lock: ${err}`);
    }
  }
}

export function cleanNextDir() {
  const nextDir = resolve(WEB_APP_DIR, '.next');
  if (existsSync(nextDir)) {
    try {
      assertNotSymlink(nextDir);
      safeRmSync(nextDir, { recursive: true, force: true });
    } catch (err) {
      console.error(red(`Failed to clean .next directory: ${err}`));
      throw err;
    }
  }
}

function depsHash() {
  // Hash workspace dependency metadata so dev/fallback installs refresh when
  // package manifests or the pnpm lockfile change.
  const paths = [
    PRODUCT_PACKAGE_JSON,
    resolve(WEB_APP_DIR, 'package.json'),
    resolve(ROOT, 'pnpm-lock.yaml'),
  ];
  try {
    const h = createHash('sha256');
    for (const file of paths) {
      try { h.update(readFileSync(file)); } catch {}
    }
    return h.digest('hex').slice(0, 16);
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

function standaloneServerDir() {
  const runtimeNextDir = resolve(PACKAGE_ROOT, '_standalone', '.next');
  const publishableNextDir = resolve(PACKAGE_ROOT, '_standalone', '__next');
  const nextDir = existsSync(runtimeNextDir) ? runtimeNextDir : publishableNextDir;
  return resolve(nextDir, 'server');
}

/** Critical packages that must exist after npm install for the app to work. */
const CRITICAL_DEPS = ['next', '@next/env', 'react', 'react-dom'];

function verifyDeps() {
  const nm = resolve(WEB_APP_DIR, 'node_modules');
  for (const dep of CRITICAL_DEPS) {
    if (!existsSync(resolve(nm, dep, 'package.json'))) return false;
  }
  return true;
}

export function hasPrebuiltStandalone() {
  if (!existsSync(STANDALONE_SERVER)) return false;
  try {
    const builtVersion = readFileSync(STANDALONE_STAMP, 'utf-8').trim();
    const currentVersion = JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
    if (builtVersion !== currentVersion) return false;
  } catch {
    return false;
  }
  // Quick sanity check: manifest + at least the home page bundle must exist.
  // Catches incomplete builds (e.g. 0.6.75 where manifest listed /wiki but
  // the page.js was missing, causing 500). Full validation is in prepare-standalone.mjs.
  const serverDir = standaloneServerDir();
  if (!existsSync(resolve(serverDir, 'app-paths-manifest.json'))) return false;
  if (!existsSync(resolve(serverDir, 'app', 'page.js'))) return false;
  return true;
}

export function ensureAppDeps({ force = false } = {}) {
  // Skip dependency installation when prebuilt standalone is available —
  // standalone bundles its own traced node_modules and doesn't need packages/web/node_modules.
  // force=true bypasses this (used by `mindos dev` which always needs packages/web/node_modules).
  if (!force && hasPrebuiltStandalone()) return;

  const appNext = resolve(WEB_APP_DIR, 'node_modules', 'next', 'package.json');
  const needsInstall = !existsSync(appNext) || depsChanged();
  if (!needsInstall) return;

  try {
    execSync('npm --version', { stdio: 'pipe' });
  } catch {
    console.error(red('\n\u2718 npm not found in PATH.\n'));
    console.error('  MindOS needs npm to install its app dependencies on first run.');
    if (process.platform === 'win32') {
      console.error('  Ensure Node.js is installed and added to your system PATH.\n');
      console.error('  Fix: reinstall Node.js from https://nodejs.org (the installer adds it to PATH).');
      console.error('  Then open a new terminal and run `mindos start` again.\n');
    } else {
      console.error('  This usually means Node.js is installed via a version manager (nvm, fnm, volta, etc.)');
      console.error('  that only loads in interactive shells, but not in /bin/sh.\n');
      console.error('  Fix: add your Node.js bin directory to a profile that /bin/sh reads (~/.profile).');
      console.error('  Example:');
      console.error(dim('    echo \'export PATH="$HOME/.nvm/versions/node/$(node --version)/bin:$PATH"\' >> ~/.profile'));
      console.error(dim('    source ~/.profile\n'));
      console.error('  Then run `mindos start` again.\n');
    }
    process.exit(1);
  }

  const label = existsSync(appNext)
    ? 'Updating app dependencies (dependency metadata changed)...\n'
    : 'Installing app dependencies (first run)...\n';
  console.log(yellow(label));
  npmInstall(WEB_APP_DIR, '--no-workspaces');

    // Verify critical deps — npm tar extraction can silently fail (ENOENT race)
    if (!verifyDeps()) {
      console.log(yellow('Some dependencies are incomplete, retrying with clean install...\n'));
      const nm = resolve(WEB_APP_DIR, 'node_modules');
      try {
        assertNotSymlink(nm);
        safeRmSync(nm, { recursive: true, force: true });
      } catch (err) {
        console.error(red(`SECURITY: Failed to verify safe deletion of node_modules: ${err}`));
        process.exit(1);
      }
      run('npm install --no-workspaces', WEB_APP_DIR);
      if (!verifyDeps()) {
        console.error(red('\n✘ Failed to install dependencies after retry.\n'));
        const appDir = WEB_APP_DIR;
        if (process.platform === 'win32') {
          console.error(`  Try manually: cd "${appDir}" && rmdir /s /q node_modules && npm install`);
        } else {
          console.error(`  Try manually: cd ${appDir} && rm -rf node_modules && npm install`);
        }
        process.exit(1);
      }
    }

  writeDepsStamp();
}
