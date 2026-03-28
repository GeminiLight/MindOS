#!/usr/bin/env node
/**
 * Copy a built MindOS repo tree into resources/mindos-runtime for electron-builder extraResources.
 * Prerequisite: repo root has app/.next with standalone output (run `npm run build` from monorepo root).
 *
 *   MINDOS_BUNDLE_SOURCE=/path/to/mindos-repo node scripts/prepare-mindos-runtime.mjs
 *
 *
 * @see wiki/specs/spec-desktop-bundled-mindos.md
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { copyAppForBundledRuntime, materializeStandaloneAssets } from './prepare-mindos-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');
const dest = path.join(desktopRoot, 'resources', 'mindos-runtime');
const defaultSource = path.resolve(desktopRoot, '..');
const source = process.env.MINDOS_BUNDLE_SOURCE
  ? path.resolve(process.env.MINDOS_BUNDLE_SOURCE)
  : defaultSource;

function fail(msg) {
  console.error(`[prepare-mindos-runtime] ${msg}`);
  process.exit(1);
}

const appDir = path.join(source, 'app');
const appNext = path.join(appDir, '.next');
const mcpDir = path.join(source, 'mcp');
const rootPkg = path.join(source, 'package.json');

if (!existsSync(rootPkg)) fail(`Not a MindOS repo root (no package.json): ${source}`);
if (!existsSync(appNext)) fail(`Missing app/.next — from repo root run: npm run build (or mindos build)`);
if (!existsSync(mcpDir)) fail(`Missing mcp/ under ${source}`);

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

copyTree('package.json');
copyTree('LICENSE');
copyAppForBundledRuntime(appDir, path.join(dest, 'app'));
copyTree('mcp');

// MCP: only need dist/index.cjs (pre-bundled). Remove node_modules and source if copied.
const destMcp = path.join(dest, 'mcp');
const destMcpBundle = path.join(destMcp, 'dist', 'index.cjs');
const destMcpNm = path.join(destMcp, 'node_modules');
if (existsSync(destMcpNm)) rmSync(destMcpNm, { recursive: true, force: true });

// Build bundle if not already present
if (!existsSync(destMcpBundle)) {
  const sourceMcpBundle = path.join(source, 'mcp', 'dist', 'index.cjs');
  if (existsSync(sourceMcpBundle)) {
    mkdirSync(path.join(destMcp, 'dist'), { recursive: true });
    cpSync(sourceMcpBundle, destMcpBundle);
  } else {
    // Build from source
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const srcMcp = path.join(source, 'mcp');
    spawnSync(npmCmd, ['install'], { cwd: srcMcp, stdio: 'inherit', shell: process.platform === 'win32' });
    spawnSync(npmCmd, ['run', 'build'], { cwd: srcMcp, stdio: 'inherit', shell: process.platform === 'win32' });
    mkdirSync(path.join(destMcp, 'dist'), { recursive: true });
    cpSync(path.join(srcMcp, 'dist', 'index.cjs'), destMcpBundle);
  }
}
if (!existsSync(destMcpBundle)) fail('MCP bundle not found after build — check mcp/dist/index.cjs');

if (existsSync(path.join(source, 'scripts'))) {
  copyTree('scripts');
}

const templatesFrom = path.join(source, 'templates');
if (existsSync(templatesFrom) && statSync(templatesFrom).isDirectory()) {
  cpSync(templatesFrom, path.join(dest, 'templates'), { recursive: true });
} else {
  console.warn('[prepare-mindos-runtime] No templates/ in source — setup init will not find starter templates');
}

const binFrom = path.join(source, 'bin');
if (existsSync(binFrom) && statSync(binFrom).isDirectory()) {
  cpSync(binFrom, path.join(dest, 'bin'), { recursive: true });
} else {
  console.warn(
    '[prepare-mindos-runtime] No bin/ in source — packaged app may log "Bundled MindOS CLI not found"',
  );
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
  let nodeUrl, nodeFormat;
  if (plat === 'darwin') {
    nodeUrl = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${nodeArch}.tar.gz`;
    nodeFormat = 'tar.gz';
  } else if (plat === 'win32') {
    nodeUrl = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-${nodeArch}.zip`;
    nodeFormat = 'zip';
  } else {
    nodeUrl = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${nodeArch}.tar.gz`;
    nodeFormat = 'tar.gz';
  }

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

    // Download using curl (available on all CI platforms and macOS/Linux)
    const curlResult = spawnSync('curl', ['-fsSL', '-o', tmpFile, nodeUrl], {
      stdio: 'inherit',
      timeout: 120000,
    });
    if (curlResult.status !== 0) {
      fail(`Failed to download Node.js from ${nodeUrl}`);
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

console.log(`[prepare-mindos-runtime] OK → ${dest} (from ${source})`);
