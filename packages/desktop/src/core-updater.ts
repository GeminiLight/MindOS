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
  existsSync, mkdirSync, renameSync, rmSync,
  createWriteStream, createReadStream, readFileSync, unlinkSync, writeFileSync,
  chmodSync, statSync, openSync, writeSync, closeSync,
  type WriteStream,
} from 'fs';
import { createHash } from 'crypto';
import { createGunzip } from 'zlib';
import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import semver from 'semver';
import { analyzeMindOsLayout } from './mindos-runtime-layout';
import { assertNotSymlink, safeRmSync } from './safe-rm';
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
        oldDir: OLD_DIR, tarballPath: TARBALL_PATH, lockPath: LOCK_PATH } = getRuntimePaths();

const URL_TIMEOUT = 8_000;
const MAX_REDIRECTS = 5;
const LOCK_STALE_MS = 10 * 60 * 1000;

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

/**
 * Only canonical `https://` URLs may be fetched. The manifest is the trust
 * root for the tarball sha256, and the tarball itself is executed code, so a
 * plain-http hop anywhere in the chain would let a network attacker swap both.
 */
function isHttpsUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('https://');
}

/**
 * Resolve an HTTP redirect Location against the current URL.
 * Rejects unbounded chains and any downgrade away from https — the manifest
 * fetched through this layer is the trust root for tarball sha256 integrity.
 */
function resolveRedirectTarget(baseUrl: string, location: string | string[] | undefined, redirectsLeft: number): string | Error {
  if (redirectsLeft <= 0) return new Error(`Too many redirects from ${baseUrl}`);
  const loc = Array.isArray(location) ? location[0] : location;
  if (!loc) return new Error(`Redirect without Location from ${baseUrl}`);
  let next: string;
  try {
    next = new URL(loc, baseUrl).toString();
  } catch {
    return new Error(`Invalid redirect location from ${baseUrl}`);
  }
  if (!next.startsWith('https:')) return new Error(`Refusing insecure redirect to ${next}`);
  return next;
}

/** Fetch a URL with timeout. Returns the body as string. */
function fetchUrl(url: string, timeoutMs: number, signal?: AbortSignal, redirectsLeft = MAX_REDIRECTS): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    if (!isHttpsUrl(url)) return reject(new Error(`Refusing non-https URL: ${url}`));

    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        // Follow redirect
        res.resume();
        const next = resolveRedirectTarget(url, res.headers.location, redirectsLeft);
        if (next instanceof Error) return reject(next);
        fetchUrl(next, timeoutMs, signal, redirectsLeft - 1).then(resolve, reject);
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
  const urlQueue: Array<{ url: string; redirectsLeft: number }> = urls.map((url) => ({ url, redirectsLeft: MAX_REDIRECTS }));
  return new Promise((resolve, reject) => {
    let urlIdx = 0;
    let settled = false;
    let lastErr: Error | undefined; // Track last error for better diagnostics
    let activeReq: ClientRequest | null = null;
    let activeRes: IncomingMessage | null = null;
    let activeFile: WriteStream | null = null;
    let activeAbortHandler: (() => void) | null = null;

    const cleanupAttempt = (destroyActive: boolean) => {
      if (activeAbortHandler) {
        signal.removeEventListener('abort', activeAbortHandler);
        activeAbortHandler = null;
      }
      if (destroyActive) {
        if (activeRes && !activeRes.destroyed) activeRes.destroy();
        if (activeReq && !activeReq.destroyed) activeReq.destroy();
        if (activeFile && !activeFile.destroyed) activeFile.destroy();
      }
      activeReq = null;
      activeRes = null;
      activeFile = null;
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupAttempt(true);
      reject(err);
    };

    const retryAfterAttemptFailure = (url: string, err: Error, req?: ClientRequest) => {
      if (req && activeReq !== req) return;
      lastErr = err;
      console.warn(`[CoreUpdater] ${url} → ${err.message}, trying next`);
      cleanupAttempt(true);
      tryNext();
    };

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

      const { url, redirectsLeft } = urlQueue[urlIdx++];
      if (!isHttpsUrl(url)) {
        // Treat like any other failed mirror: record, then try the next URL.
        retryAfterAttemptFailure(url, new Error(`Refusing non-https download URL: ${url}`));
        return;
      }

      let req: ClientRequest;
      req = https.get(url, { timeout: URL_TIMEOUT }, (res) => {
        activeRes = res;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          // Follow redirect — a refused/overlong redirect counts as this
          // URL's failure and falls through to the next fallback URL.
          res.resume();
          const next = resolveRedirectTarget(url, res.headers.location, redirectsLeft);
          if (next instanceof Error) {
            retryAfterAttemptFailure(url, next, req);
            return;
          }
          urlQueue.splice(urlIdx, 0, { url: next, redirectsLeft: redirectsLeft - 1 });
          cleanupAttempt(true);
          tryNext();
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          const msg = `HTTP ${res.statusCode}`;
          retryAfterAttemptFailure(url, new Error(msg), req);
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10) || expectedSize;
        let transferred = 0;
        const file = createWriteStream(destPath);
        activeFile = file;

        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          onProgress({
            percent: total > 0 ? Math.round((transferred / total) * 100) : 0,
            transferred,
            total,
          });
        });

        res.pipe(file);
        file.on('finish', () => {
          if (activeFile !== file) return;
          file.close();
          if (!settled) {
            settled = true;
            cleanupAttempt(false);
            resolve();
          }
        });
        file.on('error', (err) => { 
          if (activeFile !== file) return;
          file.close(); 
          fail(err);
        });
        res.on('error', (err) => { 
          if (activeRes !== res) return;
          file.close(); 
          fail(err);
        });
      });
      activeReq = req;

      req.on('error', (err) => {
        retryAfterAttemptFailure(url, err instanceof Error ? err : new Error(String(err)), req);
      });
      req.on('timeout', () => {
        retryAfterAttemptFailure(url, new Error('timeout'), req);
      });

      activeAbortHandler = () => { fail(new Error('aborted')); };
      signal.addEventListener('abort', activeAbortHandler, { once: true });
    };

    tryNext();
  });
}

