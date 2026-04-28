/**
 * Error codes and messages
 */

import type { ErrorCode } from './types.js'

/**
 * Error code to HTTP status code mapping
 */
export const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  TIMEOUT: 408,
  RATE_LIMIT_EXCEEDED: 429,
  FILE_SYSTEM_ERROR: 500,
  FILE_READ_ERROR: 500,
  FILE_WRITE_ERROR: 500,
  FILE_STAT_ERROR: 500,
  FILE_REMOVE_ERROR: 500,
  FILE_COPY_ERROR: 500,
  FILE_MOVE_ERROR: 500,
  FILE_WATCH_ERROR: 500,
  DIRECTORY_READ_ERROR: 500,
  DIRECTORY_CREATE_ERROR: 500,
  DATABASE_ERROR: 500,
  NETWORK_ERROR: 500,
  CONFIGURATION_ERROR: 500,
  SEARCH_ERROR: 500,
  VECTOR_ERROR: 500,
  MCP_ERROR: 500,
}

/**
 * Default error messages
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Validation failed',
  NOT_FOUND: 'Resource not found',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  CONFLICT: 'Resource conflict',
  INTERNAL_ERROR: 'Internal server error',
  SERVICE_UNAVAILABLE: 'Service unavailable',
  TIMEOUT: 'Operation timed out',
  RATE_LIMIT_EXCEEDED: 'Rate limit exceeded',
  FILE_SYSTEM_ERROR: 'File system operation failed',
  FILE_READ_ERROR: 'Failed to read file',
  FILE_WRITE_ERROR: 'Failed to write file',
  FILE_STAT_ERROR: 'Failed to get file stats',
  FILE_REMOVE_ERROR: 'Failed to remove file',
  FILE_COPY_ERROR: 'Failed to copy file',
  FILE_MOVE_ERROR: 'Failed to move file',
  FILE_WATCH_ERROR: 'Failed to watch file',
  DIRECTORY_READ_ERROR: 'Failed to read directory',
  DIRECTORY_CREATE_ERROR: 'Failed to create directory',
  DATABASE_ERROR: 'Database operation failed',
  NETWORK_ERROR: 'Network operation failed',
  CONFIGURATION_ERROR: 'Configuration error',
  SEARCH_ERROR: 'Search operation failed',
  VECTOR_ERROR: 'Vector operation failed',
  MCP_ERROR: 'MCP operation failed',
}

/**
 * Check if error code is retryable
 */
export function isRetryableError(code: ErrorCode): boolean {
  return [
    'SERVICE_UNAVAILABLE',
    'TIMEOUT',
    'NETWORK_ERROR',
  ].includes(code)
}

/**
 * Get retry delay for error code
 */
export function getRetryDelay(code: ErrorCode): number {
  switch (code) {
    case 'RATE_LIMIT_EXCEEDED':
      return 60000 // 1 minute
    case 'SERVICE_UNAVAILABLE':
      return 5000 // 5 seconds
    case 'TIMEOUT':
      return 1000 // 1 second
    case 'NETWORK_ERROR':
      return 2000 // 2 seconds
    default:
      return 0
  }
}
