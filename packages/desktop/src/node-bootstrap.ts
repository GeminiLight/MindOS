/**
 * Node.js Bootstrap — auto-download a private Node.js runtime for MindOS.
 *
 * When no system Node.js is found, downloads the official binary to
 * ~/.mindos/node/ and uses it exclusively for MindOS operations.
 * Does NOT touch system PATH or interfere with nvm/fnm.
 *
 * Platform support: macOS (arm64/x64), Linux (x64), Windows (arm64/x64).
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync, statSync, readFileSync, writeFileSync, symlinkSync, type WriteStream } from 'fs';
import { rm } from 'fs/promises';
import { execFileSync, spawn } from 'child_process';
import path from 'path';
import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import { gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import { getDesktopConfigDir } from './desktop-home';
import { isNodeVersionAcceptable } from './node-version';
import nodeRuntimeManifest from '../node-runtime-manifest.json';

// Node.js LTS version to download (also used by prepare-mindos-runtime to bundle Node)
export const NODE_VERSION = nodeRuntimeManifest.version;
const NODE_DOWNLOAD_SHA256: Record<string, string> = nodeRuntimeManifest.sha256;

const IS_WIN = process.platform === 'win32';
const PATH_SEP = IS_WIN ? ';' : ':';

function getMindosDir(): string {
  return getDesktopConfigDir();
}

function getNodeDir(): string {
  return path.join(getMindosDir(), 'node');
}

function needsWindowsShell(command: string): boolean {
  return IS_WIN && /\.(?:cmd|bat)$/i.test(command);
}

function forceTerminateProcessTree(proc: ReturnType<typeof spawn>): void {
  try {
    if (IS_WIN && proc.pid) {
      spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      proc.kill();
      return;
    }
    if (proc.pid) {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* process may not own a group */ }
    }
    if (IS_WIN) proc.kill();
    else proc.kill('SIGKILL');
  } catch { /* already exited */ }
}

/** Path to the bundled Node.js shipped inside the packaged app (resources/mindos-runtime/node/) */
export function getBundledNodePath(): string {
  // In dev mode, process.resourcesPath still exists (Electron provides it),
  // but mindos-runtime/node/ won't be there — existsSync will return false.
  const base = path.join(process.resourcesPath, 'mindos-runtime', 'node');
  if (process.platform === 'win32') return path.join(base, 'node.exe');
  return path.join(base, 'bin', 'node');
}

/** Check if bundled Node.js exists in the packaged app */
export function isBundledNodeInstalled(): boolean {
  return existsSync(getBundledNodePath());
}

/** Path to the private node binary (may not exist yet) */
export function getPrivateNodePath(): string {
  const nodeDir = getNodeDir();
  if (process.platform === 'win32') {
    return path.join(nodeDir, 'node.exe');
  }
  return path.join(nodeDir, 'bin', 'node');
}

/** Check if private Node.js is already installed */
export function isPrivateNodeInstalled(): boolean {
  return existsSync(getPrivateNodePath());
}

/** Check that an existing private runtime satisfies the current Pi baseline. */
export function isPrivateNodeCompatible(): boolean {
  const nodePath = getPrivateNodePath();
  if (!existsSync(nodePath)) return false;
  try {
    const version = execFileSync(nodePath, ['--version'], { encoding: 'utf-8', timeout: 3000 }).trim();
    return isNodeVersionAcceptable(version);
  } catch {
    return false;
  }
}

