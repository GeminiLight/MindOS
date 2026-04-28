/**
 * Core Updater — downloads and applies MindOS Core runtime updates
 * without restarting the Electron shell.
 *
 * Flow:  check() → download() → apply()
 * Each step is independent; caller (main.ts) orchestrates.
 */
import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import {
  existsSync, mkdirSync, renameSync, rmSync, lstatSync,
  createWriteStream, createReadStream, readFileSync, unlinkSync, writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { createGunzip } from 'zlib';
import { execFile } from 'child_process';
import https from 'https';
import http from 'http';
import semver from 'semver';
import { analyzeMindOsLayout } from './mindos-runtime-layout';
import { assertNotSymlink, safeRmSync, isSymlink } from './safe-rm';
import { validateRuntimePath, getRuntimePaths } from './safe-paths';

// ── Constants ──

// Manifest sources: a dedicated "runtime-latest" GitHub Release + CDN fallback.
// The "runtime-latest" release is updated by CI on every npm publish.
const MANIFEST_URLS = [
  'https://github.com/GeminiLight/MindOS/releases/download/runtime-latest/latest.json',
  'https://releases.mindos.com/runtime/latest.json',
];

// Get paths safely
const { configDir: CONFIG_DIR, runtimeDir: RUNTIME_DIR, downloadDir: DOWNLOAD_DIR, 
        oldDir: OLD_DIR, tarballPath: TARBALL_PATH } = getRuntimePaths();

const URL_TIMEOUT = 8_000;

// ── Types ──

export interface CoreUpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  urls: string[];
  size: number;
  sha256: string;
  minDesktopVersion: string;
  desktopTooOld: boolean;
}

export interface CoreUpdateProgress {
  percent: number;
  transferred: number;
  total: number;
}

// ── Helpers ──

