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
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { getPrivateNodePath, isPrivateNodeInstalled } from './node-bootstrap';

const execAsync = promisify(exec);

/** Build an enriched PATH that includes common Node.js bin directories */
function enrichedPath(extraBinDir?: string): string {
  const home = app.getPath('home');
  const dirs = [
    extraBinDir,
    path.join(home, '.mindos', 'node', 'bin'),  // Private MindOS Node.js
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    `${home}/.nvm/current/bin`,
    `${home}/.local/bin`,
    process.env.PATH,
  ].filter(Boolean);
  return dirs.join(':');
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

  // 0. MindOS private Node.js (~/.mindos/node/) — highest priority
  if (isPrivateNodeInstalled()) {
    return getPrivateNodePath();
  }

  // 1. Explicit env var (instant)
  if (process.env.MINDOS_NODE_BIN && existsSync(process.env.MINDOS_NODE_BIN)) {
    return process.env.MINDOS_NODE_BIN;
  }

  // 2. NVM: symlink (instant)
  const nvmCurrent = path.join(home, '.nvm', 'current', 'bin', 'node');
  if (existsSync(nvmCurrent)) return nvmCurrent;

  // 3. NVM: version directories (instant, fs only)
  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    if (existsSync(nvmVersionsDir)) {
      const versions = readdirSync(nvmVersionsDir)
        .filter((v: string) => v.startsWith('v'))
        .sort().reverse();
      for (const ver of versions) {
        const nodePath = path.join(nvmVersionsDir, ver, 'bin', 'node');
        if (existsSync(nodePath)) return nodePath;
      }
    }
  } catch { /* ignore */ }

  // 4. fnm (instant, fs only)
  const fnmDir = process.env.FNM_DIR || path.join(home, '.fnm');
  try {
    const fnmAliases = path.join(fnmDir, 'aliases', 'default');
    if (existsSync(fnmAliases)) {
      const ver = readFileSync(fnmAliases, 'utf-8').trim();
      const fnmNode = path.join(fnmDir, 'node-versions', ver, 'installation', 'bin', 'node');
      if (existsSync(fnmNode)) return fnmNode;
    }
  } catch { /* ignore */ }

  // 5. Common system paths (instant, fs only)
  const systemPaths = [
    '/usr/local/bin/node',           // Intel Homebrew
    '/opt/homebrew/bin/node',        // Apple Silicon Homebrew
    '/usr/bin/node',                 // System
    '/opt/local/bin/node',           // MacPorts
    path.join(home, '.local', 'bin', 'node'),
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  // 6. `which node` with enriched PATH (fast, ~100ms)
  try {
    const result = await execWithPath('which node', { timeout: 3000 });
    if (result && existsSync(result)) return result;
  } catch { /* ignore */ }

  // 7. Shell login detection — SLOW fallback (~2-5s per shell)
  const shells = ['/bin/zsh', '/bin/bash'];
  for (const sh of shells) {
    if (!existsSync(sh)) continue;
    try {
      const result = await execWithPath(
        `${sh} -il -c "which node" 2>/dev/null`,
        { timeout: 5000 }
      );
      if (result && existsSync(result)) return result;
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
    const npmBin = path.join(binDir, 'npm');
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
 * Resolve npx absolute path from node path.
 * npx lives in the same bin/ directory as node.
 */
export function getNpxPath(nodePath: string): string {
  const binDir = path.dirname(nodePath);
  const npx = path.join(binDir, 'npx');
  if (existsSync(npx)) return npx;
  // Fallback: npm should be next to node
  const npm = path.join(binDir, 'npm');
  if (existsSync(npm)) return npm;
  return 'npx';
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
