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

// Node.js LTS version to download
const NODE_VERSION = '22.16.0';

const MINDOS_DIR = path.join(app.getPath('home'), '.mindos');
const NODE_DIR = path.join(MINDOS_DIR, 'node');
const PATH_SEP = process.platform === 'win32' ? ';' : ':';

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
function getDownloadUrl(): { url: string; format: 'tar.gz' | 'zip' } {
  const plat = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  if (plat === 'darwin') {
    return { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${arch}.tar.gz`, format: 'tar.gz' };
  }
  if (plat === 'linux') {
    return { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.gz`, format: 'tar.gz' };
  }
  return { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-${arch}.zip`, format: 'zip' };
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

  const { url, format } = getDownloadUrl();
  const tmpDir = path.join(MINDOS_DIR, 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(NODE_DIR, { recursive: true });

  const tmpFile = path.join(tmpDir, `node.${format}`);

  // 1. Download
  onProgress?.(0, 'downloading');
  await downloadFile(url, tmpFile, (percent) => {
    onProgress?.(Math.round(percent * 0.8), 'downloading'); // 0-80%
  });

  // 2. Extract (using spawn with argument arrays — no shell injection)
  onProgress?.(80, 'extracting');
  if (format === 'tar.gz') {
    await spawnAsync('tar', ['xzf', tmpFile, '-C', NODE_DIR, '--strip-components=1'], 60000);
  } else {
    // Windows: PowerShell extract
    await spawnAsync('powershell', [
      '-Command',
      `Expand-Archive -Path '${tmpFile}' -DestinationPath '${path.join(tmpDir, 'node-extract')}' -Force`,
    ], 60000);
    // Find extracted folder name and move contents up
    const extractDir = path.join(tmpDir, 'node-extract');
    const entries = require('fs').readdirSync(extractDir);
    const nodeFolder = entries.find((e: string) => e.startsWith('node-'));
    if (nodeFolder) {
      await spawnAsync('xcopy', [
        path.join(extractDir, nodeFolder),
        NODE_DIR,
        '/E', '/Y', '/Q',
      ], 30000);
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
 */
function downloadFile(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (reqUrl: string) => {
      https.get(reqUrl, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        const fileStream = createWriteStream(dest);
        let lastReportedPercent = 0;

        fileStream.on('error', reject);

        res.pipe(fileStream);

        // Track progress via periodic stat of the file
        const progressInterval = totalBytes > 0 ? setInterval(() => {
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
          if (progressInterval) clearInterval(progressInterval);
          onProgress?.(100);
          resolve();
        });
      }).on('error', reject);
    };

    follow(url);
  });
}

/** Spawn a process and wait for exit. Rejects on non-zero exit or timeout. */
function spawnAsync(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
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
  const npmBin = path.join(binDir, 'npm');
  if (!existsSync(npmBin)) {
    throw new Error(`npm not found at ${npmBin}`);
  }

  onProgress?.('installing');

  // Use spawn with argument array (no shell, no injection risk)
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(npmBin, ['install', '-g', '@geminilight/mindos@latest'], {
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: `${binDir}${PATH_SEP}${process.env.PATH || ''}`,
      },
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
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
