/**
 * Document-related types
 */

import type { FilePath, Timestamp, UUID } from './index.js'

/**
 * Document entity
 */
export interface Document {
  /** Unique document ID */
  id: UUID
  /** Document title */
  title: string
  /** File path relative to workspace root */
  path: FilePath
  /** Document content */
  content: string
  /** Document metadata */
  metadata: DocumentMetadata
  /** Document tags */
  tags: string[]
  /** Creation timestamp */
  createdAt: Timestamp
  /** Last modified timestamp */
  updatedAt: Timestamp
}

/**
 * Document metadata
 */
export interface DocumentMetadata {
  /** File size in bytes */
  size: number
  /** File extension */
  extension: string
  /** MIME type */
  mimeType: string
  /** Word count */
  wordCount: number
  /** Character count */
  charCount: number
  /** Frontmatter data */
  frontmatter?: Record<string, unknown>
}

/**
 * Document create input
 */
export interface DocumentCreateInput {
  title: string
  path: FilePath
  content: string
  tags?: string[]
  metadata?: Partial<DocumentMetadata>
}

/**
 * Document update input
 */
export interface DocumentUpdateInput {
  title?: string
  content?: string
  tags?: string[]
  metadata?: Partial<DocumentMetadata>
}
