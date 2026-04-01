import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';

const MAX_CONTENT_LENGTH = 50_000;

// CJK Unicode ranges: Chinese, Japanese Hiragana/Katakana, Korean
const CJK_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

/**
 * Tokenize text for indexing: split on word boundaries + CJK bigrams.
 *
 * Latin/ASCII: split on non-alphanumeric characters, lowercased.
 * CJK: generate character-level bigrams (overlapping pairs).
 * Mixed text: both strategies applied, tokens merged.
 */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  // Latin/ASCII word tokens.
  // Single Latin chars (e.g. "a") are noise and excluded; CJK unigrams
  // carry meaning and are handled separately below.
  const words = lower.match(/[a-z0-9_$@#]+/g);
  if (words) {
    for (const w of words) {
      if (w.length >= 2) tokens.add(w);
    }
  }

  // CJK bigrams + single chars (unigrams carry meaning in CJK scripts)
  if (CJK_REGEX.test(lower)) {
    const cjkChars: string[] = [];
    for (const ch of lower) {
      if (CJK_REGEX.test(ch)) {
        cjkChars.push(ch);
      } else {
        // Emit bigrams for accumulated CJK run
        if (cjkChars.length > 0) {
          emitCjkTokens(cjkChars, tokens);
          cjkChars.length = 0;
        }
      }
    }
    if (cjkChars.length > 0) emitCjkTokens(cjkChars, tokens);
  }

  return tokens;
}

function emitCjkTokens(chars: string[], tokens: Set<string>): void {
  for (let i = 0; i < chars.length; i++) {
    tokens.add(chars[i]); // unigram
    if (i + 1 < chars.length) {
      tokens.add(chars[i] + chars[i + 1]); // bigram
    }
  }
}

/**
 * In-memory inverted index for core search acceleration.
 *
 * The index maps tokens → Set<filePath>. When a search query arrives,
 * we tokenize the query and intersect candidate sets from the index,
 * dramatically reducing the number of files that need full-text scanning.
 *
 * Lifecycle:
 * - `rebuild(mindRoot)` — full build from disk (called lazily on first search)
 * - `invalidate()` — mark stale (next search triggers rebuild)
 * - `getCandidates(query)` — return candidate file set, or null if no index / no tokens
 */
export class SearchIndex {
  private invertedIndex: Map<string, Set<string>> | null = null;
  private builtForRoot: string | null = null;
  private fileCount = 0;

  /** BM25 statistics — populated during rebuild() */
  private docLengths = new Map<string, number>();  // filePath → char count
  private totalChars = 0;

  /** Full rebuild: read all files and build inverted index. */
  rebuild(mindRoot: string): void {
    const allFiles = collectAllFiles(mindRoot);
    const inverted = new Map<string, Set<string>>();
    const docLengths = new Map<string, number>();
    let totalChars = 0;

    for (const filePath of allFiles) {
      let content: string;
      try {
        content = readFile(mindRoot, filePath);
      } catch {
        continue;
      }

      // Store original length for BM25 before truncation
      docLengths.set(filePath, content.length);
      totalChars += content.length;

      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH);
      }

      // Also index the file path itself
      const allText = filePath + '\n' + content;
      const tokens = tokenize(allText);

      for (const token of tokens) {
        let set = inverted.get(token);
        if (!set) {
          set = new Set<string>();
          inverted.set(token, set);
        }
        set.add(filePath);
      }
    }

    this.invertedIndex = inverted;
    this.builtForRoot = mindRoot;
    this.fileCount = allFiles.length;
    this.docLengths = docLengths;
    this.totalChars = totalChars;
  }

  /** Clear the index. Next search will trigger a lazy rebuild. */
  invalidate(): void {
    this.invertedIndex = null;
    this.builtForRoot = null;
    this.fileCount = 0;
    this.docLengths.clear();
    this.totalChars = 0;
  }

  /** Whether the index has been built for the given mindRoot. */
  isBuiltFor(mindRoot: string): boolean {
    return this.invertedIndex !== null && this.builtForRoot === mindRoot;
  }

  /** Whether the index has been built (for any root). */
  isBuilt(): boolean {
    return this.invertedIndex !== null;
  }

  /** Number of files in the index. */
  getFileCount(): number {
    return this.fileCount;
  }

  /** Average document length in chars. */
  getAvgDocLength(): number {
    return this.fileCount > 0 ? this.totalChars / this.fileCount : 0;
  }

  /** Character count of a specific document. Returns 0 if unknown. */
  getDocLength(filePath: string): number {
    return this.docLengths.get(filePath) ?? 0;
  }

  /** Number of documents containing a specific token (document frequency). */
  getDocFrequency(token: string): number {
    if (!this.invertedIndex) return 0;
    return this.invertedIndex.get(token)?.size ?? 0;
  }

  /**
   * Get candidates via UNION of token sets (for BM25 multi-term scoring).
   * Unlike getCandidates (intersection), this returns any file matching any token.
   *
   * Optimization: when the query produces many tokens (common with CJK bigrams),
   * files are ranked by how many distinct query tokens they match. Files matching
   * fewer than half the tokens are pruned — unless that would leave zero results,
   * in which case all matching files are returned. This prevents CJK bigram
   * explosion from creating massive candidate sets full of low-quality matches.
   */
  getCandidatesUnion(query: string): string[] | null {
    if (!query.trim()) return null;
    if (!this.invertedIndex) return null;

    const tokens = tokenize(query.toLowerCase().trim());
    if (tokens.size === 0) return null;

    // Count how many query tokens each file matches
    const hitCount = new Map<string, number>();
    for (const token of tokens) {
      const set = this.invertedIndex.get(token);
      if (set) {
        for (const filePath of set) {
          hitCount.set(filePath, (hitCount.get(filePath) ?? 0) + 1);
        }
      }
    }

    if (hitCount.size === 0) return [];

    // When query has many tokens (e.g. CJK bigrams), prune low-overlap files
    const tokenCount = tokens.size;
    if (tokenCount >= 3) {
      const threshold = Math.max(1, Math.floor(tokenCount / 2));
      const filtered = [...hitCount.entries()]
        .filter(([, count]) => count >= threshold)
        .map(([path]) => path);
      // Only apply pruning if it doesn't eliminate everything
      if (filtered.length > 0) return filtered;
    }

    return [...hitCount.keys()];
  }

  /**
   * Get candidate file paths for a query (single or multi-word).
   *
   * Tokenizes the query and intersects candidate sets from the inverted index.
   *
   * Returns:
   * - `null` if the index is not built, query is empty, or query produces no
   *   tokens (e.g. substring shorter than 2 chars). Callers should fall back
   *   to a full scan when null is returned.
   * - `string[]` (possibly empty) if the index can answer definitively.
   */
  getCandidates(query: string): string[] | null {
    if (!query.trim()) return null;
    if (!this.invertedIndex) return null;

    const tokens = tokenize(query.toLowerCase().trim());
    // No tokens produced → query is a substring/single-char that the index
    // cannot resolve. Return null so the caller falls back to full scan,
    // preserving pre-index indexOf behavior for partial-word queries.
    if (tokens.size === 0) return null;

    let result: Set<string> | null = null;

    for (const token of tokens) {
      const set = this.invertedIndex.get(token);
      if (!set) return []; // No files have this token → intersection is empty

      if (result === null) {
        result = new Set(set);
      } else {
        // Intersect
        for (const path of result) {
          if (!set.has(path)) result.delete(path);
        }
        if (result.size === 0) return [];
      }
    }

    return result ? Array.from(result) : [];
  }
}
