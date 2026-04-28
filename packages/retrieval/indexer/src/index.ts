/**
 * Indexer package exports
 */

export { FileIndexer } from './indexer.js'
export { chunkText, chunkByParagraphs } from './chunker.js'
export type {
  IndexerConfig,
  FileMetadata,
  DocumentChunk,
  IndexStats,
  IndexerEvent,
  IndexerEventHandler,
} from './types.js'
export type { ChunkerOptions } from './chunker.js'
