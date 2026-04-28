/**
 * Hybrid search: BM25 + Embedding with Reciprocal Rank Fusion (RRF).
 *
 * When embedding is enabled and ready, runs both BM25 and embedding search,
 * then merges results using RRF. When embedding is disabled or not ready,
 * falls back to pure BM25 — zero overhead.
 */

import { searchFiles as bm25Search } from './search';
import { EmbeddingIndex } from './embedding-index';
import { getEmbeddingConfig } from './embedding-provider';
import { readFile } from './fs-ops';
import { effectiveSopRoot } from '@/lib/settings';
import type { SearchResult, SearchOptions } from './types';

/** Module-level embedding index singleton — lazily initialized. */
const embeddingIndex = new EmbeddingIndex();

/** RRF constant (standard value from the original paper). */
const RRF_K = 60;

/** 
 * Track last config signature to detect changes requiring index rebuild.
 * Format: "provider:model" (e.g., "local:Xenova/bge-small-zh-v1.5")
 */
let lastConfigSignature: string | null = null;

/**
 * Check if embedding config has changed in a way that requires index rebuild.
 * This happens when provider or model changes (different dimensions/embeddings).
 */
function checkConfigChanged(): boolean {
  const config = getEmbeddingConfig();
  if (!config) {
    // Config disabled — no change tracking needed
    if (lastConfigSignature !== null) {
      lastConfigSignature = null;
      return true; // Was enabled, now disabled
    }
    return false;
  }
  
  const currentSignature = `${config.provider}:${config.model}`;
  
  if (lastConfigSignature === null) {
    // First time seeing config
    lastConfigSignature = currentSignature;
    return false;
  }
  
  if (lastConfigSignature !== currentSignature) {
    console.log(
      `[hybrid-search] Embedding config changed: ${lastConfigSignature} → ${currentSignature}. ` +
      `Index will be rebuilt on next search.`
    );
    lastConfigSignature = currentSignature;
    return true;
  }
  
  return false;
}

/**
 * Hybrid search combining BM25 keyword search with embedding semantic search.
 *
 * Flow:
 * 1. Always run BM25 (fast, synchronous).
 * 2. If embedding is enabled:
 *    a. Ensure index is loaded/built (async, non-blocking on first call).
 *    b. If ready, run embedding search.
 *    c. Merge results with RRF.
 * 3. If embedding is disabled or not ready, return pure BM25 results.
 */
export async function hybridSearch(
  mindRoot: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const limit = opts.limit ?? 20;

  // Step 1: BM25 (always runs — synchronous, fast)
  const bm25Results = bm25Search(mindRoot, query, { ...opts, limit: limit * 2 });

  // Step 2: Check if embedding is available
  const embeddingConfig = getEmbeddingConfig();
  if (!embeddingConfig) {
    // Embedding disabled — pure BM25
    return bm25Results.slice(0, limit);
  }

  // Step 2.5: Check if config changed (model/provider switch requires rebuild)
  if (checkConfigChanged()) {
    embeddingIndex.invalidate();
  }

  // Step 3: Ensure embedding index is loaded/building
  if (!embeddingIndex.isBuiltFor(mindRoot)) {
    // Try loading from disk
    const loaded = embeddingIndex.load(mindRoot);
    if (!loaded && !embeddingIndex.isBuilding()) {
      // Trigger async rebuild — don't await, return BM25 for now
      embeddingIndex.rebuild(mindRoot).catch(() => {});
      return bm25Results.slice(0, limit);
    }
  }

  if (!embeddingIndex.isReady()) {
    // Still building — return BM25 only
    return bm25Results.slice(0, limit);
  }

  // Step 4: Run embedding search
  const embeddingResults = await embeddingIndex.search(query, limit * 2);

  if (embeddingResults.length === 0) {
    // Embedding search failed or returned nothing — pure BM25
    return bm25Results.slice(0, limit);
  }

  // Step 5: RRF merge
  return rrfMerge(mindRoot, bm25Results, embeddingResults, limit);
}

/**
 * Reciprocal Rank Fusion — merges two ranked lists.
 *
 * score(doc) = 1/(k + rank_bm25) + 1/(k + rank_embedding)
 *
 * Documents appearing in only one list get only that term.
 * This naturally balances exact keyword matches with semantic matches.
 * 
 * For semantic-only matches (no BM25 hit), reads file content to provide
 * a meaningful snippet instead of just showing similarity score.
 */
