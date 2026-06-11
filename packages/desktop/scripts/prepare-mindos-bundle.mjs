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
  unlinkSync,
} from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { assertStandaloneAppFiles } from './runtime-health-contract.mjs';

export const RUNTIME_DEPENDENCY_SEEDS = [
  '@sinclair/typebox',
  '@earendil-works/pi-ai',
];

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
  materializeRuntimeDependencySeeds(appDir, standaloneDir, options.runtimeDependencySeeds ?? []);
  pruneDirectDevelopmentPackages(standaloneDir);
  materializeStandalonePackageDependencies(appDir, standaloneDir);
  prunePnpmVirtualStores(standaloneDir);
  pruneNextProductionServerPayload(standaloneDir);
  pruneRedundantNestedPackages(standaloneDir);
  pruneTargetNativeBinaries(standaloneDir, {
    targetPlatform: options.targetPlatform ?? process.platform,
    targetArch: options.targetArch ?? process.arch,
  });
  pruneClaudeAgentSdkNativePackages(standaloneDir);
  prunePackageDevelopmentPayload(standaloneDir);
  pruneOptionalLocalEmbeddingRuntime(standaloneDir, {
    bundleLocalEmbeddingRuntime: options.bundleLocalEmbeddingRuntime === true
      || process.env.MINDOS_BUNDLE_LOCAL_EMBEDDING_RUNTIME === '1',
  });
  pruneDirectDevelopmentPackages(standaloneDir);
  assertStandalonePackageDependencyClosure(standaloneDir);
  pruneStandaloneBuildJunk(standaloneDir);
  assertStandaloneAppFiles(appDir, 'prepare-mindos-bundle');
}

function materializeRuntimeDependencySeeds(appDir, standaloneDir, seeds) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir) || seeds.length === 0) return;

  const missing = [];
  for (const packageName of seeds) {
    materializePackage(appDir, standaloneDir, packageName);
    if (!existsSync(path.join(nodeModulesDir, packageName, 'package.json'))) {
      missing.push(packageName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      '[prepare-mindos-bundle] Runtime dependency seed(s) missing from standalone bundle:\n'
      + missing.map((item) => `  - ${item}`).join('\n')
    );
  }
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
    const packageDir = path.join(nodeModulesDir, packageName);
    const sourcePackage = resolvePackageDir(appDir, packageName);
    if (existsSync(sourcePackage)) sourceByPackageName.set(packageName, sourcePackage);
    materializePackageDependencies(appDir, standaloneDir, packageName, packageDir, sourcePackage, visited, sourceByPackageName);
  }
}

function materializePackageDependencies(appDir, standaloneDir, packageName, packageDir, sourcePackage, visited, sourceByPackageName) {
  const visitKey = path.resolve(packageDir);
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  sourcePackage = sourcePackage ?? sourceByPackageName.get(packageName) ?? resolvePackageDir(appDir, packageName);
  if (existsSync(sourcePackage)) sourceByPackageName.set(packageName, sourcePackage);
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return;
  }

  for (const [dependencyName, dependencyRange] of Object.entries(pkg.dependencies ?? {})) {
    const dependencySource = materializePackage(appDir, standaloneDir, dependencyName, sourcePackage, packageDir, dependencyRange);
    if (dependencySource) sourceByPackageName.set(dependencyName, dependencySource);
    const nestedDependencyDir = path.join(packageDir, 'node_modules', dependencyName);
    const topLevelDependencyDir = path.join(standaloneDir, 'node_modules', dependencyName);
    const dependencyDir = packageAtPathSatisfies(nestedDependencyDir, dependencyRange, dependencyName)
      ? nestedDependencyDir
      : topLevelDependencyDir;
    materializePackageDependencies(
      appDir,
      standaloneDir,
      dependencyName,
      dependencyDir,
      dependencySource,
      visited,
      sourceByPackageName,
    );
  }
}

