import path from 'path';
import { MindOSError, ErrorCodes } from '@/lib/errors';

/**
 * Asserts that a resolved path is within the given root.
 */
export function assertWithinRoot(resolved: string, root: string): void {
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new MindOSError(ErrorCodes.PATH_OUTSIDE_ROOT, 'Access denied: path outside MIND_ROOT', { resolved, root });
  }
}

/**
 * Resolves a relative file path against mindRoot and validates it is within bounds.
 * Returns the resolved absolute path.
 */
export function resolveSafe(mindRoot: string, filePath: string): string {
  const root = path.resolve(mindRoot);
  const resolved = path.resolve(path.join(root, filePath));
  assertWithinRoot(resolved, root);
  return resolved;
}

const ROOT_PROTECTED_FILES = new Set(['INSTRUCTION.md']);

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
    throw new MindOSError(
      ErrorCodes.PROTECTED_FILE,
      `Protected file: root "${filePath}" cannot be ${operation} via MCP. ` +
      `This is a system kernel file (§7 of INSTRUCTION.md). Edit it manually or use a dedicated confirmation workflow.`,
      { filePath, operation },
    );
  }
}
