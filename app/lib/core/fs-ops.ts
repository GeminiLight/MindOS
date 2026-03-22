import fs from 'fs';
import path from 'path';
import { resolveSafe, assertWithinRoot } from './security';
import { MindOSError, ErrorCodes } from '@/lib/errors';
import { scaffoldIfNewSpace } from './space-scaffold';

/**
 * Reads the content of a file given a relative path from mindRoot.
 */
export function readFile(mindRoot: string, filePath: string): string {
  const resolved = resolveSafe(mindRoot, filePath);
  return fs.readFileSync(resolved, 'utf-8');
}

/**
 * Atomically writes content to a file (temp file + rename).
 * Creates parent directories as needed.
 */
export function writeFile(mindRoot: string, filePath: string, content: string): void {
  const resolved = resolveSafe(mindRoot, filePath);
  const dir = path.dirname(resolved);
  const tmp = path.join(dir, `.tmp-${Date.now()}-${path.basename(resolved)}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, resolved);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Creates a new file. Throws if the file already exists.
 * Creates parent directories as needed.
 */
export function createFile(mindRoot: string, filePath: string, initialContent = ''): void {
  const resolved = resolveSafe(mindRoot, filePath);
  if (fs.existsSync(resolved)) {
    throw new MindOSError(ErrorCodes.FILE_ALREADY_EXISTS, `File already exists: ${filePath}`, { filePath });
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, initialContent, 'utf-8');
  scaffoldIfNewSpace(mindRoot, filePath);
}

/**
 * Deletes a file. Throws if the file does not exist.
 */
export function deleteFile(mindRoot: string, filePath: string): void {
  const resolved = resolveSafe(mindRoot, filePath);
  if (!fs.existsSync(resolved)) {
    throw new MindOSError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${filePath}`, { filePath });
  }
  fs.unlinkSync(resolved);
}

/**
 * Renames a file within its current directory.
 * newName must be a plain filename (no path separators).
 * Returns the new relative path.
 */
export function renameFile(mindRoot: string, oldPath: string, newName: string): string {
  if (newName.includes('/') || newName.includes('\\')) {
    throw new MindOSError(ErrorCodes.INVALID_PATH, 'Invalid filename: must not contain path separators', { newName });
  }
  const root = path.resolve(mindRoot);
  const oldResolved = path.resolve(path.join(root, oldPath));
  assertWithinRoot(oldResolved, root);

  const dir = path.dirname(oldResolved);
  const newResolved = path.join(dir, newName);
  assertWithinRoot(newResolved, root);

  if (fs.existsSync(newResolved)) {
    throw new MindOSError(ErrorCodes.FILE_ALREADY_EXISTS, 'A file with that name already exists', { newName });
  }
  fs.renameSync(oldResolved, newResolved);
  return path.relative(root, newResolved);
}

/**
 * Moves a file from one path to another within mindRoot.
 * Returns the new path and a list of files that referenced the old path.
 */
export function moveFile(
  mindRoot: string,
  fromPath: string,
  toPath: string,
  findBacklinksFn: (mindRoot: string, targetPath: string) => Array<{ source: string }>
): { newPath: string; affectedFiles: string[] } {
  const fromResolved = resolveSafe(mindRoot, fromPath);
  const toResolved = resolveSafe(mindRoot, toPath);
  if (!fs.existsSync(fromResolved)) throw new MindOSError(ErrorCodes.FILE_NOT_FOUND, `Source not found: ${fromPath}`, { fromPath });
  if (fs.existsSync(toResolved)) throw new MindOSError(ErrorCodes.FILE_ALREADY_EXISTS, `Destination already exists: ${toPath}`, { toPath });
  fs.mkdirSync(path.dirname(toResolved), { recursive: true });
  fs.renameSync(fromResolved, toResolved);
  const backlinks = findBacklinksFn(mindRoot, fromPath);
  return { newPath: toPath, affectedFiles: backlinks.map(b => b.source) };
}

/**
 * Returns files sorted by modification time, descending.
 */
export function getRecentlyModified(
  mindRoot: string,
  allFiles: string[],
  limit = 10
): Array<{ path: string; mtime: number; mtimeISO: string }> {
  const withMtime = allFiles.flatMap((filePath) => {
    try {
      const abs = path.join(mindRoot, filePath);
      const stat = fs.statSync(abs);
      return [{ path: filePath, mtime: stat.mtimeMs, mtimeISO: stat.mtime.toISOString() }];
    } catch {
      return [];
    }
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.slice(0, limit);
}
