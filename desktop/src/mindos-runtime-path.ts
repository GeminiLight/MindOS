/**
 * Resolve default bundled MindOS directory (packaged app resources).
 * Explicit override via env is handled in main before calling this.
 */
import { app } from 'electron';
import path from 'path';

/**
 * Directory where packaged builds may ship `mindos-runtime/` (see electron-builder extraResources).
 * In development, returns null unless MINDOS_DEV_BUNDLED_ROOT is set (dogfooding).
 */
export function getDefaultBundledMindOsDirectory(): string | null {
  if (!app.isPackaged) {
    const dev = process.env.MINDOS_DEV_BUNDLED_ROOT?.trim();
    return dev && dev.length > 0 ? dev : null;
  }
  return path.join(process.resourcesPath, 'mindos-runtime');
}