/** Resolve the download URL for the current platform */
function getDownloadUrl(): { url: string; mirrorUrl: string; file: string; format: 'tar.gz' | 'zip' } {
  const plat = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  // China mirror: npmmirror.com hosts official Node.js binaries
  const OFFICIAL_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const MIRROR_BASE = `https://npmmirror.com/mirrors/node/v${NODE_VERSION}`;

  if (plat === 'darwin') {
    const file = `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
    return { url: `${OFFICIAL_BASE}/${file}`, mirrorUrl: `${MIRROR_BASE}/${file}`, file, format: 'tar.gz' };
  }
  if (plat === 'linux') {
    const file = `node-v${NODE_VERSION}-linux-${arch}.tar.gz`;
    return { url: `${OFFICIAL_BASE}/${file}`, mirrorUrl: `${MIRROR_BASE}/${file}`, file, format: 'tar.gz' };
  }
  const file = `node-v${NODE_VERSION}-win-${arch}.zip`;
  return { url: `${OFFICIAL_BASE}/${file}`, mirrorUrl: `${MIRROR_BASE}/${file}`, file, format: 'zip' };
}

/**
 * Download Node.js to ~/.mindos/node/.
 * Calls onProgress with percentage (0-100) during download.
 * Returns the path to the node binary.
 */
export async function downloadNode(
  onProgress?: (percent: number, status: string) => void,
): Promise<string> {
  if (isPrivateNodeCompatible()) {
    return getPrivateNodePath();
  }

  const { url, mirrorUrl, file, format } = getDownloadUrl();
  const mindosDir = getMindosDir();
  const nodeDir = getNodeDir();
  const tmpDir = path.join(mindosDir, 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  const tmpFile = path.join(tmpDir, `node.${format}`);

  // 1. Download — try official URL first, fall back to China mirror on failure/timeout
  onProgress?.(0, 'downloading');
  try {
    await downloadFile(url, tmpFile, (percent) => {
      onProgress?.(Math.round(percent * 0.8), 'downloading');
    }, 30000); // 30s timeout for official — fail fast if blocked
    verifyNodeArchiveSha256(tmpFile, file);
  } catch (primaryErr) {
    console.warn(`[MindOS] Official Node.js download failed (${primaryErr instanceof Error ? primaryErr.message : primaryErr}), trying mirror...`);
    try { await rm(tmpFile, { force: true }); } catch { /* best effort */ }
    onProgress?.(0, 'downloading');
    await downloadFile(mirrorUrl, tmpFile, (percent) => {
      onProgress?.(Math.round(percent * 0.8), 'downloading');
    }, 600_000); // mirror is the last resort — generous 10min bound (vs 30s fail-fast for official) so a stalled mirror cannot hang first-run bootstrap forever
    verifyNodeArchiveSha256(tmpFile, file);
  }

  // 2. Extract (using spawn with argument arrays — no shell injection)
  onProgress?.(80, 'extracting');
  // Keep an old private runtime available while downloading. Replace it only
  // after a verified archive is ready, and remove all stale files before extraction.
  await rm(nodeDir, { recursive: true, force: true });
  mkdirSync(nodeDir, { recursive: true });
  if (format === 'tar.gz') {
    extractTarGzSafe(tmpFile, nodeDir, 1);
  } else {
    // Windows: PowerShell extract — use -NoProfile and -ExecutionPolicy Bypass
    // to avoid user profile interference and restrictive execution policies.
    // Use -LiteralPath with single-quotes (escape embedded single-quotes by doubling)
    // to prevent PowerShell variable interpolation on paths containing $.
    const psTmpFile = tmpFile.replace(/'/g, "''");
    const psExtractDir = path.join(tmpDir, 'node-extract').replace(/'/g, "''");
    await spawnAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${psTmpFile}' -DestinationPath '${psExtractDir}' -Force`,
    ], 120000);
    // Find extracted folder name and copy contents using Node.js API (xcopy is deprecated)
    const extractDir = path.join(tmpDir, 'node-extract');
    const entries = require('fs').readdirSync(extractDir);
    const nodeFolder = entries.find((e: string) => e.startsWith('node-'));
    if (nodeFolder) {
      const { cpSync: cpSyncFn } = require('fs');
      cpSyncFn(path.join(extractDir, nodeFolder), nodeDir, { recursive: true });
    }
  }

  // 3. Verify
  const nodeBin = getPrivateNodePath();
  if (!existsSync(nodeBin) || !isPrivateNodeCompatible()) {
    throw new Error(`Node.js extraction failed — ${nodeBin} is missing or below the required version`);
  }

  // Ensure executable permission (macOS/Linux)
  if (process.platform !== 'win32') {
    chmodSync(nodeBin, 0o755);
    // Remove macOS quarantine attribute — Gatekeeper may silently kill quarantined binaries
    // spawned as child processes, causing the 120s health-check timeout.
    if (process.platform === 'darwin') {
      removeMacQuarantineAttribute(nodeDir);
    }
  }

  // 4. Cleanup temp
  try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* non-critical */ }

  onProgress?.(100, 'done');
  return nodeBin;
}

