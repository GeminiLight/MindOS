import path from 'path';
import {
  MindosSearchIndex,
  bm25Score,
  tokenizeSearchText,
  type MindosSearchHit,
} from '@geminilight/mindos/server';
import { extractPdfText } from './pdf-text';
import { getWebTreeCache, isRootSystemFile } from './mind-root-cache';
import { isDefaultMindSystemScaffoldFile } from '../mind-system-scaffold';
import type { SearchResult, SearchOptions } from './types';
import { telemetry } from '../telemetry';

/**
 * Web adapter over the core search index (`@geminilight/mindos/server`).
 *
 * The index implementation (CJK tokenizer, BM25, incremental refresh) lives in
 * the core package; this module only configures it for the Web app — file
 * stats from the shared tree cache, `.md`/`.csv` text plus PDF extraction, the
 * root system files and default Mind System scaffold excluded — and keeps the
 * embedding-index bookkeeping and telemetry that only exist in Web.
 */

export { bm25Score, tokenizeSearchText };

type CoreSearchPrewarmResult = { cacheState: 'hit' | 'built'; fileCount: number };
type CoreSearchEnsureResult = CoreSearchPrewarmResult | { cacheState: 'miss'; fileCount: 0 };

const indexes = new Map<string, MindosSearchIndex>();

function indexFor(mindRoot: string): MindosSearchIndex {
  const root = path.resolve(mindRoot);
  let index = indexes.get(root);
  if (!index) {
    const cache = getWebTreeCache(root);
    index = new MindosSearchIndex(root, {
      listFiles: () => cache.collectFileStats(),
      textExtensions: ['.md', '.csv'],
      extractors: { '.pdf': (absolutePath) => extractPdfText(absolutePath) },
      shouldIndex: (relativePath) => !isRootSystemFile(relativePath) && !isDefaultMindSystemScaffoldFile(root, relativePath),
    });
    indexes.set(root, index);
  }
  return index;
}

function existingIndex(mindRoot: string): MindosSearchIndex | null {
  return indexes.get(path.resolve(mindRoot)) ?? null;
}

function treeVersionHint(mindRoot: string): { treeVersion: number } {
  return { treeVersion: getWebTreeCache(mindRoot).getTreeVersion() };
}

function invalidateEmbeddingIndexLazy(): void {
  void import('./hybrid-search')
    .then(({ invalidateEmbeddingIndex }) => invalidateEmbeddingIndex())
    .catch(() => {});
}

function updateEmbeddingFileLazy(mindRoot: string, filePath: string): void {
  void import('./hybrid-search')
    .then(({ updateEmbeddingFile }) => updateEmbeddingFile(mindRoot, filePath))
    .catch(() => {});
}

function removeEmbeddingFileLazy(filePath: string): void {
  void import('./hybrid-search')
    .then(({ removeEmbeddingFile }) => removeEmbeddingFile(filePath))
    .catch(() => {});
}

/**
 * Mark every Web index stale so the next search re-compares file stats
 * (incremental: unchanged files stay indexed). Called from `lib/fs.ts` after
 * structural writes and by `/api/file/import`.
 */
export function invalidateSearchIndex(): void {
  for (const index of indexes.values()) index.markStale();
  invalidateEmbeddingIndexLazy();
}

/** Incrementally (re-)index a single file after write/edit/create. */
export function updateSearchIndexFile(mindRoot: string, filePath: string): void {
  const index = existingIndex(mindRoot);
  if (!index || !index.isBuilt()) return;
  index.updateFile(filePath);
  updateEmbeddingFileLazy(mindRoot, filePath);
}

/** Incrementally add a new file (same as update: the index stats the path). */
export function addSearchIndexFile(mindRoot: string, filePath: string): void {
  updateSearchIndexFile(mindRoot, filePath);
}

/** Incrementally remove a file, or a whole directory subtree, from every index. */
export function removeSearchIndexPath(relPath: string): void {
  for (const index of indexes.values()) {
    if (!index.isBuilt()) continue;
    for (const removed of index.removePath(relPath)) removeEmbeddingFileLazy(removed);
  }
}

/** Incrementally remove a file from the search index (after delete). */
export function removeSearchIndexFile(filePath: string): void {
  removeSearchIndexPath(filePath);
}

