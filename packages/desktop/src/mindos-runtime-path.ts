/**
 * Resolve default bundled MindOS directory (packaged app resources).
 * Explicit override via env is handled in main before calling this.
 */
import { app } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { analyzeMindOsLayout } from './mindos-runtime-layout';

/** `app.getAppPath()` is `<repo>/packages/desktop` in a dev run. */
const MONOREPO_DEPTH_FROM_DESKTOP = ['..', '..'] as const;

/**
 * Does this directory look like something we can run MindOS from?
 *
 * Previously hand-rolled as two existsSync checks, one of which
 * (`packages/protocols/mcp-server`) pointed at a directory that moved into
 * `packages/mindos/`, so dev auto-detection could never succeed. The layout
 * analyser already answers this question and tracks the real paths.
 */
export function looksLikeMindOsRuntime(root: string): boolean {
  if (!existsSync(path.join(root, 'package.json'))) return false;
  return analyzeMindOsLayout(root).runnable;
}

/**
 * Directory where packaged builds may ship `mindos-runtime/` (see electron-builder extraResources).
 * In development: env override → monorepo root auto-detect → null.
 */
export function getDefaultBundledMindOsDirectory(): string | null {
  if (!app.isPackaged) {
    const dev = process.env.MINDOS_DEV_BUNDLED_ROOT?.trim();
    if (dev && dev.length > 0) return dev;

    // Auto-detect: packages/desktop sits inside the monorepo root, which is a
    // dev runtime. Resolving only one level up landed on `packages/`, so this
    // never matched either.
    const monorepoRoot = path.resolve(app.getAppPath(), ...MONOREPO_DEPTH_FROM_DESKTOP);
    if (looksLikeMindOsRuntime(monorepoRoot)) return monorepoRoot;

    return null;
  }
  return path.join(process.resourcesPath, 'mindos-runtime');
}