function rrfMerge(
  mindRoot: string,
  bm25Results: SearchResult[],
  embeddingResults: { path: string; similarity: number }[],
  limit: number,
): SearchResult[] {
  const rrfScores = new Map<string, number>();
  const snippets = new Map<string, string>();
  const bm25Scores = new Map<string, number>();
  const semanticSimilarity = new Map<string, number>();

  // BM25 ranks
  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    const rank = i + 1;
    rrfScores.set(r.path, (rrfScores.get(r.path) ?? 0) + 1 / (RRF_K + rank));
    snippets.set(r.path, r.snippet);
    bm25Scores.set(r.path, r.score);
  }

  // Embedding ranks
  for (let i = 0; i < embeddingResults.length; i++) {
    const r = embeddingResults[i];
    const rank = i + 1;
    rrfScores.set(r.path, (rrfScores.get(r.path) ?? 0) + 1 / (RRF_K + rank));
    semanticSimilarity.set(r.path, r.similarity);
    
    // If embedding found a doc that BM25 didn't, read file for snippet
    if (!snippets.has(r.path)) {
      const snippet = getSemanticSnippet(mindRoot, r.path, r.similarity);
      snippets.set(r.path, snippet);
    }
  }

  // Sort by RRF score
  const merged = [...rrfScores.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([filePath, rrfScore]) => ({
      path: filePath,
      snippet: snippets.get(filePath) ?? '',
      score: rrfScore,
      occurrences: bm25Scores.has(filePath) ? 1 : 0, // mark whether BM25 contributed
      // Add semantic match indicator for UI
      semanticMatch: semanticSimilarity.has(filePath) && !bm25Scores.has(filePath),
      similarity: semanticSimilarity.get(filePath),
    }));

  return merged;
}

/**
 * Get a meaningful snippet for semantic-only matches by reading file content.
 * Returns first ~200 characters of the file, or a fallback message on error.
 */
function getSemanticSnippet(mindRoot: string, filePath: string, similarity: number): string {
  const SNIPPET_LENGTH = 200;
  
  try {
    const content = readFile(mindRoot, filePath);
    if (!content || content.trim().length === 0) {
      return `Semantic match (similarity: ${similarity.toFixed(2)})`;
    }
    
    // Remove markdown heading prefix if file starts with one
    let cleanContent = content.trim();
    if (cleanContent.startsWith('#')) {
      const firstNewline = cleanContent.indexOf('\n');
      if (firstNewline > 0 && firstNewline < 100) {
        // Extract title from heading
        const title = cleanContent.slice(0, firstNewline).replace(/^#+\s*/, '').trim();
        const rest = cleanContent.slice(firstNewline + 1).trim();
        if (rest.length > 0) {
          cleanContent = `${title}: ${rest}`;
        } else {
          cleanContent = title;
        }
      }
    }
    
    // Truncate and add ellipsis if needed
    if (cleanContent.length > SNIPPET_LENGTH) {
      // Try to break at word boundary
      const truncated = cleanContent.slice(0, SNIPPET_LENGTH);
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > SNIPPET_LENGTH * 0.7) {
        return truncated.slice(0, lastSpace) + '...';
      }
      return truncated + '...';
    }
    
    return cleanContent;
  } catch {
    // File read failed — return minimal info
    return `Semantic match (similarity: ${similarity.toFixed(2)})`;
  }
}

// ── Incremental index management (called from search.ts on file mutations) ──

/** Update embedding for a single file after write. Non-blocking. */
export function updateEmbeddingFile(mindRoot: string, filePath: string): void {
  if (!embeddingIndex.isReady()) return;
  embeddingIndex.updateFile(mindRoot, filePath).catch(() => {});
}

/** Remove a file from the embedding index after delete. */
export function removeEmbeddingFile(filePath: string): void {
  embeddingIndex.removeFile(filePath);
}

/** Invalidate the embedding index entirely. */
export function invalidateEmbeddingIndex(): void {
  embeddingIndex.invalidate();
}

/** Get embedding index status (for diagnostics/UI). */
export function getEmbeddingStatus(): {
  enabled: boolean;
  ready: boolean;
  building: boolean;
  docCount: number;
} {
  const config = getEmbeddingConfig();
  return {
    enabled: !!config,
    ready: embeddingIndex.isReady(),
    building: embeddingIndex.isBuilding(),
    docCount: embeddingIndex.getDocCount(),
  };
}
