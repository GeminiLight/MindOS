import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  MINDOS_IGNORED_DIRS,
  collectFileStatsFromMindRoot,
  type MindosRuntimeFileStat,
} from '../mind-root-files.js';
import { createCachedMindosSearchIgnoreMatcher } from '../search-ignore.js';
import {
  bm25Score,
  buildSearchSnippet,
  countTermOccurrences,
  insertTopSearchHit,
  type ScoredSearchHit,
} from './scoring.js';
import { splitSearchQueryTerms, tokenizeSearchText } from './tokenizer.js';

/**
 * In-memory BM25 search index over a mind root. One implementation serves the
 * standalone Product Server and the Web adapter (`packages/web/lib/core/search.ts`).
 *
 * Freshness: `refresh()` compares the tree version handed in by the caller
 * (tree cache) and otherwise the per-file mtime/size signature, re-reading only
 * files that changed. Write paths call `updateFile()` / `removePath()` so a save
 * is searchable immediately; watcher-driven changes arrive through the next
 * `refresh()`.
 *
 * Content types: `textExtensions` are read as UTF-8; `extractors` (e.g. PDF)
 * are invoked per file and may be deferred past a time budget during a cold
 * refresh, in which case the file is indexed by path only until the caller
 * finishes it with `updateFile()`.
 */

export type MindosSearchFileStat = MindosRuntimeFileStat;

export type MindosSearchTextExtractor = (absolutePath: string, relativePath: string) => string;

export type MindosSearchIndexOptions = {
  /** Source of file stats; defaults to a fresh stat walk of the mind root. */
  listFiles?: () => MindosSearchFileStat[];
  /** Extensions read as text. Default `.md`, `.csv`, `.json`. */
  textExtensions?: Iterable<string>;
  /** Extension → text extractor for binary formats (Web injects PDF). */
  extractors?: Record<string, MindosSearchTextExtractor>;
  /** Extra caller filter on relative paths (Web excludes root system files). */
  shouldIndex?: (relativePath: string) => boolean;
  /** Characters kept per document for matching/snippets. Default 50 000. */
  maxContentLength?: number;
};

export type MindosSearchHit = ScoredSearchHit;

export type MindosSearchQueryOptions = {
  limit?: number;
  scope?: string;
  file_type?: 'md' | 'csv' | 'all';
  modified_after?: string;
};

export type MindosSearchRefreshHints = {
  /** Monotonic tree version from the tree cache; unchanged → no stat walk. */
  treeVersion?: number;
};

export type MindosSearchRefreshOptions = {
  /**
   * Time budget (ms) for running extractors inline. Files whose extractor
   * would run after the budget elapsed are indexed by path only and returned
   * in `deferred`. Omit for an unbounded refresh.
   */
  extractionBudgetMs?: number;
};

export type MindosSearchRefreshResult = {
  cacheState: 'hit' | 'built';
  /** Extractor-backed files still holding placeholder content. */
  deferred: string[];
};

export type MindosSearchUpdateResult = 'indexed' | 'removed' | 'skipped';

type SearchDoc = {
  content: string;
  lower: string;
  /** Character count before truncation (BM25 document length). */
  length: number;
  mtime: number;
  size: number;
  tokens: Set<string>;
  /** True while an extractor-backed file only has placeholder content. */
  pending: boolean;
};

const DEFAULT_TEXT_EXTENSIONS = ['.md', '.csv', '.json'];
const DEFAULT_MAX_CONTENT_LENGTH = 50_000;

function signatureOf(stats: MindosSearchFileStat[]): string {
  return stats.map((entry) => `${entry.path}\0${entry.size}\0${entry.mtime}`).sort().join('\n');
}

export class MindosSearchIndex {
  readonly mindRoot: string;
  private readonly listFiles: () => MindosSearchFileStat[];
  private readonly textExtensions: Set<string>;
  private readonly extractors: Record<string, MindosSearchTextExtractor>;
  private readonly shouldIndex: (relativePath: string) => boolean;
  private readonly maxContentLength: number;

  private docs = new Map<string, SearchDoc>();
  private inverted = new Map<string, Set<string>>();
  private files: string[] = [];
  private totalChars = 0;
  private signature: string | null = null;
  private treeVersion: number | undefined;
  private built = false;

