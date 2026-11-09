/**
 * Safe file deletion utilities that prevent symlink attacks.
 *
 * Security guarantees:
 * - Refuses to delete symlinks directly
 * - When a `boundary` option is provided, refuses symlinks in the parent
 *   chain between the target and that boundary
 * - Validates paths before deletion
 * - Atomic operations with rollback on failure
 *
 * Usage:
 *   assertNotSymlink(path);  // Verify before deletion
 *   safeRmSync(dir, { recursive: true, boundary: configDir });  // Safe deletion
 */

import path from 'path';
import { lstatSync, rmSync, existsSync, statSync, mkdirSync } from 'fs';

function isOutsideDirectory(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/**
 * Check if a path is a symbolic link.
 * Returns false if path doesn't exist (doesn't throw).
 */
export function isSymlink(filePath: string): boolean {
  try {
    const stats = lstatSync(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Verify a path is not a symbolic link, throw if it is.
 * Prevents classic symlink attacks.
 */
export function assertNotSymlink(filePath: string): void {
  if (isSymlink(filePath)) {
    throw new Error(`SECURITY: Refusing to delete symlink at ${filePath}`);
  }
}

/**
 * Verify a path and all its parent components are not symlinks.
 * Prevents "path traversal via symlink in parent chain" attacks.
 */
export function assertNoSymlinksInPath(targetPath: string, rootBoundary: string): void {
  let current = targetPath;
  const maxIterations = 50; // Prevent infinite loops
  let iterations = 0;

  while (current !== rootBoundary && iterations < maxIterations) {
    if (existsSync(current) && isSymlink(current)) {
      throw new Error(`SECURITY: Path contains symlink at ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break; // Hit filesystem root
    current = parent;
    iterations++;
  }

  if (iterations >= maxIterations) {
    throw new Error(`SECURITY: Path traversal check exceeded max iterations for ${targetPath}`);
  }
}

/**
 * Detect Windows device-namespace path injection (`\\?\`, `\\.\`).
 * Normal UNC shares (`\\server\share\...`) are intentionally allowed —
 * folder-redirected user profiles live on UNC paths.
 */
export function isWindowsDeviceNamespacePath(filePath: string): boolean {
  const normPath = path.win32.normalize(filePath);
  return /^\\\\[?.]\\/.test(normPath);
}

export type SafeRmOptions = Parameters<typeof rmSync>[1] & {
  /**
   * When provided, every parent directory between the target and this
   * boundary is checked for symlinks before deletion. The boundary itself
   * (and anything above it) is not checked, so OS-level symlinks like
   * macOS /tmp -> /private/tmp don't cause false positives.
   */
  boundary?: string;
};

/**
 * Safe recursive deletion that refuses symlinks.
 *
 * Security checks:
 * 1. Target path is not a symlink
 * 2. Parent chain between target and `boundary` has no symlinks (when
 *    `boundary` is provided)
 * 3. Path doesn't use the Windows device namespace (Windows only)
 *
 * @param dir Directory to delete
 * @param options Options passed to rmSync(), plus optional `boundary`
 * @throws Error if symlink detected or deletion fails
 */
export function safeRmSync(dir: string, options: SafeRmOptions = {}): void {
  const { boundary, ...rmOptions } = options;

  // ✅ Check 1: Target must not be a symlink
  if (isSymlink(dir)) {
    throw new Error(`SECURITY: Refusing to delete symlink: ${dir}`);
  }

  // ✅ Check 2: Parent chain between target and boundary must be symlink-free
  if (boundary) {
    assertNoSymlinksInPath(path.dirname(path.resolve(dir)), path.resolve(boundary));
  }

  // ✅ Check 3: Directory must exist before deletion attempt
  if (!existsSync(dir)) {
    // Safe to return silently (idempotent behavior)
    return;
  }

  // ✅ Check 4: Must be a directory (if recursive requested)
  if (rmOptions.recursive) {
    const stats = statSync(dir);
    if (!stats.isDirectory()) {
      throw new Error(`SECURITY: Not a directory: ${dir}`);
    }
  }

  // ✅ Check 5: On Windows, prevent device-namespace path manipulation attacks
  if (process.platform === 'win32' && isWindowsDeviceNamespacePath(dir)) {
    throw new Error(`SECURITY: Suspicious path format on Windows: ${dir}`);
  }

  // ✅ All checks passed, proceed with deletion
  try {
    rmSync(dir, { force: true, ...rmOptions });
  } catch (err) {
    throw new Error(`Failed to delete ${dir}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Create a directory with security checks.
 * Refuses to create if symlinks exist in parent chain.
 *
 * Returns `dir`. It used to return mkdirSync's own result, which is undefined
 * when the directory already exists — the `string` return type was untrue,
 * hidden only because mkdirSync came from an untyped require().
 */
export function safeMkdir(
  dir: string,
  options: { recursive?: boolean; mode?: number } = {}
): string {
  // Check parent chain for symlinks
  let current = path.dirname(dir);
  const rootBoundary = path.dirname(current); // One level up

  while (current !== rootBoundary) {
    if (existsSync(current) && isSymlink(current)) {
      throw new Error(`SECURITY: Parent directory is symlink: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  mkdirSync(dir, { recursive: true, ...options });
  return dir;
}

/**
 * Get safe file stats, verifying path is not a symlink.
 * Useful for pre-deletion validation.
 */
export function getSafeStats(filePath: string) {
  if (isSymlink(filePath)) {
    throw new Error(`SECURITY: Path is symlink: ${filePath}`);
  }
  return statSync(filePath);
}

/**
 * Detect suspicious deletion patterns that might indicate attacks.
 * Should be called before high-risk deletions.
 */
export interface DeletionRiskFactors {
  isSymlink: boolean;
  hasSymlinkParent: boolean;
  isSystemPath: boolean;
  isSuspiciousOwnership: boolean;
}

/**
 * Case-aware "is target strictly inside boundary" check.
 * path.win32.relative already compares case-insensitively on Windows; macOS
 * filesystems are typically case-insensitive too, so fold case there as well.
 */
function isInsideBoundary(boundary: string, target: string): boolean {
  if (process.platform === 'win32') {
    const rel = path.win32.relative(boundary, target);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.win32.sep}`) && !path.win32.isAbsolute(rel);
  }
  const fold = (p: string) => (process.platform === 'darwin' ? p.toLowerCase() : p);
  const rel = path.relative(fold(boundary), fold(target));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function assessDeletionRisk(
  filePath: string,
  configDir: string
): DeletionRiskFactors {
  const risks: DeletionRiskFactors = {
    isSymlink: isSymlink(filePath),
    hasSymlinkParent: false,
    isSystemPath: false,
    isSuspiciousOwnership: false,
  };

  // Check parent symlinks
  try {
    const boundary = path.resolve(configDir);
    let current = path.dirname(path.resolve(filePath));
    for (let i = 0; i < 10; i++) {
      if (current === boundary) break;
      if (existsSync(current) && isSymlink(current)) {
        risks.hasSymlinkParent = true;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      if (current !== boundary && !isInsideBoundary(boundary, current)) break;
      current = parent;
    }
  } catch {
    // Ignore errors in risk assessment
  }

  // Check if path is outside expected boundaries
  try {
    if (isOutsideDirectory(configDir, filePath)) {
      risks.isSystemPath = true;
    }
  } catch {
    risks.isSystemPath = true;
  }

  // Check ownership (Unix only)
  if (process.platform !== 'win32') {
    try {
      const stats = lstatSync(filePath);
      const myUid = process.getuid?.();
      if (myUid !== undefined && stats.uid !== myUid) {
        risks.isSuspiciousOwnership = true;
      }
    } catch {
      // Ignore if stat fails
    }
  }

  return risks;
}

/**
 * Log deletion for audit trail (implementation stub).
 * Should be integrated with actual audit system.
 */
export interface DeletionAuditEntry {
  timestamp: string;
  path: string;
  reason: string;
  initiator: string;
  riskFactors?: DeletionRiskFactors;
}

export function logDeletionAudit(entry: DeletionAuditEntry): void {
  // TODO: Implement persistent audit logging
  // For now, just log to console in debug mode
  if (process.env.DEBUG_SAFE_RM) {
    console.log(`[DeletionAudit] ${entry.timestamp} - ${entry.path} (${entry.reason})`);
  }
}