export const _downloadFile_forTest = downloadFile;
export const _fetchUrl_forTest = fetchUrl;

/**
 * Extract a tar.gz archive.
 *
 * Uses a pure-JS implementation (Node zlib + minimal tar parser) on every
 * platform so traversal rejection and long-path handling stay consistent.
 */
function extractTarGz(tarball: string, destDir: string): Promise<void> {
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
    const mode = parseInt(readTarString(header, 100, 8), 8) || 0;
    const sizeOctal = readTarString(header, 124, 12);
    const typeflag = header[156];
    const prefix = readTarString(header, 345, 155);

    const fileSize = parseInt(sizeOctal, 8) || 0;
    if (offset + fileSize > buf.length) {
      throw new Error('Truncated tar archive: entry data exceeds archive size');
    }

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
    if (typeflag === 0x78) {
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
    if (typeflag === 0x67) {
      offset += dataBlocks;
      continue;
    }

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

    // typeflag '1' = hardlink, '2' = symlink. Runtime archives are built
    // symlink-free (scripts/build-runtime-archive.sh), so a link entry means a
    // corrupt or tampered archive — fail loudly instead of writing an empty file.
    if (typeflag === 0x31 || typeflag === 0x32) {
      throw new Error(`Unsupported tar link entry (typeflag '${String.fromCharCode(typeflag)}'): ${entryName}`);
    }

    // Resolve path, reject archive traversal, then apply Windows long-path prefix.
    const entryPath = resolveTarEntryPath(destDir, entryName);

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
      if (process.platform !== 'win32' && mode) chmodSync(entryPath, mode & 0o777); // preserve executable bits; Windows has no chmod semantics
    }

    offset += dataBlocks;
  }
}

function resolveTarEntryPath(destDir: string, entryName: string): string {
  const normalizedEntryName = entryName.replace(/\\/g, '/');
  if (
    path.posix.isAbsolute(normalizedEntryName)
    || path.win32.isAbsolute(entryName)
    || path.win32.isAbsolute(normalizedEntryName)
    || hasWindowsDrivePrefix(entryName)
    || hasWindowsDrivePrefix(normalizedEntryName)
    || normalizedEntryName.split('/').includes('..')
  ) {
    throw new Error(`Tar entry outside extraction directory: ${entryName}`);
  }

  const destResolved = path.resolve(destDir);
  const entryPath = path.resolve(destResolved, normalizedEntryName);
  const relativeEntry = path.relative(destResolved, entryPath);
  if (
    relativeEntry === '..'
    || relativeEntry.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeEntry)
  ) {
    throw new Error(`Tar entry outside extraction directory: ${entryName}`);
  }

  return winLongPath(entryPath);
}

