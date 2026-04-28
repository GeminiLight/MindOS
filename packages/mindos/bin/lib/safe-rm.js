/**
 * Safe file deletion utilities for Node.js CLI.
 * Prevents symlink attacks and unsafe deletions.
 */

import path from 'path';
import { lstatSync, rmSync, existsSync, statSync } from 'node:fs';

/**
 * Check if a path is a symbolic link.
 */
export function isSymlink(filePath) {
  try {
    const stats = lstatSync(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Assert a path is not a symlink, throw otherwise.
 */
export function assertNotSymlink(filePath) {
  if (isSymlink(filePath)) {
    throw new Error(`SECURITY: Refusing to delete symlink at ${filePath}`);
  }
}

/**
 * Assert all parents in path chain are not symlinks.
 */
export function assertNoSymlinksInPath(targetPath, rootBoundary) {
  let current = targetPath;
  const maxIterations = 50;
  let iterations = 0;

  while (current !== rootBoundary && iterations < maxIterations) {
    if (existsSync(current) && isSymlink(current)) {
      throw new Error(`SECURITY: Path contains symlink at ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    iterations++;
  }

  if (iterations >= maxIterations) {
    throw new Error(`SECURITY: Path traversal check exceeded max iterations for ${targetPath}`);
  }
}

/**
 * Safe recursive deletion that refuses symlinks.
 */
export function safeRmSync(dir, options = {}) {
  // Check 1: Target must not be a symlink
  if (isSymlink(dir)) {
    throw new Error(`SECURITY: Refusing to delete symlink: ${dir}`);
  }

  // Check 2: Directory must exist
  if (!existsSync(dir)) {
    return; // Idempotent
  }

  // Check 3: Must be a directory if recursive
  if (options.recursive) {
    try {
      const stats = statSync(dir);
      if (!stats.isDirectory()) {
        throw new Error(`SECURITY: Not a directory: ${dir}`);
      }
    } catch (err) {
      throw err;
    }
  }

  // Check 4: Windows path validation
  if (process.platform === 'win32') {
    const normPath = path.normalize(dir);
    if (normPath.includes('\\\\?\\') || normPath.startsWith('\\')) {
      throw new Error(`SECURITY: Suspicious path format on Windows: ${dir}`);
    }
  }

  // Proceed with deletion
  try {
    rmSync(dir, { force: true, ...options });
  } catch (err) {
    throw new Error(`Failed to delete ${dir}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Safe directory creation with symlink checks.
 */
export function safeMkdir(dir, options = {}) {
  const { mkdirSync } = require('node:fs');

  // Check parent chain for symlinks
  let current = path.dirname(dir);
  const rootBoundary = path.dirname(current);

  while (current !== rootBoundary) {
    if (existsSync(current) && isSymlink(current)) {
      throw new Error(`SECURITY: Parent directory is symlink: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return mkdirSync(dir, { recursive: true, ...options });
}

/**
 * Get safe file stats without following symlinks.
 */
export function getSafeStats(filePath) {
  if (isSymlink(filePath)) {
    throw new Error(`SECURITY: Path is symlink: ${filePath}`);
  }
  return statSync(filePath);
}

/**
 * Assess deletion risks before operation.
 */
export function assessDeletionRisk(filePath, configDir) {
  const risks = {
    isSymlink: isSymlink(filePath),
    hasSymlinkParent: false,
    isSystemPath: false,
    isSuspiciousOwnership: false,
  };

  // Check parent symlinks
  try {
    let current = path.dirname(filePath);
    for (let i = 0; i < 10; i++) {
      if (existsSync(current) && isSymlink(current)) {
        risks.hasSymlinkParent = true;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // Ignore
  }

  // Check if outside expected boundaries
  try {
    const relative = path.relative(configDir, filePath);
    if (relative.startsWith('..')) {
      risks.isSystemPath = true;
    }
  } catch {
    risks.isSystemPath = true;
  }

  return risks;
}
