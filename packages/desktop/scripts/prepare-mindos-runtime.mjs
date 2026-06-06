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
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, symlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';
import { RUNTIME_DEPENDENCY_SEEDS, copyAppForBundledRuntime, materializeStandaloneAssets } from './prepare-mindos-bundle.mjs';
import { writeRuntimeManifest } from '../../../scripts/runtime-manifest.mjs';

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

function formatSpawnFailure(result) {
  const details = [
    `status=${result.status ?? 'null'}`,
    `signal=${result.signal ?? 'null'}`,
  ];
  if (result.error) details.push(`error=${result.error.message}`);
  return ` (${details.join(', ')})`;
}

const appDir = path.join(source, 'packages', 'web');
const appNext = path.join(appDir, '.next');
const mindosDir = path.join(source, 'packages', 'mindos');
const mcpSourceDir = path.join(mindosDir, 'src', 'protocols', 'mcp-server');
const mcpBundle = path.join(mindosDir, 'dist', 'protocols', 'mcp-server', 'index.cjs');
const rootPkg = path.join(source, 'package.json');
const productPkg = path.join(source, 'packages', 'mindos', 'package.json');
const targetNodePlatform = process.env.MINDOS_BUNDLE_NODE_PLATFORM || process.platform;
const targetNodeArch = process.env.MINDOS_BUNDLE_NODE_ARCH || process.arch;
const NODE_ZIP_EXTRACT_TIMEOUT_MS = 300000;

if (!existsSync(rootPkg)) fail(`Not a MindOS repo root (no package.json): ${source}`);
if (!existsSync(productPkg)) fail(`Missing packages/mindos/package.json under ${source}`);
if (!existsSync(appNext)) fail(`Missing packages/web/.next — from repo root run: pnpm --filter @mindos/web build`);
if (!existsSync(mcpSourceDir)) fail(`Missing packages/mindos/src/protocols/mcp-server under ${source}`);