function hasWindowsDrivePrefix(filePath: string): boolean {
  return /^[A-Za-z]:/.test(filePath);
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
export {
  extractTarGz as _extractTarGz_forTest,
  extractTarGzJs as _extractTarGzJs_forTest,
};

// ── Update lock ──

/** Thrown when another MindOS instance is already running an update operation. */
export class CoreUpdateInProgressError extends Error {
  readonly code = 'CORE_UPDATE_IN_PROGRESS';
  constructor(detail: string) {
    super(`Another update is in progress (${detail})`);
    this.name = 'CoreUpdateInProgressError';
  }
}

function isLockHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid exists but belongs to another user — treat as alive.
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function isLockStale(lockPath: string): boolean {
  let pid: number | undefined;
  let createdAt: number | undefined;
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf-8')) as Record<string, unknown>;
    if (typeof raw.pid === 'number') pid = raw.pid;
    if (typeof raw.createdAt === 'number') createdAt = raw.createdAt;
  } catch {
    // Corrupt or vanished lock — fall through to age checks below.
  }
  // A live holder is never stale, no matter how old the lock is (downloads can
  // legitimately exceed the stale window on slow connections).
  if (pid !== undefined && pid > 0) return !isLockHolderAlive(pid);
  if (createdAt !== undefined) return Date.now() - createdAt > LOCK_STALE_MS;
  try {
    return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
  } catch {
    return true; // lock vanished — safe to retry acquisition
  }
}

/**
 * Advisory cross-process lock around download/apply/cleanup. Two app
 * instances share ~/.mindos — without this, one instance's cleanup can
 * delete the runtime another instance is serving from.
 */
function acquireUpdateLock(operation: string): () => void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, operation, createdAt: Date.now() }));
      } finally {
        closeSync(fd);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try { unlinkSync(LOCK_PATH); } catch { /* already gone */ }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (attempt === 0 && isLockStale(LOCK_PATH)) {
        try { unlinkSync(LOCK_PATH); } catch { /* lost a reclaim race */ }
        continue;
      }
      throw new CoreUpdateInProgressError(`lock held at ${LOCK_PATH}`);
    }
  }
  throw new CoreUpdateInProgressError(`lock held at ${LOCK_PATH}`);
}

// ── Rename retry ──

/** Synchronous sleep — apply() must stay synchronous (main.ts restarts services right after it returns). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * renameSync with retry/backoff: antivirus/indexers on Windows can hold
 * transient handles on runtime files right after child processes exit.
 */
function renameWithRetrySync(
  from: string,
  to: string,
  opts: { attempts?: number; delayMs?: number; rename?: typeof renameSync; sleep?: (ms: number) => void } = {},
): void {
  const { attempts = 3, delayMs = 300, rename = renameSync, sleep = sleepSync } = opts;
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= attempts || !TRANSIENT_RENAME_CODES.has(code)) throw err;
      console.warn(`[CoreUpdater] rename failed with ${code}, retrying (${attempt}/${attempts}): ${from} → ${to}`);
      sleep(delayMs);
    }
  }
}
export { renameWithRetrySync as _renameWithRetrySync_forTest };

export interface CoreDownloadRequest {
  urls: string[];
  version: string;
  size: number;
  sha256: string;
}

/**
 * Turn a renderer `download-core-update` invocation into a download request.
 *
 * The renderer only names the version it wants; urls, size and sha256 come from
 * the manifest cached by the last `check()` in the main process. Trusting a
 * renderer-supplied url/hash pair would let a compromised page point the
 * updater at any tarball and supply a matching hash for it.
 *
 * Accepts the new `(version)` shape and the legacy `(urls, version, size,
 * sha256)` shape; in the legacy shape everything except `version` is ignored.
 */
