import fs from 'fs';
import path from 'path';
import os from 'os';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import { SearchIndex } from './search-index';
import type { SearchResult, SearchOptions } from './types';
import { updateEmbeddingFile, removeEmbeddingFile, invalidateEmbeddingIndex } from './hybrid-search';
import { telemetry } from '../telemetry';
/**
 * Module-level search index singleton.
 * Lazily built on first search, invalidated by `invalidateSearchIndex()`.
 */
const searchIndex = new SearchIndex();

/** Path to ~/.mindos/ for index persistence. */
function getMindosDir(): string {
  return path.join(os.homedir(), '.mindos');
}

/** Invalidate the core search index. Called from `lib/fs.ts` on write operations. */
export function invalidateSearchIndex(): void {
  searchIndex.invalidate();
  invalidateEmbeddingIndex();
}

/** Incrementally update a single file in the search index (after write/edit). */
export function updateSearchIndexFile(mindRoot: string, filePath: string): void {
  if (!searchIndex.isBuilt()) return;
  searchIndex.updateFile(mindRoot, filePath);
  schedulePersist();
  // Also update embedding index (async, non-blocking)
  updateEmbeddingFile(mindRoot, filePath);
}

/** Incrementally add a new file to the search index (after create). */
export function addSearchIndexFile(mindRoot: string, filePath: string): void {
  if (!searchIndex.isBuilt()) return;
  searchIndex.addFile(mindRoot, filePath);
  schedulePersist();
  // Also update embedding index (async, non-blocking)
  updateEmbeddingFile(mindRoot, filePath);
}

/** Incrementally remove a file from the search index (after delete). */
export function removeSearchIndexFile(filePath: string): void {
  if (!searchIndex.isBuilt()) return;
  searchIndex.removeFile(filePath);
  schedulePersist();
  removeEmbeddingFile(filePath);
}

/** Debounced persist — writes index to disk 5s after last write operation. */
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _persistDirty = false;

function schedulePersist(): void {
  _persistDirty = true;
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(flushPersist, 5000);
}

/** Immediately flush pending index to disk (used by exit hooks). */
function flushPersist(): void {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  if (!_persistDirty) return;
  _persistDirty = false;
  try { searchIndex.persist(getMindosDir()); } catch { /* non-critical */ }
}

// Ensure index is persisted before process exits
if (typeof process !== 'undefined') {
  process.on('beforeExit', flushPersist);
  process.on('SIGTERM', () => { flushPersist(); process.exit(0); });
  process.on('SIGINT', () => { flushPersist(); process.exit(0); });
}

/* ── BM25 Parameters ── */
const BM25_K1 = 1.2;  // Term frequency saturation
const BM25_B = 0.75;  // Document length normalization

/**
 * Compute BM25 score for a single term in a single document.
 *
 * @param tf          - raw term frequency (occurrences of term in doc)
 * @param df          - document frequency (number of docs containing term)
 * @param docLength   - length of this document (chars)
 * @param avgDocLength - average document length across corpus (chars)
 * @param totalDocs   - total number of documents in corpus
 */
export function bm25Score(
  tf: number,
  df: number,
  docLength: number,
  avgDocLength: number,
  totalDocs: number,
): number {
  if (tf === 0 || totalDocs === 0 || avgDocLength === 0) return 0;

  // IDF: log((N - df + 0.5) / (df + 0.5) + 1) — the +1 prevents negative IDF
  // when df > N/2 (common terms)
  const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);

  // Normalized TF with saturation and length normalization
  const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docLength / avgDocLength));

  return idf * tfNorm;
}

/**
 * Split a query into individual search terms for multi-term BM25 scoring.
 * Each term is scored independently, then scores are summed per document.
 */
function splitQueryTerms(query: string): string[] {
  const lower = query.toLowerCase().trim();
  // Split on whitespace, filter empty
  const terms = lower.split(/\s+/).filter(t => t.length > 0);
  // Deduplicate
  return [...new Set(terms)];
}

