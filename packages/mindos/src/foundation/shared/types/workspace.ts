/**
 * Workspace-related types
 */

import type { FilePath, Timestamp } from './index.js'

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace root path */
  root: FilePath
  /** Workspace name */
  name: string
  /** Workspace type */
  type: 'local' | 'obsidian' | 'remote'
  /** Workspace settings */
  settings: WorkspaceSettings
}

/**
 * Workspace settings
 */
export interface WorkspaceSettings {
  /** File extensions to index */
  indexedExtensions: string[]
  /** Directories to exclude */
  excludedPaths: string[]
  /** Enable file watching */
  watchFiles: boolean
  /** Enable auto-save */
  autoSave: boolean
  /** Auto-save delay in milliseconds */
  autoSaveDelay: number
}

/**
 * Workspace metadata
 */
export interface WorkspaceMetadata {
  /** Creation timestamp */
  createdAt: Timestamp
  /** Last modified timestamp */
  updatedAt: Timestamp
  /** Total number of documents */
  documentCount: number
  /** Total size in bytes */
  totalSize: number
}
