/**
 * Search-related types
 */

import type { UUID } from './index.js'

/**
 * Search query
 */
export interface SearchQuery {
  /** Search text */
  query: string
  /** Search filters */
  filters?: SearchFilters
  /** Search options */
  options?: SearchOptions
}

/**
 * Search filters
 */
export interface SearchFilters {
  /** Filter by tags */
  tags?: string[]
  /** Filter by file extension */
  extensions?: string[]
  /** Filter by date range */
  dateRange?: {
    from?: number
    to?: number
  }
  /** Filter by path pattern */
  pathPattern?: string
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Maximum number of results */
  limit?: number
  /** Result offset for pagination */
  offset?: number
  /** Enable fuzzy matching */
  fuzzy?: boolean
  /** Minimum relevance score (0-1) */
  minScore?: number
  /** Search mode */
  mode?: 'keyword' | 'semantic' | 'hybrid'
}

/**
 * Search result
 */
export interface SearchResult {
  /** Document ID */
  documentId: UUID
  /** Relevance score (0-1) */
  score: number
  /** Matched snippets */
  snippets: SearchSnippet[]
  /** Result metadata */
  metadata: SearchResultMetadata
}

/**
 * Search snippet
 */
export interface SearchSnippet {
  /** Snippet text */
  text: string
  /** Highlighted ranges */
  highlights: Array<{ start: number; end: number }>
}

/**
 * Search result metadata
 */
export interface SearchResultMetadata {
  /** Keyword search score */
  keywordScore?: number
  /** Semantic search score */
  semanticScore?: number
  /** Matched terms */
  matchedTerms?: string[]
}

/**
 * Search response
 */
export interface SearchResponse {
  /** Search results */
  results: SearchResult[]
  /** Total number of results */
  total: number
  /** Query execution time in milliseconds */
  took: number
}
