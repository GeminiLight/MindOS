import path from 'path';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import type { BacklinkEntry } from './types';

/**
 * Finds files that reference the given targetPath via wikilinks,
 * markdown links, or backtick references.
 */
export function findBacklinks(mindRoot: string, targetPath: string): BacklinkEntry[] {
  const allFiles = collectAllFiles(mindRoot).filter(f => f.endsWith('.md') && f !== targetPath);
  const results: BacklinkEntry[] = [];
  const bname = path.basename(targetPath, '.md');
  const escapedTarget = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedBname = bname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = [
    new RegExp(`\\[\\[${escapedBname}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
    new RegExp(`\\[\\[${escapedTarget}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
    new RegExp(`\\[[^\\]]+\\]\\(${escapedTarget}(?:#[^)]*)?\\)`, 'i'),
    new RegExp(`\\[[^\\]]+\\]\\([^)]*${escapedBname}\\.md(?:#[^)]*)?\\)`, 'i'),
    new RegExp('`' + escapedTarget.replace(/\//g, '\\/') + '`'),
  ];

  for (const filePath of allFiles) {
    let content: string;
    try { content = readFile(mindRoot, filePath); } catch { continue; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (patterns.some(p => p.test(lines[i]))) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        const ctx = lines.slice(start, end + 1).join('\n').trim();
        results.push({ source: filePath, line: i + 1, context: ctx });
        break;
      }
    }
  }
  return results;
}
