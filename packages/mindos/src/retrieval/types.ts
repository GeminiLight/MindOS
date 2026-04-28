import type { Result } from '../foundation/shared/index.js';

export interface SearchDocument {
  id: string;
  title: string;
  content: string;
  path: string;
  tags: string[];
  createdAt: number;
  modifiedAt: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  tags?: string[];
  pathPrefix?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  highlight?: boolean;
  attributesToSearchOn?: string[];
}

export interface SearchResultItem {
  document: SearchDocument;
  score: number;
  highlights?: Record<string, string[]>;
}

export interface SearchResults {
  items: SearchResultItem[];
  total: number;
  processingTime: number;
  offset: number;
  limit: number;
}

export interface SearchIndexStats {
  documentCount: number;
  sizeInBytes: number;
  lastUpdatedAt: Date;
}

export interface SearchEngine {
  indexDocument(document: SearchDocument): Promise<Result<void>>;
  indexDocuments(documents: SearchDocument[]): Promise<Result<void>>;
  removeDocument(id: string): Promise<Result<void>>;
  removeDocuments(ids: string[]): Promise<Result<void>>;
  search(query: string, options?: SearchOptions): Promise<Result<SearchResults>>;
  getDocument(id: string): Promise<Result<SearchDocument | null>>;
  clear(): Promise<Result<void>>;
  getStats(): Promise<Result<SearchIndexStats>>;
  health(): Promise<Result<boolean>>;
}

export interface VectorEmbedding {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorQuery {
  vector: number[];
  limit?: number;
  filter?: Record<string, unknown>;
  minScore?: number;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorSearchResults {
  items: VectorSearchResult[];
  total: number;
  processingTime: number;
}

export interface VectorIndexStats {
  vectorCount: number;
  dimension: number;
  sizeInBytes: number;
  lastUpdatedAt: Date;
}

export interface VectorDatabase {
  addVector(embedding: VectorEmbedding): Promise<Result<void>>;
  addVectors(embeddings: VectorEmbedding[]): Promise<Result<void>>;
  removeVector(id: string): Promise<Result<void>>;
  removeVectors(ids: string[]): Promise<Result<void>>;
  search(query: VectorQuery): Promise<Result<VectorSearchResults>>;
  getVector(id: string): Promise<Result<VectorEmbedding | null>>;
  clear(): Promise<Result<void>>;
  getStats(): Promise<Result<VectorIndexStats>>;
  health(): Promise<Result<boolean>>;
}

export interface IndexerConfig {
  rootPath: string;
  include?: string[];
  exclude?: string[];
  maxFileSize?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  watch?: boolean;
}

export interface FileMetadata {
  path: string;
  relativePath: string;
  size: number;
  mtime: number;
  extension: string;
  mimeType: string;
}

export interface DocumentChunk {
  id: string;
  filePath: string;
  content: string;
  chunkIndex: number;
  totalChunks: number;
  metadata: FileMetadata;
}

export interface IndexerStats {
  totalFiles: number;
  totalChunks: number;
  totalBytes: number;
  lastIndexTime: number;
  indexDuration: number;
}

export type IndexerEvent =
  | { type: 'file-added'; path: string }
  | { type: 'file-changed'; path: string }
  | { type: 'file-removed'; path: string }
  | { type: 'index-started' }
  | { type: 'index-completed'; stats: IndexerStats }
  | { type: 'index-error'; error: Error };

export type IndexerEventHandler = (event: IndexerEvent) => void;
