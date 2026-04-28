import type { Request, Response, NextFunction } from 'express'
import type { Result } from '@geminilight/mindos/foundation'
import type { FileIndexer } from '@mindos/indexer'
import type { SearchEngine } from '@mindos/search'
import type { VectorDatabase } from '@mindos/vector'
import type { Logger } from '@geminilight/mindos/foundation'

export interface ApiConfig {
  port: number
  host: string
  cors: {
    enabled: boolean
    origins: string[]
  }
  rateLimit: {
    enabled: boolean
    windowMs: number
    maxRequests: number
  }
}

export interface ApiContext {
  indexer: FileIndexer
  search: SearchEngine
  vector: VectorDatabase
  logger: Logger
}

export interface SearchRequest {
  query: string
  limit?: number
  offset?: number
  filters?: Record<string, any>
}

export interface SearchResponse {
  results: Array<{
    id: string
    content: string
    score: number
    metadata: Record<string, any>
  }>
  total: number
  took: number
}

export interface IndexRequest {
  path: string
  recursive?: boolean
}

export interface IndexResponse {
  indexed: number
  failed: number
  duration: number
}

export interface ErrorResponse {
  error: string
  message: string
  details?: any
}

export type ApiHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void> | void

export interface WebSocketMessage {
  type: 'index-progress' | 'index-complete' | 'index-error' | 'search-update'
  data: any
}