  constructor(mindRoot: string, options: MindosSearchIndexOptions = {}) {
    this.mindRoot = resolve(mindRoot);
    this.listFiles = options.listFiles ?? (() => collectFileStatsFromMindRoot(this.mindRoot));
    this.textExtensions = new Set([...(options.textExtensions ?? DEFAULT_TEXT_EXTENSIONS)].map((ext) => ext.toLowerCase()));
    this.extractors = options.extractors ?? {};
    this.shouldIndex = options.shouldIndex ?? (() => true);
    this.maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  }

  // ── Freshness ─────────────────────────────────────────────────────────

  refresh(hints: MindosSearchRefreshHints = {}, options: MindosSearchRefreshOptions = {}): MindosSearchRefreshResult {
    // Fast path: the tree cache already knows nothing changed.
    if (this.built && hints.treeVersion !== undefined && this.treeVersion === hints.treeVersion) {
      return { cacheState: 'hit', deferred: [] };
    }
    const stats = this.listFiles().filter((stat) => this.isIndexable(stat.path));
    const signature = signatureOf(stats);
    this.treeVersion = hints.treeVersion;
    if (this.built && signature === this.signature) return { cacheState: 'hit', deferred: [] };
    this.signature = signature;

    const deadline = options.extractionBudgetMs === undefined ? null : Date.now() + options.extractionBudgetMs;
    const deferred: string[] = [];
    const seen = new Set<string>();
    let changed = false;
    for (const stat of stats) {
      seen.add(stat.path);
      const existing = this.docs.get(stat.path);
      if (existing && !existing.pending && existing.mtime === stat.mtime && existing.size === stat.size) continue;
      changed = true;
      if (this.indexStat(stat, deadline) === 'deferred') deferred.push(stat.path);
    }
    for (const filePath of [...this.docs.keys()]) {
      if (seen.has(filePath)) continue;
      this.removeDoc(filePath);
      changed = true;
    }
    if (changed || !this.built) this.files = [...this.docs.keys()].sort((a, b) => a.localeCompare(b));
    this.built = true;
    return { cacheState: 'built', deferred };
  }

  /**
   * Forget the tree-version memo so the next `refresh()` re-compares the file
   * stats (cheap when a tree cache supplies them); unchanged files stay indexed.
   */
  markStale(): void {
    this.treeVersion = undefined;
  }

  /** Drop everything; the next `refresh()` rebuilds from scratch. */
  invalidate(): void {
    this.docs.clear();
    this.inverted.clear();
    this.files = [];
    this.totalChars = 0;
    this.signature = null;
    this.treeVersion = undefined;
    this.built = false;
  }

  isBuilt(): boolean {
    return this.built;
  }

  // ── Incremental updates (write paths) ─────────────────────────────────

  /**
   * (Re-)index one file right now, e.g. after a save or a deferred extraction.
   * Ignored / filtered / unreadable paths are removed instead.
   */
  updateFile(relativePath: string): MindosSearchUpdateResult {
    const filePath = normalizeRelative(relativePath);
    if (!this.isIndexable(filePath)) {
      return this.removeDoc(filePath) ? 'removed' : 'skipped';
    }
    let stat: MindosSearchFileStat;
    try {
      const fileStat = statSync(resolveExistingSafe(this.mindRoot, filePath));
      if (!fileStat.isFile()) return this.removeDoc(filePath) ? 'removed' : 'skipped';
      stat = { path: filePath, mtime: fileStat.mtimeMs, size: fileStat.size };
    } catch {
      return this.removeDoc(filePath) ? 'removed' : 'skipped';
    }
    const outcome = this.indexStat(stat, null);
    if (outcome === 'indexed') {
      if (!this.files.includes(filePath)) this.files = [...this.docs.keys()].sort((a, b) => a.localeCompare(b));
      return 'indexed';
    }
    return this.files.includes(filePath) ? 'removed' : 'skipped';
  }

  /**
   * Remove a file, or every file under a directory, from the index. Matches
   * the exact path plus `prefix/…` (no `Projects-extra` false positives).
   * Returns the removed paths.
   */
  removePath(relativePath: string): string[] {
    const target = normalizeRelative(relativePath);
    const prefix = `${target}/`;
    const removed: string[] = [];
    for (const filePath of [...this.docs.keys()]) {
      if (filePath === target || filePath.startsWith(prefix)) {
        this.removeDoc(filePath);
        removed.push(filePath);
      }
    }
    if (removed.length > 0) this.files = [...this.docs.keys()].sort((a, b) => a.localeCompare(b));
    return removed;
  }

  // ── Query ─────────────────────────────────────────────────────────────

