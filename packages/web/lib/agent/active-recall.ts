/**
 * Active Recall — automatically search the knowledge base and return relevant
 * content to inject into the agent's system prompt before it replies.
 *
 * Design decisions:
 * - Uses hybridSearch only to find candidate files. hybridSearch already falls
 *   back to BM25 when embedding is unavailable, so recall does not depend on an
 *   embedding extension.
 * - Re-ranks heading-aware Markdown chunks inside candidate files instead of
 *   injecting whole long files or a keyword-first character window.
 * - Excludes meta-files (README.md, INSTRUCTION.md, CONFIG.json) already in bootstrap.
 * - Token budget is greedy-fill: highest score first, truncate last entry if needed.
 */

import crypto from 'node:crypto';
import path from 'path';
import { hybridSearch } from '@/lib/core/hybrid-search';
import type { SearchResult } from '@/lib/core/types';
import { estimateStringTokens } from './context';
import { getFileContent } from '@/lib/fs';
import { registerContextFileAsset } from '@geminilight/mindos/knowledge';
import {
  writeRetrievalReceipt,
  type RetrievalReceipt,
  type RetrievalReceiptCandidate,
  type RetrievalReceiptOutcome,
  type RetrievalReceiptSelection,
} from '@geminilight/mindos/retrieval';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecallResult {
  /** Relative file path within the knowledge base. */
  path: string;
  /** Recalled Markdown excerpt. Long files contribute chunks, not whole files. */
  content: string;
  /** Search relevance score. */
  score: number;
  /** 1-based source line range when the excerpt came from a readable file. */
  startLine?: number;
  endLine?: number;
  /** Markdown heading ancestry for the excerpt. */
  headingPath?: string[];
}

export interface RecallOptions {
  maxTokens: number;
  maxFiles: number;
  minScore: number;
  /** Search timeout in ms. Default 2000. */
  timeoutMs: number;
  /** File paths already in context (attached + currentFile) — skip these. */
  excludePaths: string[];
  /** Preferred directory prefixes, usually selected Spaces for the session. */
  preferredPaths: string[];
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: RecallOptions = {
  maxTokens: 2000,
  maxFiles: 5,
  minScore: 1.0,
  timeoutMs: 2000,
  excludePaths: [],
  preferredPaths: [],
};

/** Meta-file basenames that are already loaded in bootstrap context. */
const META_BASENAMES = new Set([
  'readme.md',
  'instruction.md',
  'config.json',
]);

const SEARCH_CANDIDATE_MULTIPLIER = 4;
const MAX_CHUNKS_PER_FILE = 2;
const TARGET_CHUNK_CHARS = 1200;
const MAX_CHUNK_CHARS = 1800;
const MIN_CHUNK_CHARS = 20;
const MAX_QUERY_CHARS = 500;
const MAX_QUERY_TOKENS = 50;

type RecallChunk = {
  path: string;
  content: string;
  headingPath: string[];
  startLine: number;
  endLine: number;
  index: number;
};

type RecallCandidate = {
  result: RecallResult;
  score: number;
  sourceHitScore: number;
};

type ActiveRecallTrace = {
  candidates: RecallCandidate[];
  outcome: RetrievalReceiptOutcome;
  error?: string;
};

export type ActiveRecallReceiptContext = {
  receiptId?: string;
  chatSessionId?: string;
  runId?: string;
  automationId?: string;
  trigger?: string;
  /** Record an explicit skip without invoking the search backend. */
  skip?: boolean;
};

export type ActiveRecallWithReceiptResult = {
  items: RecallResult[];
  receipt: RetrievalReceipt | null;
  metadata: {
    retrievalReceiptId?: string;
    retrievalSelectedAssetIds: string[];
    retrievalOutcome: RetrievalReceiptOutcome;
  };
};

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
  return (await executeActiveRecall(mindRoot, userQuery, options)).items;
}

