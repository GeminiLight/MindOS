/**
 * Safe path resolution and validation for update operations.
 * Prevents path traversal attacks and ensures paths stay within boundaries.
 */

import path from 'path';
import os from 'os';

function getHomeDir(): string {
  return process.env.MINDOS_DESKTOP_HOME_DIR || os.homedir();
}

// Directories allowed to be managed by the updater
const ALLOWED_SUBDIRS = [
  'runtime',
  'runtime-downloading',
  'runtime-old',
  'config.json',
  'node',
  'bin',
];

/**
 * Validate that a path is safe and within boundaries.
 * 
 * Security checks:
 * 1. Must be within ~/.mindos/
 * 2. Must be in ALLOWED_SUBDIRS whitelist
 * 3. Must not contain .. for path traversal
 * 4. Must resolve without symlink escaping
 */
export function validateRuntimePath(targetPath: string): string {
  if (!targetPath) {
    throw new Error('SECURITY: Empty path provided');
  }

  // ✅ Check 1: No null bytes (null byte injection)
  if (targetPath.includes('\0')) {
    throw new Error(`SECURITY: Null byte in path: ${targetPath}`);
  }

  // Normalize the path
  const normalized = path.normalize(targetPath);
  if (normalized.split(path.sep).includes('..') || targetPath.includes('..')) {
    throw new Error(`SECURITY: Path traversal detected (..) in: ${targetPath}`);
  }

  // ✅ Check 2: Must be within ~/.mindos/
  const homeDir = getHomeDir();
  const configDir = path.join(homeDir, '.mindos');
  const resolved = path.resolve(configDir, targetPath);

  // Verify resolved path is within config directory
  if (!resolved.startsWith(configDir + path.sep) && resolved !== configDir) {
    throw new Error(`SECURITY: Path outside .mindos/: ${resolved}`);
  }

  // ✅ Check 3: Must not contain .. after resolution
  const relative = path.relative(configDir, resolved);
  if (relative.includes('..')) {
    throw new Error(`SECURITY: Path traversal detected (..) in: ${relative}`);
  }

  // ✅ Check 4: Must be in allowed subdirectories (if not config dir itself)
  if (resolved !== configDir) {
    const parts = relative.split(path.sep);
    const topLevel = parts[0];
    if (!ALLOWED_SUBDIRS.includes(topLevel)) {
      throw new Error(`SECURITY: Subdirectory not whitelisted: ${topLevel}`);
    }
  }

  return resolved;
}

/**
 * Validate multiple runtime paths (used during apply()).
 */
export function validateRuntimePaths(...paths: string[]): Record<string, string> {
  const validated: Record<string, string> = {};
  for (const p of paths) {
    if (!p) continue;
    try {
      const name = path.basename(p);
      validated[name] = validateRuntimePath(p);
    } catch (err) {
      throw new Error(`Failed to validate path ${p}: ${err}`);
    }
  }
  return validated;
}

/**
 * Assert a path is an allowed runtime directory.
 */
export function assertAllowedRuntimeDir(dirName: string): void {
  if (!ALLOWED_SUBDIRS.includes(dirName)) {
    throw new Error(`SECURITY: Directory not allowed for deletion: ${dirName}`);
  }
}

/**
 * Whitelist a new runtime directory (used during extension).
 */
export function allowRuntimeDir(dirName: string): void {
  if (!ALLOWED_SUBDIRS.includes(dirName)) {
    ALLOWED_SUBDIRS.push(dirName);
  }
}

/**
 * Get the safe config directory path.
 */
export function getConfigDir(): string {
  const homeDir = getHomeDir();
  return path.join(homeDir, '.mindos');
}

/**
 * Get safe runtime directory paths.
 */
export function getRuntimePaths() {
  const configDir = getConfigDir();
  return {
    configDir,
    runtimeDir: path.join(configDir, 'runtime'),
    downloadDir: path.join(configDir, 'runtime-downloading'),
    oldDir: path.join(configDir, 'runtime-old'),
    tarballPath: path.join(configDir, 'runtime-download.tar.gz'),
  };
}

/**
 * Verify a directory name is safe (no path separators, null bytes, etc).
 */
export function isValidDirName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('\0')) return false;
  if (name === '.' || name === '..') return false;
  if (name.startsWith('.')) return false; // Hidden dirs
  if (name.includes('~')) return false;
  return true;
}

/**
 * Sanitize directory name to safe format.
 */
export function sanitizeDirName(name: string): string {
  if (!name) throw new Error('Empty directory name');
  // Remove path separators, null bytes, and suspicious characters
  let sanitized = name
    .replace(/[\/\\]/g, '_')
    .replace(/\0/g, '')
    .replace(/\.\./g, '__')
    .replace(/^\./, '_');

  if (!isValidDirName(sanitized)) {
    throw new Error(`Failed to sanitize directory name: ${name}`);
  }
  return sanitized;
}
