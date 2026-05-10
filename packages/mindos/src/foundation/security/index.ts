/**
 * @mindos/security - Path validation and security utilities
 *
 * Provides security functions for:
 * - Path traversal prevention
 * - Protected file validation
 * - Safe path resolution
 */

import * as path from 'path';
import * as fs from 'fs';
import { AppError, createError } from '../errors/index.js';
import type { Result } from '../shared/index.js';

// Helper functions for Result type
function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: Error): Result<T> {
  return { ok: false, error };
}

/**
 * Set of root-level protected files that cannot be modified via automated tools.
 */
const ROOT_PROTECTED_FILES = new Set(['INSTRUCTION.md']);
const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_INVALID_SEGMENT_CHARS = /[<>:"|?*\x00-\x1f]/;

function hasWindowsDrivePrefix(filePath: string): boolean {
  return /^[A-Za-z]:/.test(filePath);
}

function isPathWithinRoot(resolved: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedResolved = path.resolve(resolved);
  const relative = path.relative(normalizedRoot, normalizedResolved);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function nearestExistingPath(resolved: string): string {
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * Asserts that a resolved path is within the given root.
 * Throws AppError if the path is outside the root.
 */
export function assertWithinRoot(resolved: string, root: string): void {
  if (!isPathWithinRoot(resolved, root)) {
    throw createError(
      'VALIDATION_ERROR',
      'Access denied: path outside root',
      { context: { resolved, root } }
    );
  }
}

/**
 * Checks if a resolved path is within the given root.
 * Returns a Result indicating success or failure.
 */
export function isWithinRoot(resolved: string, root: string): Result<boolean> {
  try {
    return ok(isPathWithinRoot(resolved, root));
  } catch (error) {
    return err(
      createError(
        'VALIDATION_ERROR',
        'Failed to validate path',
        { context: { resolved, root }, cause: error as Error }
      )
    );
  }
}

/**
 * Resolves a relative file path against root and validates it is within bounds.
 * Returns the resolved absolute path.
 * Throws AppError if the path is outside the root.
 */
export function resolveSafe(root: string, filePath: string): string {
  const normalizedFilePath = normalizePath(filePath);
  if (
    path.isAbsolute(normalizedFilePath) ||
    path.win32.isAbsolute(filePath) ||
    path.win32.isAbsolute(normalizedFilePath) ||
    hasWindowsDrivePrefix(filePath) ||
    hasWindowsDrivePrefix(normalizedFilePath)
  ) {
    throw createError(
      'VALIDATION_ERROR',
      'Access denied: absolute paths are not allowed',
      { context: { root, filePath } }
    );
  }
  assertCrossPlatformPathSegments(root, filePath, normalizedFilePath);

  const rootResolved = path.resolve(root);
  const resolved = path.resolve(path.join(rootResolved, normalizedFilePath));
  assertWithinRoot(resolved, rootResolved);
  return resolved;
}

function assertCrossPlatformPathSegments(root: string, filePath: string, normalizedFilePath: string): void {
  for (const segment of normalizedFilePath.split('/')) {
    if (!segment || segment === '.') continue;
    if (
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      WINDOWS_RESERVED_SEGMENT.test(segment) ||
      WINDOWS_INVALID_SEGMENT_CHARS.test(segment)
    ) {
      throw createError(
        'VALIDATION_ERROR',
        'Access denied: path contains a Windows-invalid file name segment',
        { context: { root, filePath, segment } }
      );
    }
  }
}

/**
 * Resolves a path and validates the real filesystem target of the nearest
 * existing path remains inside root. This blocks symlink escapes for existing
 * files/dirs and for new files created below an existing symlinked parent.
 */
export function resolveExistingSafe(root: string, filePath: string): string {
  const resolved = resolveSafe(root, filePath);
  const existing = nearestExistingPath(resolved);

  const rootResolved = path.resolve(root);
  let rootReal: string;
  let targetReal: string;
  try {
    rootReal = fs.realpathSync(rootResolved);
    targetReal = fs.realpathSync(existing);
  } catch (error) {
    throw createError(
      'VALIDATION_ERROR',
      'Access denied: failed to validate real path',
      { context: { root, filePath, resolved, existing }, cause: error as Error }
    );
  }

  try {
    assertWithinRoot(targetReal, rootReal);
  } catch (error) {
    throw createError(
      'VALIDATION_ERROR',
      'Access denied: symlink resolves outside root',
      { context: { root, filePath, resolved, existing, targetReal }, cause: error as Error }
    );
  }

  return resolved;
}

/**
 * Resolves a relative file path against root and validates it is within bounds.
 * Returns a Result with the resolved absolute path.
 */
export function resolveSafeResult(root: string, filePath: string): Result<string> {
  try {
    const resolved = resolveSafe(root, filePath);
    return ok(resolved);
  } catch (error) {
    if (error instanceof AppError) {
      return err(error);
    }
    return err(
      createError(
        'VALIDATION_ERROR',
        'Failed to resolve path safely',
        { context: { root, filePath }, cause: error as Error }
      )
    );
  }
}

/**
 * Checks if a relative file path refers to a root-level protected file.
 */
export function isRootProtected(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return ROOT_PROTECTED_FILES.has(normalized);
}

/**
 * Throws if the file is protected and cannot be modified via automated tools.
 */
export function assertNotProtected(filePath: string, operation: string): void {
  if (isRootProtected(filePath)) {
    throw createError(
      'VALIDATION_ERROR',
      `Protected file: root "${filePath}" cannot be ${operation} via automated tools. ` +
      `This is a system kernel file. Edit it manually or use a dedicated confirmation workflow.`,
      { context: { filePath, operation } }
    );
  }
}

/**
 * Checks if the file is protected.
 * Returns a Result indicating whether the file is protected.
 */
export function checkProtected(filePath: string): Result<boolean> {
  try {
    const isProtected = isRootProtected(filePath);
    return ok(isProtected);
  } catch (error) {
    return err(
      createError(
        'VALIDATION_ERROR',
        'Failed to check if file is protected',
        { context: { filePath }, cause: error as Error }
      )
    );
  }
}

/**
 * Validates that a path is safe to use (within root and not protected).
 */
export function validatePath(
  root: string,
  filePath: string,
  operation?: string
): Result<string> {
  try {
    const resolved = resolveSafe(root, filePath);
    if (operation) {
      assertNotProtected(filePath, operation);
    }
    return ok(resolved);
  } catch (error) {
    if (error instanceof AppError) {
      return err(error);
    }
    return err(
      createError(
        'VALIDATION_ERROR',
        'Path validation failed',
        { context: { root, filePath, operation }, cause: error as Error }
      )
    );
  }
}

/**
 * Normalizes a file path to use forward slashes.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Gets the relative path from root to target.
 */
export function getRelativePath(root: string, target: string): string {
  return path.relative(root, target);
}

/**
 * Checks if a path is absolute.
 */
export function isAbsolutePath(filePath: string): boolean {
  return path.isAbsolute(filePath);
}
