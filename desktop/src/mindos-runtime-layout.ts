/**
 * Filesystem probes for a MindOS package root (app/.next + mcp).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface MindOsLayoutAnalysis {
  version: string | null;
  runnable: boolean;
}

/** Sentinel file written after a successful next build in Desktop/CLI */
export const BUILD_VERSION_FILE = '.mindos-build-version';

/**
 * Check if a .next directory contains a valid production build.
 * Next.js writes BUILD_ID during `next build`; standalone mode writes server.js.
 * If neither exists, the directory is incomplete / leftover from a failed build.
 */
export function isNextBuildValid(appDir: string): boolean {
  const nextDir = path.join(appDir, '.next');
  if (!existsSync(nextDir)) return false;
  // standalone server.js is the preferred path
  if (existsSync(path.join(nextDir, 'standalone', 'server.js'))) return true;
  // Regular build: BUILD_ID is written at the end of `next build`
  if (existsSync(path.join(nextDir, 'BUILD_ID'))) return true;
  return false;
}

/**
 * Strict build check for pre-launch gate: build exists AND matches current package version.
 *
 * Returns false (= trigger rebuild) when:
 *   - No build at all (.next missing or incomplete)
 *   - Build version stamp missing (old build or interrupted build)
 *   - Build version doesn't match package.json version (upgrade/reinstall)
 *
 * @see wiki/80-known-pitfalls.md
 */
export function isNextBuildCurrent(appDir: string, projectRoot: string): boolean {
  if (!isNextBuildValid(appDir)) return false;

  const nextDir = path.join(appDir, '.next');
  const stampPath = path.join(nextDir, BUILD_VERSION_FILE);

  // No version stamp = old or interrupted build, don't trust it
  let buildVersion: string;
  try {
    buildVersion = readFileSync(stampPath, 'utf-8').trim();
    if (!buildVersion) return false;
  } catch {
    return false;
  }

  // Compare against package.json version
  let pkgVersion: string;
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    pkgVersion = typeof pkg.version === 'string' ? pkg.version.trim() : '';
    if (!pkgVersion) return true; // can't determine pkg version, trust the stamp
  } catch {
    return true; // can't read package.json, trust the stamp
  }

  return buildVersion === pkgVersion;
}

/**
 * Check that a bundled runtime has all critical directories intact.
 * Catches partial DMG extraction where server.js exists but static assets are missing.
 */
export function isBundledRuntimeIntact(root: string): boolean {
  const required = [
    path.join(root, 'app', '.next'),
    path.join(root, 'mcp', 'dist', 'index.cjs'),
  ];
  // Static assets are critical for the web UI to render properly
  const appDir = path.join(root, 'app');
  const hasStandalone = existsSync(path.join(appDir, '.next', 'standalone', 'server.js'));
  if (hasStandalone) {
    // standalone mode needs static dir copied alongside
    required.push(path.join(appDir, '.next', 'static'));
  }
  return required.every(p => existsSync(p));
}

export function analyzeMindOsLayout(root: string): MindOsLayoutAnalysis {
  let version: string | null = null;
  try {
    const raw = readFileSync(path.join(root, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    version = typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    version = null;
  }

  const appDir = path.join(root, 'app');
  const mcpDir = path.join(root, 'mcp');
  const runnable = isNextBuildValid(appDir) && existsSync(mcpDir);

  return { version, runnable };
}