// ── Cold-build PDF budget ────────────────────────────────────────────────
// A cold in-request refresh reads text files inline (fast) but defers PDF
// extraction beyond this time budget to a background task, so the first
// search after a restart is not blocked by minutes of PDF parsing.
const DEFAULT_COLD_PDF_BUDGET_MS = 3_000;
let _coldPdfBudgetMs = DEFAULT_COLD_PDF_BUDGET_MS;
let _deferredPdfTask: Promise<void> = Promise.resolve();

/** Test hook: override the inline-PDF time budget (null restores the default). */
export function __setColdBuildPdfBudgetForTests(budgetMs: number | null): void {
  _coldPdfBudgetMs = budgetMs ?? DEFAULT_COLD_PDF_BUDGET_MS;
}

/** Test hook: resolves once all currently scheduled deferred PDFs are indexed. */
export function __waitForDeferredPdfIndexingForTests(): Promise<void> {
  return _deferredPdfTask;
}

function scheduleDeferredPdfIndexing(mindRoot: string, deferredPdfs: string[]): void {
  if (deferredPdfs.length === 0) return;
  const index = indexFor(mindRoot);
  _deferredPdfTask = _deferredPdfTask.then(async () => {
    for (const pdfPath of deferredPdfs) {
      if (existingIndex(mindRoot) !== index || !index.isBuilt()) return;
      try {
        // updateFile re-extracts the PDF and replaces the placeholder entry;
        // extraction failures drop the entry and keep the rest going.
        index.updateFile(pdfPath);
      } catch { /* skip corrupt pdf, keep the rest */ }
      await Promise.resolve(); // yield between files
    }
  });
}

/** Refresh the index for `mindRoot` (incremental; PDFs beyond the budget are deferred). */
function refreshIndex(mindRoot: string): CoreSearchPrewarmResult {
  const index = indexFor(mindRoot);
  const stop = telemetry.startTimer('search.core.refresh');
  const { cacheState, deferred } = index.refresh(treeVersionHint(mindRoot), { extractionBudgetMs: _coldPdfBudgetMs });
  scheduleDeferredPdfIndexing(mindRoot, deferred);
  stop({ cacheState, fileCount: index.getFileCount(), deferredPdfCount: deferred.length });
  return { cacheState, fileCount: index.getFileCount() };
}

/** Prewarm the core search index for a given mindRoot (`/api/search/prewarm`). */
export async function prewarmCoreSearchIndex(mindRoot: string): Promise<CoreSearchPrewarmResult> {
  const result = refreshIndex(mindRoot);
  telemetry.track('search.core.prewarm', { cacheState: result.cacheState, fileCount: result.fileCount });
  return result;
}

/** Report whether an index exists for `mindRoot` without building one (hybrid search). */
export async function ensureCoreSearchIndexReady(mindRoot: string): Promise<CoreSearchEnsureResult> {
  const index = existingIndex(mindRoot);
  if (index?.isBuilt()) return { cacheState: 'hit', fileCount: index.getFileCount() };
  return { cacheState: 'miss', fileCount: 0 };
}

function toSearchResult(hit: MindosSearchHit): SearchResult {
  return { path: hit.path, snippet: hit.snippet, score: hit.score, occurrences: hit.occurrences };
}

/**
 * Core literal search — used by MCP tools via REST API and by hybrid search.
 *
 * Scoring is BM25 over the union of files matching any query token (see
 * `@geminilight/mindos/server` `MindosSearchIndex`). The App also has an
 * embedding index (`hybrid-search.ts`) merged with these results via RRF.
 */
export function searchFiles(mindRoot: string, query: string, opts: SearchOptions = {}): SearchResult[] {
  if (!query.trim()) return [];
  const { limit = 20 } = opts;
  if (limit <= 0) return [];

  refreshIndex(mindRoot);
  const index = indexFor(mindRoot);
  const stop = telemetry.startTimer('search.core.query', { queryLen: query.length, totalDocs: index.getFileCount() });
  const results = index.search(query, { ...opts, limit }, treeVersionHint(mindRoot)).map(toSearchResult);
  stop({ resultCount: results.length });
  return results;
}