export async function performActiveRecallWithReceipt(
  mindRoot: string,
  userQuery: string,
  options?: Partial<RecallOptions>,
  context: ActiveRecallReceiptContext = {},
): Promise<ActiveRecallWithReceiptResult> {
  const startedAt = new Date();
  const execution = context.skip
    ? { items: [], trace: { candidates: [], outcome: 'skipped' as const } }
    : await executeActiveRecall(mindRoot, userQuery, options);
  const completedAt = new Date();
  const resolvedOptions = resolveRecallOptions(options);
  const assetIdsByPath = new Map<string, string>();

  for (const item of execution.items) {
    if (assetIdsByPath.has(item.path)) continue;
    try {
      const asset = registerContextFileAsset(mindRoot, {
        path: item.path,
        kind: 'knowledge',
        status: 'active',
        source: { kind: 'file', ref: `file:${item.path}` },
        metadata: { registeredBy: 'active-recall' },
      }, completedAt);
      assetIdsByPath.set(item.path, asset.id);
    } catch {
      // Observability must never make the retrieval path unavailable.
    }
  }

  const receiptCandidates = receiptCandidatesFromTrace(execution.trace.candidates, execution.items, assetIdsByPath);
  const selections = receiptSelections(execution.items, execution.trace.candidates, assetIdsByPath);
  const receiptId = context.receiptId ?? `retrieval-${completedAt.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  let receipt: RetrievalReceipt | null = null;
  try {
    receipt = writeRetrievalReceipt(mindRoot, {
      id: receiptId,
      query: userQuery,
      strategy: 'hybrid-heading-rerank-v1',
      outcome: execution.trace.outcome,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      budget: {
        maxTokens: resolvedOptions.maxTokens,
        maxFiles: resolvedOptions.maxFiles,
        minScore: resolvedOptions.minScore,
        timeoutMs: resolvedOptions.timeoutMs,
      },
      scope: {
        preferredPaths: resolvedOptions.preferredPaths,
        excludePaths: resolvedOptions.excludePaths,
      },
      candidates: receiptCandidates,
      selections,
      totals: {
        candidateCount: execution.trace.candidates.length,
        selectedCount: execution.items.length,
        usedTokens: execution.items.reduce((total, item) => total + estimateStringTokens(item.content), 0),
      },
      ...(execution.trace.error ? { error: execution.trace.error } : {}),
      metadata: context,
    });
  } catch {
    // A read-only answer is more important than its optional audit artifact.
  }

  const selectedAssetIds = [...new Set(selections.map((selection) => selection.assetId))];
  return {
    items: execution.items,
    receipt,
    metadata: {
      ...(receipt ? { retrievalReceiptId: receipt.id } : {}),
      retrievalSelectedAssetIds: selectedAssetIds,
      retrievalOutcome: execution.trace.outcome,
    },
  };
}

async function executeActiveRecall(
  mindRoot: string,
  userQuery: string,
  options?: Partial<RecallOptions>,
): Promise<{ items: RecallResult[]; trace: ActiveRecallTrace }> {
  const opts = resolveRecallOptions(options);
  const excludeSet = new Set(opts.excludePaths);
  const preferredPaths = normalizePathPrefixes(opts.preferredPaths);

  // Skip queries that are too short to be meaningful
  const query = userQuery.length > MAX_QUERY_CHARS ? userQuery.slice(0, MAX_QUERY_CHARS) : userQuery;
  if (query.trim().length < 2) return { items: [], trace: { candidates: [], outcome: 'skipped' } };

  // Search with timeout
  let searchResults: SearchResult[];
  try {
    searchResults = await Promise.race([
      hybridSearch(mindRoot, query, { limit: opts.maxFiles * SEARCH_CANDIDATE_MULTIPLIER }),
      rejectAfter(opts.timeoutMs),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: [],
      trace: {
        candidates: [],
        outcome: /timeout/i.test(message) ? 'timeout' : 'error',
        error: message,
      },
    };
  }

  // Filter: score threshold + exclude attached files + exclude meta-files
  const filtered = searchResults.filter(r => {
    if (!passesRecallSourceScore(r, opts.minScore)) return false;
    if (excludeSet.has(r.path)) return false;
    if (isMetaFile(r.path)) return false;
    return true;
  });

  if (filtered.length === 0) return { items: [], trace: { candidates: [], outcome: 'empty' } };

  const queryTokens = tokenizeRecallText(query);
  const candidates = filtered.flatMap((hit) => buildChunkCandidates(hit, query, queryTokens, preferredPaths));
  if (candidates.length === 0) return { items: [], trace: { candidates: [], outcome: 'empty' } };

  candidates.sort((a, b) => (b.score - a.score) || (b.sourceHitScore - a.sourceHitScore));
  const diversified = diversifyCandidates(candidates, opts.maxFiles);
  const items = fitTokenBudget(diversified, opts.maxTokens);
  return {
    items,
    trace: {
      candidates,
      outcome: items.length > 0 ? 'selected' : 'empty',
    },
  };
}

function receiptCandidatesFromTrace(
  candidates: RecallCandidate[],
  selected: RecallResult[],
  assetIdsByPath: Map<string, string>,
): RetrievalReceiptCandidate[] {
  const selectedKeys = new Set(selected.map(recallResultKey));
  return candidates.slice(0, 100).map((candidate) => {
    const isSelected = selectedKeys.has(recallResultKey(candidate.result));
    return {
      ...(assetIdsByPath.get(candidate.result.path) ? { assetId: assetIdsByPath.get(candidate.result.path) } : {}),
      path: candidate.result.path,
      score: candidate.score,
      selected: isSelected,
      reason: isSelected ? 'highest reranked chunk within budget' : 'not selected by diversity or token budget',
    };
  });
}

function receiptSelections(
  items: RecallResult[],
  candidates: RecallCandidate[],
  assetIdsByPath: Map<string, string>,
): RetrievalReceiptSelection[] {
  const candidatesByKey = new Map(candidates.map((candidate) => [recallResultKey(candidate.result), candidate]));
  return items.flatMap((item) => {
    const assetId = assetIdsByPath.get(item.path);
    if (!assetId) return [];
    const candidate = candidatesByKey.get(recallResultKey(item));
    return [{
      assetId,
      path: item.path,
      score: item.score,
      ...(item.startLine ? { startLine: item.startLine } : {}),
      ...(item.endLine ? { endLine: item.endLine } : {}),
      ...(item.headingPath?.length ? { headingPath: item.headingPath } : {}),
      estimatedTokens: estimateStringTokens(item.content),
      truncated: Boolean(candidate && candidate.result.content.length > item.content.length),
      reason: 'highest reranked chunk within budget',
    }];
  });
}

function recallResultKey(result: RecallResult): string {
  return `${result.path}:${result.startLine ?? 0}:${result.endLine ?? 0}`;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function resolveRecallOptions(options: Partial<RecallOptions> | undefined): RecallOptions {
  return {
    maxTokens: options?.maxTokens ?? DEFAULTS.maxTokens,
    maxFiles: options?.maxFiles ?? DEFAULTS.maxFiles,
    minScore: options?.minScore ?? DEFAULTS.minScore,
    timeoutMs: options?.timeoutMs ?? DEFAULTS.timeoutMs,
    excludePaths: [...(options?.excludePaths ?? DEFAULTS.excludePaths)],
    preferredPaths: [...(options?.preferredPaths ?? DEFAULTS.preferredPaths)],
  };
}

function passesRecallSourceScore(result: SearchResult, minScore: number): boolean {
  if (result.score >= minScore) return true;
  // Rank-fusion scores are intentionally small (roughly 0.01-0.04). They are
  // already top-K search candidates, so let the chunk-level lexical scorer make
  // the final recall decision instead of applying the BM25 minScore scale.
  if (result.scoreKind === 'rank_fusion') return result.score > 0;
  return false;
}

/** Check if a path is a meta-file (README/INSTRUCTION/CONFIG at any depth). */
function isMetaFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return META_BASENAMES.has(basename);
}

function buildChunkCandidates(
  hit: SearchResult,
  query: string,
  queryTokens: string[],
  preferredPaths: string[],
): RecallCandidate[] {
  let content: string;
  try {
    content = getFileContent(hit.path);
  } catch {
    return [{
      result: {
        path: hit.path,
        content: hit.snippet,
        score: hit.score,
      },
      score: hit.score,
      sourceHitScore: hit.score,
    }];
  }

  const chunks = buildMarkdownRecallChunks(hit.path, content);
  if (chunks.length === 0) return [];

  return chunks
    .map((chunk) => {
      const chunkScore = scoreChunk(chunk, hit, query, queryTokens, preferredPaths);
      return {
        result: {
          path: chunk.path,
          content: chunk.content,
          score: hit.score + chunkScore,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          ...(chunk.headingPath.length > 0 ? { headingPath: chunk.headingPath } : {}),
        },
        score: hit.score + chunkScore,
        sourceHitScore: hit.score,
      };
    })
    .filter((candidate) => candidate.result.content.trim().length > 0);
}

function buildMarkdownRecallChunks(filePath: string, content: string): RecallChunk[] {
  const lines = content.split(/\r?\n/);
  if (content.trim().length === 0) return [];
  if (content.length <= MAX_CHUNK_CHARS) {
    return [{
      path: filePath,
      content: content.trim(),
      headingPath: collectLeadingHeadingPath(lines),
      startLine: 1,
      endLine: Math.max(1, lines.length),
      index: 0,
    }];
  }

  const chunks: RecallChunk[] = [];
  const headingStack: Array<{ level: number; title: string }> = [];
  let currentLines: string[] = [];
  let currentStartLine = 1;
  let currentHeadingPath: string[] = [];
  let inFence = false;

  const flush = () => {
    const raw = currentLines.join('\n');
    const trimmed = raw.trim();
    if (trimmed.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        path: filePath,
        content: trimmed,
        headingPath: currentHeadingPath,
        startLine: currentStartLine,
        endLine: Math.max(currentStartLine, currentStartLine + currentLines.length - 1),
        index: chunks.length,
      });
    }
    currentLines = [];
  };

  const startChunk = (lineNumber: number) => {
    currentStartLine = lineNumber;
    currentHeadingPath = headingStack.map((heading) => heading.title);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    const fenceMatch = /^\s*```/.test(line);
    const heading = !inFence ? parseMarkdownHeading(line) : null;

    if (heading) {
      flush();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= heading.level) {
        headingStack.pop();
      }
      headingStack.push({ level: heading.level, title: heading.title });
      startChunk(lineNumber);
      currentLines.push(line);
      continue;
    }

    if (currentLines.length === 0) startChunk(lineNumber);
    currentLines.push(line);

    if (fenceMatch) inFence = !inFence;

    const currentLength = currentLines.join('\n').length;
    const shouldFlushAtParagraph = !inFence && line.trim() === '' && currentLength >= TARGET_CHUNK_CHARS;
    const shouldForceFlush = !inFence && currentLength >= MAX_CHUNK_CHARS;
    if (shouldFlushAtParagraph || shouldForceFlush) flush();
  }

  flush();
  return chunks;
}

