#!/usr/bin/env node
/**
 * Copy a built MindOS repo tree into resources/mindos-runtime for electron-builder extraResources.
 * Prerequisite: repo root has packages/web/.next with standalone output (run `pnpm --filter @mindos/web build`).
 *
 *   MINDOS_BUNDLE_SOURCE=/path/to/mindos-repo node scripts/prepare-mindos-runtime.mjs
 *
 *
 * @see wiki/specs/spec-desktop-bundled-mindos.md
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { copyAppForBundledRuntime, materializeStandaloneAssets } from './prepare-mindos-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');
const dest = path.join(desktopRoot, 'resources', 'mindos-runtime');
const defaultSource = path.resolve(desktopRoot, '..', '..');
const source = process.env.MINDOS_BUNDLE_SOURCE
  ? path.resolve(process.env.MINDOS_BUNDLE_SOURCE)
  : defaultSource;

function fail(msg) {
  console.error(`[prepare-mindos-runtime] ${msg}`);
  process.exit(1);
}

const appDir = path.join(source, 'packages', 'web');
const appNext = path.join(appDir, '.next');
const mcpDir = path.join(source, 'packages', 'protocols', 'mcp-server');
const rootPkg = path.join(source, 'package.json');
const productPkg = path.join(source, 'packages', 'mindos', 'package.json');

if (!existsSync(rootPkg)) fail(`Not a MindOS repo root (no package.json): ${source}`);
if (!existsSync(productPkg)) fail(`Missing packages/mindos/package.json under ${source}`);
if (!existsSync(appNext)) fail(`Missing packages/web/.next — from repo root run: pnpm --filter @mindos/web build`);
if (!existsSync(mcpDir)) fail(`Missing packages/protocols/mcp-server under ${source}`);

try {
  materializeStandaloneAssets(appDir);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

const keepNames = new Set(['.gitkeep', 'README.md']);
mkdirSync(dest, { recursive: true });
for (const name of readdirSync(dest)) {
  if (keepNames.has(name)) continue;
  rmSync(path.join(dest, name), { recursive: true, force: true });
}

function copyTree(rel) {
  const from = path.join(source, rel);
  if (!existsSync(from)) fail(`Missing ${rel}`);
  cpSync(from, path.join(dest, rel), { recursive: true });
}

cpSync(productPkg, path.join(dest, 'package.json'));
copyTree('LICENSE');
copyAppForBundledRuntime(appDir, path.join(dest, 'packages', 'web'));

// Write build version stamp so Desktop's isNextBuildCurrent() recognizes the bundled build.
// Without this, Desktop would trigger a full rebuild on every launch.
const BUILD_VERSION_FILE = '.mindos-build-version';
try {
  const pkg = JSON.parse(readFileSync(productPkg, 'utf-8'));
  const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
  if (version) {
    const stampPath = path.join(dest, 'packages', 'web', '.next', BUILD_VERSION_FILE);
    writeFileSync(stampPath, version, 'utf-8');
    console.log(`[prepare-mindos-runtime] Build version stamp: ${version} → ${stampPath}`);
  } else {
    console.warn('[prepare-mindos-runtime] No version in package.json — skipping build stamp');
  }
} catch (e) {
  console.warn('[prepare-mindos-runtime] Failed to write build version stamp:', e.message);
}

// MCP: source of truth and Desktop runtime layout both use packages/protocols/mcp-server.
const destMcp = path.join(dest, 'packages', 'protocols', 'mcp-server');
const destMcpBundle = path.join(destMcp, 'dist', 'index.cjs');
rmSync(destMcp, { recursive: true, force: true });
mkdirSync(path.join(destMcp, 'dist'), { recursive: true });

// Build bundle if not already present
if (!existsSync(destMcpBundle)) {
  const sourceMcpBundle = path.join(mcpDir, 'dist', 'index.cjs');
  if (existsSync(sourceMcpBundle)) {
    cpSync(sourceMcpBundle, destMcpBundle);
  } else {
    // Build from source
    const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const build = spawnSync(pnpmCmd, ['--filter', '@mindos/mcp-server', 'build'], {
      cwd: source,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (build.status !== 0) fail('Failed to build @mindos/mcp-server');
    cpSync(path.join(mcpDir, 'dist', 'index.cjs'), destMcpBundle);
  }
}
if (!existsSync(destMcpBundle)) fail('MCP bundle not found after build — check packages/protocols/mcp-server/dist/index.cjs');
cpSync(path.join(mcpDir, 'package.json'), path.join(destMcp, 'package.json'));

if (existsSync(path.join(source, 'scripts'))) {
  copyTree('scripts');
  const setupPath = path.join(dest, 'scripts', 'setup.js');
  if (existsSync(setupPath)) {
    const setupSource = readFileSync(setupPath, 'utf-8')
      .replaceAll('../packages/mindos/bin/', '../bin/');
    writeFileSync(setupPath, setupSource, 'utf-8');
  }
}

const templatesFrom = path.join(source, 'templates');
if (existsSync(templatesFrom) && statSync(templatesFrom).isDirectory()) {
  cpSync(templatesFrom, path.join(dest, 'templates'), { recursive: true });
} else {
  console.warn('[prepare-mindos-runtime] No templates/ in source — setup init will not find starter templates');
}

const binFrom = path.join(source, 'packages', 'mindos', 'bin');
if (existsSync(binFrom) && statSync(binFrom).isDirectory()) {
  cpSync(binFrom, path.join(dest, 'bin'), { recursive: true });
} else {
  console.warn(
    '[prepare-mindos-runtime] No packages/mindos/bin/ in source — packaged app may log "Bundled MindOS CLI not found"',
  );
}

const productSrcFrom = path.join(source, 'packages', 'mindos', 'src');
if (existsSync(productSrcFrom) && statSync(productSrcFrom).isDirectory()) {
  cpSync(productSrcFrom, path.join(dest, 'src'), { recursive: true });
} else {
  fail('Missing packages/mindos/src — bundled CLI imports ../src/cli.js');
}

// ── Bundle Node.js binary ──
// Download and extract platform-appropriate Node.js into mindos-runtime/node/
// so Desktop can launch without any system Node.js installed.
// Skip with MINDOS_SKIP_BUNDLE_NODE=1 (e.g. local dev builds where size matters).
if (!process.env.MINDOS_SKIP_BUNDLE_NODE) {
  // IMPORTANT: Keep in sync with desktop/src/node-bootstrap.ts NODE_VERSION
  const NODE_VERSION = '22.16.0';
  const plat = process.env.MINDOS_BUNDLE_NODE_PLATFORM || process.platform;
  const arch = process.env.MINDOS_BUNDLE_NODE_ARCH || process.arch;

  // Determine platform-specific download info
  const nodeArch = arch === 'arm64' ? 'arm64' : 'x64';
  const OFFICIAL_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const MIRROR_BASE = process.env.NODEJS_ORG_MIRROR || `https://npmmirror.com/mirrors/node/v${NODE_VERSION}`;
  let nodeFile, nodeFormat;
  if (plat === 'darwin') {
    nodeFile = `node-v${NODE_VERSION}-darwin-${nodeArch}.tar.gz`;
    nodeFormat = 'tar.gz';
  } else if (plat === 'win32') {
    nodeFile = `node-v${NODE_VERSION}-win-${nodeArch}.zip`;
    nodeFormat = 'zip';
  } else {
    nodeFile = `node-v${NODE_VERSION}-linux-${nodeArch}.tar.gz`;
    nodeFormat = 'tar.gz';
  }
  const nodeUrl = `${OFFICIAL_BASE}/${nodeFile}`;
  const nodeMirrorUrl = `${MIRROR_BASE}/${nodeFile}`;

  const nodeDest = path.join(dest, 'node');
  const tmpDir = path.join(desktopRoot, '.node-bundle-tmp');

  // Check if already present (idempotent)
  const expectedBin = plat === 'win32'
    ? path.join(nodeDest, 'node.exe')
    : path.join(nodeDest, 'bin', 'node');

  if (existsSync(expectedBin)) {
    console.log(`[prepare-mindos-runtime] Node.js already bundled at ${nodeDest}`);
  } else {
    console.log(`[prepare-mindos-runtime] Downloading Node.js ${NODE_VERSION} (${plat}-${nodeArch})...`);

    // Clean up
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    if (existsSync(nodeDest)) rmSync(nodeDest, { recursive: true, force: true });
    mkdirSync(nodeDest, { recursive: true });

    const tmpFile = path.join(tmpDir, `node.${nodeFormat}`);

    // Download using curl — try official first, fall back to China mirror (npmmirror.com)
    const curlResult = spawnSync('curl', ['-fsSL', '--connect-timeout', '15', '-o', tmpFile, nodeUrl], {
      stdio: 'inherit',
      timeout: 120000,
    });
    if (curlResult.status !== 0) {
      console.log(`[prepare-mindos-runtime] Official download failed, trying mirror: ${nodeMirrorUrl}`);
      const mirrorResult = spawnSync('curl', ['-fsSL', '-o', tmpFile, nodeMirrorUrl], {
        stdio: 'inherit',
        timeout: 120000,
      });
      if (mirrorResult.status !== 0) {
        fail(`Failed to download Node.js from both ${nodeUrl} and ${nodeMirrorUrl}`);
      }
    }

    // Extract
    if (nodeFormat === 'tar.gz') {
      const tarResult = spawnSync('tar', ['xzf', tmpFile, '-C', nodeDest, '--strip-components=1'], {
        stdio: 'inherit',
        timeout: 60000,
      });
      if (tarResult.status !== 0) fail('Failed to extract Node.js tar.gz');
    } else {
      // Windows zip — use PowerShell
      const extractDir = path.join(tmpDir, 'extract');
      mkdirSync(extractDir, { recursive: true });
      spawnSync('powershell', [
        '-Command',
        `Expand-Archive -Path '${tmpFile}' -DestinationPath '${extractDir}' -Force`,
      ], { stdio: 'inherit', timeout: 60000 });
      // Move contents up (strip top-level folder)
      const entries = readdirSync(extractDir);
      const nodeFolder = entries.find(e => e.startsWith('node-'));
      if (nodeFolder) {
        cpSync(path.join(extractDir, nodeFolder), nodeDest, { recursive: true });
      } else {
        fail('Node.js zip extraction: could not find node-* folder');
      }
    }

    // Verify
    if (!existsSync(expectedBin)) {
      fail(`Node.js extraction succeeded but binary not found at ${expectedBin}`);
    }

    // Cleanup tmp
    rmSync(tmpDir, { recursive: true, force: true });

    // Strip unnecessary files to minimize bundle size (~80MB → ~40MB)
    // Keep: bin/node, bin/npm, bin/npx, lib/node_modules/npm (for npm install)
    // Remove: include/, share/doc/, share/man/, CHANGELOG.md, README.md, etc.
    for (const stripDir of ['include', 'share']) {
      const p = path.join(nodeDest, stripDir);
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
    for (const stripFile of ['CHANGELOG.md', 'README.md', 'LICENSE']) {
      const p = path.join(nodeDest, stripFile);
      if (existsSync(p)) rmSync(p, { force: true });
    }

    console.log(`[prepare-mindos-runtime] Node.js ${NODE_VERSION} bundled → ${nodeDest}`);
  }
} else {
  console.log('[prepare-mindos-runtime] MINDOS_SKIP_BUNDLE_NODE=1 — skipping Node.js bundle');
}

// ── Remove symlinks ──
// macOS codesign rejects bundles containing symlinks with invalid destinations.
// Standalone node_modules may contain symlinks from fixTurbopackHashedExternals
// or leftover from npm's hoisting. Remove them all — they're not needed at runtime
// since webpack already bundles everything, and standalone traces all required files.
import { lstatSync } from 'fs';
function removeSymlinks(dir) {
  if (!existsSync(dir)) return;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        rmSync(full, { force: true });
        count++;
      } else if (stat.isDirectory()) {
        count += removeSymlinks(full);
      }
    } catch { /* skip unreadable entries */ }
  }
  return count;
}
const symlinkCount = removeSymlinks(dest) || 0;
if (symlinkCount > 0) {
  console.log(`[prepare-mindos-runtime] Removed ${symlinkCount} symlinks from runtime bundle`);
}

console.log(`[prepare-mindos-runtime] OK → ${dest} (from ${source})`);
