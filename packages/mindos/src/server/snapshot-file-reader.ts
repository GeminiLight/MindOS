import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

export function checkedSnapshotPath(root: string, parts: readonly string[]): string {
  let target = root;
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[/\\:\x00-\x1f\x7f]/.test(part)) throw new Error('Invalid snapshot path');
    target = join(target, part);
    if (lstatSync(target).isSymbolicLink()) throw new Error('Snapshot symlink is not allowed');
  }
  return target;
}

/** Bounded inode-checked read shared by code assets and approved Vault bytes. */
export function readSnapshotFile(root: string, parts: readonly string[], maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024) throw new Error('Invalid snapshot limit');
  const target = checkedSnapshotPath(root, parts); const before = lstatSync(target);
  if (!before.isFile()) throw new Error('Snapshot contains a non-regular file');
  if (before.nlink !== 1) throw new Error('Snapshot hard link is not allowed');
  if (before.size > maxBytes) throw new Error('Snapshot size limit exceeded');
  const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('Snapshot changed while reading');
    const buffer = Buffer.allocUnsafe(before.size + 1); let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break; size += count;
    }
    const after = fstatSync(fd); const current = lstatSync(checkedSnapshotPath(root, parts));
    if (size !== before.size || after.nlink !== 1 || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || current.dev !== opened.dev || current.ino !== opened.ino) throw new Error('Snapshot changed while reading');
    return { bytes: buffer.subarray(0, size), stat: opened };
  } finally { closeSync(fd); }
}
