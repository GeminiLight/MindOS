import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from '@/lib/core/security';

export const OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH = '.mindos/plugins';
export const LEGACY_OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH = '.plugins';
export const OBSIDIAN_PLUGIN_MANAGER_STATE_FILE = '.plugin-manager.json';
export const OBSIDIAN_PLUGIN_LOCAL_STORAGE_FILE = '.local-storage.json';
export const OBSIDIAN_PLUGIN_SECRET_STORAGE_FILE = '.secret-storage.json';
export const OBSIDIAN_PLUGIN_SECRET_STORAGE_KEY_FILE = '.secret-storage.key';
export const OBSIDIAN_PLUGIN_DESKTOP_SECRET_STORAGE_FILE = '.secret-storage.desktop-safe-storage.json';

export interface ObsidianPluginRootLocation {
  rootDir: string;
  relativePath: string;
  legacy: boolean;
}

export interface ObsidianPluginLocation extends ObsidianPluginRootLocation {
  pluginDir: string;
  pluginRelativePath: string;
  pluginId: string;
}

export function assertSafeObsidianPluginId(pluginId: string): void {
  if (!pluginId || pluginId.includes('..') || pluginId.includes('/') || pluginId.includes('\\')) {
    throw new Error(`Plugin path escapes MindOS plugin directory: ${pluginId}`);
  }
}

export function resolveCanonicalObsidianPluginRoot(mindRoot: string): ObsidianPluginRootLocation {
  return {
    rootDir: resolveExistingSafe(mindRoot, OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH),
    relativePath: OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH,
    legacy: false,
  };
}

export function resolveLegacyObsidianPluginRoot(mindRoot: string): ObsidianPluginRootLocation {
  return {
    rootDir: resolveExistingSafe(mindRoot, LEGACY_OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH),
    relativePath: LEGACY_OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH,
    legacy: true,
  };
}

export function resolveObsidianPluginRootsForRead(mindRoot: string): ObsidianPluginRootLocation[] {
  const roots: ObsidianPluginRootLocation[] = [];
  for (const resolver of [resolveCanonicalObsidianPluginRoot, resolveLegacyObsidianPluginRoot]) {
    try {
      const location = resolver(mindRoot);
      if (!pathExists(location.rootDir)) continue;
      if (!fs.statSync(location.rootDir).isDirectory()) continue;
      roots.push(location);
    } catch {
      // Ignore unsafe, missing, or non-readable roots.
    }
  }
  return roots;
}

export function resolveCanonicalObsidianPluginDir(mindRoot: string, pluginId: string): ObsidianPluginLocation {
  assertSafeObsidianPluginId(pluginId);
  return pluginLocationFromRoot(mindRoot, resolveCanonicalObsidianPluginRoot(mindRoot), pluginId);
}

export function resolveLegacyObsidianPluginDir(mindRoot: string, pluginId: string): ObsidianPluginLocation {
  assertSafeObsidianPluginId(pluginId);
  return pluginLocationFromRoot(mindRoot, resolveLegacyObsidianPluginRoot(mindRoot), pluginId);
}

export function resolveInstalledObsidianPluginDir(mindRoot: string, pluginId: string): ObsidianPluginLocation | null {
  for (const resolver of [resolveCanonicalObsidianPluginDir, resolveLegacyObsidianPluginDir]) {
    let location: ObsidianPluginLocation;
    try {
      location = resolver(mindRoot, pluginId);
    } catch {
      continue;
    }
    if (pathExists(location.pluginDir) && fs.statSync(location.pluginDir).isDirectory()) {
      return location;
    }
  }
  return null;
}

export function hasInstalledObsidianPluginDir(mindRoot: string, pluginId: string): boolean {
  return resolveInstalledObsidianPluginDir(mindRoot, pluginId) !== null;
}

export function resolveCanonicalPluginManagerStatePath(mindRoot: string): string {
  return path.join(resolveCanonicalObsidianPluginRoot(mindRoot).rootDir, OBSIDIAN_PLUGIN_MANAGER_STATE_FILE);
}

export function resolveLegacyPluginManagerStatePath(mindRoot: string): string {
  return path.join(resolveLegacyObsidianPluginRoot(mindRoot).rootDir, OBSIDIAN_PLUGIN_MANAGER_STATE_FILE);
}

export function resolvePluginManagerStatePathsForRead(mindRoot: string): string[] {
  const paths: string[] = [];
  for (const resolver of [resolveLegacyPluginManagerStatePath, resolveCanonicalPluginManagerStatePath]) {
    try {
      paths.push(resolver(mindRoot));
    } catch {
      // Ignore unsafe roots.
    }
  }
  return paths;
}

export function resolveCanonicalPluginLocalStoragePath(mindRoot: string): string {
  return path.join(resolveCanonicalObsidianPluginRoot(mindRoot).rootDir, OBSIDIAN_PLUGIN_LOCAL_STORAGE_FILE);
}

export function resolveLegacyPluginLocalStoragePath(mindRoot: string): string {
  return path.join(resolveLegacyObsidianPluginRoot(mindRoot).rootDir, OBSIDIAN_PLUGIN_LOCAL_STORAGE_FILE);
}

export function resolvePluginLocalStoragePathsForRead(mindRoot: string): string[] {
  const paths: string[] = [];
  for (const resolver of [resolveCanonicalPluginLocalStoragePath, resolveLegacyPluginLocalStoragePath]) {
    try {
      paths.push(resolver(mindRoot));
    } catch {
      // Ignore unsafe roots.
    }
  }
  return paths;
}

export function resolveCanonicalPluginSecretStoragePath(mindRoot: string): string {
  return path.join(resolveCanonicalObsidianPluginRoot(mindRoot).rootDir, OBSIDIAN_PLUGIN_SECRET_STORAGE_FILE);
}

export function resolveCanonicalPluginSecretStorageKeyPath(mindRoot: string): string {
  return path.join(resolveCanonicalObsidianPluginRoot(mindRoot).rootDir, OBSIDIAN_PLUGIN_SECRET_STORAGE_KEY_FILE);
}

export function resolveCanonicalPluginDesktopSecretStoragePath(mindRoot: string): string {
  return path.join(resolveCanonicalObsidianPluginRoot(mindRoot).rootDir, OBSIDIAN_PLUGIN_DESKTOP_SECRET_STORAGE_FILE);
}

function pluginLocationFromRoot(mindRoot: string, root: ObsidianPluginRootLocation, pluginId: string): ObsidianPluginLocation {
  return {
    ...root,
    pluginDir: resolveExistingSafe(mindRoot, `${root.relativePath}/${pluginId}`),
    pluginRelativePath: `${root.relativePath}/${pluginId}`,
    pluginId,
  };
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (err) {
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
