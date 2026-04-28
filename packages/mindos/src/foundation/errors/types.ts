/**
 * Error types and interfaces
 */

import type { Timestamp } from '../shared/index.js'

/**
 * Error code type
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'FILE_SYSTEM_ERROR'
  | 'FILE_READ_ERROR'
  | 'FILE_WRITE_ERROR'
  | 'FILE_STAT_ERROR'
  | 'FILE_REMOVE_ERROR'
  | 'FILE_COPY_ERROR'
  | 'FILE_MOVE_ERROR'
  | 'FILE_WATCH_ERROR'
  | 'DIRECTORY_READ_ERROR'
  | 'DIRECTORY_CREATE_ERROR'
  | 'DATABASE_ERROR'
  | 'NETWORK_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'SEARCH_ERROR'
  | 'VECTOR_ERROR'
  | 'MCP_ERROR'

/**
 * Error context for debugging
 */
export interface ErrorContext {
  /** Operation that failed */
  operation?: string
  /** Resource identifier */
  resourceId?: string
  /** User identifier */
  userId?: string
  /** Request identifier */
  requestId?: string
  /** Additional context data */
  [key: string]: unknown
}

/**
 * Error metadata
 */
export interface ErrorMetadata {
  /** Error timestamp */
  timestamp: Timestamp
  /** Error severity */
  severity?: 'low' | 'medium' | 'high' | 'critical'
  /** Whether error is retryable */
  retryable?: boolean
  /** Retry delay in milliseconds */
  retryAfter?: number
  /** Additional metadata */
  [key: string]: unknown
}

/**
 * Serialized error
 */
export interface SerializedError {
  name: string
  message: string
  code: ErrorCode
  statusCode: number
  context?: ErrorContext
  metadata: ErrorMetadata
  stack?: string
}
