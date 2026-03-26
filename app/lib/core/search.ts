import fs from 'fs';
import path from 'path';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import { SearchIndex } from './search-index';
import type { SearchResult, SearchOptions } from './types';

/**
 * Module-level search index singleton.
 * Lazily built on first search, invalidated by `invalidateSearchIndex()`.
 */
const searchIndex = new SearchIndex();

/** Invalidate the core search index. Called from `lib/fs.ts` on write operations. */
export function invalidateSearchIndex(): void {
  searchIndex.invalidate();
}

/**
 * Core literal search — used by MCP tools via REST API.
 *
 * This is a **case-insensitive literal string match** with occurrence-density scoring.
 * It supports scope, file_type, and modified_after filters that MCP tools expose.
 *
 * Performance: uses an in-memory inverted index to narrow the candidate file set
 * before doing full-text scanning. The index is built lazily on the first query
 * and invalidated on any write operation.
 *
 * NOTE: The App also has a separate Fuse.js fuzzy search in `lib/fs.ts` for the
 * browser `⌘K` search overlay. The two coexist intentionally:
 * - Core search (here): exact literal match, supports filters, used by MCP/API
 * - App search (lib/fs.ts): Fuse.js fuzzy match with CJK support, used by frontend
 */
export function searchFiles(mindRoot: string, query: string, opts: SearchOptions = {}): SearchResult[] {
  if (!query.trim()) return [];
  const { limit = 20, scope, file_type = 'all', modified_after } = opts;

  // Ensure search index is built for this mindRoot
  if (!searchIndex.isBuiltFor(mindRoot)) {
    searchIndex.rebuild(mindRoot);
  }

  // Use index to get candidate files (or null if index unavailable → full scan)
  const candidates = searchIndex.getCandidates(query);
  const candidateSet = candidates ? new Set(candidates) : null;

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

  // Narrow by index candidates (if available)
  if (candidateSet) {
    allFiles = allFiles.filter(f => candidateSet.has(f));
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

    // Try to find natural boundaries (paragraphs) around the match
    let snippetStart = content.lastIndexOf('\n\n', index);
    if (snippetStart === -1) snippetStart = Math.max(0, index - 200);
    else snippetStart += 2; // skip the newlines

    let snippetEnd = content.indexOf('\n\n', index);
    if (snippetEnd === -1) snippetEnd = Math.min(content.length, index + query.length + 200);

    // Prevent massive blocks (cap at ~400 chars total)
    if (index - snippetStart > 200) snippetStart = index - 200;
    if (snippetEnd - index > 200) snippetEnd = index + query.length + 200;

    let snippet = content.slice(snippetStart, snippetEnd).trim();
    
    // Collapse internal whitespace for cleaner search result presentation, but preserve some structure
    snippet = snippet.replace(/\n{3,}/g, '\n\n');
    
    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < content.length) snippet += '...';

    const occurrences = (lowerContent.match(new RegExp(escapedQuery, 'g')) ?? []).length;
    const score = occurrences / content.length;

    results.push({ path: filePath, snippet, score, occurrences });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
