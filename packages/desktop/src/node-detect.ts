/**
 * Node.js / MindOS detection utilities.
 * Extracted to avoid circular dependency between main.ts and connect-window.ts.
 *
 * KEY DESIGN: Electron packaged apps have a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
 * We CANNOT rely on `exec('npm ...')` or `exec('which node')` — they will fail.
 * Instead, we use filesystem-only checks first (instant), then shell fallbacks
 * with an enriched PATH that includes the discovered node's bin directory.
 */
import { app } from 'electron';
import { exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { getPrivateNodePath, isPrivateNodeInstalled, getBundledNodePath, isBundledNodeInstalled } from './node-bootstrap';
import { getAppConfigStore } from './app-config-store';

const IS_WIN = process.platform === 'win32';

const execAsync = promisify(exec);

const MIN_NODE_MAJOR = 18;

/**
 * Check if a node binary meets the minimum version requirement (>= 18).
 * Returns true if version is OK, false if too old or check fails.
 */
function checkNodeVersion(nodePath: string): boolean {
  try {
    const ver = execFileSync(nodePath, ['--version'], { encoding: 'utf-8', timeout: 3000 }).trim();
    // ver looks like "v22.16.0"
    const match = ver.match(/^v(\d+)\./);
    if (!match) return false;
    return parseInt(match[1], 10) >= MIN_NODE_MAJOR;
  } catch {
    return false;
  }
}

/**
 * Check if a version directory name (e.g. "v22.16.0") meets requirements.
 * Rejects versions below MIN_NODE_MAJOR and pre-release versions (nightly/rc/alpha/beta).
 */
function isVersionDirAcceptable(ver: string): boolean {
  const match = ver.match(/^v(\d+)\./);
  if (!match) return false;
  if (parseInt(match[1], 10) < MIN_NODE_MAJOR) return false;
  // Reject pre-release: v23.0.0-nightly, v22.0.0-rc.1, etc.
  if (ver.includes('-')) return false;
  return true;
}

/** Build an enriched PATH that includes common Node.js bin directories */
function enrichedPath(extraBinDir?: string): string {
  const home = app.getPath('home');
  const dirs = [
    extraBinDir,
    path.join(home, '.mindos', 'bin'),           // MindOS CLI shim
    path.join(home, '.mindos', 'node', 'bin'),    // Private MindOS Node.js
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    `${home}/.nvm/current/bin`,
    `${home}/.local/bin`,
    process.env.PATH,
  ].filter(Boolean);
  return dirs.join(path.delimiter);
}

/** Run a shell command with enriched PATH */
async function execWithPath(cmd: string, opts: { timeout?: number; cwd?: string; extraBinDir?: string } = {}): Promise<string> {
  const { stdout } = await execAsync(cmd, {
    timeout: opts.timeout ?? 5000,
    encoding: 'utf-8',
    cwd: opts.cwd,
    env: { ...process.env, PATH: enrichedPath(opts.extraBinDir) },
  });
  return stdout.trim();
}

/**
 * Resolve the absolute path to node binary.
 * Fast checks (fs only) run first, slow checks (shell spawn) run last.
 */
export async function getNodePath(): Promise<string | null> {
  const home = app.getPath('home');

  // 0a. Bundled Node.js shipped with the Desktop app (highest priority — zero download)
  if (isBundledNodeInstalled()) {
    return getBundledNodePath();
  }

  // 0b. MindOS private Node.js (~/.mindos/node/) — downloaded on first run of older versions
  if (isPrivateNodeInstalled()) {
    return getPrivateNodePath();
  }

  // 0c. Cached path from previous startup — avoids expensive shell detection on every launch
  try {
    const cached = getAppConfigStore().get('cachedNodePath');
    if (cached && existsSync(cached) && checkNodeVersion(cached)) {
      return cached;
    }
  } catch { /* cache miss — fall through to full detection */ }

  // 1. Explicit env var (instant)
  if (process.env.MINDOS_NODE_BIN && existsSync(process.env.MINDOS_NODE_BIN)) {
    if (checkNodeVersion(process.env.MINDOS_NODE_BIN)) return process.env.MINDOS_NODE_BIN;
    console.warn(`[MindOS] MINDOS_NODE_BIN (${process.env.MINDOS_NODE_BIN}) is below Node ${MIN_NODE_MAJOR}, skipping`);
  }

  // 2. NVM: symlink (instant + version check)
  const nvmCurrent = path.join(home, '.nvm', 'current', 'bin', 'node');
  if (existsSync(nvmCurrent) && checkNodeVersion(nvmCurrent)) return nvmCurrent;

  // 3. NVM: version directories (instant, fs only — filter by version)
  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    if (existsSync(nvmVersionsDir)) {
      const versions = readdirSync(nvmVersionsDir)
        .filter((v: string) => v.startsWith('v') && isVersionDirAcceptable(v))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
      for (const ver of versions) {
        const nodePath = path.join(nvmVersionsDir, ver, 'bin', 'node');
        if (existsSync(nodePath)) return nodePath;
      }
    }
  } catch { /* ignore */ }

  // 4. fnm (instant, fs only + version check)
  const fnmDir = process.env.FNM_DIR || path.join(home, '.fnm');
  try {
    const fnmAliases = path.join(fnmDir, 'aliases', 'default');
    if (existsSync(fnmAliases)) {
      const ver = readFileSync(fnmAliases, 'utf-8').trim();
      if (isVersionDirAcceptable(ver)) {
        const fnmNode = path.join(fnmDir, 'node-versions', ver, 'installation', 'bin', 'node');
        if (existsSync(fnmNode)) return fnmNode;
      }
    }
  } catch { /* ignore */ }

  // 5. Common system paths (instant, fs only + version check)
  const systemPaths = [
    '/usr/local/bin/node',           // Intel Homebrew
    '/opt/homebrew/bin/node',        // Apple Silicon Homebrew
    '/usr/bin/node',                 // System
    '/opt/local/bin/node',           // MacPorts
    path.join(home, '.local', 'bin', 'node'),
  ];
  for (const p of systemPaths) {
    if (existsSync(p) && checkNodeVersion(p)) return p;
  }

  // 6. `which`/`where` node with enriched PATH (fast, ~100ms + version check)
  try {
    const raw = await execWithPath(IS_WIN ? 'where node' : 'which node', { timeout: 3000 });
    // `where` on Windows may return multiple lines; take the first match.
    const result = raw.split(/\r?\n/)[0].trim();
    if (result && existsSync(result) && checkNodeVersion(result)) {
      try { getAppConfigStore().set('cachedNodePath', result); } catch { /* best-effort */ }
      return result;
    }
  } catch { /* ignore */ }

  // 7. Shell login detection — bounded fallback (1.5s per shell, 3s total ceiling)
  const shells = ['/bin/zsh', '/bin/bash'];
  const shellStart = Date.now();
  const shellCeiling = 3000;
  for (const sh of shells) {
    if (Date.now() - shellStart > shellCeiling) break;
    if (!existsSync(sh)) continue;
    try {
      const remaining = shellCeiling - (Date.now() - shellStart);
      const result = await execWithPath(
        `${sh} -il -c "which node" 2>/dev/null`,
        { timeout: Math.min(1500, remaining) }
      );
      if (result && existsSync(result) && checkNodeVersion(result)) {
        // Cache for next startup so we skip the slow shell detection
        try { getAppConfigStore().set('cachedNodePath', result); } catch { /* best-effort */ }
        return result;
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Resolve npm global root and return the @geminilight/mindos module path.
 * Uses the discovered nodePath's bin directory to find npm, avoiding PATH issues.
 */
export async function getMindosInstallPath(nodePath?: string | null): Promise<string | null> {
  const binDir = nodePath ? path.dirname(nodePath) : undefined;

  // Strategy 1: Use npm from the same bin directory as node (most reliable)
  if (binDir) {
    const npmBin = getNpmPath(binDir);
    if (existsSync(npmBin)) {
      try {
        const globalRoot = await execWithPath(`"${npmBin}" root -g`, { timeout: 5000, extraBinDir: binDir });
        const modulePath = path.join(globalRoot, '@geminilight', 'mindos');
        if (existsSync(modulePath)) return modulePath;
      } catch { /* fall through */ }
    }
  }

  // Strategy 2: Check common global npm paths directly (no shell needed)
  const home = app.getPath('home');
  const commonGlobalPaths = [
    // Private MindOS node
    path.join(home, '.mindos', 'node', 'lib', 'node_modules', '@geminilight', 'mindos'),
    '/usr/local/lib/node_modules/@geminilight/mindos',
    '/opt/homebrew/lib/node_modules/@geminilight/mindos',
    path.join(home, '.npm-global/lib/node_modules/@geminilight/mindos'),
    // NVM global
    ...(nodePath ? [path.join(path.dirname(path.dirname(nodePath)), 'lib', 'node_modules', '@geminilight', 'mindos')] : []),
  ];
  for (const p of commonGlobalPaths) {
    if (existsSync(p)) return p;
  }

  // Strategy 3: exec npm root -g with enriched PATH (fallback)
  try {
    const globalRoot = await execWithPath('npm root -g', { timeout: 5000, extraBinDir: binDir });
    const modulePath = path.join(globalRoot, '@geminilight', 'mindos');
    if (existsSync(modulePath)) return modulePath;
  } catch { /* ignore */ }

  return null;
}

/**
 * Resolve npm absolute path from a bin directory.
 * On Windows, npm ships as npm.cmd; on Unix it's a plain script.
 */
export function getNpmPath(binDir: string): string {
  return path.join(binDir, IS_WIN ? 'npm.cmd' : 'npm');
}

/**
 * Resolve npx absolute path from node path.
 * npx lives in the same bin/ directory as node.
 */
export function getNpxPath(nodePath: string): string {
  const binDir = path.dirname(nodePath);
  const npx = path.join(binDir, IS_WIN ? 'npx.cmd' : 'npx');
  if (existsSync(npx)) return npx;
  // Fallback: bare 'npx' — let PATH resolve it. Don't return npm (different CLI args).
  return 'npx';
}

/**
 * Resolve a local .bin executable path (e.g. "next").
 * On Windows, .bin stubs are .cmd files.
 */
export function getLocalBinPath(baseDir: string, name: string): string {
  return path.join(baseDir, 'node_modules', '.bin', IS_WIN ? `${name}.cmd` : name);
}

/**
 * Get enriched env for spawning child processes that need node/npm in PATH.
 */
export function getEnrichedEnv(nodePath?: string | null): Record<string, string> {
  const binDir = nodePath ? path.dirname(nodePath) : undefined;
  return {
    ...process.env as Record<string, string>,
    PATH: enrichedPath(binDir),
  };
}
