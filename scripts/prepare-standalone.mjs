#!/usr/bin/env node
/**
 * prepare-standalone.mjs — Materialize Next.js standalone build into _standalone/
 *
 * Called during `npm pack` (via prepack script) to bundle prebuilt production
 * server into the npm package. Users who install via npm get a ready-to-run
 * server without needing `npm install` + `next build` on their machine.
 *
 * Prerequisites: `pnpm --filter @mindos/web run build` must have been run first.
 */
import { cpSync, existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = resolve(root, 'packages', 'web');
const standaloneAppDir = resolve(appDir, '.next', 'standalone');
const standaloneServerJs = resolve(standaloneAppDir, 'server.js');
const productRoot = resolve(root, 'packages', 'mindos');
const destDir = resolve(productRoot, '_standalone');
const runtimeDependencySeeds = [
  '@mariozechner/pi-coding-agent',
  '@sinclair/typebox',
  'partial-json',
  'ajv',
  'ajv-formats',
  '@anthropic-ai/sdk',
  'openai',
];

// ── Guard: ensure standalone build exists ────────────────────────────────────
if (!existsSync(standaloneServerJs)) {
  console.error(
    `[prepare-standalone] Missing ${standaloneServerJs}\n` +
    `Run: pnpm --filter @mindos/web run build`
  );
  process.exit(1);
}

// ── Step 1: Materialize static + public into standalone dir ──────────────────
// Reuse the same logic Desktop uses.
import { materializeStandaloneAssets } from '../packages/desktop/scripts/prepare-mindos-bundle.mjs';
materializeStandaloneAssets(appDir);
copyRuntimeDependencyClosure(resolve(standaloneAppDir, 'node_modules'), runtimeDependencySeeds);

// ── Step 2: Copy standalone to top-level _standalone/ ────────────────────────
console.log('[prepare-standalone] Copying standalone build to packages/mindos/_standalone/ ...');
rmSync(destDir, { recursive: true, force: true });
cpSync(standaloneAppDir, destDir, { recursive: true, dereference: true });

// npm always excludes directories named node_modules, even when they live under
// an explicit `files` entry. Stage traced standalone dependencies under a
// publishable name; the CLI restores `_standalone/node_modules` at runtime.
const standaloneNodeModules = resolve(destDir, 'node_modules');
const publishableNodeModules = resolve(destDir, '__node_modules');
if (existsSync(standaloneNodeModules)) {
  rmSync(publishableNodeModules, { recursive: true, force: true });
  renameSync(standaloneNodeModules, publishableNodeModules);
}

const removedPackageLocks = prunePackageLocks(destDir);
if (removedPackageLocks > 0) {
  console.log(`[prepare-standalone] Removed ${removedPackageLocks} package-lock.json file(s) from standalone output`);
}

// ── Step 3: Write version stamp ──────────────────────────────────────────────
const version = JSON.parse(readFileSync(resolve(productRoot, 'package.json'), 'utf-8')).version;
writeFileSync(resolve(destDir, '.mindos-build-version'), version, 'utf-8');

// ── Step 4: Verify server.js ─────────────────────────────────────────────────
const destServerJs = resolve(destDir, 'server.js');
if (!existsSync(destServerJs)) {
  console.error('[prepare-standalone] FAILED: packages/mindos/_standalone/server.js not found after copy');
  process.exit(1);
}

// ── Step 5: Verify every route declared in app-paths-manifest actually exists ─
// Root cause of the /wiki 500 bug: manifest listed the route but the page.js
// file was missing from the standalone build.  A static checklist can go stale
// when new pages are added, so we read the manifest directly — zero maintenance.
const manifestPath = resolve(destDir, '.next', 'server', 'app-paths-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('[prepare-standalone] FAILED: app-paths-manifest.json not found in standalone build');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const serverDir = resolve(destDir, '.next', 'server');
const missingFiles = [];

for (const [route, relPath] of Object.entries(manifest)) {
  const absPath = resolve(serverDir, relPath);
  if (!existsSync(absPath)) {
    missingFiles.push({ route, file: relPath });
  }
}

if (missingFiles.length > 0) {
  console.error(
    `[prepare-standalone] FAILED: ${missingFiles.length} route(s) declared in app-paths-manifest.json but file missing:\n` +
    missingFiles.map(({ route, file }) => `  ${route}  →  ${file}`).join('\n') + '\n' +
    'This will cause 500 errors at runtime. Check the Next.js build output for errors.'
  );
  process.exit(1);
}

const pageRoutes = Object.keys(manifest).filter(r => r.endsWith('/page'));
const standaloneNextDir = resolve(destDir, '.next');
const publishableNextDir = resolve(destDir, '__next');
if (existsSync(standaloneNextDir)) {
  rmSync(resolve(standaloneNextDir, 'cache'), { recursive: true, force: true });
  rmSync(resolve(standaloneNextDir, 'diagnostics'), { recursive: true, force: true });
  rmSync(publishableNextDir, { recursive: true, force: true });
  renameSync(standaloneNextDir, publishableNextDir);
}

console.log(`[prepare-standalone] OK — server.js + ${Object.keys(manifest).length} manifest entries verified (${pageRoutes.length} pages, v${version})`);

function prunePackageLocks(dir) {
  let removed = 0;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      removed += prunePackageLocks(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name === 'package-lock.json') {
      rmSync(entryPath, { force: true });
      removed += 1;
    }
  }

  return removed;
}

function copyRuntimeDependencyClosure(destNodeModules, seeds) {
  if (!existsSync(destNodeModules)) return;

  const visited = new Set();
  const queue = seeds.map((name) => ({ name, required: true, strict: true, from: appDir }));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next.name)) continue;
    visited.add(next.name);

    const packageDir = resolvePackageDir(next.name, next.from);
    if (!packageDir) {
      if (next.strict) {
        console.error(`[prepare-standalone] FAILED: runtime dependency not resolvable: ${next.name}`);
        process.exit(1);
      }
      continue;
    }

    const packageJsonPath = resolve(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      if (next.strict) {
        console.error(`[prepare-standalone] FAILED: runtime dependency package.json missing: ${next.name}`);
        process.exit(1);
      }
      continue;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const destDir = resolve(destNodeModules, next.name);
    if (!existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true });
      cpSync(packageDir, destDir, {
        recursive: true,
        dereference: true,
        filter: shouldCopyRuntimePackageEntry,
      });
    }

    const peerMeta = packageJson.peerDependenciesMeta ?? {};
    const deps = [
      ...Object.keys(packageJson.dependencies ?? {}).map((name) => ({ name, required: true })),
      ...Object.keys(packageJson.peerDependencies ?? {}).map((name) => ({
        name,
        required: peerMeta[name]?.optional !== true,
      })),
      ...Object.keys(packageJson.optionalDependencies ?? {}).map((name) => ({ name, required: false })),
    ];

    for (const dep of deps) {
      if (!visited.has(dep.name)) queue.push({ ...dep, strict: false, from: packageDir });
    }
  }
}

function resolvePackageDir(packageName, fromDir) {
  const directPath = resolve(appDir, 'node_modules', packageName);
  if (existsSync(resolve(directPath, 'package.json'))) return realpathSync(directPath);

  try {
    const requireFromPackage = createRequire(resolve(fromDir, 'package.json'));
    const entry = requireFromPackage.resolve(packageName);
    return findPackageRoot(entry, packageName);
  } catch {
    return null;
  }
}

function findPackageRoot(startPath, packageName) {
  let dir = dirname(startPath);

  while (dir !== dirname(dir)) {
    const packageJsonPath = resolve(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.name === packageName) return dir;
      } catch {
        return null;
      }
    }
    dir = dirname(dir);
  }

  return null;
}

function shouldCopyRuntimePackageEntry(src) {
  const name = src.split('/').pop();
  return name !== 'node_modules' && name !== '.cache' && name !== '.turbo';
}