  search(query: string, options: MindosSearchQueryOptions = {}, hints: MindosSearchRefreshHints = {}): MindosSearchHit[] {
    if (!query.trim()) return [];
    const limit = options.limit ?? 20;
    if (limit <= 0) return [];
    this.refresh(hints);

    const totalDocs = this.docs.size;
    const avgDocLength = this.getAvgDocLength();
    const queryTerms = splitSearchQueryTerms(query);
    const lowerQuery = query.toLowerCase();

    const candidates = this.getCandidatesUnion(query);
    let files = candidates ?? this.files;
    if (options.scope) {
      const scope = options.scope;
      const normalizedScope = scope.endsWith('/') ? scope : `${scope}/`;
      files = files.filter((f) => f.startsWith(normalizedScope) || f === scope);
    }
    if (options.file_type && options.file_type !== 'all') {
      const ext = `.${options.file_type}`;
      files = files.filter((f) => f.endsWith(ext));
    }
    let mtimeThreshold = 0;
    if (options.modified_after) {
      mtimeThreshold = new Date(options.modified_after).getTime();
      if (Number.isNaN(mtimeThreshold)) mtimeThreshold = 0;
    }

    // Match once per document, remembering per-term counts so BM25 below does
    // not re-run the regexes; document frequency is computed over the
    // filtered candidate set (matches the historical Web behaviour).
    const termDf = new Map<string, number>();
    const matched: Array<{ path: string; doc: SearchDoc; termCounts: number[]; firstMatch: number; occurrences: number }> = [];
    for (const filePath of files) {
      const doc = this.docs.get(filePath);
      if (!doc) continue;
      if (mtimeThreshold > 0 && doc.mtime < mtimeThreshold) continue;
      const termCounts = new Array<number>(queryTerms.length).fill(0);
      let firstMatch = -1;
      let occurrences = 0;
      for (let i = 0; i < queryTerms.length; i += 1) {
        const term = queryTerms[i]!;
        const tf = countTermOccurrences(term, doc.lower);
        if (tf === 0) continue;
        termCounts[i] = tf;
        termDf.set(term, (termDf.get(term) ?? 0) + 1);
        occurrences += tf;
        if (firstMatch === -1) firstMatch = doc.lower.indexOf(term);
      }
      if (occurrences === 0) continue;
      matched.push({ path: filePath, doc, termCounts, firstMatch, occurrences });
    }

    const results: MindosSearchHit[] = [];
    for (const hit of matched) {
      let score = 0;
      for (let i = 0; i < queryTerms.length; i += 1) {
        const tf = hit.termCounts[i]!;
        if (tf === 0) continue;
        score += bm25Score(tf, termDf.get(queryTerms[i]!) ?? 0, hit.doc.length, avgDocLength, totalDocs);
      }
      const anchorIndex = hit.firstMatch >= 0 ? hit.firstMatch : hit.doc.lower.indexOf(lowerQuery);
      const snippet = buildSearchSnippet(hit.doc.content, anchorIndex >= 0 ? anchorIndex : 0, query.length);
      insertTopSearchHit(results, { path: hit.path, snippet, score, occurrences: hit.occurrences }, limit);
    }
    return results;
  }

  /**
   * Candidate paths matching ANY query token. When the query yields three or
   * more tokens (typical for CJK), files matching fewer than half of them are
   * pruned unless that would leave nothing. `null` means the index cannot help
   * (empty query / no tokens) and the caller should scan everything.
   */
  getCandidatesUnion(query: string): string[] | null {
    if (!query.trim()) return null;
    const tokens = tokenizeSearchText(query.toLowerCase().trim());
    if (tokens.size === 0) return null;
    const hitCount = new Map<string, number>();
    for (const token of tokens) {
      const paths = this.inverted.get(token);
      if (!paths) continue;
      for (const filePath of paths) hitCount.set(filePath, (hitCount.get(filePath) ?? 0) + 1);
    }
    if (hitCount.size === 0) return [];
    if (tokens.size >= 3) {
      const threshold = Math.max(1, Math.floor(tokens.size / 2));
      const filtered = [...hitCount.entries()].filter(([, count]) => count >= threshold).map(([filePath]) => filePath);
      if (filtered.length > 0) return filtered;
    }
    return [...hitCount.keys()];
  }

