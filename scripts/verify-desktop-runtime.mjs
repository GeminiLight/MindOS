#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const runtimeRoot = resolve(root, args.runtimeRoot ?? 'packages/desktop/resources/mindos-runtime');
const mainBundle = resolve(root, args.mainBundle ?? 'packages/desktop/dist-electron/main/main.js');

const requiredRuntimeFiles = [
  'package.json',
  'packages/web/.next/standalone/server.js',
  'packages/web/.next/standalone/node_modules/next/package.json',
  'packages/web/.next/standalone/node_modules/@sinclair/typebox/package.json',
  'dist/protocols/mcp-server/index.cjs',
  'bin/cli.js',
  'src/cli.js',
  'runtime-manifest.json',
];

const optionalLocalEmbeddingRuntimeFiles = [
  'packages/web/.next/standalone/node_modules/@huggingface/transformers/package.json',
  'packages/web/.next/standalone/node_modules/onnxruntime-node/package.json',
  'packages/web/.next/standalone/node_modules/onnxruntime-web/package.json',
];

const fatalMainPatterns = [
  /path\.join\(__dirname,\s*["']path\.txt["']\)/,
  /__vite-browser-external/,
  /mcp-server["']?\),\s*["']dist["'],\s*["']index\.cjs["']/,
];

const fatalLogPatterns = [
  'MCP bundle not found',
  'ERR_MODULE_NOT_FOUND',
  'Cannot find module',
  'Internal Error',
  'A JavaScript error occurred in the main process',
  'path.join is not a function',
];

const failures = [];

for (const rel of requiredRuntimeFiles) {
  if (!existsSync(join(runtimeRoot, rel))) failures.push(`missing runtime file: ${rel}`);
}

if (process.env.MINDOS_BUNDLE_LOCAL_EMBEDDING_RUNTIME !== '1') {
  for (const rel of optionalLocalEmbeddingRuntimeFiles) {
    if (existsSync(join(runtimeRoot, rel))) failures.push(`optional local embedding runtime should not be bundled by default: ${rel}`);
  }
}

if (existsSync(mainBundle)) {
  const source = readFileSync(mainBundle, 'utf-8');
  for (const pattern of fatalMainPatterns) {
    if (pattern.test(source)) failures.push(`main bundle contains forbidden pattern: ${pattern}`);
  }
  if (!source.includes('resolveMcpBundlePath')) {
    failures.push('main bundle does not include resolveMcpBundlePath');
  }
}

const standaloneNodeModules = join(runtimeRoot, 'packages/web/.next/standalone/node_modules');
if (existsSync(standaloneNodeModules)) {
  failures.push(...findMissingDependencyClosure(standaloneNodeModules));
}

if (failures.length > 0) {
  console.error('[verify-desktop-runtime] FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const size = existsSync(runtimeRoot) ? formatBytes(dirSize(runtimeRoot)) : 'missing';
console.log(`[verify-desktop-runtime] OK ${runtimeRoot} (${size})`);
console.log(`[verify-desktop-runtime] fatal log patterns guarded: ${fatalLogPatterns.join(', ')}`);

function findMissingDependencyClosure(nodeModulesDir) {
  const missing = [];
  for (const packageName of listPackageNames(nodeModulesDir)) {
    const packageDir = join(nodeModulesDir, packageName);
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) continue;

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    } catch {
      continue;
    }

    for (const dependencyName of Object.keys(pkg.dependencies ?? {})) {
      if (dependencyName.startsWith('node:')) continue;
      const nested = join(packageDir, 'node_modules', dependencyName, 'package.json');
      const topLevel = join(nodeModulesDir, dependencyName, 'package.json');
      if (!existsSync(nested) && !existsSync(topLevel)) {
        missing.push(`missing dependency: ${packageName} -> ${dependencyName}`);
      }
    }
  }
  return missing;
}

function listPackageNames(nodeModulesDir) {
  const packageNames = [];
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const scopedEntry of readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) packageNames.push(`${entry.name}/${scopedEntry.name}`);
      }
      continue;
    }
    packageNames.push(entry.name);
  }
  return packageNames;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += statSync(full).size;
  }
  return total;
}

function formatBytes(bytes) {
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(1)} MiB`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runtime-root') parsed.runtimeRoot = argv[++i];
    else if (arg === '--main-bundle') parsed.mainBundle = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
