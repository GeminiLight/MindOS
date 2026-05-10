/**
 * Shared logic for packaging the built MindOS Web runtime into Desktop `mindos-runtime`.
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { assertStandaloneAppFiles } from './runtime-health-contract.mjs';

export function materializeStandaloneAssets(appDir, options = {}) {
  const standaloneDir = path.join(appDir, '.next', 'standalone');
  const serverJs = path.join(standaloneDir, 'server.js');
  if (!existsSync(serverJs)) {
    throw new Error(
      `[prepare-mindos-bundle] Missing ${serverJs}. Enable output: 'standalone' in packages/web/next.config.ts and run pnpm --filter @mindos/web build from repo root.`
    );
  }

  const staticSrc = path.join(appDir, '.next', 'static');
  const staticDest = path.join(standaloneDir, '.next', 'static');
  if (existsSync(staticSrc)) {
    mkdirSync(path.dirname(staticDest), { recursive: true });
    rmSync(staticDest, { recursive: true, force: true });
    copyDereferenced(staticSrc, staticDest);
  }

  const publicSrc = path.join(appDir, 'public');
  const publicDest = path.join(standaloneDir, 'public');
  if (existsSync(publicSrc)) {
    rmSync(publicDest, { recursive: true, force: true });
    copyDereferenced(publicSrc, publicDest);
  }

  materializeStandaloneNodeModules(appDir, standaloneDir);
  materializeNextServerLib(appDir, standaloneDir);
  materializeStandalonePackageDependencies(appDir, standaloneDir);
  pruneNextProductionServerPayload(standaloneDir);
  pruneRedundantNestedPackages(standaloneDir);
  pruneTargetNativeBinaries(standaloneDir, {
    targetPlatform: options.targetPlatform ?? process.platform,
    targetArch: options.targetArch ?? process.arch,
  });
  prunePackageDevelopmentPayload(standaloneDir);
  pruneOptionalLocalEmbeddingRuntime(standaloneDir, {
    bundleLocalEmbeddingRuntime: options.bundleLocalEmbeddingRuntime === true
      || process.env.MINDOS_BUNDLE_LOCAL_EMBEDDING_RUNTIME === '1',
  });
  assertStandalonePackageDependencyClosure(standaloneDir);
  pruneStandaloneBuildJunk(standaloneDir);
  assertStandaloneAppFiles(appDir, 'prepare-mindos-bundle');
}

function pruneStandaloneBuildJunk(standaloneDir) {
  for (const rel of ['.next/cache', '.next/dev']) {
    rmSync(path.join(standaloneDir, rel), { recursive: true, force: true });
  }
}

function materializeStandaloneNodeModules(appDir, standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  replaceSymlinksWithCopies(nodeModulesDir, nodeModulesDir, path.join(appDir, 'node_modules'));
}

function materializeStandalonePackageDependencies(appDir, standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  const visited = new Set();
  const sourceByPackageName = new Map();
  for (const packageName of listPackageNames(nodeModulesDir)) {
    const sourcePackage = resolvePackageDir(appDir, packageName);
    if (existsSync(sourcePackage)) sourceByPackageName.set(packageName, sourcePackage);
    materializePackageDependencies(appDir, standaloneDir, packageName, visited, sourceByPackageName);
  }
}

function materializePackageDependencies(appDir, standaloneDir, packageName, visited, sourceByPackageName) {
  if (visited.has(packageName)) return;
  visited.add(packageName);

  const sourcePackage = sourceByPackageName.get(packageName) ?? resolvePackageDir(appDir, packageName);
  if (existsSync(sourcePackage)) sourceByPackageName.set(packageName, sourcePackage);
  const packageJsonPath = path.join(standaloneDir, 'node_modules', packageName, 'package.json');
  if (!existsSync(packageJsonPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return;
  }

  for (const [dependencyName, dependencyRange] of Object.entries(pkg.dependencies ?? {})) {
    const dependencySource = materializePackage(appDir, standaloneDir, dependencyName, sourcePackage, packageName, dependencyRange);
    if (dependencySource) sourceByPackageName.set(dependencyName, dependencySource);
    materializePackageDependencies(appDir, standaloneDir, dependencyName, visited, sourceByPackageName);
  }
}

function assertStandalonePackageDependencyClosure(standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  const missing = [];
  for (const packageName of listPackageNames(nodeModulesDir)) {
    const packageDir = path.join(nodeModulesDir, packageName);
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) continue;

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    } catch {
      continue;
    }

    for (const [dependencyName, dependencyRange] of Object.entries(pkg.dependencies ?? {})) {
      if (isNodeBuiltin(dependencyName)) continue;
      if (!dependencyResolvableFromStandalonePackage(nodeModulesDir, packageDir, dependencyName, dependencyRange)) {
        missing.push(`${packageName} -> ${dependencyName}@${dependencyRange}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      '[prepare-mindos-bundle] Incomplete standalone dependency closure:\n'
      + missing.map((item) => `  - ${item}`).join('\n')
    );
  }
}

function dependencyResolvableFromStandalonePackage(nodeModulesDir, packageDir, dependencyName, dependencyRange) {
  return packageAtPathSatisfies(path.join(packageDir, 'node_modules', dependencyName), dependencyRange)
    || packageAtPathSatisfies(path.join(nodeModulesDir, dependencyName), dependencyRange);
}

function isNodeBuiltin(packageName) {
  return packageName.startsWith('node:');
}

function listPackageNames(nodeModulesDir) {
  const packageNames = [];
  if (!existsSync(nodeModulesDir)) return packageNames;
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name);
      for (const scopedEntry of readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) packageNames.push(`${entry.name}/${scopedEntry.name}`);
      }
      continue;
    }
    packageNames.push(entry.name);
  }
  return packageNames;
}

function replaceSymlinksWithCopies(dir, nodeModulesRoot = dir, fallbackNodeModulesDir = null) {
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name);
    const stat = lstatSync(child);

    if (stat.isSymbolicLink()) {
      const packageRel = path.relative(nodeModulesRoot, child);
      let target;
      try {
        target = realpathSync(child);
      } catch (err) {
        if (!fallbackNodeModulesDir) throw err;
        target = realpathSync(path.join(fallbackNodeModulesDir, packageRel));
      }
      unlinkSync(child);
      copyDereferenced(target, child);
      if (existsSync(child) && lstatSync(child).isDirectory()) {
        replaceSymlinksWithCopies(child, nodeModulesRoot, fallbackNodeModulesDir);
      }
      continue;
    }

    if (stat.isDirectory()) {
      replaceSymlinksWithCopies(child, nodeModulesRoot, fallbackNodeModulesDir);
    }
  }
}

function materializeNextServerLib(appDir, standaloneDir) {
  const sourceNext = path.join(appDir, 'node_modules', 'next');
  const destNext = path.join(standaloneDir, 'node_modules', 'next');
  const sourceDist = path.join(sourceNext, 'dist');
  const destDist = path.join(destNext, 'dist');
  if (!existsSync(sourceNext) || !existsSync(destNext)) return;

  // Next 16 standalone tracing can include start-server.js without its relative
  // dist siblings. Copying next/dist preserves the runtime require graph and
  // keeps Desktop/npm standalone health checks honest.
  for (const ent of readdirSync(sourceNext, { withFileTypes: true })) {
    if (!ent.isFile() && !ent.isSymbolicLink()) continue;
    copyDereferenced(path.join(sourceNext, ent.name), path.join(destNext, ent.name));
  }
  materializeNextDependencies(appDir, standaloneDir, sourceNext);
  if (!existsSync(sourceDist) || !existsSync(destDist)) return;
  copyDereferenced(sourceDist, destDist);
}

function materializeNextDependencies(appDir, standaloneDir, sourceNext) {
  const packageJsonPath = path.join(sourceNext, 'package.json');
  if (!existsSync(packageJsonPath)) return;
  const nextPackage = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const runtimeDeps = {
    ...(nextPackage.dependencies ?? {}),
    ...(nextPackage.peerDependencies ?? {}),
  };
  for (const packageName of Object.keys(runtimeDeps)) {
    materializePackage(appDir, standaloneDir, packageName, sourceNext);
  }
}

function pruneNextProductionServerPayload(standaloneDir) {
  const nextDist = path.join(standaloneDir, 'node_modules', 'next', 'dist');
  if (!existsSync(nextDist)) return;
  for (const rel of [
    'esm',
  ]) {
    rmSync(path.join(nextDist, rel), { recursive: true, force: true });
  }
}

function pruneRedundantNestedPackages(standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  const nestedNodeModulesDirs = [];
  collectNestedNodeModulesDirs(nodeModulesDir, nodeModulesDir, nestedNodeModulesDirs);

  for (const nestedNodeModulesDir of nestedNodeModulesDirs) {
    if (!existsSync(nestedNodeModulesDir)) continue;
    for (const packageName of listPackageNames(nestedNodeModulesDir)) {
      const nestedPackage = path.join(nestedNodeModulesDir, packageName);
      const topLevelPackage = path.join(nodeModulesDir, packageName);
      if (nestedPackage === topLevelPackage) continue;
      if (!samePackageVersion(nestedPackage, topLevelPackage)) continue;
      rmSync(nestedPackage, { recursive: true, force: true });
      pruneEmptyParents(nestedPackage, nestedNodeModulesDir);
    }
  }
}

function prunePackageDevelopmentPayload(standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;
  pruneDevOnlyDirs(nodeModulesDir);
  pruneDevOnlyFiles(nodeModulesDir);
}

function pruneOptionalLocalEmbeddingRuntime(standaloneDir, { bundleLocalEmbeddingRuntime }) {
  if (bundleLocalEmbeddingRuntime) return;

  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  for (const packageName of [
    '@huggingface/transformers',
    '@huggingface/jinja',
    '@huggingface/tokenizers',
    'onnxruntime-node',
    'onnxruntime-web',
    'onnxruntime-common',
  ]) {
    rmSync(path.join(nodeModulesDir, packageName), { recursive: true, force: true });
  }
  pruneEmptyParents(path.join(nodeModulesDir, '@huggingface', 'transformers'), nodeModulesDir);
}

function pruneDevOnlyDirs(currentDir) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(currentDir, entry.name);
    if (isDevOnlyDirName(entry.name)) {
      rmSync(child, { recursive: true, force: true });
      continue;
    }
    pruneDevOnlyDirs(child);
  }
}

function pruneDevOnlyFiles(currentDir) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const child = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      pruneDevOnlyFiles(child);
      continue;
    }
    if (entry.isFile() && isDevOnlyFileName(entry.name)) {
      rmSync(child, { force: true });
    }
  }
}

function isDevOnlyDirName(name) {
  return [
    '__tests__',
    'benchmark',
    'benchmarks',
    'doc',
    'docs',
    'example',
    'examples',
    'test',
    'tests',
  ].includes(name);
}

function isDevOnlyFileName(name) {
  return name.endsWith('.d.ts') || name.endsWith('.map') || name.endsWith('.tsbuildinfo');
}

function collectNestedNodeModulesDirs(currentDir, rootNodeModulesDir, out) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(currentDir, entry.name);
    if (entry.name === 'node_modules') {
      if (child !== rootNodeModulesDir) out.push(child);
      collectNestedNodeModulesDirs(child, rootNodeModulesDir, out);
      continue;
    }
    collectNestedNodeModulesDirs(child, rootNodeModulesDir, out);
  }
}

function pruneTargetNativeBinaries(standaloneDir, { targetPlatform, targetArch }) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  const platform = normalizeNodePlatform(targetPlatform);
  const arch = normalizeNodeArch(targetArch);
  for (const napiDir of findDirsNamed(nodeModulesDir, 'napi-v6')) {
    if (!napiDir.endsWith(path.join('onnxruntime-node', 'bin', 'napi-v6'))) continue;
    for (const platformEntry of readdirSync(napiDir, { withFileTypes: true })) {
      if (!platformEntry.isDirectory()) continue;
      const platformDir = path.join(napiDir, platformEntry.name);
      if (platformEntry.name !== platform) {
        rmSync(platformDir, { recursive: true, force: true });
        continue;
      }
      for (const archEntry of readdirSync(platformDir, { withFileTypes: true })) {
        if (archEntry.isDirectory() && archEntry.name !== arch) {
          rmSync(path.join(platformDir, archEntry.name), { recursive: true, force: true });
        }
      }
    }
  }
}

function findDirsNamed(rootDir, dirName) {
  const found = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(rootDir, entry.name);
    if (entry.name === dirName) found.push(child);
    findDirsNamed(child, dirName).forEach((dir) => found.push(dir));
  }
  return found;
}

function samePackageVersion(packageA, packageB) {
  const pkgA = readPackageJson(packageA);
  const pkgB = readPackageJson(packageB);
  return Boolean(pkgA?.name && pkgA.name === pkgB?.name && pkgA.version && pkgA.version === pkgB?.version);
}

function readPackageJson(packageDir) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return null;
  }
}

function pruneEmptyParents(startPath, stopAt) {
  let current = path.dirname(startPath);
  while (current.startsWith(stopAt) && current !== path.dirname(current)) {
    if (!existsSync(current)) return;
    if (readdirSync(current).length > 0) return;
    rmSync(current, { recursive: true, force: true });
    if (current === stopAt) return;
    current = path.dirname(current);
  }
}

function normalizeNodePlatform(platform) {
  return platform === 'win' || platform === 'windows' ? 'win32' : platform;
}

function normalizeNodeArch(arch) {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

function materializePackage(appDir, standaloneDir, packageName, fromDir = appDir, nestedUnderPackageName = null, dependencyRange = '*') {
  const sourcePackage = resolvePackageDir(appDir, packageName, fromDir, dependencyRange);
  const destPackage = path.join(standaloneDir, 'node_modules', packageName);
  if (!existsSync(sourcePackage)) return null;
  if (!existsSync(destPackage)) {
    mkdirSync(path.dirname(destPackage), { recursive: true });
    copyDereferenced(sourcePackage, destPackage);
  }

  if (nestedUnderPackageName) {
    if (packageAtPathSatisfies(destPackage, dependencyRange)) return sourcePackage;

    const nestedDest = path.join(standaloneDir, 'node_modules', nestedUnderPackageName, 'node_modules', packageName);
    if (packageAtPathSatisfies(nestedDest, dependencyRange)) return sourcePackage;

    rmSync(nestedDest, { recursive: true, force: true });
    mkdirSync(path.dirname(nestedDest), { recursive: true });
    copyDereferenced(sourcePackage, nestedDest);
  }
  return sourcePackage;
}

function packageAtPathSatisfies(packageDir, dependencyRange = '*') {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    if (typeof pkg.version !== 'string' && !isWildcardRange(dependencyRange)) return false;
    return versionSatisfiesRange(pkg.version, dependencyRange);
  } catch {
    return true;
  }
}

function versionSatisfiesRange(version, rawRange) {
  if (typeof version !== 'string') return true;
  if (isWildcardRange(rawRange)) return true;

  let range = rawRange;
  if (range.includes('||')) {
    return range.split('||').some((part) => versionSatisfiesRange(version, part.trim()));
  }
  if (range.startsWith('npm:')) {
    const at = range.lastIndexOf('@');
    range = at > 3 ? range.slice(at + 1) : '*';
  }
  if (range === '*' || range === 'latest') return true;
  if (range.startsWith('^')) {
    const min = parseSemver(range.slice(1));
    const actual = parseSemver(version);
    if (!min || !actual) return true;
    return actual.major === min.major && compareSemver(actual, min) >= 0;
  }
  if (range.startsWith('~')) {
    const min = parseSemver(range.slice(1));
    const actual = parseSemver(version);
    if (!min || !actual) return true;
    return actual.major === min.major && actual.minor === min.minor && compareSemver(actual, min) >= 0;
  }
  if (/^\d+\.\d+\.\d+/.test(range)) {
    const expected = parseSemver(range);
    const actual = parseSemver(version);
    if (!expected || !actual) return true;
    return compareSemver(actual, expected) === 0;
  }
  return true;
}

function isWildcardRange(rawRange) {
  return typeof rawRange !== 'string' || rawRange === '' || rawRange === '*' || rawRange === 'latest';
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(a, b) {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

function resolvePackageDir(appDir, packageName, fromDir = appDir, dependencyRange = '*') {
  const direct = path.join(appDir, 'node_modules', packageName);
  const packageLocal = path.join(fromDir, 'node_modules', packageName);
  if (packageAtPathSatisfies(packageLocal, dependencyRange)) return realpathSync(packageLocal);
  if (packageAtPathSatisfies(direct, dependencyRange)) return realpathSync(direct);

  try {
    const requireFromPackage = createRequire(path.join(realpathSync(fromDir), 'package.json'));
    const entrypoint = requireFromPackage.resolve(packageName);
    const packageRoot = findPackageRoot(entrypoint);
    if (packageAtPathSatisfies(packageRoot, dependencyRange)) return packageRoot;
  } catch {
    // Fall through to pnpm store scan below.
  }

  if (packageAtPathSatisfies(direct, dependencyRange)) return realpathSync(direct);

  const repoRoot = path.resolve(appDir, '..', '..');
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return direct;

  const encodedName = packageName.replace('/', '+');
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith(`${encodedName}@`)) continue;
    const candidate = path.join(pnpmDir, entry, 'node_modules', packageName);
    if (packageAtPathSatisfies(candidate, dependencyRange)) return candidate;
  }
  return direct;
}

function findPackageRoot(startPath) {
  let current = path.dirname(startPath);
  while (current && current !== path.dirname(current)) {
    if (existsSync(path.join(current, 'package.json'))) return current;
    current = path.dirname(current);
  }
  return path.dirname(startPath);
}

/**
 * @param {string} sourceAppDir
 * @param {string} destAppDir
 */