export function resolveCoreDownloadRequest(
  args: readonly unknown[],
  lastCheck: CoreUpdateInfo | null,
): CoreDownloadRequest {
  const requested = args.length >= 2 && Array.isArray(args[0]) ? args[1] : args[0];
  if (typeof requested !== 'string' || !requested.trim() || requested !== requested.trim()) {
    throw new Error('Invalid core update version');
  }
  if (!lastCheck) throw new Error('No core update check has completed yet — run check() first');
  if (!lastCheck.available) throw new Error('No core update is available');
  if (lastCheck.latestVersion !== requested) {
    throw new Error(`Core version ${requested} was not offered by the last update check (${lastCheck.latestVersion || 'none'})`);
  }
  if (!Array.isArray(lastCheck.urls) || lastCheck.urls.length === 0) {
    throw new Error('Update manifest has no download URLs');
  }
  if (!lastCheck.urls.every(isHttpsUrl)) {
    throw new Error('Update manifest contains a non-https download URL');
  }
  if (typeof lastCheck.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(lastCheck.sha256)) {
    throw new Error('Update manifest has an invalid SHA-256');
  }
  if (typeof lastCheck.size !== 'number' || !Number.isFinite(lastCheck.size) || lastCheck.size <= 0) {
    throw new Error('Update manifest has an invalid size');
  }
  return { urls: [...lastCheck.urls], version: requested, size: lastCheck.size, sha256: lastCheck.sha256 };
}

// ── CoreUpdater ──

export class CoreUpdater extends EventEmitter {
  private abortController: AbortController | null = null;
  /** Result of the most recent check(); the only source of truth for download urls/sha256. */
  private lastCheck: CoreUpdateInfo | null = null;

  getLastCheck(): CoreUpdateInfo | null {
    return this.lastCheck;
  }

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

    const info: CoreUpdateInfo = {
      available,
      currentVersion,
      latestVersion,
      urls,
      size: typeof data.size === 'number' ? data.size : 0,
      sha256: typeof data.sha256 === 'string' ? data.sha256 : '',
      minDesktopVersion: minDesktop,
      desktopTooOld: !!(semver.valid(minDesktop) && semver.gt(minDesktop, app.getVersion())),
    };
    this.lastCheck = info;
    return info;
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
    if (!/^[0-9a-fA-F]{64}$/.test(expectedSha256)) {
      throw new Error('Refusing download: expectedSha256 must be a 64-char hex string');
    }

