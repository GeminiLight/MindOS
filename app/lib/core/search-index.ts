import fs from 'fs';
import path from 'path';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import { CJK_CHAR_REGEX } from './cjk';

const MAX_CONTENT_LENGTH = 50_000;

// Intl.Segmenter for proper CJK word segmentation (available in Node 16+)
const zhSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'word' })
  : null;

/**
 * Tokenize text for indexing: split on word boundaries + CJK word segmentation.
 *
 * Latin/ASCII: split on non-alphanumeric characters, lowercased.
 * CJK: uses Intl.Segmenter for proper word boundaries (e.g. "知识管理"
 *   → ["知识", "管理"] instead of bigrams ["知识", "识管", "管理"]).
 *   Falls back to bigrams if Intl.Segmenter is unavailable.
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

  // CJK word segmentation
  if (CJK_CHAR_REGEX.test(lower)) {
    if (zhSegmenter) {
      // Intl.Segmenter: proper word boundaries
      for (const { segment, isWordLike } of zhSegmenter.segment(lower)) {
        if (!isWordLike) continue;
        const word = segment.trim();
        if (!word) continue;
        tokens.add(word);
        // Also add individual CJK characters as unigrams (for single-char queries)
        for (const ch of word) {
          if (CJK_CHAR_REGEX.test(ch)) tokens.add(ch);
        }
      }
    } else {
      // Fallback: bigrams + unigrams
      const cjkChars: string[] = [];
      for (const ch of lower) {
        if (CJK_CHAR_REGEX.test(ch)) {
          cjkChars.push(ch);
        } else {
          if (cjkChars.length > 0) {
            emitCjkBigrams(cjkChars, tokens);
            cjkChars.length = 0;
          }
        }
      }
      if (cjkChars.length > 0) emitCjkBigrams(cjkChars, tokens);
    }
  }

  return tokens;
}

/** Fallback CJK tokenizer: bigrams + unigrams (when Intl.Segmenter unavailable) */
function emitCjkBigrams(chars: string[], tokens: Set<string>): void {
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
  /** Reverse mapping: filePath → Set<token> for efficient removeFile. */
  private fileTokens = new Map<string, Set<string>>();

  /** Full rebuild: read all files and build inverted index. */
  rebuild(mindRoot: string): void {
    const allFiles = collectAllFiles(mindRoot);
    const inverted = new Map<string, Set<string>>();
    const docLengths = new Map<string, number>();
    const fileTokensMap = new Map<string, Set<string>>();
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
      fileTokensMap.set(filePath, tokens);

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
    this.fileTokens = fileTokensMap;
  }

  /** Clear the index. Next search will trigger a lazy rebuild. */
  invalidate(): void {
    this.invertedIndex = null;
    this.builtForRoot = null;
    this.fileCount = 0;
    this.docLengths.clear();
    this.totalChars = 0;
    this.fileTokens.clear();
  }

  // ── Incremental updates ──────────────────────────────────────────────

  /**
   * Remove a single file from the index (e.g. after deletion).
   * O(tokens-in-file) — much faster than full rebuild.
   */
  removeFile(filePath: string): void {
    if (!this.invertedIndex) return;

    // Use reverse mapping for O(tokens-in-file) instead of O(all-tokens)
    const tokens = this.fileTokens.get(filePath);
    if (tokens) {
      for (const token of tokens) {
        this.invertedIndex.get(token)?.delete(filePath);
      }
      this.fileTokens.delete(filePath);
    }

    // Update BM25 stats
    const oldLen = this.docLengths.get(filePath) ?? 0;
    this.totalChars -= oldLen;
    this.docLengths.delete(filePath);
    this.fileCount = Math.max(0, this.fileCount - 1);
  }

  /**
   * Add a new file to the index (e.g. after creation).
   * O(tokens-in-file) — much faster than full rebuild.
   */
  addFile(mindRoot: string, filePath: string): void {
    if (!this.invertedIndex) return;

    let content: string;
    try { content = readFile(mindRoot, filePath); } catch { return; }

    // Update BM25 stats
    this.docLengths.set(filePath, content.length);
    this.totalChars += content.length;
    this.fileCount++;

    // Index tokens
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }
    const allText = filePath + '\n' + content;
    const tokens = tokenize(allText);
    this.fileTokens.set(filePath, tokens);

    for (const token of tokens) {
      let set = this.invertedIndex.get(token);
      if (!set) {
        set = new Set<string>();
        this.invertedIndex.set(token, set);
      }
      set.add(filePath);
    }
  }

  /**
   * Re-index a single file after modification.
   * Equivalent to removeFile + addFile but avoids double traversal of inverted index.
   */
  updateFile(mindRoot: string, filePath: string): void {
    if (!this.invertedIndex) return;
    this.removeFile(filePath);
    this.addFile(mindRoot, filePath);
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

  // ── Persistence ──────────────────────────────────────────────────────

  /**
   * Serialize the index to a JSON file for persistence across restarts.
   * Stored at `<mindosDir>/search-index.json`.
   */
  persist(mindosDir: string): void {
    if (!this.invertedIndex) return;

    const data: PersistedIndex = {
      version: 1,
      builtForRoot: this.builtForRoot ?? '',
      fileCount: this.fileCount,
      totalChars: this.totalChars,
      docLengths: Object.fromEntries(this.docLengths),
      invertedIndex: {},
      timestamp: Date.now(),
    };

    for (const [token, fileSet] of this.invertedIndex) {
      data.invertedIndex[token] = [...fileSet];
    }

    const filePath = path.join(mindosDir, 'search-index.json');
    try {
      fs.mkdirSync(mindosDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    } catch {
      // Non-critical — index will be rebuilt on next search
    }
  }

  /**
   * Load a previously persisted index from disk.
   * Returns true if loaded successfully, false if stale/missing/corrupt.
   *
   * Staleness checks (all must pass):
   * 1. Version and mindRoot match
   * 2. Actual file count on disk matches indexed file count (detects adds/deletes)
   * 3. Sampled files' mtime are older than the persisted timestamp
   */
  load(mindosDir: string, mindRoot: string): boolean {
    const filePath = path.join(mindosDir, 'search-index.json');

    let raw: string;
    try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return false; }

    let data: PersistedIndex;
    try { data = JSON.parse(raw); } catch { return false; }

    if (data.version !== 1 || data.builtForRoot !== mindRoot) return false;

    // Check 1: file count on disk must match indexed count
    // This catches new files created or files deleted while process was down
    const currentFiles = collectAllFiles(mindRoot);
    if (currentFiles.length !== data.fileCount) return false;

    // Check 2: mtime sampling — check every file if ≤50, otherwise sample 50
    const docPaths = Object.keys(data.docLengths);
    const sampleSize = Math.min(50, docPaths.length);
    if (sampleSize === docPaths.length) {
      // Small index: check all files
      for (const dp of docPaths) {
        try {
          const stat = fs.statSync(path.join(mindRoot, dp));
          if (stat.mtimeMs > data.timestamp) return false;
        } catch {
          return false; // file deleted
        }
      }
    } else {
      // Large index: sample evenly + always check the last few (most likely to be recent)
      const step = Math.max(1, Math.floor(docPaths.length / 40));
      const sampled = new Set<number>();
      // Evenly spaced samples
      for (let i = 0; i < docPaths.length; i += step) sampled.add(i);
      // Always check the last 10 files (most recently added to the index)
      for (let i = Math.max(0, docPaths.length - 10); i < docPaths.length; i++) sampled.add(i);

      for (const idx of sampled) {
        try {
          const stat = fs.statSync(path.join(mindRoot, docPaths[idx]));
          if (stat.mtimeMs > data.timestamp) return false;
        } catch {
          return false;
        }
      }
    }

    // Restore state
    this.builtForRoot = data.builtForRoot;
    this.fileCount = data.fileCount;
    this.totalChars = data.totalChars;
    this.docLengths = new Map(Object.entries(data.docLengths).map(([k, v]) => [k, v as number]));

    const inverted = new Map<string, Set<string>>();
    const fileTokensMap = new Map<string, Set<string>>();
    for (const [token, files] of Object.entries(data.invertedIndex)) {
      const fileSet = new Set(files as string[]);
      inverted.set(token, fileSet);
      // Rebuild reverse mapping
      for (const f of fileSet) {
        let tokens = fileTokensMap.get(f);
        if (!tokens) { tokens = new Set(); fileTokensMap.set(f, tokens); }
        tokens.add(token);
      }
    }
    this.invertedIndex = inverted;
    this.fileTokens = fileTokensMap;

    return true;
  }
}

/** Shape of the persisted index JSON. */
interface PersistedIndex {
  version: number;
  builtForRoot: string;
  fileCount: number;
  totalChars: number;
  docLengths: Record<string, number>;
  invertedIndex: Record<string, string[]>;
  timestamp: number;
}
