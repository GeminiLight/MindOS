/**
 * Filesystem probes for a MindOS package root (app/.next + mcp).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface MindOsLayoutAnalysis {
  version: string | null;
  runnable: boolean;
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