    // Abort any in-flight download before starting a new one
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    const releaseLock = acquireUpdateLock('download');
    try {
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

        // Size verification — cheaper than hashing, so check first
        const actualSize = statSync(TARBALL_PATH).size;
        if (expectedSize > 0 && actualSize !== expectedSize) {
          throw new Error(`Size mismatch: expected ${expectedSize} bytes, got ${actualSize}`);
        }

        // SHA256 verification
        const hash = createHash('sha256');
        const fileData = readFileSync(TARBALL_PATH);
        hash.update(fileData);
        const actual = hash.digest('hex');
        if (actual !== expectedSha256) {
          throw new Error(`SHA256 mismatch: expected ${expectedSha256.slice(0, 12)}..., got ${actual.slice(0, 12)}...`);
        }

        // Extract (flat — archive was packed without outer directory)
        await extractTarGz(TARBALL_PATH, DOWNLOAD_DIR);

        // Clean up tarball
        if (existsSync(TARBALL_PATH)) unlinkSync(TARBALL_PATH);

        // Validate extracted content
        const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
        if (!layout.runnable) {
          throw new Error('Downloaded runtime is incomplete (missing packages/web server.js or dist/protocols/mcp-server)');
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
    } finally {
      releaseLock();
    }
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
  apply(currentVersion?: string | null): string {
    const releaseLock = acquireUpdateLock('apply');
    try {
      return this.applyLocked(currentVersion);
    } finally {
      releaseLock();
    }
  }

  private applyLocked(currentVersion?: string | null): string {
    // Defense-in-depth: every directory we rename or delete must be a
    // whitelisted ~/.mindos path.
    validateRuntimePath(RUNTIME_DIR);
    validateRuntimePath(DOWNLOAD_DIR);
    validateRuntimePath(OLD_DIR);

    // ✅ Pre-condition: Downloaded runtime must exist
    if (!existsSync(DOWNLOAD_DIR)) {
      throw new Error('No downloaded runtime to apply (runtime-downloading/ missing)');
    }

    // ✅ Security Check 1: Validate downloaded runtime is complete
    const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
    if (!layout.runnable) {
      throw new Error('Downloaded runtime is incomplete or corrupted, refusing to apply');
    }

    // ✅ Never downgrade: a leftover download from before a Desktop upgrade
    // (or reinstall) must not replace a same-or-newer runtime.
    const current = currentVersion ?? this.getCachedVersion();
    if (
      current && layout.version &&
      semver.valid(current) && semver.valid(layout.version) &&
      !semver.gt(layout.version, current)
    ) {
      safeRmSync(DOWNLOAD_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
      throw new Error(`Pending runtime v${layout.version} is not newer than current v${current}; stale download discarded`);
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
          safeRmSync(OLD_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
        } catch (err) {
          console.warn(`[CoreUpdater] Warning: Failed to cleanup stale runtime-old: ${err}`);
          throw new Error(`Cannot proceed with update: stale backup exists at ${OLD_DIR}`);
        }
      }

      // Atomic rename: RUNTIME_DIR → OLD_DIR
      try {
        renameWithRetrySync(RUNTIME_DIR, OLD_DIR);
      } catch (err) {
        throw new Error(`Failed to backup current runtime: ${err}`);
      }
    }

    // ✅ Step 2: Promote new runtime (atomic rename)
    try {
      renameWithRetrySync(DOWNLOAD_DIR, RUNTIME_DIR);
    } catch (err) {
      // Rollback: Restore old runtime
      if (existsSync(OLD_DIR)) {
        try {
          renameWithRetrySync(OLD_DIR, RUNTIME_DIR);
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
          safeRmSync(OLD_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
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
   * Returns the version if ready and newer than the installed runtime,
   * null otherwise.
   */
  getPendingVersion(currentVersion?: string | null): string | null {
    if (!existsSync(DOWNLOAD_DIR)) return null;
    const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
    if (!layout.runnable) return null;
    const current = currentVersion ?? this.getCachedVersion();
    if (
      current && layout.version &&
      semver.valid(current) && semver.valid(layout.version) &&
      !semver.gt(layout.version, current)
    ) {
      return null; // pending download is stale — not an upgrade over what's installed
    }
    return layout.version;
  }

  /**
   * Clean up stale files on Desktop startup.
   * Must be called before resolveLocalMindOsProjectRoot().
   *
   * Security: Enhanced with symlink detection to prevent deletion attacks.
   * Never crashes or blocks startup: lock contention (or any lock acquisition
   * failure) just skips cleanup for this boot.
   */
  cleanupOnBoot(bundledVersion: string | null): void {
    let releaseLock: () => void;
    try {
      releaseLock = acquireUpdateLock('cleanup');
    } catch (err) {
      if (err instanceof CoreUpdateInProgressError) {
        console.warn('[CoreUpdater] Skipping boot cleanup: another instance is updating');
      } else {
        console.warn(`[CoreUpdater] Skipping boot cleanup: ${err instanceof Error ? err.message : err}`);
      }
      return;
    }
    try {
      this.cleanupOnBootLocked(bundledVersion);
    } finally {
      releaseLock();
    }
  }

  private cleanupOnBootLocked(bundledVersion: string | null): void {
    // 1. Remove leftover runtime-old/ from a previous apply
    if (existsSync(OLD_DIR)) {
      try {
        assertNotSymlink(OLD_DIR);
        safeRmSync(OLD_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
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
          safeRmSync(RUNTIME_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
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
            safeRmSync(RUNTIME_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
          }
        }
      } catch (err) {
        console.warn(`[CoreUpdater] Failed to cleanup cached runtime: ${err}`);
        // Non-critical, don't block startup
      }
    }

    // 3. Remove incomplete or stale downloads (corrupted / interrupted / not an upgrade)
    if (existsSync(DOWNLOAD_DIR)) {
      try {
        assertNotSymlink(DOWNLOAD_DIR);

        const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
        if (!layout.runnable) {
          console.info('[CoreUpdater] Removing incomplete download');
          safeRmSync(DOWNLOAD_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
        } else {
          // Runnable, but only keep it if it upgrades the newest runtime we
          // could boot with (bundled or cached) — UI will show "ready to apply"
          const candidates = [bundledVersion, this.getCachedVersion()]
            .filter((v): v is string => !!v && !!semver.valid(v));
          const baseline = candidates.length
            ? candidates.reduce((a, b) => (semver.gt(b, a) ? b : a))
            : null;
          if (baseline && layout.version && semver.valid(layout.version) && !semver.gt(layout.version, baseline)) {
            console.info(`[CoreUpdater] Removing stale pending download v${layout.version}`);
            safeRmSync(DOWNLOAD_DIR, { recursive: true, force: true, boundary: CONFIG_DIR });
          }
        }
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
