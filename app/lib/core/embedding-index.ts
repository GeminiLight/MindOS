/**
 * In-memory embedding vector index with JSON file persistence.
 *
 * Stores one embedding vector per file. Supports:
 * - Cosine similarity search
 * - Incremental add/update/remove
 * - Persist to / load from ~/.mindos/embedding-index.json
 *
 * Designed for <2000 files — brute-force cosine is fast enough (~2ms for 1000 docs).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import { getEmbeddings, getEmbedding, getEmbeddingConfig } from './embedding-provider';

const MAX_CONTENT_LENGTH = 8_000; // Truncate long files (embedding context window)

export interface EmbeddingSearchResult {
  path: string;
  similarity: number; // 0..1 cosine similarity
}

export class EmbeddingIndex {
  /** filePath → Float32Array (embedding vector) */
  private vectors = new Map<string, Float32Array>();
  private dimensions = 0;
  private builtForRoot: string | null = null;

  /** Whether a full build or load has been done for this root. */
  private _ready = false;

  /** Background build in progress — callers should not wait, just use BM25. */
  private _building = false;

  isReady(): boolean { return this._ready; }
  isBuilding(): boolean { return this._building; }

  /** Number of indexed documents. */
  getDocCount(): number { return this.vectors.size; }

  /** Current index dimensions (0 if not built). */
  getDimensions(): number { return this.dimensions; }

  // ── Build ────────────────────────────────────────────────────────

  /**
   * Full rebuild: embed all files. Runs async — returns immediately.
   * Callers should check isReady() before calling search().
   */
  async rebuild(mindRoot: string): Promise<void> {
    if (this._building) return;
    this._building = true;

    try {
      const config = getEmbeddingConfig();
      if (!config) { this._building = false; return; }

      const allFiles = collectAllFiles(mindRoot);
      const texts: string[] = [];
      const paths: string[] = [];

      for (const filePath of allFiles) {
        // Skip non-text files for embedding
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.md' && ext !== '.csv') continue;

        let content: string;
        try { content = readFile(mindRoot, filePath); } catch { continue; }

        // Prepend file path as context
        const text = `${filePath}\n${content}`.slice(0, MAX_CONTENT_LENGTH);
        texts.push(text);
        paths.push(filePath);
      }

      if (texts.length === 0) {
        this._building = false;
        this._ready = true;
        this.builtForRoot = mindRoot;
        return;
      }

      // Batch embed all documents
      const vectors = await getEmbeddings(texts);

      if (vectors.length !== texts.length) {
        console.error(`[embedding-index] Expected ${texts.length} vectors, got ${vectors.length}`);
        this._building = false;
        return;
      }

      this.vectors.clear();
      this.dimensions = vectors[0].length;
      for (let i = 0; i < paths.length; i++) {
        this.vectors.set(paths[i], vectors[i]);
      }

      this.builtForRoot = mindRoot;
      this._ready = true;

      // Persist in background
      try { this.persist(); } catch { /* non-critical */ }
    } catch (err) {
      console.error('[embedding-index] Rebuild failed:', err instanceof Error ? err.message : err);
    } finally {
      this._building = false;
    }
  }

  // ── Incremental updates ──────────────────────────────────────────

  /** Add or update a single file's embedding. */
  async updateFile(mindRoot: string, filePath: string): Promise<void> {
    if (!this._ready) return;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.md' && ext !== '.csv') return;

    let content: string;
    try { content = readFile(mindRoot, filePath); } catch { return; }

    const text = `${filePath}\n${content}`.slice(0, MAX_CONTENT_LENGTH);
    const vector = await getEmbedding(text);
    if (vector) {
      this.vectors.set(filePath, vector);
      if (this.dimensions === 0) this.dimensions = vector.length;
    }
  }

  /** Remove a file from the index. */
  removeFile(filePath: string): void {
    this.vectors.delete(filePath);
  }

  // ── Search ───────────────────────────────────────────────────────

  /**
   * Find the top-K most similar documents to the query vector.
   * Returns results sorted by descending similarity.
   * 
   * Validates query vector dimensions match index dimensions.
   * Returns empty array (graceful degradation) on mismatch.
   */
  searchByVector(queryVector: Float32Array, topK: number = 20): EmbeddingSearchResult[] {
    if (!this._ready || this.vectors.size === 0) return [];

    // Dimension validation: query must match index dimensions
    if (this.dimensions > 0 && queryVector.length !== this.dimensions) {
      console.warn(
        `[embedding-index] Dimension mismatch: query has ${queryVector.length} dimensions, ` +
        `index has ${this.dimensions}. Returning empty results.`
      );
      return [];
    }

    const results: EmbeddingSearchResult[] = [];

    for (const [filePath, docVector] of this.vectors) {
      const sim = cosineSimilarity(queryVector, docVector);
      results.push({ path: filePath, similarity: sim });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * Search by text query: embed the query, then find similar docs.
   * Returns empty array if embedding fails or index not ready.
   */
  async search(query: string, topK: number = 20): Promise<EmbeddingSearchResult[]> {
    if (!this._ready) return [];

    const queryVector = await getEmbedding(query);
    if (!queryVector) return [];

    return this.searchByVector(queryVector, topK);
  }

  // ── Persistence ──────────────────────────────────────────────────

  private get persistPath(): string {
    return path.join(os.homedir(), '.mindos', 'embedding-index.json');
  }

  /** Serialize to disk. */
  persist(): void {
    if (this.vectors.size === 0) return;

    const data: PersistedEmbeddingIndex = {
      version: 1,
      builtForRoot: this.builtForRoot ?? '',
      dimensions: this.dimensions,
      docCount: this.vectors.size,
      timestamp: Date.now(),
      vectors: {},
    };

    for (const [filePath, vec] of this.vectors) {
      // Store as regular number array for JSON serialization
      data.vectors[filePath] = Array.from(vec);
    }

    const dir = path.dirname(this.persistPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(data), 'utf-8');
    } catch {
      // Non-critical
    }
  }

  /**
   * Load from disk. Returns true if loaded successfully.
   * Staleness check: file count must match and root must match.
   */
  load(mindRoot: string): boolean {
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const data: PersistedEmbeddingIndex = JSON.parse(raw);

      if (data.version !== 1 || data.builtForRoot !== mindRoot) return false;

      // Basic staleness: check file count
      const currentFiles = collectAllFiles(mindRoot);
      const mdCsvCount = currentFiles.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ext === '.md' || ext === '.csv';
      }).length;

      // Allow some drift (files added/removed since last persist)
      // If >10% drift, force rebuild
      if (Math.abs(mdCsvCount - data.docCount) > Math.max(5, mdCsvCount * 0.1)) {
        return false;
      }

      this.vectors.clear();
      this.dimensions = data.dimensions;
      for (const [filePath, arr] of Object.entries(data.vectors)) {
        this.vectors.set(filePath, new Float32Array(arr));
      }
      this.builtForRoot = data.builtForRoot;
      this._ready = true;

      return true;
    } catch {
      return false;
    }
  }

  /** Clear all state. */
  invalidate(): void {
    this.vectors.clear();
    this.dimensions = 0;
    this.builtForRoot = null;
    this._ready = false;
  }

  /** Check if index is built for this root. */
  isBuiltFor(mindRoot: string): boolean {
    return this._ready && this.builtForRoot === mindRoot;
  }
}

// ── Math ─────────────────────────────────────────────────────────

/** Cosine similarity between two vectors. Returns 0..1 (clamped). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  // Clamp to [0, 1] — embeddings from the same model are usually positive,
  // but numerical noise can push slightly below 0 or above 1.
  return Math.max(0, Math.min(1, dot / denom));
}

// ── Persistence types ────────────────────────────────────────────

interface PersistedEmbeddingIndex {
  version: number;
  builtForRoot: string;
  dimensions: number;
  docCount: number;
  timestamp: number;
  vectors: Record<string, number[]>;
}