/**
 * Count how many times a term appears in text using word-boundary-aware matching.
 * For Latin terms: uses word boundaries (\b)
 * For CJK terms: just counts substring occurrences (CJK has no word boundaries in regex)
 *
 * Caches compiled RegExp per term to avoid recompilation on each file (O(files) → O(1) per term).
 */
const _termRegexCache = new Map<string, RegExp>();

function getTermRegex(term: string): RegExp {
  let cached = _termRegexCache.get(term);
  if (cached) return cached;

  const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
  const hasCJK = cjkRegex.test(term);
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  cached = hasCJK
    ? new RegExp(escapedTerm, 'g')
    : new RegExp(`\\b${escapedTerm}\\b`, 'g');

  // Bound cache size to prevent unbounded memory growth
  if (_termRegexCache.size > 500) _termRegexCache.clear();
  _termRegexCache.set(term, cached);
  return cached;
}

function countTermOccurrences(term: string, text: string): number {
  const regex = getTermRegex(term);
  regex.lastIndex = 0; // reset stateful /g regex
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Prewarm the core search index for a given mindRoot.
 * Tries loading from disk first (fast path), falls back to full rebuild.
 * Returns the number of indexed files and whether the index was loaded or built.
 */
export async function prewarmCoreSearchIndex(mindRoot: string): Promise<{ cacheState: 'hit' | 'loaded' | 'built'; fileCount: number }> {
  if (searchIndex.isBuiltFor(mindRoot)) {
    telemetry.track('search.core.prewarm', { cacheState: 'hit', fileCount: searchIndex.getFileCount() });
    return { cacheState: 'hit', fileCount: searchIndex.getFileCount() };
  }

  const stopLoad = telemetry.startTimer('search.core.prewarm.load');
  const loaded = searchIndex.load(getMindosDir(), mindRoot);
  stopLoad({ loaded, fileCount: loaded ? searchIndex.getFileCount() : 0 });

  if (loaded) {
    telemetry.track('search.core.prewarm', { cacheState: 'loaded', fileCount: searchIndex.getFileCount() });
    return { cacheState: 'loaded', fileCount: searchIndex.getFileCount() };
  }

  // Use async worker rebuild to avoid blocking the event loop
  await searchIndex.rebuildAsync(mindRoot);
  try { searchIndex.persist(getMindosDir()); } catch { /* non-critical */ }

  telemetry.track('search.core.prewarm', { cacheState: 'built', fileCount: searchIndex.getFileCount() });
  return { cacheState: 'built', fileCount: searchIndex.getFileCount() };
}

/**
 * Core literal search — used by MCP tools via REST API.
 *
 * Scoring: **BM25** (Best Matching 25) — the standard information retrieval
 * ranking function. For multi-term queries, each term is scored independently
 * and scores are summed. This means:
 * - Rare terms (low document frequency) contribute more to the score
 * - Term frequency has diminishing returns (saturation at k1)
 * - Shorter documents score higher when term frequency is equal
 *
 * Candidate narrowing: uses an in-memory inverted index with UNION semantics
 * for multi-term queries (a document matching ANY term is a candidate).
 *
 * NOTE: The App also has a separate Fuse.js fuzzy search in `lib/fs.ts` for the
 * browser `⌘K` search overlay. The two coexist intentionally:
 * - Core search (here): BM25 ranking, used by MCP/API/Agent
 * - App search (lib/fs.ts): Fuse.js fuzzy match, used by frontend ⌘K
 */
export function searchFiles(mindRoot: string, query: string, opts: SearchOptions = {}): SearchResult[] {
  if (!query.trim()) return [];
  const { limit = 20, scope, file_type = 'all', modified_after } = opts;

  // Ensure search index is built for this mindRoot
  if (!searchIndex.isBuiltFor(mindRoot)) {
    // Try loading from disk first (fast path — avoids full rebuild)
    const stopIndexLoad = telemetry.startTimer('search.core.index.load');
    const loaded = searchIndex.load(getMindosDir(), mindRoot);
    stopIndexLoad({ loaded, fileCount: loaded ? searchIndex.getFileCount() : 0 });
    if (!loaded) {
      searchIndex.rebuild(mindRoot);
      // Persist for next cold start (fire-and-forget)
      try { searchIndex.persist(getMindosDir()); } catch { /* non-critical */ }
    }
  }

  const totalDocs = searchIndex.getFileCount();
  const avgDocLength = searchIndex.getAvgDocLength();

  const queryTerms = splitQueryTerms(query);
  const stopQuery = telemetry.startTimer('search.core.query', {
    queryLen: query.length,
    queryTermCount: queryTerms.length,
    totalDocs,
  });

  // Use UNION index to get candidate files (any file matching any term)
  const candidates = searchIndex.getCandidatesUnion(query);
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

  // ── Pre-scan: compute document frequency for each query term ──
  // FIXED: Now uses consistent term counting (word boundaries for Latin, substring for CJK)
  const termDf = new Map<string, number>();
  const fileContents = new Map<string, string>();

  for (const filePath of allFiles) {
    if (mtimeThreshold > 0) {
      try {
        const abs = path.join(mindRoot, filePath);
        const stat = fs.statSync(abs);
        if (stat.mtimeMs < mtimeThreshold) continue;
      } catch { continue; }
    }

    let content: string;
    try { content = readFile(mindRoot, filePath); } catch { continue; }

    const lower = content.toLowerCase();
    fileContents.set(filePath, content);

    for (const term of queryTerms) {
      // Use consistent term counting with word boundaries for Latin terms
      if (countTermOccurrences(term, lower) > 0) {
        termDf.set(term, (termDf.get(term) ?? 0) + 1);
      }
    }
  }

  // ── Score each document with BM25 ──
  for (const [filePath, content] of fileContents) {
    const lowerContent = content.toLowerCase();

    // Check if document matches any term (full-text verification after index narrowing)
    let matchedAnyTerm = false;
    let firstMatchIndex = -1;

    // Compute BM25 score: sum of per-term scores
    let totalScore = 0;
    let totalOccurrences = 0;
    const docLength = content.length;

    for (const term of queryTerms) {
      const tf = countTermOccurrences(term, lowerContent);
      if (tf === 0) continue;

      matchedAnyTerm = true;
      totalOccurrences += tf;

      if (firstMatchIndex === -1) {
        firstMatchIndex = lowerContent.indexOf(term);
      }

      // Get document frequency for this term (computed in pre-scan)
      const df = termDf.get(term) ?? 0;

      totalScore += bm25Score(tf, df, docLength, avgDocLength, totalDocs);
    }

    if (!matchedAnyTerm) continue;

    // Build snippet around the first match
    const index = firstMatchIndex >= 0 ? firstMatchIndex : lowerContent.indexOf(lowerQuery);
    const snippetAnchor = index >= 0 ? index : 0;

    let snippetStart = content.lastIndexOf('\n\n', snippetAnchor);
    if (snippetStart === -1) snippetStart = Math.max(0, snippetAnchor - 200);
    else snippetStart += 2;

    let snippetEnd = content.indexOf('\n\n', snippetAnchor);
    if (snippetEnd === -1) snippetEnd = Math.min(content.length, snippetAnchor + query.length + 200);

    if (snippetAnchor - snippetStart > 200) snippetStart = snippetAnchor - 200;
    if (snippetEnd - snippetAnchor > 200) snippetEnd = snippetAnchor + query.length + 200;

    let snippet = content.slice(snippetStart, snippetEnd).trim();
    snippet = snippet.replace(/\n{3,}/g, '\n\n');
    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < content.length) snippet += '...';

    results.push({ path: filePath, snippet, score: totalScore, occurrences: totalOccurrences });
  }

  results.sort((a, b) => b.score - a.score);
  const limitedResults = results.slice(0, limit);
  stopQuery({
    candidateCount: candidateSet ? candidateSet.size : allFiles.length,
    resultCount: limitedResults.length,
  });
  return limitedResults;
}