function extractTarGzSafe(tarPath: string, destDir: string, stripComponents = 0): void {
  const tar = gunzipSync(readFileSync(tarPath));
  let offset = 0;
  let longName: string | null = null;

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
    if (dataEnd > tar.length) throw new Error('Invalid Node.js tar entry size');

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
      if (process.platform !== 'win32') chmodSync(entryPath, mode & 0o777);
    } else if (isSymlink && process.platform !== 'win32') {
      const safeLinkName = resolveTarSymlinkTarget(destDir, entryPath, linkName);
      mkdirSync(path.dirname(entryPath), { recursive: true });
      symlinkSync(safeLinkName, entryPath);
    }

    offset += paddedSize;
  }
}

function stripTarEntryPath(entryName: string, stripComponents: number): string {
  const normalizedEntry = entryName.replaceAll('\\', '/');
  if (normalizedEntry.startsWith('/') || normalizedEntry.startsWith('//') || /^[A-Za-z]:/.test(normalizedEntry)) {
    throw new Error(`Node.js tar entry outside extraction directory: ${entryName}`);
  }
  const parts = normalizedEntry.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.includes('..')) {
    throw new Error(`Node.js tar entry outside extraction directory: ${entryName}`);
  }
  return parts.slice(stripComponents).join('/');
}

function resolveTarEntryPath(destDir: string, entryName: string): string {
  const root = path.resolve(destDir);
  const target = path.resolve(root, entryName);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Node.js tar entry outside extraction directory: ${entryName}`);
  }
  return target;
}

function resolveTarSymlinkTarget(destDir: string, entryPath: string, linkName: string): string {
  const normalizedLink = linkName.replaceAll('\\', '/');
  if (!normalizedLink || normalizedLink.startsWith('/') || normalizedLink.startsWith('//') || /^[A-Za-z]:/.test(normalizedLink)) {
    throw new Error(`Node.js tar symlink outside extraction directory: ${linkName}`);
  }
  const root = path.resolve(destDir);
  const target = path.resolve(path.dirname(entryPath), normalizedLink);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Node.js tar symlink outside extraction directory: ${linkName}`);
  }
  return normalizedLink;
}

function readTarString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? length : nul).toString('utf-8');
}

function readTarOctal(buffer: Buffer, offset: number, length: number): number {
  const raw = readTarString(buffer, offset, length).trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw.replace(/\0/g, ''), 8);
  if (!Number.isFinite(parsed)) throw new Error('Invalid Node.js tar entry metadata');
  return parsed;
}

function readPaxPath(content: string): string | null {
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

function isZeroBlock(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte !== 0) return false;
  }
  return true;
}

type ExecFileSyncLike = (command: string, args: string[], options: { stdio: 'ignore' }) => unknown;

export function removeMacQuarantineAttribute(
  nodeDir = getNodeDir(),
  execFile: ExecFileSyncLike = execFileSync,
): void {
  try {
    execFile('xattr', ['-dr', 'com.apple.quarantine', nodeDir], { stdio: 'ignore' });
  } catch {
    // xattr may not exist or the attribute may already be absent.
  }
}

/**
 * Download a file via HTTPS with progress tracking.
 * Progress is tracked by monitoring bytes written to disk (not stream consumption).
 * @param timeoutMs — overall download timeout in ms (0 = no timeout, default)
 */