function assertStandalonePackageDependencyClosure(standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  const missing = [];
  for (const { name: packageName, dir: packageDir } of collectPackageEntries(nodeModulesDir)) {
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
  return packageAtPathSatisfies(path.join(packageDir, 'node_modules', dependencyName), dependencyRange, dependencyName)
    || packageAtPathSatisfies(path.join(nodeModulesDir, dependencyName), dependencyRange, dependencyName);
}

function isNodeBuiltin(packageName) {
  return packageName.startsWith('node:');
}

function listPackageNames(nodeModulesDir) {
  const packageNames = [];
  if (!existsSync(nodeModulesDir)) return packageNames;
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name === '.pnpm') continue;
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

function collectPackageEntries(nodeModulesDir, out = []) {
  if (!existsSync(nodeModulesDir)) return out;
  for (const packageName of listPackageNames(nodeModulesDir)) {
    const packageDir = path.join(nodeModulesDir, packageName);
    out.push({ name: packageName, dir: packageDir });
    collectPackageEntries(path.join(packageDir, 'node_modules'), out);
  }
  return out;
}

function replaceSymlinksWithCopies(dir, nodeModulesRoot = dir, fallbackNodeModulesDir = null) {
  for (const name of readdirSync(dir)) {
    if (name === '.pnpm') continue;

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

function prunePnpmVirtualStores(standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;
  for (const pnpmDir of findDirsNamed(nodeModulesDir, '.pnpm')) {
    rmSync(pnpmDir, { recursive: true, force: true });
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
  };
  for (const [packageName, packageRange] of Object.entries(nextPackage.peerDependencies ?? {})) {
    if (nextPackage.peerDependenciesMeta?.[packageName]?.optional === true) continue;
    runtimeDeps[packageName] = packageRange;
  }
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

function pruneDirectDevelopmentPackages(standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  const nodeModulesDirs = [nodeModulesDir];
  collectNestedNodeModulesDirs(nodeModulesDir, nodeModulesDir, nodeModulesDirs);
  for (const packageName of [
    '@eslint',
    '@vitest',
    'eslint',
    'eslint-config-next',
    'eslint-plugin-react-hooks',
    'tsx',
    'typescript',
    'typescript-eslint',
    'vitest',
  ]) {
    for (const currentNodeModulesDir of nodeModulesDirs) {
      const packageDir = path.join(currentNodeModulesDir, packageName);
      rmSync(packageDir, { recursive: true, force: true });
      pruneEmptyParents(packageDir, currentNodeModulesDir);
    }
  }
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
  const stopRoot = path.resolve(stopAt);
  let current = path.dirname(startPath);
  while (current !== path.dirname(current)) {
    // path.relative boundary check — a string prefix would treat /a/b-extra
    // as inside stopAt /a/b
    const rel = path.relative(stopRoot, path.resolve(current));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return;
    if (!existsSync(current)) return;
    if (readdirSync(current).length > 0) return;
    rmSync(current, { recursive: true, force: true });
    if (rel === '') return; // just removed stopAt itself
    current = path.dirname(current);
  }
}

function normalizeNodePlatform(platform) {
  return platform === 'win' || platform === 'windows' ? 'win32' : platform;
}

function normalizeNodeArch(arch) {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

function materializePackage(appDir, standaloneDir, packageName, fromDir = appDir, parentPackageDir = null, dependencyRange = '*') {
  const sourcePackage = resolvePackageDir(appDir, packageName, fromDir, dependencyRange);
  const destPackage = path.join(standaloneDir, 'node_modules', packageName);
  if (!existsSync(sourcePackage)) return null;
  if (!existsSync(destPackage)) {
    mkdirSync(path.dirname(destPackage), { recursive: true });
    copyDereferenced(sourcePackage, destPackage);
  }

  if (parentPackageDir) {
    if (packageAtPathSatisfies(destPackage, dependencyRange, packageName)) return sourcePackage;

    const nestedDest = path.join(parentPackageDir, 'node_modules', packageName);
    if (packageAtPathSatisfies(nestedDest, dependencyRange, packageName)) return sourcePackage;

    rmSync(nestedDest, { recursive: true, force: true });
    mkdirSync(path.dirname(nestedDest), { recursive: true });
    copyDereferenced(sourcePackage, nestedDest);
  }
  return sourcePackage;
}

function packageAtPathSatisfies(packageDir, dependencyRange = '*', expectedPackageName = null) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    if (expectedPackageName && pkg.name !== expectedPackageName) return false;
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
  if (packageAtPathSatisfies(packageLocal, dependencyRange, packageName)) return realpathSync(packageLocal);
  if (packageAtPathSatisfies(direct, dependencyRange, packageName)) return realpathSync(direct);

  try {
    const requireFromPackage = createRequire(path.join(realpathSync(fromDir), 'package.json'));
    const entrypoint = requireFromPackage.resolve(packageName);
    const packageRoot = findPackageRoot(entrypoint);
    if (packageAtPathSatisfies(packageRoot, dependencyRange, packageName)) return packageRoot;
  } catch {
    // Fall through to pnpm store scan below.
  }

  if (packageAtPathSatisfies(direct, dependencyRange, packageName)) return realpathSync(direct);

  const repoRoot = path.resolve(appDir, '..', '..');
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return direct;

  const encodedName = packageName.replace('/', '+');
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith(`${encodedName}@`)) continue;
    const candidate = path.join(pnpmDir, entry, 'node_modules', packageName);
    if (packageAtPathSatisfies(candidate, dependencyRange, packageName)) return candidate;
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
  pruneClaudeAgentSdkNativePackages(path.join(destAppDir, '.next', 'standalone'));
}

export function pruneClaudeAgentSdkNativePackages(rootDir) {
  if (!existsSync(rootDir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const child = path.join(rootDir, entry.name);
    if (!entry.isDirectory()) continue;
    if (isClaudeAgentSdkNativePackageDir(child, entry.name)) {
      rmSync(child, { recursive: true, force: true });
      removed += 1;
      continue;
    }
    removed += pruneClaudeAgentSdkNativePackages(child);
  }
  return removed;
}

function isClaudeAgentSdkNativePackageDir(dir, name) {
  return (
    path.basename(path.dirname(dir)) === '@anthropic-ai'
    && name.startsWith('claude-agent-sdk-')
  ) || name.startsWith('@anthropic-ai+claude-agent-sdk-');
}

/**
 * Turbopack appends a content hash to serverExternalPackages names
 * (e.g. `@mariozechner/pi-agent-core-805d1afb58d9a138`).
 * standalone/node_modules only has the original name. Materialize the hashed
 * name as a REAL directory copy — not a symlink (the desktop pipeline strips
 * all symlinks for codesign safety and Windows can't create them unprivileged)
 * and not a package.json "main" shim (can't replicate ESM `exports` maps or
 * subpath requires like `pkg-<hash>/dist/x`).
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
          copyDereferenced(originalDir, hashedDir);
          console.log(`[prepare-mindos-bundle] Materialized hashed external: ${hashed} → copy of ${original}`);
        } catch (e) {
          console.warn(`[prepare-mindos-bundle] Failed to materialize ${hashed}:`, e.message);
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
      if (name === '.pnpm') continue;
      if (name === '.next') continue;
      copyDereferenced(path.join(fromAbs, name), path.join(toAbs, name));
    }
    return;
  }

  if (stat.isFile()) {
    mkdirSync(path.dirname(toAbs), { recursive: true });
    copyFileSync(fromAbs, toAbs);
  }
}
