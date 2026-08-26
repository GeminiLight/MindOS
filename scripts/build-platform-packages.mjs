#!/usr/bin/env node
/**
 * Build OpenCode-style platform runtime packages for npm publishing.
 *
 * Input: packages/mindos must already contain built dist/, staged runtime assets,
 * and either static-web/ or a pruned _standalone/ fallback runtime.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binaryName, buildBunBinary } from './build-bun-binary.mjs';
import {
  assertBuiltinAgentExtensionRuntime,
  assertExtractionRuntime,
  bundleDocxExtractor,
  pruneStandaloneToExtractionRuntime,
} from './prune-standalone-extraction.mjs';
import { writeRuntimeManifest as writeSharedRuntimeManifest } from './runtime-manifest.mjs';
import { pruneClaudeAgentSdkNativePackages } from '../packages/desktop/scripts/prepare-mindos-bundle.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const productRoot = resolve(root, 'packages', 'mindos');
const CLI_RUNTIME_ROOT_DEPENDENCIES = ['chokidar'];

const platforms = [
  { key: 'darwin-arm64', os: 'darwin', cpu: 'arm64', koffi: ['darwin_arm64'], clipboard: ['clipboard', 'clipboard-darwin-arm64', 'clipboard-darwin-universal'] },
  { key: 'darwin-x64', os: 'darwin', cpu: 'x64', koffi: ['darwin_x64'], clipboard: ['clipboard', 'clipboard-darwin-x64', 'clipboard-darwin-universal'] },
  { key: 'linux-arm64', os: 'linux', cpu: 'arm64', koffi: ['linux_arm64'], clipboard: ['clipboard', 'clipboard-linux-arm64-gnu'] },
  { key: 'linux-arm64-musl', os: 'linux', cpu: 'arm64', koffi: ['musl_arm64'], clipboard: ['clipboard', 'clipboard-linux-arm64-musl'] },
  { key: 'linux-x64', os: 'linux', cpu: 'x64', koffi: ['linux_x64'], clipboard: ['clipboard', 'clipboard-linux-x64-gnu'] },
  { key: 'linux-x64-musl', os: 'linux', cpu: 'x64', koffi: ['musl_x64'], clipboard: ['clipboard', 'clipboard-linux-x64-musl'] },
  { key: 'windows-arm64', os: 'win32', cpu: 'arm64', koffi: ['win32_arm64'], clipboard: ['clipboard', 'clipboard-win32-arm64-msvc'], binary: false },
  { key: 'windows-x64', os: 'win32', cpu: 'x64', koffi: ['win32_x64'], clipboard: ['clipboard', 'clipboard-win32-x64-msvc'] },
];

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(root, args.out ?? 'packages/mindos-platforms');
const selected = selectPlatforms(args.platform ?? 'all');
const productPkg = JSON.parse(readFileSync(resolve(productRoot, 'package.json'), 'utf-8'));
const buildBinary = args.binary !== false;
const fallbackRuntime = args.fallbackRuntime === true;

assertProductRuntimeReady();
mkdirSync(outDir, { recursive: true });

for (const target of selected) {
  const targetBuildBinary = buildBinary && target.binary !== false;
  const packageDir = resolve(outDir, target.key);
  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(packageDir, { recursive: true });

  copyRuntimeRoot(packageDir);
  copyCliRuntimeNodeModules(packageDir);
  writePlatformPackageJson(packageDir, target, targetBuildBinary);
  writePlatformRuntimeManifest(packageDir, target, targetBuildBinary);
  pruneKoffi(packageDir, target);
  pruneMarioClipboardPackages(packageDir, target);
  const removedClaudeNativePackages = pruneClaudeAgentSdkNativePackages(packageDir);
  if (removedClaudeNativePackages > 0) {
    console.log(`[build-platform-packages] Removed ${removedClaudeNativePackages} Claude Agent SDK native package(s) from ${target.key}`);
  }
  if (targetBuildBinary) {
    // Binary targets serve static-web; the standalone Next server is dead
    // weight in the embedded archive, but the document extraction runtime
    // under _standalone must survive — excluding it wholesale shipped a
    // runtime whose start gate fell into the source-build crash path (1.1.7).
    // Fallback-runtime packages expose _standalone on disk, so keep it whole.
    if (!fallbackRuntime && existsSync(resolve(packageDir, 'static-web', 'index.html'))) {
      const standaloneDir = resolve(packageDir, '_standalone');
      // Bundle first: it resolves against the complete staged tree, which the
      // pruned closure does not fully preserve (nested node_modules).
      bundleDocxExtractor(standaloneDir);
      pruneStandaloneToExtractionRuntime(standaloneDir);
      assertExtractionRuntime(standaloneDir);
      assertBuiltinAgentExtensionRuntime(standaloneDir);
    }
    buildBunBinary({
      runtimeRoot: packageDir,
      outFile: resolve(packageDir, 'bin', binaryName(target)),
      target,
    });
    if (!fallbackRuntime) pruneBinaryPackageRoot(packageDir, target);
  }

  console.log(`[build-platform-packages] ${target.key} -> ${packageDir}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') parsed.out = argv[++i];
    else if (arg === '--platform') parsed.platform = argv[++i];
    else if (arg === '--current') parsed.platform = currentPlatformKey();
    else if (arg === '--all') parsed.platform = 'all';
    else if (arg === '--no-binary') parsed.binary = false;
    else if (arg === '--fallback-runtime') parsed.fallbackRuntime = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function currentPlatformKey() {
  const osName = process.platform === 'win32' ? 'windows' : process.platform;
  const musl = process.platform === 'linux' && isMusl();
  return `${osName}-${process.arch}${musl ? '-musl' : ''}`;
}

function isMusl() {
  try {
    if (existsSync('/etc/alpine-release')) return true;
  } catch {
    // ignore
  }
  return false;
}

function selectPlatforms(value) {
  if (value === 'all') return platforms;
  const wanted = new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
  const selected = platforms.filter((target) => wanted.has(target.key));
  if (selected.length !== wanted.size) {
    const known = platforms.map((target) => target.key).join(', ');
    throw new Error(`Unknown platform selection "${value}". Known: ${known}`);
  }
  return selected;
}

function assertProductRuntimeReady() {
  const required = [
    'bin/cli.js',
    'dist/index.js',
    'src/cli-runtime.js',
    'dist/protocols/mcp-server/index.cjs',
    'skills/mindos/SKILL.md',
    'skills/mindos-zh/SKILL.md',
  ];

  for (const rel of required) {
    if (!existsSync(resolve(productRoot, rel))) {
      throw new Error(`[build-platform-packages] Missing product runtime file: packages/mindos/${rel}`);
    }
  }

  const hasStaticWeb = existsSync(resolve(productRoot, 'static-web/index.html'));
  const hasStandalone = existsSync(resolve(productRoot, '_standalone/server.js'))
    && existsSync(resolve(productRoot, '_standalone/__next/server/app-paths-manifest.json'))
    && existsSync(resolve(productRoot, '_standalone/__node_modules'));
  if (!hasStaticWeb && !hasStandalone) {
    throw new Error('[build-platform-packages] Missing Web runtime artifact: packages/mindos/static-web/index.html or packages/mindos/_standalone/server.js');
  }
}

function copyRuntimeRoot(packageDir) {
  const entries = [
    'bin',
    'dist',
    'src/cli.js',
    'src/cli.d.ts',
    'src/cli-runtime.js',
    'static-web',
    '_standalone',
    'scripts',
    'assets',
    'skills',
    'templates',
    'README.md',
    'README_zh.md',
    'LICENSE',
  ];

  for (const rel of entries) {
    const src = resolve(productRoot, rel);
    if (!existsSync(src)) continue;
    const dest = resolve(packageDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, dereference: true });
  }

  rmSync(resolve(packageDir, 'bin', 'mindos-shim.cjs'), { force: true });
}

function writePlatformPackageJson(packageDir, target, targetBuildBinary = buildBinary) {
  const manifest = {
    name: `@geminilight/mindos-${target.key}`,
    version: productPkg.version,
    description: `MindOS runtime package for ${target.key}`,
    type: 'module',
    license: productPkg.license ?? 'MIT',
    os: [target.os],
    cpu: [target.cpu],
    dependencies: platformRuntimeDependencies(),
    files: fallbackRuntime || !targetBuildBinary
      ? [
        'bin/',
        'dist/',
        'src/cli.js',
        'src/cli.d.ts',
        'src/cli-runtime.js',
        'scripts/',
        'assets/',
        'skills/',
        'templates/',
        'static-web/',
        '_standalone/',
        'README.md',
        'README_zh.md',
        'LICENSE',
        'package.json',
        'runtime-manifest.json',
      ]
      : [
        'bin/',
        'package.json',
        'runtime-manifest.json',
        'README.md',
        'README_zh.md',
        'LICENSE',
      ],
  };

  writeFileSync(resolve(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

function platformRuntimeDependencies() {
  const dependencies = {};
  for (const name of CLI_RUNTIME_ROOT_DEPENDENCIES) {
    const version = productPkg.dependencies?.[name];
    if (!version) {
      throw new Error(`[build-platform-packages] packages/mindos/package.json must declare runtime dependency: ${name}`);
    }
    dependencies[name] = version;
  }
  return dependencies;
}

function copyCliRuntimeNodeModules(packageDir) {
  const targetNodeModules = resolve(packageDir, 'node_modules');
  mkdirSync(targetNodeModules, { recursive: true });

  // bin/lib/sync.js dynamically imports chokidar after the Bun binary extracts
  // this runtime into ~/.mindos/runtime-cache; dependencies installed beside
  // the npm platform package are not visible from that extracted cache root.
  copyDependencyClosure(CLI_RUNTIME_ROOT_DEPENDENCIES, {
    targetNodeModules,
    resolveFromDir: productRoot,
  });
}

function copyDependencyClosure(rootPackages, options) {
  const copied = new Set();
  const queue = rootPackages.map((name) => ({ name, resolveFromDir: options.resolveFromDir }));

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || copied.has(item.name)) continue;

    const sourceDir = resolvePackageDir(item.resolveFromDir, item.name);
    const pkg = readRuntimeDependencyManifest(sourceDir, item.name);
    const destDir = resolvePackageName(options.targetNodeModules, item.name);

    rmSync(destDir, { recursive: true, force: true });
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(sourceDir, destDir, {
      recursive: true,
      dereference: true,
      filter: shouldCopyRuntimeDependency,
    });
    copied.add(item.name);

    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ name: dependency, resolveFromDir: sourceDir });
    }
  }

  return copied;
}

function resolvePackageDir(resolveFromDir, packageName) {
  const requireFromDir = createRequire(resolve(resolveFromDir, 'package.json'));
  try {
    return dirname(requireFromDir.resolve(`${packageName}/package.json`));
  } catch (packageJsonErr) {
    try {
      return findPackageRoot(requireFromDir.resolve(packageName), packageName);
    } catch (entryErr) {
      throw new Error(
        `[build-platform-packages] Missing installed runtime dependency ${packageName}; run pnpm install before building platform packages.`
        + `\n  resolved from: ${resolveFromDir}`
        + `\n  package.json cause: ${packageJsonErr instanceof Error ? packageJsonErr.message : String(packageJsonErr)}`
        + `\n  entrypoint cause: ${entryErr instanceof Error ? entryErr.message : String(entryErr)}`,
      );
    }
  }
}

function findPackageRoot(entryPath, packageName) {
  let current = dirname(entryPath);
  for (;;) {
    const manifestPath = resolve(current, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (!manifest.name || manifest.name === packageName) return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find package root for ${packageName} from ${entryPath}`);
    }
    current = parent;
  }
}

function readRuntimeDependencyManifest(packageDir, packageName) {
  const manifestPath = resolve(packageDir, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[build-platform-packages] Runtime dependency ${packageName} resolved to ${packageDir}, but package.json was not found.`,
    );
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

function resolvePackageName(nodeModules, packageName) {
  return resolve(nodeModules, ...packageName.split('/'));
}

function shouldCopyRuntimeDependency(src) {
  const name = basename(src);
  if (name === 'node_modules' || name === '.bin' || name === '.cache') return false;
  if (name === '.git' || name === '.github') return false;
  return true;
}

function writePlatformRuntimeManifest(packageDir, target, targetBuildBinary = buildBinary) {
  writeSharedRuntimeManifest(packageDir, {
    productPkg,
    packageName: `@geminilight/mindos-${target.key}`,
    platform: target.key,
    os: target.os,
    cpu: target.cpu,
    layout: targetBuildBinary ? 'bun-single-binary' : 'platform',
  });
}

function pruneBinaryPackageRoot(packageDir, target) {
  const keepBinary = binaryName(target);
  const removable = [
    '_standalone',
    'static-web',
    'dist',
    'src',
    'scripts',
    'assets',
    'skills',
    'templates',
    'node_modules',
    '.mindos-binary-build',
  ];

  for (const rel of removable) {
    rmSync(resolve(packageDir, rel), { recursive: true, force: true });
  }

  const binDir = resolve(packageDir, 'bin');
  if (!existsSync(binDir)) return;
  for (const entry of readdirSync(binDir, { withFileTypes: true })) {
    if (entry.name !== keepBinary) {
      rmSync(resolve(binDir, entry.name), { recursive: true, force: true });
    }
  }
}

function pruneKoffi(packageDir, target) {
  const koffiDir = resolve(packageDir, '_standalone', '__node_modules', 'koffi', 'build', 'koffi');
  if (!existsSync(koffiDir)) return;

  const keep = new Set(target.koffi);
  for (const entry of readdirSync(koffiDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !keep.has(entry.name)) {
      rmSync(resolve(koffiDir, entry.name), { recursive: true, force: true });
    }
  }
}

function pruneMarioClipboardPackages(packageDir, target) {
  const scopeDir = resolve(packageDir, '_standalone', '__node_modules', '@mariozechner');
  if (!existsSync(scopeDir)) return;

  const keep = new Set(target.clipboard);
  for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('clipboard')) continue;
    if (!keep.has(entry.name)) {
      rmSync(resolve(scopeDir, entry.name), { recursive: true, force: true });
    }
  }
}