export function copyAppForBundledRuntime(sourceAppDir, destAppDir) {
  if (!existsSync(sourceAppDir)) {
    throw new Error(`[prepare-mindos-bundle] Missing app directory: ${sourceAppDir}`);
  }
  rmSync(destAppDir, { recursive: true, force: true });
  mkdirSync(destAppDir, { recursive: true });
  copyFiltered(sourceAppDir, destAppDir, '');
  fixTurbopackHashedExternals(destAppDir);
}

/**
 * Turbopack appends a content hash to serverExternalPackages names
 * (e.g. `@mariozechner/pi-agent-core-805d1afb58d9a138`).
 * standalone/node_modules only has the original name. Create symlinks so
 * the hashed require resolves to the real package.
 */
function fixTurbopackHashedExternals(destAppDir) {
  const chunksDir = path.join(destAppDir, '.next', 'standalone', '.next', 'server', 'chunks');
  const nmDir = path.join(destAppDir, '.next', 'standalone', 'node_modules');
  if (!existsSync(chunksDir) || !existsSync(nmDir)) return;

  const hashPattern = /"(@[^"\/]+\/[^"\/]+-[a-f0-9]{16,})"/g;
  for (const name of readdirSync(chunksDir)) {
    if (!name.endsWith('.js')) continue;
    const content = readFileSync(path.join(chunksDir, name), 'utf-8');
    let m;
    while ((m = hashPattern.exec(content)) !== null) {
      const hashed = m[1]; // e.g. @mariozechner/pi-agent-core-805d1afb58d9a138
      const lastDash = hashed.lastIndexOf('-');
      const original = hashed.slice(0, lastDash); // @mariozechner/pi-agent-core
      const scope = original.split('/')[0]; // @mariozechner
      const hashedPkgName = hashed.split('/')[1]; // pi-agent-core-805d1afb58d9a138
      const originalPkgName = original.split('/')[1]; // pi-agent-core

      const originalDir = path.join(nmDir, scope, originalPkgName);
      const hashedDir = path.join(nmDir, scope, hashedPkgName);

      if (existsSync(originalDir) && !existsSync(hashedDir)) {
        try {
          symlinkSync(originalPkgName, hashedDir);
          console.log(`[prepare-mindos-bundle] Symlink: ${hashed} → ${original}`);
        } catch (e) {
          console.warn(`[prepare-mindos-bundle] Failed to symlink ${hashed}:`, e.message);
        }
      }
    }
  }
}

