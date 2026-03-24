/**
 * Filesystem probes for a MindOS package root (app/.next + mcp).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface MindOsLayoutAnalysis {
  version: string | null;
  runnable: boolean;
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

  const nextDir = path.join(root, 'app', '.next');
  const mcpDir = path.join(root, 'mcp');
  const runnable = existsSync(nextDir) && existsSync(mcpDir);

  return { version, runnable };
}
