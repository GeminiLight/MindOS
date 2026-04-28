/**
 * Prefer `app.asar.unpacked` when present — macOS Chromium often fails `file://` loads from inside `app.asar`.
 */
import { app } from 'electron';
import path from 'path';
import { existsSync } from 'fs';

export function resolvePreferUnpacked(...segments: string[]): string {
  const rel = path.join(...segments);
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), rel);
  }
  const asarPath = app.getAppPath();
  const unpacked = path.join(path.dirname(asarPath), 'app.asar.unpacked', rel);
  if (existsSync(unpacked)) return unpacked;
  return path.join(asarPath, rel);
}
