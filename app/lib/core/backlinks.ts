import path from 'path';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import type { BacklinkEntry } from './types';

/**
 * Finds files that reference the given targetPath via wikilinks,
 * markdown links, or backtick references.
 */
export function findBacklinks(mindRoot: string, targetPath: string, cachedFiles?: string[]): BacklinkEntry[] {
  const allFiles = (cachedFiles ?? collectAllFiles(mindRoot)).filter(f => f.endsWith('.md') && f !== targetPath);
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
        // Expand to a slightly larger context block for agent comprehension
        // Attempt to find paragraph boundaries (empty lines) or cap at a reasonable size
        let start = i;
        while (start > 0 && start > i - 3 && lines[start].trim() !== '') start--;
        let end = i;
        while (end < lines.length - 1 && end < i + 3 && lines[end].trim() !== '') end++;
        
        let ctx = lines.slice(start, end + 1).join('\n').trim();
        // Collapse multiple newlines in the context to save tokens, but keep simple structure
        ctx = ctx.replace(/\n{2,}/g, ' ↵ ');
        
        results.push({ source: filePath, line: i + 1, context: ctx });
        break; // currently only records the first match per file
      }
    }
  }
  return results;
}
