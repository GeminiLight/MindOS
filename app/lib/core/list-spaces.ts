import path from 'path';
import type { FileNode } from './types';
import { readFile } from './fs-ops';

/** One top-level Mind Space (aligned with home page Spaces grid). */
export interface MindSpaceSummary {
  /** Directory entry name as on disk (may include leading emoji). */
  name: string;
  /** Relative path to the space directory, forward slashes only. */
  path: string;
  /** Count of .md/.csv files under this space (recursive). */
  fileCount: number;
  /** First non-empty body line from README.md after the title, or empty. */
  description: string;
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
}

function toPosixRel(p: string): string {
  return p.split(path.sep).join('/');
}

function extractDescription(mindRoot: string, dirRelPosix: string): string {
  const readmeRel = `${dirRelPosix}/README.md`;
  try {
    const content = readFile(mindRoot, readmeRel);
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      return trimmed;
    }
  } catch {
    /* no README */
  }
  return '';
}

/**
 * Build summaries from the **app file tree** (same nodes as home Spaces).
 * Caller passes `getFileTree()` so ignore rules match the UI cache.
 */
export function summarizeTopLevelSpaces(mindRoot: string, tree: FileNode[]): MindSpaceSummary[] {
  return tree
    .filter((n) => n.type === 'directory' && !n.name.startsWith('.'))
    .map((n) => {
      const posix = toPosixRel(n.path);
      return {
        name: n.name,
        path: posix,
        fileCount: countFiles(n),
        description: extractDescription(mindRoot, posix),
      };
    });
}
