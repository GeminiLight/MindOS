/**
 * Active Recall — automatically search the knowledge base and return relevant
 * content to inject into the agent's system prompt before it replies.
 *
 * Design decisions:
 * - Uses hybridSearch (BM25 + embedding) instead of a sub-agent: zero API cost, <100ms.
 * - Expands search snippets (~400 chars) to ~800 chars by re-reading the file.
 * - Excludes meta-files (README.md, INSTRUCTION.md, CONFIG.json) already in bootstrap.
 * - Token budget is greedy-fill: highest score first, truncate last entry if needed.
 */

import path from 'path';
import { hybridSearch } from '@/lib/core/hybrid-search';
import { estimateStringTokens } from './context';
import { getFileContent } from '@/lib/fs';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecallResult {
  /** Relative file path within the knowledge base. */
  path: string;
  /** Expanded content paragraph (~800 chars). */
  content: string;
  /** Search relevance score. */
  score: number;
}

export interface RecallOptions {
  maxTokens: number;
  maxFiles: number;
  minScore: number;
  /** Search timeout in ms. Default 2000. */
  timeoutMs: number;
  /** File paths already in context (attached + currentFile) — skip these. */
  excludePaths: string[];
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: RecallOptions = {
  maxTokens: 2000,
  maxFiles: 5,
  minScore: 1.0,
  timeoutMs: 2000,
  excludePaths: [],
};

/** Meta-file basenames that are already loaded in bootstrap context. */
const META_BASENAMES = new Set([
  'readme.md',
  'instruction.md',
  'config.json',
]);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Search the knowledge base and return relevant content for the user's query.
 *
 * Flow: search → filter score → exclude attached/meta → expand snippets → fit budget
 */
export async function performActiveRecall(
  mindRoot: string,
  userQuery: string,
  options?: Partial<RecallOptions>,
): Promise<RecallResult[]> {
  const opts: RecallOptions = { ...DEFAULTS, ...options };
  const excludeSet = new Set(opts.excludePaths);

  // Skip queries that are too short to be meaningful
  const query = userQuery.length > 500 ? userQuery.slice(0, 500) : userQuery;
  if (query.trim().length < 2) return [];

  // Search with timeout
  let searchResults;
  try {
    searchResults = await Promise.race([
      hybridSearch(mindRoot, query, { limit: opts.maxFiles * 3 }),
      rejectAfter(opts.timeoutMs),
    ]);
  } catch {
    return []; // timeout or error → silent fallback
  }

  // Filter: score threshold + exclude attached files + exclude meta-files
  const filtered = searchResults.filter(r => {
    if (r.score < opts.minScore) return false;
    if (excludeSet.has(r.path)) return false;
    if (isMetaFile(r.path)) return false;
    return true;
  });

  if (filtered.length === 0) return [];

  // Expand snippets and fit within token budget
  const results: RecallResult[] = [];
  let usedTokens = 0;

  for (const hit of filtered) {
    if (results.length >= opts.maxFiles) break;

    const content = expandSnippet(hit.path, hit.snippet, query);
    const tokens = estimateStringTokens(content);

    if (usedTokens + tokens > opts.maxTokens) {
      // Try to fit a truncated version
      const remaining = opts.maxTokens - usedTokens;
      if (remaining > 100) {
        results.push({
          path: hit.path,
          content: truncateToTokenBudget(content, remaining),
          score: hit.score,
        });
      }
      break;
    }

    results.push({ path: hit.path, content, score: hit.score });
    usedTokens += tokens;
  }

  return results;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Check if a path is a meta-file (README/INSTRUCTION/CONFIG at any depth). */
function isMetaFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return META_BASENAMES.has(basename);
}

/**
 * Expand a search snippet (~400 chars) to ~800 chars by re-reading the file
 * and extracting a larger window around the match location.
 */
function expandSnippet(filePath: string, fallbackSnippet: string, query: string): string {
  const MAX_CHARS = 800;
  let fullContent: string;
  try {
    fullContent = getFileContent(filePath);
  } catch {
    return fallbackSnippet;
  }

  if (fullContent.length <= MAX_CHARS) return fullContent;

  // Find keyword anchor in full content
  const lower = fullContent.toLowerCase();
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  let anchor = -1;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) { anchor = idx; break; }
  }
  if (anchor === -1) anchor = 0;

  // Expand to paragraph boundaries
  const half = Math.floor(MAX_CHARS / 2);

  let start = fullContent.lastIndexOf('\n\n', Math.max(0, anchor - half));
  if (start === -1 || anchor - start > half) start = Math.max(0, anchor - half);
  else start += 2; // skip the \n\n

  let end = fullContent.indexOf('\n\n', Math.min(fullContent.length, anchor + half));
  if (end === -1 || end - anchor > half) end = Math.min(fullContent.length, anchor + half);

  let section = fullContent.slice(start, end).trim();
  if (start > 0) section = '...' + section;
  if (end < fullContent.length) section += '...';

  return section;
}

/** Truncate text to fit within a token budget. ~3 chars per token (CJK/ASCII mix). */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const chars = maxTokens * 3;
  if (text.length <= chars) return text;
  return text.slice(0, chars) + '...';
}

/** Promise that rejects after ms. Used for Promise.race timeout. */
function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}
