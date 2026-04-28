/**
 * Configuration types
 */

import type { FilePath } from '../shared/index.js'

/**
 * Application configuration
 */
export interface AppConfig {
  /** Application name */
  name: string
  /** Application version */
  version: string
  /** Environment */
  env: 'development' | 'production' | 'test'
  /** Server configuration */
  server: ServerConfig
  /** Workspace configuration */
  workspace: WorkspaceConfig
  /** Search configuration */
  search: SearchConfig
  /** Vector configuration */
  vector: VectorConfig
  /** MCP configuration */
  mcp: McpConfig
  /** Logging configuration */
  logging: LoggingConfig
}

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Server port */
  port: number
  /** Server host */
  host: string
  /** Enable CORS */
  cors: boolean
  /** Request timeout in milliseconds */
  timeout: number
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace root path */
  root: FilePath
  /** File extensions to index */
  indexedExtensions: string[]
  /** Directories to exclude */
  excludedPaths: string[]
  /** Enable file watching */
  watchFiles: boolean
}

/**
 * Search configuration
 */
export interface SearchConfig {
  /** Search engine type */
  engine: 'meilisearch' | 'local'
  /** MeiliSearch host */
  host?: string
  /** MeiliSearch API key */
  apiKey?: string
  /** Index name */
  indexName: string
}

/**
 * Vector configuration
 */
export interface VectorConfig {
  /** Vector database type */
  database: 'lancedb' | 'local'
  /** Database path */
  path: FilePath
  /** Embedding model */
  embeddingModel: string
  /** Vector dimension */
  dimension: number
}

/**
 * MCP configuration
 */
export interface McpConfig {
  /** MCP server port */
  port: number
  /** Enable MCP server */
  enabled: boolean
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Log level */
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  /** Enable pretty printing */
  pretty: boolean
  /** Log file path */
  file?: FilePath
}

/**
 * Configuration provider interface
 */
export interface ConfigProvider {
  /**
   * Get configuration value
   */
  get<T = unknown>(key: string): T | undefined

  /**
   * Get configuration value with default
   */
  getOrDefault<T = unknown>(key: string, defaultValue: T): T

  /**
   * Check if configuration key exists
   */
  has(key: string): boolean

  /**
   * Get all configuration
   */
  getAll(): AppConfig

  /**
   * Reload configuration
   */
  reload(): Promise<void>
}
