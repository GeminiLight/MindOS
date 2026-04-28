/**
 * File operations utilities.
 * Used for recursive directory copying and other file system tasks.
 */

import fs from 'fs';
import path from 'path';

/**
 * Recursively copy a directory and all its contents.
 *
 * @param src Source directory path
 * @param dst Destination directory path
 * @throws Error if source doesn't exist or copy fails
 */
export async function copyDir(src: string, dst: string): Promise<void> {
  // Create destination directory
  await fs.promises.mkdir(dst, { recursive: true });

  // Read source directory
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      // Recursively copy subdirectory
      await copyDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      // Copy file
      await fs.promises.copyFile(srcPath, dstPath);
    } else if (entry.isSymbolicLink()) {
      // Copy symbolic link target
      const linkTarget = await fs.promises.readlink(srcPath);
      await fs.promises.symlink(linkTarget, dstPath);
    }
  }
}

/**
 * Check if a directory exists.
 */
export function dirExists(dir: string): boolean {
  try {
    const stat = fs.statSync(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create a directory recursively.
 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}
