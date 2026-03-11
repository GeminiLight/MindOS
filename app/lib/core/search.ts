import fs from 'fs';
import path from 'path';
import { resolveSafe } from './security';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import type { SearchResult, SearchOptions } from './types';

/**
 * Core literal search — used by MCP tools via REST API.
 *
 * This is a **case-insensitive literal string match** with occurrence-density scoring.
 * It supports scope, file_type, and modified_after filters that MCP tools expose.
 *
 * NOTE: The App also has a separate Fuse.js fuzzy search in `lib/fs.ts` for the
 * browser `⌘K` search overlay. The two coexist intentionally:
 * - Core search (here): exact literal match, supports filters, used by MCP/API
 * - App search (lib/fs.ts): Fuse.js fuzzy match with CJK support, used by frontend
 */
export function searchFiles(mindRoot: string, query: string, opts: SearchOptions = {}): SearchResult[] {
  if (!query.trim()) return [];
  const { limit = 20, scope, file_type = 'all', modified_after } = opts;

  let allFiles = collectAllFiles(mindRoot);

  // Filter by scope (directory prefix)
  if (scope) {
    const normalizedScope = scope.endsWith('/') ? scope : scope + '/';
    allFiles = allFiles.filter(f => f.startsWith(normalizedScope) || f === scope);
  }

  // Filter by file type
  if (file_type !== 'all') {
    const ext = `.${file_type}`;
    allFiles = allFiles.filter(f => f.endsWith(ext));
  }

  // Filter by modification time
  let mtimeThreshold = 0;
  if (modified_after) {
    mtimeThreshold = new Date(modified_after).getTime();
    if (isNaN(mtimeThreshold)) mtimeThreshold = 0;
  }

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const escapedQuery = lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const filePath of allFiles) {
    // Check mtime filter before reading content
    if (mtimeThreshold > 0) {
      try {
        const abs = path.join(mindRoot, filePath);
        const stat = fs.statSync(abs);
        if (stat.mtimeMs < mtimeThreshold) continue;
      } catch { continue; }
    }

    let content: string;
    try { content = readFile(mindRoot, filePath); } catch { continue; }

    const lowerContent = content.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);
    if (index === -1) continue;

    const snippetStart = Math.max(0, index - 60);
    const snippetEnd = Math.min(content.length, index + query.length + 60);
    let snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, ' ').trim();
    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < content.length) snippet += '...';

    const occurrences = (lowerContent.match(new RegExp(escapedQuery, 'g')) ?? []).length;
    const score = occurrences / content.length;

    results.push({ path: filePath, snippet, score, occurrences });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
