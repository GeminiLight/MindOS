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
  createWriteStream, readFileSync, unlinkSync,
} from 'fs';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import https from 'https';
import http from 'http';
import semver from 'semver';
import { analyzeMindOsLayout } from './mindos-runtime-layout';

// ── Constants ──

// Manifest sources: a dedicated "runtime-latest" GitHub Release + CDN fallback.
// The "runtime-latest" release is updated by CI on every npm publish.
const MANIFEST_URLS = [
  'https://github.com/GeminiLight/MindOS/releases/download/runtime-latest/latest.json',
  'https://releases.mindos.com/runtime/latest.json',
];
const CONFIG_DIR = path.join(app.getPath('home'), '.mindos');
const RUNTIME_DIR = path.join(CONFIG_DIR, 'runtime');
const DOWNLOAD_DIR = path.join(CONFIG_DIR, 'runtime-downloading');
const OLD_DIR = path.join(CONFIG_DIR, 'runtime-old');
const TARBALL_PATH = path.join(CONFIG_DIR, 'runtime-download.tar.gz');
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

    const tryNext = () => {
      if (settled) return;
      if (urlIdx >= urlQueue.length) { settled = true; return reject(new Error('All download URLs failed')); }
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
          console.warn(`[CoreUpdater] ${url} → HTTP ${res.statusCode}, trying next`);
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
        file.on('error', (err) => { file.close(); if (!settled) { settled = true; reject(err); } });
        res.on('error', (err) => { file.close(); if (!settled) { settled = true; reject(err); } });
      });

      req.on('error', (err) => {
        console.warn(`[CoreUpdater] ${url} → ${err.message}, trying next`);
        tryNext();
      });
      req.on('timeout', () => {
        req.destroy();
        console.warn(`[CoreUpdater] ${url} → timeout, trying next`);
        tryNext();
      });

      const onAbort = () => { req.destroy(); if (!settled) { settled = true; reject(new Error('aborted')); } };
      signal.addEventListener('abort', onAbort, { once: true });
    };

    tryNext();
  });
}

/** Extract a tar.gz using system tar (available on macOS, Linux, Windows with Git). */
function extractTarGz(tarball: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['xzf', tarball, '-C', destDir], { timeout: 120_000 }, (err) => {
      if (err) reject(new Error(`tar extract failed: ${err.message}`));
      else resolve();
    });
  });
}

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

    // Clean up previous download attempts
    if (existsSync(DOWNLOAD_DIR)) rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
    if (existsSync(TARBALL_PATH)) try { unlinkSync(TARBALL_PATH); } catch { /* may not exist */ }
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
        throw new Error('Downloaded runtime is incomplete (missing server.js or mcp/dist)');
      }
      if (layout.version !== expectedVersion) {
        throw new Error(`Version mismatch: expected ${expectedVersion}, got ${layout.version}`);
      }
    } catch (err) {
      // Clean up on failure
      if (existsSync(DOWNLOAD_DIR)) rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
      if (existsSync(TARBALL_PATH)) try { unlinkSync(TARBALL_PATH); } catch { /* ignore */ }
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
   */
  apply(): string {
    if (!existsSync(DOWNLOAD_DIR)) {
      throw new Error('No downloaded runtime to apply (runtime-downloading/ missing)');
    }

    // Move old runtime out of the way
    if (existsSync(RUNTIME_DIR)) {
      if (existsSync(OLD_DIR)) rmSync(OLD_DIR, { recursive: true, force: true });
      renameSync(RUNTIME_DIR, OLD_DIR);
    }

    // Promote downloaded → current
    try {
      renameSync(DOWNLOAD_DIR, RUNTIME_DIR);
    } catch (err) {
      // Rollback: restore old runtime
      if (existsSync(OLD_DIR)) {
        try { renameSync(OLD_DIR, RUNTIME_DIR); } catch { /* double fault */ }
      }
      throw new Error(`Failed to apply update: ${err instanceof Error ? err.message : err}`);
    }

    // Clean up old (async, best-effort)
    if (existsSync(OLD_DIR)) {
      try { rmSync(OLD_DIR, { recursive: true, force: true }); } catch { /* non-critical */ }
    }

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
   */
  cleanupOnBoot(bundledVersion: string | null): void {
    // 1. Remove leftover runtime-old/ from a previous apply
    if (existsSync(OLD_DIR)) {
      try { rmSync(OLD_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
    }

    // 2. Remove cached runtime if bundled version is same or newer (Desktop was updated)
    if (bundledVersion && semver.valid(bundledVersion) && existsSync(RUNTIME_DIR)) {
      const cached = this.getCachedVersion();
      if (cached && semver.valid(cached) && semver.gte(bundledVersion, cached)) {
        console.info(`[CoreUpdater] Bundled v${bundledVersion} >= cached v${cached}, removing stale cache`);
        try { rmSync(RUNTIME_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }

    // 3. Remove incomplete downloads (corrupted / interrupted)
    if (existsSync(DOWNLOAD_DIR)) {
      const layout = analyzeMindOsLayout(DOWNLOAD_DIR);
      if (!layout.runnable) {
        console.info('[CoreUpdater] Removing incomplete download');
        try { rmSync(DOWNLOAD_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
      // If runnable, keep it — UI will show "ready to apply"
    }

    // 4. Remove leftover tarball
    if (existsSync(TARBALL_PATH)) {
      try { unlinkSync(TARBALL_PATH); } catch { /* best-effort */ }
    }
  }
}