function collectLeadingHeadingPath(lines: string[]): string[] {
  for (const line of lines) {
    const heading = parseMarkdownHeading(line);
    if (heading) return [heading.title];
    if (line.trim()) return [];
  }
  return [];
}

function parseMarkdownHeading(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!match) return null;
  return {
    level: match[1]!.length,
    title: match[2]!.trim(),
  };
}

function scoreChunk(
  chunk: RecallChunk,
  hit: SearchResult,
  query: string,
  queryTokens: string[],
  preferredPaths: string[],
): number {
  const headingText = chunk.headingPath.join(' ');
  const searchable = normalizeSearchText(`${chunk.path}\n${headingText}\n${chunk.content}`);
  const headingSearchable = normalizeSearchText(headingText);
  const pathSearchable = normalizeSearchText(chunk.path);
  const contentSearchable = normalizeSearchText(chunk.content);
  const exactQuery = normalizeSearchText(query).trim();
  const snippetTokens = tokenizeRecallText(hit.snippet);

  let score = 0;
  for (const token of queryTokens) {
    const occurrences = countOccurrences(searchable, token);
    if (occurrences === 0) continue;
    const tokenWeight = Math.min(3, Math.max(1, token.length / 3));
    score += tokenWeight * (1 + Math.log2(occurrences + 1));
    if (countOccurrences(headingSearchable, token) > 0) score += 3;
    if (countOccurrences(pathSearchable, token) > 0) score += 2;
  }

  if (exactQuery.length > 2 && contentSearchable.includes(exactQuery)) score += 4;
  if (isPreferredPath(chunk.path, preferredPaths)) score += 2;

  let snippetOverlap = 0;
  for (const token of snippetTokens) {
    if (countOccurrences(contentSearchable, token) > 0) snippetOverlap += 1;
  }
  score += Math.min(4, snippetOverlap * 0.75);

  // Small source-score carry keeps semantic-only hits usable while chunk
  // lexical signals decide which section of the file should be recalled.
  score += Math.min(1, hit.score * 0.05);

  // If a semantic-only hit has no lexical overlap, prefer the first chunk over
  // a random later section. This preserves graceful degradation without
  // pretending semantic recall is required.
  if (score <= 1 && chunk.index === 0) score += 0.5;
  return score;
}