/** Fetch a URL with timeout. Returns the body as string. */
function fetchUrl(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    const transport = url.startsWith('https') ? https : http;
    const req = transport.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetchUrl(res.headers.location, timeoutMs, signal).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout: ${url}`)); });
    if (signal) {
      const onAbort = () => { req.destroy(); reject(new Error('aborted')); };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Try URLs in order, return first success. */
async function fetchWithFallback(urls: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  let lastErr: Error | undefined;
  for (const url of urls) {
    try {
      return await fetchUrl(url, timeoutMs, signal);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (signal?.aborted) throw lastErr;
    }
  }
  throw lastErr || new Error('No URLs provided');
}

/** Download a file with progress reporting. Tries URLs in order. */
function downloadFile(
  urls: readonly string[],
  destPath: string,
  expectedSize: number,
  signal: AbortSignal,
  onProgress: (p: CoreUpdateProgress) => void,
): Promise<void> {
  // Work on a copy to avoid mutating the caller's array (redirect insertions)
  const urlQueue = [...urls];
  return new Promise((resolve, reject) => {
    let urlIdx = 0;
    let settled = false;
    let lastErr: Error | undefined; // Track last error for better diagnostics

    const tryNext = () => {
      if (settled) return;
      if (urlIdx >= urlQueue.length) { 
        settled = true; 
        const msg = lastErr 
          ? `All download URLs failed: ${lastErr.message}` 
          : 'All download URLs failed';
        return reject(new Error(msg)); 
      }
      if (signal.aborted) { settled = true; return reject(new Error('aborted')); }

      const url = urlQueue[urlIdx++];
      const transport = url.startsWith('https') ? https : http;

      const req = transport.get(url, { timeout: URL_TIMEOUT }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect — insert into queue
          urlQueue.splice(urlIdx, 0, res.headers.location);
          res.resume();
          tryNext();
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          const msg = `HTTP ${res.statusCode}`;
          lastErr = new Error(msg);
          console.warn(`[CoreUpdater] ${url} → ${msg}, trying next`);
          tryNext();
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10) || expectedSize;
        let transferred = 0;
        const file = createWriteStream(destPath);

        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          onProgress({
            percent: total > 0 ? Math.round((transferred / total) * 100) : 0,
            transferred,
            total,
          });
        });

        res.pipe(file);
        file.on('finish', () => { file.close(); if (!settled) { settled = true; resolve(); } });
        file.on('error', (err) => { 
          file.close(); 
          if (!settled) { 
            settled = true; 
            reject(err); 
          } 
        });
        res.on('error', (err) => { 
          file.close(); 
          if (!settled) { 
            settled = true; 
            reject(err); 
          } 
        });
      });

      req.on('error', (err) => {
        lastErr = err instanceof Error ? err : new Error(String(err));
        console.warn(`[CoreUpdater] ${url} → ${lastErr.message}, trying next`);
        tryNext();
      });
      req.on('timeout', () => {
        req.destroy();
        lastErr = new Error('timeout');
        console.warn(`[CoreUpdater] ${url} → timeout, trying next`);
        tryNext();
      });

      const onAbort = () => { req.destroy(); if (!settled) { settled = true; reject(new Error('aborted')); } };
      signal.addEventListener('abort', onAbort, { once: true });
    };

    tryNext();
  });
}

/**
 * Extract a tar.gz archive.
 *
 * On macOS/Linux: uses system `tar` (fast, reliable).
 * On Windows: uses a pure-JS implementation (Node zlib + minimal tar parser)
 * because Windows' built-in bsdtar silently fails on long paths (>260 chars),
 * which is common in standalone node_modules trees like packages/web/.next/standalone/node_modules/...
 */
function extractTarGz(tarball: string, destDir: string): Promise<void> {
  if (process.platform !== 'win32') {
    // macOS / Linux — system tar is reliable
    return new Promise((resolve, reject) => {
      execFile('tar', ['xzf', tarball, '-C', destDir], { timeout: 120_000 }, (err) => {
        if (err) reject(new Error(`tar extract failed: ${err.message}`));
        else resolve();
      });
    });
  }
  // Windows — pure-JS extraction to avoid bsdtar long-path bugs
  return extractTarGzJs(tarball, destDir);
}

/**
 * Pure-JS tar.gz extraction using Node built-in zlib.
 * Handles both POSIX ustar and GNU tar formats (512-byte header blocks).
 * GNU tar uses @LongLink (typeflag 'L') / @LongName (typeflag 'K') extensions
 * for paths exceeding the 100-byte name field. POSIX pax uses typeflag 'x'.
 * Uses \\?\ long-path prefix on Windows to bypass 260-char limit.
 */
async function extractTarGzJs(tarball: string, destDir: string): Promise<void> {
  // Read & decompress the entire file into memory.
  // Runtime tarballs are ~32 MB compressed, ~125 MB decompressed — fits in memory.
  const buf = await decompressGzip(tarball);

  let offset = 0;
  // GNU long-name extensions: the next entry's name/link is stored in a preceding
  // pseudo-entry with typeflag 'L' (long name) or 'K' (long link target).
  let gnuLongName: string | null = null;
  let gnuLongLink: string | null = null;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    offset += 512;

    // Two consecutive zero blocks = end of archive
    if (header.every(b => b === 0)) break;

    // Parse tar header fields
    const nameRaw = readTarString(header, 0, 100);
    const sizeOctal = readTarString(header, 124, 12);
    const typeflag = header[156];
    const prefix = readTarString(header, 345, 155);

    const fileSize = parseInt(sizeOctal, 8) || 0;

    // Data blocks (rounded up to 512-byte boundary)
    const dataBlocks = Math.ceil(fileSize / 512) * 512;

    // ── GNU typeflag 'L' (0x4c): long file name for the next entry ──
    if (typeflag === 0x4c) {
      gnuLongName = buf.subarray(offset, offset + fileSize).toString('utf-8').replace(/\0+$/, '');
      offset += dataBlocks;
      continue;
    }

    // ── GNU typeflag 'K' (0x4b): long symlink target for the next entry ──
    if (typeflag === 0x4b) {
      gnuLongLink = buf.subarray(offset, offset + fileSize).toString('utf-8').replace(/\0+$/, '');
      offset += dataBlocks;
      continue;
    }

    // ── POSIX pax extended header (typeflag 'x' = 0x78): skip data, may set name ──
    if (typeflag === 0x78 || typeflag === 0x67) {
      // Parse pax headers to extract path if present
      const paxData = buf.subarray(offset, offset + fileSize).toString('utf-8');
      const pathMatch = paxData.match(/\d+ path=(.+)\n/);
      if (pathMatch) {
        gnuLongName = pathMatch[1];
      }
      offset += dataBlocks;
      continue;
    }

    // ── Global pax header (typeflag 'g' = 0x67) — skip ──
    // (already handled above alongside 'x')

    // Determine final entry name: GNU long name takes priority, then POSIX prefix+name
    let entryName: string;
    if (gnuLongName) {
      entryName = gnuLongName;
      gnuLongName = null; // Consumed — applies only to the immediately following entry
    } else {
      entryName = prefix ? `${prefix}/${nameRaw}` : nameRaw;
    }
    // Consume gnuLongLink (we don't create symlinks, but must reset state)
    gnuLongLink = null;

    if (!entryName || entryName === '.' || entryName === './') {
      offset += dataBlocks;
      continue;
    }

    // Resolve path and apply Windows long-path prefix
    const entryPath = winLongPath(path.join(destDir, entryName));

    // typeflag: '5' (0x35) = directory, '0' (0x30) or 0 (NUL) = regular file
    const isDir = typeflag === 0x35 || entryName.endsWith('/');

    if (isDir) {
      mkdirSync(entryPath, { recursive: true });
    } else {
      // Ensure parent directory exists
      const parentDir = path.dirname(entryPath);
      mkdirSync(parentDir, { recursive: true });

      // Write file content
      const content = buf.subarray(offset, offset + fileSize);
      writeFileSync(entryPath, content);
    }

    offset += dataBlocks;
  }
}

/** Decompress a .gz file into a Buffer using Node's built-in zlib. */
function decompressGzip(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const input = createReadStream(filePath);

    input.pipe(gunzip);
    gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks)));
    gunzip.on('error', (err) => reject(new Error(`gzip decompression failed: ${err.message}`)));
    input.on('error', (err) => reject(new Error(`reading tarball failed: ${err.message}`)));
  });
}

/** Read a NUL-terminated string from a tar header field. */
function readTarString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const nulIdx = slice.indexOf(0);
  return slice.subarray(0, nulIdx === -1 ? length : nulIdx).toString('utf-8');
}

/** On Windows, prefix absolute paths with \\?\ to support paths > 260 chars. */
function winLongPath(p: string): string {
  if (process.platform !== 'win32') return p;
  // Already prefixed, or is a relative/UNC path
  if (p.startsWith('\\\\?\\') || !path.isAbsolute(p)) return p;
  return `\\\\?\\${p}`;
}

/** Exported for testing. */
export { extractTarGzJs as _extractTarGzJs_forTest };

// ── CoreUpdater ──

export class CoreUpdater extends EventEmitter {
  private abortController: AbortController | null = null;

  /**
   * Check for available Core updates.
   * @param currentVersion — version of the currently running Core (from pick.version)
   */
  async check(currentVersion: string): Promise<CoreUpdateInfo> {
    const raw = await fetchWithFallback(
      MANIFEST_URLS.map(u => `${u}?t=${Date.now()}`),
      URL_TIMEOUT,
    );

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Invalid manifest JSON');
    }

    const latestVersion = typeof data.version === 'string' ? data.version : '';
    const minDesktop = typeof data.minDesktopVersion === 'string' ? data.minDesktopVersion : '0.0.0';

    const urls = Array.isArray(data.urls) ? data.urls as string[] : [];
    const available = !!(
      latestVersion &&
      urls.length > 0 &&
      semver.valid(latestVersion) &&
      semver.valid(currentVersion) &&
      semver.gt(latestVersion, currentVersion)
    );

    return {
      available,
      currentVersion,
      latestVersion,
      urls,
      size: typeof data.size === 'number' ? data.size : 0,
      sha256: typeof data.sha256 === 'string' ? data.sha256 : '',
      minDesktopVersion: minDesktop,
      desktopTooOld: !!(semver.valid(minDesktop) && semver.gt(minDesktop, app.getVersion())),
    };
  }

  /**
   * Download and extract a Core runtime update.
   * Does NOT replace the current runtime — call apply() separately.
   * Emits 'progress' events with { percent, transferred, total }.
   */
  async download(
    urls: string[],
    expectedVersion: string,
    expectedSize: number,
    expectedSha256: string,
  ): Promise<void> {
    // Abort any in-flight download before starting a new one
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clean up previous download attempts — CRITICAL: must ensure files are fully deleted
    // Use retry logic on Windows because antivirus may hold file locks momentarily
    if (existsSync(DOWNLOAD_DIR)) {
      console.info('[CoreUpdater] Removing previous download directory');
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
          break;
        } catch (err) {
          if (attempt < 2) {
            console.warn(`[CoreUpdater] Failed to remove download dir (attempt ${attempt + 1}/3): ${err instanceof Error ? err.message : err}`);
            await new Promise(r => setTimeout(r, 200));
          } else {
            console.warn(`[CoreUpdater] Could not remove download dir after 3 attempts, proceeding anyway`);
          }
        }
      }
    }
    
    // Delete tarball with retry — Windows may hold file lock momentarily
    if (existsSync(TARBALL_PATH)) {
      let deleted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          unlinkSync(TARBALL_PATH);
          deleted = true;
          console.info('[CoreUpdater] Deleted previous tarball');
          break;
        } catch (err) {
          if (attempt < 2) {
            console.warn(`[CoreUpdater] Failed to delete tarball (attempt ${attempt + 1}/3), retrying: ${err instanceof Error ? err.message : err}`);
            // Brief delay before retry (let any file locks release)
            await new Promise(r => setTimeout(r, 100));
          } else {
            console.warn(`[CoreUpdater] Could not delete previous tarball after 3 attempts: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
      if (!deleted) {
        // If we still can't delete it, at least warn but don't fail — downloadFile may overwrite it
        console.warn('[CoreUpdater] WARNING: Could not clean up old tarball — may cause issues if download is partial');
      }
    }
    
    mkdirSync(DOWNLOAD_DIR, { recursive: true });

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // Download
      await downloadFile(urls, TARBALL_PATH, expectedSize, signal, (p) => {
        this.emit('progress', p);
      });

      if (signal.aborted) throw new Error('aborted');

      // SHA256 verification
      if (expectedSha256) {
        const hash = createHash('sha256');
        const fileData = readFileSync(TARBALL_PATH);
        hash.update(fileData);
        const actual = hash.digest('hex');
        if (actual !== expectedSha256) {
          throw new Error(`SHA256 mismatch: expected ${expectedSha256.slice(0, 12)}..., got ${actual.slice(0, 12)}...`);
        }
      }

      // Extract (flat — archive was packed without outer directory)
      await extractTarGz(TARBALL_PATH, DOWNLOAD_DIR);

      // Clean up tarball
      if (existsSync(TARBALL_PATH)) unlinkSync(TARBALL_PATH);

      // Validate extracted content
      const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
      if (!layout.runnable) {
        throw new Error('Downloaded runtime is incomplete (missing packages/web server.js or packages/protocols/mcp-server/dist)');
      }
      if (layout.version !== expectedVersion) {
        throw new Error(`Version mismatch: expected ${expectedVersion}, got ${layout.version}`);
      }
    } catch (err) {
      // Clean up on failure
      if (existsSync(DOWNLOAD_DIR)) rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
      if (existsSync(TARBALL_PATH)) {
        try { unlinkSync(TARBALL_PATH); } catch (cleanupErr) { 
          console.warn('[CoreUpdater] Failed to clean up tarball after download error:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
        }
      }
      this.abortController = null;
      throw err;
    }

    this.abortController = null;
  }

  /** Cancel an in-progress download. */
  cancelDownload(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Atomically replace the cached runtime with the downloaded one.
   * Caller MUST stop ProcessManager before calling this (Windows file locks).
   * Returns the new runtime directory path.
   * 
   * Security: Uses symlink detection and atomic operations to prevent
   * data loss via path traversal or race conditions.
   */
  apply(): string {
    // ✅ Pre-condition: Downloaded runtime must exist
    if (!existsSync(DOWNLOAD_DIR)) {
      throw new Error('No downloaded runtime to apply (runtime-downloading/ missing)');
    }

    // ✅ Security Check 1: Validate downloaded runtime is complete
    const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
    if (!layout.runnable) {
      throw new Error('Downloaded runtime is incomplete or corrupted, refusing to apply');
    }

    // ✅ Security Check 2: Refuse to delete symlinks
    assertNotSymlink(CONFIG_DIR);
    assertNotSymlink(DOWNLOAD_DIR);
    if (existsSync(RUNTIME_DIR)) {
      assertNotSymlink(RUNTIME_DIR);
    }
    if (existsSync(OLD_DIR)) {
      assertNotSymlink(OLD_DIR);
    }

    // ✅ Security Check 3: Create user data guard file
    this.createUserDataGuard();

    // ✅ Step 1: Backup current runtime (atomic rename)
    if (existsSync(RUNTIME_DIR)) {
      // Clean up any stale old-dir first
      if (existsSync(OLD_DIR)) {
        try {
          assertNotSymlink(OLD_DIR);
          safeRmSync(OLD_DIR, { recursive: true, force: true });
        } catch (err) {
          console.warn(`[CoreUpdater] Warning: Failed to cleanup stale runtime-old: ${err}`);
          throw new Error(`Cannot proceed with update: stale backup exists at ${OLD_DIR}`);
        }
      }

      // Atomic rename: RUNTIME_DIR → OLD_DIR
      try {
        renameSync(RUNTIME_DIR, OLD_DIR);
      } catch (err) {
        throw new Error(`Failed to backup current runtime: ${err}`);
      }
    }

    // ✅ Step 2: Promote new runtime (atomic rename)
    try {
      renameSync(DOWNLOAD_DIR, RUNTIME_DIR);
    } catch (err) {
      // Rollback: Restore old runtime
      if (existsSync(OLD_DIR)) {
        try {
          renameSync(OLD_DIR, RUNTIME_DIR);
          console.warn('[CoreUpdater] Update failed, rolled back to previous version');
        } catch (rollbackErr) {
          console.error('[CoreUpdater] CRITICAL: Rollback also failed, system may be in inconsistent state');
          throw new Error(
            `Update failed AND rollback failed - manual intervention needed.\n` +
            `Failed: ${err}\nRollback error: ${rollbackErr}`
          );
        }
      }
      throw new Error(`Failed to apply update: ${err}`);
    }

    // ✅ Step 3: Clean up old runtime (async, non-blocking)
    // We do this in the background to avoid blocking the update completion
    setImmediate(() => {
      if (existsSync(OLD_DIR)) {
        try {
          assertNotSymlink(OLD_DIR);
          safeRmSync(OLD_DIR, { recursive: true, force: true });
          console.info('[CoreUpdater] Cleaned up old runtime backup');
        } catch (err) {
          console.warn(`[CoreUpdater] Non-critical: Failed to cleanup old runtime: ${err}`);
          // Non-critical failure - log but don't throw
        }
      }
    });

    return RUNTIME_DIR;
  }

  /** Read version from cached runtime, or null if not present. */
  getCachedVersion(): string | null {
    try {
      const pkg = JSON.parse(readFileSync(path.join(RUNTIME_DIR, 'package.json'), 'utf-8'));
      return typeof pkg.version === 'string' ? pkg.version : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a completed download is waiting to be applied.
   * Returns the version if ready, null otherwise.
   */
  getPendingVersion(): string | null {
    if (!existsSync(DOWNLOAD_DIR)) return null;
    const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
    return layout.runnable ? layout.version : null;
  }

  /**
   * Clean up stale files on Desktop startup.
   * Must be called before resolveLocalMindOsProjectRoot().
   * 
   * Security: Enhanced with symlink detection to prevent deletion attacks.
   */
  cleanupOnBoot(bundledVersion: string | null): void {
    // 1. Remove leftover runtime-old/ from a previous apply
    if (existsSync(OLD_DIR)) {
      try {
        assertNotSymlink(OLD_DIR);
        safeRmSync(OLD_DIR, { recursive: true, force: true });
        console.info('[CoreUpdater] Cleaned up leftover runtime-old/');
      } catch (err) {
        console.warn(`[CoreUpdater] Failed to cleanup runtime-old: ${err}`);
        // Don't block startup on this failure
      }
    }

    // 2. Remove cached runtime if it's incomplete, or if bundled version is same or newer
    if (existsSync(RUNTIME_DIR)) {
      try {
        // Security: Double-check it's not a symlink
        assertNotSymlink(RUNTIME_DIR);

        const layout = analyzeMindOsLayout(RUNTIME_DIR);
        if (!layout.runnable) {
          console.info('[CoreUpdater] Cached runtime is incomplete, removing stale cache');
          safeRmSync(RUNTIME_DIR, { recursive: true, force: true });
          return;
        }

        if (bundledVersion && semver.valid(bundledVersion)) {
          const cached = this.getCachedVersion();
          if (cached && semver.valid(cached) && semver.gte(bundledVersion, cached)) {
            // Additional safety: Verify this is a runtime directory
            const pkgPath = path.join(RUNTIME_DIR, 'package.json');
            if (!existsSync(pkgPath)) {
              console.warn('[CoreUpdater] runtime/ missing package.json, not removing');
              return;
            }

            console.info(`[CoreUpdater] Bundled v${bundledVersion} >= cached v${cached}, removing stale cache`);
            safeRmSync(RUNTIME_DIR, { recursive: true, force: true });
          }
        }
      } catch (err) {
        console.warn(`[CoreUpdater] Failed to cleanup cached runtime: ${err}`);
        // Non-critical, don't block startup
      }
    }

    // 3. Remove incomplete downloads (corrupted / interrupted)
    if (existsSync(DOWNLOAD_DIR)) {
      try {
        assertNotSymlink(DOWNLOAD_DIR);

        const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
        if (!layout.runnable) {
          console.info('[CoreUpdater] Removing incomplete download');
          safeRmSync(DOWNLOAD_DIR, { recursive: true, force: true });
        }
        // If runnable, keep it — UI will show "ready to apply"
      } catch (err) {
        console.warn(`[CoreUpdater] Failed to cleanup incomplete download: ${err}`);
      }
    }

    // 4. Remove leftover tarball
    if (existsSync(TARBALL_PATH)) {
      try {
        // Tarball is a file, safe to delete without special checks
        unlinkSync(TARBALL_PATH);
      } catch (err) {
        console.warn(`[CoreUpdater] Failed to cleanup tarball: ${err}`);
      }
    }
  }

  /**
   * Create a guard file marking user data directory.
   * Helps prevent accidental deletion of user files.
   */
  private createUserDataGuard(): void {
    const userDataGuardPath = path.join(CONFIG_DIR, '.mindos-guard');
    if (!existsSync(userDataGuardPath)) {
      try {
        writeFileSync(
          userDataGuardPath,
          JSON.stringify({
            created: new Date().toISOString(),
            version: '1.0',
            warning: 'This directory contains MindOS system files. Deletion may cause data loss.',
          }, null, 2),
          'utf-8'
        );
      } catch (err) {
        console.warn(`[CoreUpdater] Failed to create guard file: ${err}`);
        // Non-critical, continue anyway
      }
    }
  }
}
