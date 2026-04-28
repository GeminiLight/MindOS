/**
 * Filesystem probes for a MindOS package root (packages/web/.next + packages/protocols/mcp-server).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  hasBundledRuntimeRequiredFiles,
  hasRequiredStandaloneAppFiles,
  isRuntimeLayoutMcpRunnable,
} from './runtime-health-contract';

export interface MindOsLayoutAnalysis {
  version: string | null;
  runnable: boolean;
}

/** Sentinel file written after a successful next build in Desktop/CLI */
export const BUILD_VERSION_FILE = '.mindos-build-version';

export function resolveWebAppDir(root: string): string {
  const v1AppDir = path.join(root, 'packages', 'web');
  return existsSync(v1AppDir) ? v1AppDir : path.join(root, 'app');
}

export function resolveMcpDir(root: string): string {
  const domainMcpDir = path.join(root, 'packages', 'protocols', 'mcp-server');
  if (existsSync(domainMcpDir)) return domainMcpDir;

  const v1FlatMcpDir = path.join(root, 'packages', 'mcp-server');
  return existsSync(v1FlatMcpDir) ? v1FlatMcpDir : path.join(root, 'mcp');
}

export function resolveCliPath(root: string): string {
  const packageCli = path.join(root, 'packages', 'mindos', 'bin', 'cli.js');
  return existsSync(packageCli) ? packageCli : path.join(root, 'bin', 'cli.js');
}

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
 *   - Build version stamp exists but doesn't match package.json version (upgrade/reinstall)
 *   - Build version stamp is empty string (interrupted stamp write)
 *
 * Returns true (= skip rebuild) when:
 *   - Stamp exists and matches package.json version
 *   - Stamp is missing but build is valid (external build from CLI / npm run build / bundled runtime)
 *   - Stamp exists but package.json is missing or unreadable
 *
 * Rationale: a valid build (BUILD_ID or standalone/server.js) created by CLI, npm run build,
 * or the packaging script should not be discarded just because the Desktop-specific stamp file
 * is absent. Only an explicit version mismatch (stamp present but != package version) triggers
 * a rebuild, which covers the upgrade/reinstall scenario.
 *
 * @see wiki/80-known-pitfalls.md
 */
export function isNextBuildCurrent(appDir: string, projectRoot: string): boolean {
  if (!isNextBuildValid(appDir)) return false;

  const nextDir = path.join(appDir, '.next');
  const stampPath = path.join(nextDir, BUILD_VERSION_FILE);

  // Read stamp — may not exist (external build, old build, bundled runtime)
  let buildVersion: string | null;
  try {
    const raw = readFileSync(stampPath, 'utf-8').trim();
    buildVersion = raw || null; // empty string → treat as missing
  } catch {
    buildVersion = null;
  }

  // No stamp but build is valid → trust it (external build / bundled runtime)
  if (buildVersion === null) return true;

  // Stamp exists — compare against package.json version
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
  return hasBundledRuntimeRequiredFiles(root);
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

  const appDir = resolveWebAppDir(root);
  const hasStandalone = existsSync(path.join(appDir, '.next', 'standalone', 'server.js'));
  const runtimeRunnable = hasStandalone
    ? hasRequiredStandaloneAppFiles(appDir)
    : isNextBuildValid(appDir);
  const resolvedMcpDir = resolveMcpDir(root);
  const mcpRunnable = isRuntimeLayoutMcpRunnable(root)
    || existsSync(path.join(resolvedMcpDir, 'dist', 'index.cjs'))
    || existsSync(path.join(resolvedMcpDir, 'src'));
  const runnable = runtimeRunnable && mcpRunnable;

  return { version, runnable };
}
