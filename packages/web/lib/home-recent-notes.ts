import fs from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from './core/security';

export type HomeRecentFile = { path: string; mtime: number };

function isUntouchedSpaceScaffold(file: HomeRecentFile, root: string): boolean {
  const basename = path.posix.basename(file.path);
  if (basename !== 'README.md' && basename !== 'INSTRUCTION.md') return false;
  try {
    const absolute = resolveExistingSafe(root, file.path);
    const directory = path.dirname(absolute);
    if (!fs.existsSync(path.join(directory, 'README.md'))
      || !fs.existsSync(path.join(directory, 'INSTRUCTION.md'))) return false;
    const stat = fs.statSync(absolute);
    // An edited Space guide is genuine recent work. Creation time can be
    // unavailable on some filesystems; in that case keep the original order.
    return stat.birthtimeMs > 0 && stat.mtimeMs <= stat.birthtimeMs + 10;
  } catch {
    // A disappearing or inaccessible file should not break Home rendering.
    return false;
  }
}

/** Favor actual work while retaining untouched Space guides when little else exists. */
export function selectHomeRecentNotes(files: HomeRecentFile[], root: string, limit = 3): HomeRecentFile[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const work: HomeRecentFile[] = [];
  const guides: HomeRecentFile[] = [];
  for (const file of files) {
    (isUntouchedSpaceScaffold(file, root) ? guides : work).push(file);
  }
  return [...work, ...guides].slice(0, Math.floor(limit));
}
