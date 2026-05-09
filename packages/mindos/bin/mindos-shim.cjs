#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const PACKAGE_PREFIX = '@geminilight/mindos-';
const LINUX_MUSL_EXAMPLE = 'linux-x64-musl';
const scriptPath = fs.realpathSync(__filename);
const scriptDir = path.dirname(scriptPath);
const packageRoot = path.resolve(scriptDir, '..');
const requireFromHere = createRequire(scriptPath);

function runNodeScript(target) {
  const result = childProcess.spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 0);
}

function runDirect(target) {
  const result = childProcess.spawnSync(target, process.argv.slice(2), {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 0);
}

if (process.env.MINDOS_BIN_PATH) {
  runDirect(process.env.MINDOS_BIN_PATH);
}

if (process.env.MINDOS_RUNTIME_PACKAGE_PATH) {
  const entrypoint = runtimeEntrypoint(process.env.MINDOS_RUNTIME_PACKAGE_PATH);
  if (entrypoint) runEntrypoint(entrypoint);
  console.error(
    'MINDOS_RUNTIME_PACKAGE_PATH does not contain a MindOS runtime entrypoint: '
    + process.env.MINDOS_RUNTIME_PACKAGE_PATH,
  );
  process.exit(1);
}

function normalizedPlatform() {
  if (process.platform === 'win32') return 'windows';
  return process.platform;
}

function isLinuxMusl() {
  if (process.platform !== 'linux') return false;

  try {
    if (fs.existsSync('/etc/alpine-release')) return true;
  } catch {
    // ignore
  }

  try {
    const result = childProcess.spawnSync('ldd', ['--version'], {
      encoding: 'utf8',
      timeout: 1500,
    });
    return `${result.stdout || ''}${result.stderr || ''}`.toLowerCase().includes('musl');
  } catch {
    return false;
  }
}

function platformPackageCandidates() {
  const platform = normalizedPlatform();
  const arch = process.arch;
  const base = `${PACKAGE_PREFIX}${platform}-${arch}`;

  if (platform === 'linux') {
    const musl = isLinuxMusl();
    if (musl) return [`${base}-musl`, base];
    return [base, `${base}-musl`];
  }

  return [base];
}

function findRuntimePackageByRequire(packageName) {
  try {
    const packageJson = requireFromHere.resolve(`${packageName}/package.json`);
    return path.dirname(packageJson);
  } catch {
    return null;
  }
}

function findRuntimePackageByWalking(packageName) {
  let current = scriptDir;
  for (;;) {
    const candidate = path.join(current, 'node_modules', ...packageName.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findRuntimePackageInSourceTree(packageName) {
  const key = packageName.slice(PACKAGE_PREFIX.length);
  const candidate = path.resolve(packageRoot, '..', 'mindos-platforms', key);
  if (runtimeEntrypoint(candidate)) return candidate;
  return null;
}

function runtimeEntrypoint(packageDir) {
  const binary = path.join(packageDir, 'bin', process.platform === 'win32' ? 'mindos.exe' : 'mindos');
  if (fs.existsSync(binary)) return { type: 'binary', path: binary };

  const cli = path.join(packageDir, 'bin', 'cli.js');
  if (fs.existsSync(cli)) return { type: 'node', path: cli };

  return null;
}

function runEntrypoint(entrypoint) {
  if (entrypoint.type === 'binary') runDirect(entrypoint.path);
  runNodeScript(entrypoint.path);
}

function findRuntimeEntrypoint() {
  for (const packageName of platformPackageCandidates()) {
    const packageDir = findRuntimePackageByRequire(packageName)
      || findRuntimePackageByWalking(packageName)
      || findRuntimePackageInSourceTree(packageName);
    if (!packageDir) continue;

    const entrypoint = runtimeEntrypoint(packageDir);
    if (entrypoint) return entrypoint;
  }

  const legacyCli = path.join(packageRoot, 'bin', 'cli.js');
  const legacyStandalone = path.join(packageRoot, '_standalone', 'server.js');
  if (fs.existsSync(legacyCli) && fs.existsSync(legacyStandalone)) {
    return { type: 'node', path: legacyCli };
  }

  return null;
}

const entrypoint = findRuntimeEntrypoint();
if (!entrypoint) {
  const candidates = platformPackageCandidates();
  console.error(
    'MindOS runtime package is not installed for this platform.\n\n' +
    `Tried: ${candidates.join(', ')}\n\n` +
    `Try reinstalling @geminilight/mindos, or install ${candidates[0]} at the same version.`,
  );
  process.exit(1);
}

runEntrypoint(entrypoint);