function normalizePathPrefixes(paths: string[]): string[] {
  return paths
    .map((item) => item.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
}

function isPreferredPath(filePath: string, preferredPaths: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return preferredPaths.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function diversifyCandidates(candidates: RecallCandidate[], maxResults: number): RecallCandidate[] {
  const selected: RecallCandidate[] = [];
  const perFile = new Map<string, number>();

  for (const candidate of candidates) {
    if (selected.length >= maxResults) break;
    const count = perFile.get(candidate.result.path) ?? 0;
    if (count >= MAX_CHUNKS_PER_FILE) continue;
    selected.push(candidate);
    perFile.set(candidate.result.path, count + 1);
  }

  return selected;
}

function fitTokenBudget(candidates: RecallCandidate[], maxTokens: number): RecallResult[] {
  const results: RecallResult[] = [];
  let usedTokens = 0;

  for (const candidate of candidates) {
    const tokens = estimateStringTokens(candidate.result.content);
    if (usedTokens + tokens > maxTokens) {
      const remaining = maxTokens - usedTokens;
      if (remaining > 100) {
        results.push({
          ...candidate.result,
          content: truncateToTokenBudget(candidate.result.content, remaining),
        });
      }
      break;
    }
    results.push(candidate.result);
    usedTokens += tokens;
  }

  return results;
}

function normalizeSearchText(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function tokenizeRecallText(text: string): string[] {
  const normalized = normalizeSearchText(text);
  const tokens = new Set<string>();

  for (const match of normalized.match(/[a-z0-9][a-z0-9./:-]*/g) ?? []) {
    if (match.length > 1) tokens.add(match);
    for (const part of match.split(/[./:-]+/)) {
      if (part.length > 1) tokens.add(part);
    }
  }

  for (const match of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (match.length <= 8) tokens.add(match);
    if (match.length === 1) {
      tokens.add(match);
      continue;
    }
    for (let index = 0; index < match.length - 1; index += 1) {
      tokens.add(match.slice(index, index + 2));
    }
  }

  return [...tokens].slice(0, MAX_QUERY_TOKENS);
}

function countOccurrences(text: string, token: string): number {
  if (!token) return 0;
  let count = 0;
  let index = text.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + Math.max(1, token.length));
  }
  return count;
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