/**
 * @param {string} fromAbs
 * @param {string} toAbs
 * @param {string} rel — path relative to app root (native separators)
 */
function copyFiltered(fromAbs, toAbs, rel) {
  if (isExcludedNextRuntimePath(rel)) return;

  const entries = readdirSync(fromAbs, { withFileTypes: true });
  for (const ent of entries) {
    const name = ent.name;

    const nextRel = rel ? path.join(rel, name) : name;
    if (isExcludedNextRuntimePath(nextRel)) continue;

    // Skip app-level node_modules but KEEP .next/standalone/node_modules (traced runtime deps).
    // Copy the standalone node_modules with symlinks dereferenced for codesign-safe packaging.
    if (name === 'node_modules') {
      const standalonePrefix = path.join('.next', 'standalone');
      if (rel === standalonePrefix) {
        const fromChild = path.join(fromAbs, name);
        const toChild = path.join(toAbs, name);
        copyDereferenced(fromChild, toChild);
        replaceSymlinksWithCopies(toChild, toChild, path.resolve(fromAbs, '..', '..', 'node_modules'));
      }
      continue;
    }

    const fromChild = path.join(fromAbs, name);
    const toChild = path.join(toAbs, name);

    if (ent.isDirectory()) {
      mkdirSync(toChild, { recursive: true });
      copyFiltered(fromChild, toChild, nextRel);
      continue;
    }
    if (ent.isFile() || ent.isSymbolicLink()) {
      mkdirSync(path.dirname(toChild), { recursive: true });
      copyDereferenced(fromChild, toChild);
    }
  }
}

function isExcludedNextRuntimePath(rel) {
  if (!rel) return false;
  const parts = rel.split(path.sep);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] === '.next' && (parts[i + 1] === 'cache' || parts[i + 1] === 'dev')) {
      return true;
    }
  }
  return false;
}

function copyDereferenced(fromAbs, toAbs) {
  const stat = lstatSync(fromAbs);
  if (stat.isSymbolicLink()) {
    copyDereferenced(realpathSync(fromAbs), toAbs);
    return;
  }

  if (stat.isDirectory()) {
    mkdirSync(path.dirname(toAbs), { recursive: true });
    mkdirSync(toAbs, { recursive: true });
    for (const name of readdirSync(fromAbs)) {
      copyDereferenced(path.join(fromAbs, name), path.join(toAbs, name));
    }
    return;
  }

  if (stat.isFile()) {
    mkdirSync(path.dirname(toAbs), { recursive: true });
    copyFileSync(fromAbs, toAbs);
  }
}