function downloadFile(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
  timeoutMs = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let settled = false;
    let overallTimer: ReturnType<typeof setTimeout> | null = null;
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let activeReq: ClientRequest | null = null;
    let activeRes: IncomingMessage | null = null;
    let activeFileStream: WriteStream | null = null;

    const cleanup = (destroyActive: boolean) => {
      if (progressInterval) clearInterval(progressInterval);
      progressInterval = null;
      if (overallTimer) { clearTimeout(overallTimer); overallTimer = null; }
      if (!destroyActive) return;
      // Stop all active I/O on timeout/error so fallback downloads cannot race
      // with a timed-out request still writing the same temp archive.
      if (activeRes && !activeRes.destroyed) activeRes.destroy();
      if (activeReq && !activeReq.destroyed) activeReq.destroy();
      if (activeFileStream && !activeFileStream.destroyed) activeFileStream.destroy();
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup(true);
      reject(err);
    };

    if (timeoutMs > 0) {
      overallTimer = setTimeout(() => {
        fail(new Error(`Download timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }

    const follow = (reqUrl: string) => {
      if (settled) return;
      if (++redirects > 5) {
        fail(new Error('Too many redirects'));
        return;
      }
      const req = https.get(reqUrl, (res) => {
        activeRes = res;
        if (settled) { res.resume(); return; }

        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location, reqUrl).toString();
          follow(nextUrl);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        const fileStream = createWriteStream(dest);
        activeFileStream = fileStream;
        let lastReportedPercent = 0;

        fileStream.on('error', (err) => { fail(err); });

        res.pipe(fileStream);

        // Track progress via periodic stat of the file
        progressInterval = totalBytes > 0 ? setInterval(() => {
          if (settled) return;
          try {
            const written = statSync(dest).size;
            const percent = (written / totalBytes) * 100;
            if (percent - lastReportedPercent >= 1) {
              lastReportedPercent = percent;
              onProgress?.(percent);
            }
          } catch { /* file may not exist yet */ }
        }, 200) : null;

        fileStream.on('finish', () => {
          if (settled) return;
          settled = true;
          cleanup(false);
          onProgress?.(100);
          resolve();
        });
      });
      activeReq = req;
      // Socket inactivity timeout: a silently stalled connection must fail even
      // when no overall timer was requested. Applied to every request in the
      // redirect chain; only the request that is still active may fail the
      // download — stale redirect sockets idling out are just destroyed.
      req.setTimeout(60_000, () => {
        if (activeReq === req) {
          fail(new Error('Download stalled (no data for 60s)'));
        } else if (!req.destroyed) {
          req.destroy();
        }
      });
      req.on('error', (err) => { fail(err); });
    };

    follow(url);
  });
}

export const _downloadFile_forTest = downloadFile;
export const _extractTarGzSafe_forTest = extractTarGzSafe;
export const _verifyNodeArchiveSha256_forTest = verifyNodeArchiveSha256;

function verifyNodeArchiveSha256(filePath: string, fileName: string): void {
  const expected = NODE_DOWNLOAD_SHA256[fileName];
  if (!expected) {
    throw new Error(`No pinned SHA-256 checksum for Node.js archive ${fileName}`);
  }
  const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  if (actual !== expected) {
    throw new Error(`Node.js archive checksum mismatch for ${fileName}: expected ${expected}, got ${actual}`);
  }
}

/** Spawn a process and wait for exit. Rejects on non-zero exit or timeout. */
function spawnAsync(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'ignore',
      shell: needsWindowsShell(cmd),
      detached: !IS_WIN,
    });
    const timer = setTimeout(() => {
      forceTerminateProcessTree(proc);
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Install MindOS globally using the provided Node.js.
 * Equivalent to: npm install -g @geminilight/mindos
 */
export async function installMindosWithPrivateNode(
  nodePath: string,
  onProgress?: (status: string) => void,
): Promise<string> {
  const binDir = path.dirname(nodePath);
  const npmBin = path.join(binDir, IS_WIN ? 'npm.cmd' : 'npm');
  if (!existsSync(npmBin)) {
    throw new Error(`npm not found at ${npmBin}`);
  }

  onProgress?.('installing');

  // Use spawn with argument array. Windows npm.cmd is the only shell-backed path.
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(npmBin, ['install', '-g', '@geminilight/mindos@latest'], {
      stdio: 'ignore',
      shell: needsWindowsShell(npmBin),
      detached: !IS_WIN,
      env: {
        ...process.env,
        PATH: `${binDir}${PATH_SEP}${process.env.PATH || ''}`,
      },
    });
    const timer = setTimeout(() => {
      forceTerminateProcessTree(proc);
      reject(new Error('npm install timed out after 5 minutes'));
    }, 300000);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Verify installation by finding the global root
  const globalRoot = await new Promise<string>((resolve, reject) => {
    let out = '';
    const proc = spawn(npmBin, ['root', '-g'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: needsWindowsShell(npmBin),
      env: {
        ...process.env,
        PATH: `${binDir}${PATH_SEP}${process.env.PATH || ''}`,
      },
    });
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('exit', () => resolve(out.trim()));
    proc.on('error', reject);
  });

  const mindosPath = path.join(globalRoot, '@geminilight', 'mindos');
  if (!existsSync(mindosPath)) {
    throw new Error(`Installation completed but MindOS not found at ${mindosPath}`);
  }

  onProgress?.('done');
  return mindosPath;
}
