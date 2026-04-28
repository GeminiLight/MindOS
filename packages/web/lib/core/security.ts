import {
  assertWithinRoot as packageAssertWithinRoot,
  resolveSafe as packageResolveSafe,
  isRootProtected as packageIsRootProtected,
  assertNotProtected as packageAssertNotProtected,
} from '@geminilight/mindos';
import { MindOSError, ErrorCodes } from '@/lib/errors';

function toMindOSError(error: unknown, fallbackContext?: Record<string, unknown>): MindOSError {
  if (error instanceof MindOSError) {
    return error;
  }

  const maybeError = error as Error & { context?: Record<string, unknown> };
  return new MindOSError(
    ErrorCodes.PATH_OUTSIDE_ROOT,
    maybeError?.message || 'Access denied: path outside MIND_ROOT',
    maybeError?.context ?? fallbackContext,
  );
}

/**
 * Asserts that a resolved path is within the given root.
 */
export function assertWithinRoot(resolved: string, root: string): void {
  try {
    packageAssertWithinRoot(resolved, root);
  } catch (error) {
    throw toMindOSError(error, { resolved, root });
  }
}

/**
 * Resolves a relative file path against mindRoot and validates it is within bounds.
 * Returns the resolved absolute path.
 */
export function resolveSafe(mindRoot: string, filePath: string): string {
  try {
    return packageResolveSafe(mindRoot, filePath);
  } catch (error) {
    throw toMindOSError(error, { mindRoot, filePath });
  }
}

/**
 * Checks if a relative file path refers to a root-level protected file.
 */
export function isRootProtected(filePath: string): boolean {
  return packageIsRootProtected(filePath);
}

/**
 * Throws if the file is protected and cannot be modified via automated tools.
 */
export function assertNotProtected(filePath: string, operation: string): void {
  try {
    packageAssertNotProtected(filePath, operation);
  } catch (error) {
    const maybeError = error as Error & { context?: Record<string, unknown> };
    throw new MindOSError(
      ErrorCodes.PROTECTED_FILE,
      maybeError?.message || `Protected file: root "${filePath}" cannot be ${operation} via MCP.`,
      maybeError?.context ?? { filePath, operation },
    );
  }
}
