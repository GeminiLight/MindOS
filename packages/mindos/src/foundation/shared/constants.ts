/**
 * Common constants used across MindOS packages
 */

/**
 * Application metadata
 */
export const APP_NAME = 'MindOS'
export const APP_VERSION = '1.0.0'
export const APP_DESCRIPTION = 'Human-Agent Collaborative Mind System'

/**
 * File extensions
 */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const
export const TEXT_EXTENSIONS = ['.txt', '.text'] as const
export const CODE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs'] as const
export const ALL_INDEXED_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS, ...CODE_EXTENSIONS] as const

/**
 * Default configuration values
 */
export const DEFAULT_PORT = 3456
export const DEFAULT_MCP_PORT = 8781
export const DEFAULT_AUTO_SAVE_DELAY = 1000
export const DEFAULT_SEARCH_LIMIT = 20
export const DEFAULT_MIN_SEARCH_SCORE = 0.3

/**
 * Cache TTL values (in milliseconds)
 */
export const CACHE_TTL = {
  SHORT: 5 * 60 * 1000, // 5 minutes
  MEDIUM: 30 * 60 * 1000, // 30 minutes
  LONG: 24 * 60 * 60 * 1000, // 24 hours
} as const

/**
 * File size limits (in bytes)
 */
export const FILE_SIZE_LIMITS = {
  MAX_DOCUMENT_SIZE: 10 * 1024 * 1024, // 10 MB
  MAX_UPLOAD_SIZE: 50 * 1024 * 1024, // 50 MB
} as const

/**
 * Regex patterns
 */
export const PATTERNS = {
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  URL: /^https?:\/\/.+/,
} as const
