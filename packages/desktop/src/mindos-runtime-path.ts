/**
 * Resolve default bundled MindOS directory (packaged app resources).
 * Explicit override via env is handled in main before calling this.
 */
import { app } from 'electron';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Directory where packaged builds may ship `mindos-runtime/` (see electron-builder extraResources).
 * In development: env override → monorepo root auto-detect → null.
 */
export function getDefaultBundledMindOsDirectory(): string | null {
  if (!app.isPackaged) {
    const dev = process.env.MINDOS_DEV_BUNDLED_ROOT?.trim();
    if (dev && dev.length > 0) return dev;

    // Auto-detect: packages/desktop sits inside the monorepo root, which is a dev runtime.
    const monorepoRoot = path.resolve(app.getAppPath(), '..');
    if (
      existsSync(path.join(monorepoRoot, 'packages', 'web')) &&
      existsSync(path.join(monorepoRoot, 'packages', 'protocols', 'mcp-server')) &&
      existsSync(path.join(monorepoRoot, 'package.json'))
    ) {
      return monorepoRoot;
    }

    return null;
  }
  return path.join(process.resourcesPath, 'mindos-runtime');
}
