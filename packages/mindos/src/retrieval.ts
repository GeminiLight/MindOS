export type MindosRetrievalCapability = 'indexing' | 'keyword-search' | 'vector-search' | 'retrieval-api';

export interface RetrievalCapabilityBoundary {
  readonly owner: '@geminilight/mindos';
  readonly loadMode: 'optional';
  readonly defaultRuntime: false;
  readonly capabilities: readonly MindosRetrievalCapability[];
  readonly activation: 'explicit';
  readonly reason: string;
}

export const retrievalCapabilityBoundary: RetrievalCapabilityBoundary = {
  owner: '@geminilight/mindos',
  loadMode: 'optional',
  defaultRuntime: false,
  capabilities: ['indexing', 'keyword-search', 'vector-search', 'retrieval-api'],
  activation: 'explicit',
  reason: 'Retrieval is a MindOS product capability, but heavy index/vector backends stay out of the default runtime until enabled.',
};

export function isRetrievalCapabilityDefaultEnabled(capability: MindosRetrievalCapability): false {
  void capability;
  return false;
}

export { chunkByParagraphs, chunkText } from './retrieval/chunker.js';
export type { ChunkerOptions } from './retrieval/chunker.js';
export type {
  DocumentChunk,
  FileMetadata,
  IndexerConfig,
  IndexerEvent,
  IndexerEventHandler,
  IndexerStats,
  SearchDocument,
  SearchEngine,
  SearchIndexStats,
  SearchOptions,
  SearchResultItem,
  SearchResults,
  VectorDatabase,
  VectorEmbedding,
  VectorIndexStats,
  VectorQuery,
  VectorSearchResult,
  VectorSearchResults,
} from './retrieval/types.js';
