/**
 * Node.js Bootstrap — auto-download a private Node.js runtime for MindOS.
 *
 * When no system Node.js is found, downloads the official binary to
 * ~/.mindos/node/ and uses it exclusively for MindOS operations.
 * Does NOT touch system PATH or interfere with nvm/fnm.
 *
 * Platform support: macOS (arm64/x64), Linux (x64), Windows (x64).
 */
import { app } from 'electron';
import { createWriteStream, existsSync, mkdirSync, chmodSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import https from 'https';

// Node.js LTS version to download (also used by prepare-mindos-runtime to bundle Node)
export const NODE_VERSION = '22.16.0';

const MINDOS_DIR = path.join(app.getPath('home'), '.mindos');
const NODE_DIR = path.join(MINDOS_DIR, 'node');
const IS_WIN = process.platform === 'win32';
const PATH_SEP = IS_WIN ? ';' : ':';

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
  if (process.platform === 'win32') {
    return path.join(NODE_DIR, 'node.exe');
  }
  return path.join(NODE_DIR, 'bin', 'node');
}

/** Check if private Node.js is already installed */
export function isPrivateNodeInstalled(): boolean {
  return existsSync(getPrivateNodePath());
}

/** Resolve the download URL for the current platform */
function getDownloadUrl(): { url: string; mirrorUrl: string; format: 'tar.gz' | 'zip' } {
  const plat = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  // China mirror: npmmirror.com hosts official Node.js binaries
  const OFFICIAL_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const MIRROR_BASE = `https://npmmirror.com/mirrors/node/v${NODE_VERSION}`;

  if (plat === 'darwin') {
    const file = `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
    return { url: `${OFFICIAL_BASE}/${file}`, mirrorUrl: `${MIRROR_BASE}/${file}`, format: 'tar.gz' };
  }
  if (plat === 'linux') {
    const file = `node-v${NODE_VERSION}-linux-${arch}.tar.gz`;
    return { url: `${OFFICIAL_BASE}/${file}`, mirrorUrl: `${MIRROR_BASE}/${file}`, format: 'tar.gz' };
  }
  const file = `node-v${NODE_VERSION}-win-${arch}.zip`;
  return { url: `${OFFICIAL_BASE}/${file}`, mirrorUrl: `${MIRROR_BASE}/${file}`, format: 'zip' };
}

/**
 * Download Node.js to ~/.mindos/node/.
 * Calls onProgress with percentage (0-100) during download.
 * Returns the path to the node binary.
 */
export async function downloadNode(
  onProgress?: (percent: number, status: string) => void,
): Promise<string> {
  if (isPrivateNodeInstalled()) {
    return getPrivateNodePath();
  }

  const { url, mirrorUrl, format } = getDownloadUrl();
  const tmpDir = path.join(MINDOS_DIR, 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(NODE_DIR, { recursive: true });

  const tmpFile = path.join(tmpDir, `node.${format}`);

  // 1. Download — try official URL first, fall back to China mirror on failure/timeout
  onProgress?.(0, 'downloading');
  try {
    await downloadFile(url, tmpFile, (percent) => {
      onProgress?.(Math.round(percent * 0.8), 'downloading');
    }, 30000); // 30s timeout for official — fail fast if blocked
  } catch (primaryErr) {
    console.warn(`[MindOS] Official Node.js download failed (${primaryErr instanceof Error ? primaryErr.message : primaryErr}), trying mirror...`);
    onProgress?.(0, 'downloading');
    await downloadFile(mirrorUrl, tmpFile, (percent) => {
      onProgress?.(Math.round(percent * 0.8), 'downloading');
    }); // default timeout for mirror
  }

  // 2. Extract (using spawn with argument arrays — no shell injection)
  onProgress?.(80, 'extracting');
  if (format === 'tar.gz') {
    await spawnAsync('tar', ['xzf', tmpFile, '-C', NODE_DIR, '--strip-components=1'], 60000);
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
      cpSyncFn(path.join(extractDir, nodeFolder), NODE_DIR, { recursive: true });
    }
  }

  // 3. Verify
  const nodeBin = getPrivateNodePath();
  if (!existsSync(nodeBin)) {
    throw new Error(`Node.js extraction failed — ${nodeBin} not found`);
  }

  // Ensure executable permission (macOS/Linux)
  if (process.platform !== 'win32') {
    chmodSync(nodeBin, 0o755);
    // Remove macOS quarantine attribute — Gatekeeper may silently kill quarantined binaries
    // spawned as child processes, causing the 120s health-check timeout.
    if (process.platform === 'darwin') {
      try {
        const { execSync } = require('child_process');
        execSync(`xattr -dr com.apple.quarantine "${NODE_DIR}"`, { stdio: 'ignore' });
      } catch { /* xattr may not exist or attribute already absent — safe to ignore */ }
    }
  }

  // 4. Cleanup temp
  try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* non-critical */ }

  onProgress?.(100, 'done');
  return nodeBin;
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

    const cleanup = (progressInterval: ReturnType<typeof setInterval> | null, res?: import('http').IncomingMessage) => {
      if (progressInterval) clearInterval(progressInterval);
      if (overallTimer) { clearTimeout(overallTimer); overallTimer = null; }
      // Destroy response stream to stop network I/O on timeout/error
      if (res && !res.destroyed) res.destroy();
    };

    const fail = (err: Error, res?: import('http').IncomingMessage) => {
      if (settled) return;
      settled = true;
      cleanup(null, res);
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
        if (settled) { res.resume(); return; }

        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`Download failed: HTTP ${res.statusCode}`), res);
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        const fileStream = createWriteStream(dest);
        let lastReportedPercent = 0;

        fileStream.on('error', (err) => { cleanup(null, res); fail(err, res); });

        res.pipe(fileStream);

        // Track progress via periodic stat of the file
        const progressInterval = totalBytes > 0 ? setInterval(() => {
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
          cleanup(progressInterval, res);
          if (settled) return;
          settled = true;
          onProgress?.(100);
          resolve();
        });
      });
      req.on('error', (err) => { fail(err); });
    };

    follow(url);
  });
}

/** Spawn a process and wait for exit. Rejects on non-zero exit or timeout. */
function spawnAsync(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // On Windows, .cmd/.bat files require shell:true for spawn to execute them.
    const proc = spawn(cmd, args, { stdio: 'ignore', shell: IS_WIN });
    const timer = setTimeout(() => {
      proc.kill(); // No signal arg — Node.js uses SIGTERM on Unix, TerminateProcess on Windows
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

  // Use spawn with argument array (no shell, no injection risk)
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(npmBin, ['install', '-g', '@geminilight/mindos@latest'], {
      stdio: 'ignore',
      shell: IS_WIN, // .cmd files require shell on Windows
      env: {
        ...process.env,
        PATH: `${binDir}${PATH_SEP}${process.env.PATH || ''}`,
      },
    });
    const timer = setTimeout(() => {
      proc.kill();
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
      shell: IS_WIN, // .cmd files require shell on Windows
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