  /** Candidate paths containing EVERY query token (`null` when the index cannot answer). */
  getCandidates(query: string): string[] | null {
    if (!query.trim()) return null;
    const tokens = tokenizeSearchText(query.toLowerCase().trim());
    if (tokens.size === 0) return null;
    let result: Set<string> | null = null;
    for (const token of tokens) {
      const paths = this.inverted.get(token);
      if (!paths) return [];
      if (result === null) {
        result = new Set(paths);
      } else {
        for (const filePath of result) {
          if (!paths.has(filePath)) result.delete(filePath);
        }
        if (result.size === 0) return [];
      }
    }
    return result ? [...result] : [];
  }

  // ── Statistics / accessors ────────────────────────────────────────────

  getFileCount(): number {
    return this.docs.size;
  }

  getAvgDocLength(): number {
    return this.docs.size > 0 ? this.totalChars / this.docs.size : 0;
  }

  getDocLength(filePath: string): number {
    return this.docs.get(normalizeRelative(filePath))?.length ?? 0;
  }

  getDocFrequency(token: string): number {
    return this.inverted.get(token)?.size ?? 0;
  }

  getAllFiles(): string[] {
    return [...this.files];
  }

  getContent(filePath: string): string | null {
    return this.docs.get(normalizeRelative(filePath))?.content ?? null;
  }

  getLowerContent(filePath: string): string | null {
    return this.docs.get(normalizeRelative(filePath))?.lower ?? null;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private isIndexable(filePath: string): boolean {
    if (!filePath || filePath === '.') return false;
    const ext = extname(filePath).toLowerCase();
    if (!this.textExtensions.has(ext) && !this.extractors[ext]) return false;
    if (!this.shouldIndex(filePath)) return false;
    return !createCachedMindosSearchIgnoreMatcher(this.mindRoot, MINDOS_IGNORED_DIRS)(filePath);
  }

  private indexStat(stat: MindosSearchFileStat, deadline: number | null): 'indexed' | 'deferred' | 'dropped' {
    const ext = extname(stat.path).toLowerCase();
    let content: string;
    let pending = false;
    if (this.textExtensions.has(ext)) {
      try {
        content = readFileSync(resolveExistingSafe(this.mindRoot, stat.path), 'utf-8');
      } catch {
        this.removeDoc(stat.path);
        return 'dropped';
      }
    } else {
      const extractor = this.extractors[ext];
      if (!extractor) {
        this.removeDoc(stat.path);
        return 'dropped';
      }
      if (deadline !== null && Date.now() >= deadline) {
        content = '';
        pending = true;
      } else {
        try {
          content = extractor(resolveExistingSafe(this.mindRoot, stat.path), stat.path);
        } catch {
          content = '';
        }
        if (!content) {
          this.removeDoc(stat.path);
          return 'dropped';
        }
      }
    }
    this.removeDoc(stat.path);
    const length = content.length;
    if (content.length > this.maxContentLength) content = content.slice(0, this.maxContentLength);
    const tokens = tokenizeSearchText(`${stat.path}\n${content}`);
    this.docs.set(stat.path, {
      content,
      lower: content.toLowerCase(),
      length,
      mtime: stat.mtime,
      size: stat.size,
      tokens,
      pending,
    });
    this.totalChars += length;
    for (const token of tokens) {
      let paths = this.inverted.get(token);
      if (!paths) {
        paths = new Set<string>();
        this.inverted.set(token, paths);
      }
      paths.add(stat.path);
    }
    return pending ? 'deferred' : 'indexed';
  }

  private removeDoc(filePath: string): boolean {
    const doc = this.docs.get(filePath);
    if (!doc) return false;
    for (const token of doc.tokens) {
      const paths = this.inverted.get(token);
      if (!paths) continue;
      paths.delete(filePath);
      if (paths.size === 0) this.inverted.delete(token);
    }
    this.totalChars -= doc.length;
    this.docs.delete(filePath);
    return true;
  }
}

function normalizeRelative(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

// ── Per-root registry ───────────────────────────────────────────────────

const indexes = new Map<string, MindosSearchIndex>();

/**
 * Shared index per resolved mind root. Options only apply when the instance is
 * created; callers that need a differently configured index (the standalone
 * server wires the tree cache stats) construct `MindosSearchIndex` directly.
 */
export function getMindosSearchIndex(mindRoot: string, options?: MindosSearchIndexOptions): MindosSearchIndex {
  const root = resolve(mindRoot);
  let index = indexes.get(root);
  if (!index) {
    index = new MindosSearchIndex(root, options);
    indexes.set(root, index);
  }
  return index;
}

export function resetMindosSearchIndexesForTests(): void {
  indexes.clear();
}
