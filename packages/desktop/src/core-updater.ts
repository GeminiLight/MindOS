/**
 * Core Updater — downloads and applies MindOS Core runtime updates
 * without restarting the Electron shell.
 *
 * Flow:  check() → download() → apply()
 * Each step is independent; caller (main.ts) orchestrates.
 *
 * Network (core-update-fetch.ts) and archive extraction (core-update-tar.ts)
 * live in their own modules; this file keeps the update lifecycle, the lock,
 * and the on-disk swap.
 */
import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import {
  existsSync, mkdirSync, renameSync, rmSync,
  readFileSync, unlinkSync, writeFileSync,
  statSync, openSync, writeSync, closeSync,
} from 'fs';
import { createHash } from 'crypto';
import semver from 'semver';
import { analyzeMindOsLayout } from './mindos-runtime-layout';
import { assertNotSymlink, safeRmSync } from './safe-rm';
import { validateRuntimePath, getRuntimePaths } from './safe-paths';
import { URL_TIMEOUT, downloadFile, fetchWithFallback, isHttpsUrl } from './core-update-fetch';
import { extractTarGz } from './core-update-tar';

// Test hooks that lived here before the network and tar halves moved out.
export { _downloadFile_forTest, _fetchUrl_forTest } from './core-update-fetch';
export { _extractTarGz_forTest, _extractTarGzJs_forTest } from './core-update-tar';

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