try {
  materializeStandaloneAssets(appDir, {
    targetPlatform: targetNodePlatform,
    targetArch: targetNodeArch,
    runtimeDependencySeeds: RUNTIME_DEPENDENCY_SEEDS,
    bundleLocalEmbeddingRuntime: process.env.MINDOS_BUNDLE_LOCAL_EMBEDDING_RUNTIME === '1',
  });
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

// MCP: product-owned protocol runtime lives under packages/mindos/dist/protocols/mcp-server.
const destMcp = path.join(dest, 'dist', 'protocols', 'mcp-server');
const destMcpBundle = path.join(destMcp, 'index.cjs');
rmSync(path.join(dest, 'dist', 'protocols'), { recursive: true, force: true });
mkdirSync(destMcp, { recursive: true });

// Build bundle if not already present
if (!existsSync(destMcpBundle)) {
  if (existsSync(mcpBundle)) {
    cpSync(mcpBundle, destMcpBundle);
  } else {
    // Build from source
    const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const build = spawnSync(pnpmCmd, ['--filter', '@geminilight/mindos', 'build'], {
      cwd: source,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (build.status !== 0) fail('Failed to build @geminilight/mindos protocol runtimes');
    cpSync(mcpBundle, destMcpBundle);
  }
}
if (!existsSync(destMcpBundle)) fail('MCP bundle not found after build - check packages/mindos/dist/protocols/mcp-server/index.cjs');

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
  const plat = targetNodePlatform;
  const arch = targetNodeArch;

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
      extractTarGzSafe(tmpFile, nodeDest, 1);
    } else {
      // Windows zip — use PowerShell
      const extractDir = path.join(tmpDir, 'extract');
      mkdirSync(extractDir, { recursive: true });
      const psTmpFile = tmpFile.replace(/'/g, "''");
      const psExtractDir = extractDir.replace(/'/g, "''");
      const zipResult = spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath '${psTmpFile}' -DestinationPath '${psExtractDir}' -Force`,
      ], { stdio: 'inherit', timeout: NODE_ZIP_EXTRACT_TIMEOUT_MS });
      if (zipResult.status !== 0) {
        fail(`Failed to extract Node.js zip after ${NODE_ZIP_EXTRACT_TIMEOUT_MS}ms${formatSpawnFailure(zipResult)}`);
      }
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

function extractTarGzSafe(tarPath, destDir, stripComponents = 0) {
  const tar = gunzipSync(readFileSync(tarPath));
  let offset = 0;
  let longName = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (isZeroBlock(header)) break;

    const nameRaw = readTarString(header, 0, 100);
    const mode = readTarOctal(header, 100, 8) || 0o644;
    const linkName = readTarString(header, 157, 100);
    const size = readTarOctal(header, 124, 12);
    const typeflag = header[156];
    const prefix = readTarString(header, 345, 155);
    const dataEnd = offset + size;
    if (dataEnd > tar.length) fail('Invalid Node.js tar entry size');

    const paddedSize = Math.ceil(size / 512) * 512;
    if (typeflag === 0x4c) {
      longName = tar.subarray(offset, dataEnd).toString('utf-8').replace(/\0.*$/, '');
      offset += paddedSize;
      continue;
    }
    if (typeflag === 0x78) {
      const paxPath = readPaxPath(tar.subarray(offset, dataEnd).toString('utf-8'));
      if (paxPath) longName = paxPath;
      offset += paddedSize;
      continue;
    }
    if (typeflag === 0x67) {
      offset += paddedSize;
      continue;
    }

    const rawEntryName = longName || (prefix ? `${prefix}/${nameRaw}` : nameRaw);
    longName = null;
    const entryName = stripTarEntryPath(rawEntryName, stripComponents);
    if (!entryName || entryName === '.' || entryName === './') {
      offset += paddedSize;
      continue;
    }

    const entryPath = resolveTarEntryPath(destDir, entryName);
    const isDir = typeflag === 0x35 || entryName.endsWith('/');
    const isFile = typeflag === 0 || typeflag === 0x30;
    const isSymlink = typeflag === 0x32;
    if (isDir) {
      mkdirSync(entryPath, { recursive: true });
    } else if (isFile) {
      mkdirSync(path.dirname(entryPath), { recursive: true });
      writeFileSync(entryPath, tar.subarray(offset, dataEnd));
      if (targetNodePlatform !== 'win32') chmodSync(entryPath, mode & 0o777);
    } else if (isSymlink && targetNodePlatform !== 'win32') {
      const safeLinkName = resolveTarSymlinkTarget(destDir, entryPath, linkName);
      mkdirSync(path.dirname(entryPath), { recursive: true });
      symlinkSync(safeLinkName, entryPath);
    }

    offset += paddedSize;
  }
}

function stripTarEntryPath(entryName, stripComponents) {
  const normalizedEntry = entryName.replaceAll('\\', '/');
  if (normalizedEntry.startsWith('/') || normalizedEntry.startsWith('//') || /^[A-Za-z]:/.test(normalizedEntry)) {
    fail(`Node.js tar entry outside extraction directory: ${entryName}`);
  }
  const parts = normalizedEntry.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.includes('..')) fail(`Node.js tar entry outside extraction directory: ${entryName}`);
  return parts.slice(stripComponents).join('/');
}

function resolveTarEntryPath(destDir, entryName) {
  const root = path.resolve(destDir);
  const target = path.resolve(root, entryName);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    fail(`Node.js tar entry outside extraction directory: ${entryName}`);
  }
  return target;
}

function resolveTarSymlinkTarget(destDir, entryPath, linkName) {
  const normalizedLink = linkName.replaceAll('\\', '/');
  if (!normalizedLink || normalizedLink.startsWith('/') || normalizedLink.startsWith('//') || /^[A-Za-z]:/.test(normalizedLink)) {
    fail(`Node.js tar symlink outside extraction directory: ${linkName}`);
  }
  const root = path.resolve(destDir);
  const target = path.resolve(path.dirname(entryPath), normalizedLink);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    fail(`Node.js tar symlink outside extraction directory: ${linkName}`);
  }
  return normalizedLink;
}

function readTarString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? length : nul).toString('utf-8');
}

function readTarOctal(buffer, offset, length) {
  const raw = readTarString(buffer, offset, length).trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw.replace(/\0/g, ''), 8);
  if (!Number.isFinite(parsed)) fail('Invalid Node.js tar entry metadata');
  return parsed;
}

function readPaxPath(content) {
  let cursor = 0;
  while (cursor < content.length) {
    const space = content.indexOf(' ', cursor);
    if (space === -1) return null;
    const length = Number.parseInt(content.slice(cursor, space), 10);
    if (!Number.isFinite(length) || length <= 0) return null;
    const record = content.slice(space + 1, cursor + length).replace(/\n$/, '');
    const eq = record.indexOf('=');
    if (eq > 0 && record.slice(0, eq) === 'path') return record.slice(eq + 1);
    cursor += length;
  }
  return null;
}

function isZeroBlock(buffer) {
  for (const byte of buffer) {
    if (byte !== 0) return false;
  }
  return true;
}

// ── Remove symlinks ──
// macOS codesign rejects bundles containing symlinks with invalid destinations.
// Standalone node_modules may contain symlinks from fixTurbopackHashedExternals
// or leftover from npm's hoisting. Remove them all — they're not needed at runtime
// since webpack already bundles everything, and standalone traces all required files.
// Keep the bundled Node.js directory intact: official npm/npx launchers are
// symlinks on POSIX platforms, and extractTarGzSafe already validates that tar
// symlink targets stay inside the Node extraction root.
const symlinkSkipRoots = [path.resolve(dest, 'node')];
function removeSymlinks(dir) {
  if (!existsSync(dir)) return;
  const resolvedDir = path.resolve(dir);
  if (symlinkSkipRoots.some((skipRoot) => resolvedDir === skipRoot || resolvedDir.startsWith(`${skipRoot}${path.sep}`))) {
    return 0;
  }
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const resolvedFull = path.resolve(full);
    if (symlinkSkipRoots.some((skipRoot) => resolvedFull === skipRoot || resolvedFull.startsWith(`${skipRoot}${path.sep}`))) {
      continue;
    }
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

const productManifest = JSON.parse(readFileSync(productPkg, 'utf-8'));
writeRuntimeManifest(dest, {
  productPkg: productManifest,
  packageName: '@geminilight/mindos-desktop-runtime',
  platform: `${targetNodePlatform}-${targetNodeArch}`,
  os: targetNodePlatform,
  cpu: targetNodeArch,
  layout: 'desktop-bundled',
});

console.log(`[prepare-mindos-runtime] OK → ${dest} (from ${source})`);
