import path from 'path';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import type { BacklinkEntry } from './types';

/**
 * Finds files that reference the given targetPath via wikilinks,
 * markdown links, or backtick references.
 *
 * Uses the pre-built LinkIndex for O(1) source lookup, then scans
 * only the matching files for line-level context. This reduces the
 * scanning cost from O(all-files * lines * patterns) to
 * O(linking-files * lines * patterns).
 *
 * @param mindRoot  - absolute path to MIND_ROOT
 * @param targetPath - relative file path to find backlinks for
 * @param linkingSources - optional pre-computed list of files that link to targetPath
 *                         (from LinkIndex.getBacklinks). If omitted, falls back to full scan.
 * @param cachedFiles - optional full file list (legacy, used when linkingSources not available)
 */
export function findBacklinks(
  mindRoot: string,
  targetPath: string,
  linkingSources?: string[],
  cachedFiles?: string[],
): BacklinkEntry[] {
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

  // Use linkingSources from LinkIndex (O(1) lookup) when available,
  // otherwise fall back to scanning all .md files
  let filesToScan: string[];
  if (linkingSources) {
    filesToScan = linkingSources;
  } else if (cachedFiles) {
    filesToScan = cachedFiles.filter(f => f.endsWith('.md') && f !== targetPath);
  } else {
    filesToScan = collectAllFiles(mindRoot).filter(f => f.endsWith('.md') && f !== targetPath);
  }

  for (const filePath of filesToScan) {
    if (filePath === targetPath) continue;
    let content: string;
    try { content = readFile(mindRoot, filePath); } catch { continue; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (patterns.some(p => p.test(lines[i]))) {
        let start = i;
        while (start > 0 && start > i - 3 && lines[start].trim() !== '') start--;
        let end = i;
        while (end < lines.length - 1 && end < i + 3 && lines[end].trim() !== '') end++;

        let ctx = lines.slice(start, end + 1).join('\n').trim();
        ctx = ctx.replace(/\n{2,}/g, ' ↵ ');

        results.push({ source: filePath, line: i + 1, context: ctx });
        break;
      }
    }
  }
  return results;
}
