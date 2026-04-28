/**
 * File indexer service
 */

import { watch, type FSWatcher } from 'chokidar'
import { Result, ok, err } from '@geminilight/mindos/foundation'
import { createError } from '@geminilight/mindos/foundation'
import type { ErrorCode } from '@geminilight/mindos/foundation'
import type { Logger } from '@geminilight/mindos/foundation'
import type { IFileSystem } from '@geminilight/mindos/knowledge'
import type { SearchEngine, SearchDocument } from '@mindos/search'
import type { VectorDatabase } from '@mindos/vector'
import type {
  IndexerConfig,
  IndexerEvent,
  IndexerEventHandler,
  FileMetadata,
  IndexStats,
  DocumentChunk,
} from './types.js'
import { chunkText, chunkByParagraphs } from './chunker.js'
import { join, relative, extname } from 'node:path'

const DEFAULT_CONFIG: Partial<IndexerConfig> = {
  include: ['**/*.md', '**/*.txt'],
  exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  chunkSize: 1000,
  chunkOverlap: 200,
  watch: false,
}

export class FileIndexer {
  private config: IndexerConfig
  private watcher?: FSWatcher
  private eventHandlers: IndexerEventHandler[] = []
  private stats: IndexStats = {
    totalFiles: 0,
    totalChunks: 0,
    totalBytes: 0,
    lastIndexTime: 0,
    indexDuration: 0,
  }

  constructor(
    config: IndexerConfig,
    private fs: IFileSystem,
    private search: SearchEngine,
    private vector: VectorDatabase,
    private logger: Logger
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config } as IndexerConfig
  }

  /**
   * Register event handler
   */
  on(handler: IndexerEventHandler): void {
    this.eventHandlers.push(handler)
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: IndexerEvent): void {
    this.eventHandlers.forEach((handler) => handler(event))
  }

  /**
   * Start indexing
   */
  async start(): Promise<Result<IndexStats>> {
    try {
      this.emit({ type: 'index-started' })
      const startTime = Date.now()

      // Build initial index
      const result = await this.buildIndex()
      if (!result.ok) {
        this.emit({ type: 'index-error', error: new Error(result.error.message) })
        return result
      }

      this.stats.lastIndexTime = Date.now()
      this.stats.indexDuration = Date.now() - startTime

      this.emit({ type: 'index-completed', stats: this.stats })

      // Start watching if enabled
      if (this.config.watch) {
        await this.startWatching()
      }

      return ok(this.stats)
    } catch (error) {
      const appError = createError(
        'INTERNAL_ERROR' as ErrorCode,
        'Failed to start indexer',
        { cause: error as Error }
      )
      this.emit({ type: 'index-error', error: appError })
      return err(appError)
    }
  }

  /**
   * Stop indexing and cleanup
   */
  async stop(): Promise<Result<void>> {
    try {
      if (this.watcher) {
        await this.watcher.close()
        this.watcher = undefined
      }
      return ok(undefined)
    } catch (error) {
      return err(
        createError('INTERNAL_ERROR' as ErrorCode, 'Failed to stop indexer', {
          cause: error as Error,
        })
      )
    }
  }

  /**
   * Get current stats
   */
  getStats(): IndexStats {
    return { ...this.stats }
  }

  /**
   * Build index from scratch
   */
  private async buildIndex(): Promise<Result<void>> {
    try {
      this.stats = {
        totalFiles: 0,
        totalChunks: 0,
        totalBytes: 0,
        lastIndexTime: 0,
        indexDuration: 0,
      }

      // Get all files
      const filesResult = await this.getFiles()
      if (!filesResult.ok) return filesResult

      const files = filesResult.value

      // Index each file
      for (const file of files) {
        const result = await this.indexFile(file)
        if (!result.ok) {
          this.logger.warn(`Failed to index file: ${file}`, { error: result.error.message })
          continue
        }
      }

      return ok(undefined)
    } catch (error) {
      return err(
        createError('INTERNAL_ERROR' as ErrorCode, 'Failed to build index', {
          cause: error as Error,
        })
      )
    }
  }

  /**
   * Get all files matching patterns
   */
  private async getFiles(): Promise<Result<string[]>> {
    try {
      const files: string[] = []
      await this.scanDirectory(this.config.rootPath, files)
      return ok(files)
    } catch (error) {
      return err(
        createError('INTERNAL_ERROR' as ErrorCode, 'Failed to get files', {
          cause: error as Error,
        })
      )
    }
  }

  /**
   * Recursively scan directory for files
   */
  private async scanDirectory(dirPath: string, files: string[]): Promise<void> {
    const listResult = await this.fs.readdir(dirPath)
    if (!listResult.ok) {
      throw new Error(`Failed to read directory: ${dirPath}`)
    }

    for (const entry of listResult.value) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory) {
        // Recursively scan subdirectory
        await this.scanDirectory(fullPath, files)
      } else if (entry.isFile) {
        if (this.shouldIndex(fullPath)) {
          files.push(fullPath)
        }
      }
    }
  }

  /**
   * Check if file should be indexed
   */
  private shouldIndex(filePath: string): boolean {
    const relativePath = relative(this.config.rootPath, filePath)

    // Check exclude patterns
    if (this.config.exclude) {
      for (const pattern of this.config.exclude) {
        if (this.matchPattern(relativePath, pattern)) {
          return false
        }
      }
    }

    // Check include patterns
    if (this.config.include) {
      for (const pattern of this.config.include) {
        if (this.matchPattern(relativePath, pattern)) {
          return true
        }
      }
      return false
    }

    return true
  }

  /**
   * Simple glob pattern matching
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    // First, escape all regex special characters
    let regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')

    // Then handle glob wildcards (must escape * and ? first)
    regex = regex.replace(/\*/g, '\x00STAR\x00') // Temporary placeholder
    regex = regex.replace(/\?/g, '\x00QUESTION\x00')

    // Now handle the placeholders
    regex = regex.replace(/\x00STAR\x00\x00STAR\x00\//g, '(?:.*/)?') // **/ matches zero or more dirs
    regex = regex.replace(/\x00STAR\x00\x00STAR\x00/g, '.*') // ** matches anything
    regex = regex.replace(/\x00STAR\x00/g, '[^/]*') // * matches anything except /
    regex = regex.replace(/\x00QUESTION\x00/g, '.') // ? matches single char

    return new RegExp(`^${regex}$`).test(path)
  }

  /**
   * Index a single file
   */
  private async indexFile(filePath: string): Promise<Result<void>> {
    try {
      // Get file metadata
      const metadataResult = await this.getFileMetadata(filePath)
      if (!metadataResult.ok) return metadataResult

      const metadata = metadataResult.value

      // Check file size
      if (metadata.size > (this.config.maxFileSize ?? Infinity)) {
        this.logger.debug(`Skipping large file: ${filePath}`)
        return ok(undefined)
      }

      // Read file content
      const contentResult = await this.fs.readFile(filePath)
      if (!contentResult.ok) return contentResult

      const content = contentResult.value

      // Chunk content
      const chunks = chunkByParagraphs(content, filePath, metadata, {
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap,
      })

      // Index chunks in search engine
      for (const chunk of chunks) {
        const searchDoc: SearchDocument = {
          id: chunk.id,
          title: metadata.relativePath,
          content: chunk.content,
          path: chunk.filePath,
          tags: [],
          createdAt: metadata.mtime,
          modifiedAt: metadata.mtime,
          metadata: {
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
          },
        }

        const searchResult = await this.search.indexDocument(searchDoc)

        if (!searchResult.ok) {
          this.logger.warn(`Failed to index chunk in search: ${chunk.id}`)
        }
      }

      // Index chunks in vector database
      // Note: In real implementation, we'd generate embeddings here
      // For now, we'll skip vector indexing as it requires an embedding model
      // This will be implemented when we add the embedding service

      // Update stats
      this.stats.totalFiles++
      this.stats.totalChunks += chunks.length
      this.stats.totalBytes += metadata.size

      return ok(undefined)
    } catch (error) {
      return err(
        createError('INTERNAL_ERROR' as ErrorCode, `Failed to index file: ${filePath}`, {
          cause: error as Error,
        })
      )
    }
  }

  /**
   * Get file metadata
   */
  private async getFileMetadata(filePath: string): Promise<Result<FileMetadata>> {
    try {
      const statsResult = await this.fs.stat(filePath)
      if (!statsResult.ok) return statsResult

      const stats = statsResult.value
      const relativePath = relative(this.config.rootPath, filePath)
      const extension = extname(filePath).slice(1)

      return ok({
        path: filePath,
        relativePath,
        size: stats.size,
        mtime: stats.modifiedAt.getTime(),
        extension,
        mimeType: this.getMimeType(extension),
      })
    } catch (error) {
      return err(
        createError('INTERNAL_ERROR' as ErrorCode, `Failed to get file metadata: ${filePath}`, {
          cause: error as Error,
        })
      )
    }
  }

  /**
   * Get MIME type from extension
   */
  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      md: 'text/markdown',
      txt: 'text/plain',
      json: 'application/json',
      js: 'text/javascript',
      ts: 'text/typescript',
      html: 'text/html',
      css: 'text/css',
    }
    return mimeTypes[extension] || 'application/octet-stream'
  }

  /**
   * Start watching for file changes
   */
  private async startWatching(): Promise<void> {
    this.watcher = watch(this.config.rootPath, {
      ignored: this.config.exclude,
      persistent: true,
      ignoreInitial: true,
    })

    this.watcher.on('add', (path) => {
      this.emit({ type: 'file-added', path })
      this.indexFile(path)
    })

    this.watcher.on('change', (path) => {
      this.emit({ type: 'file-changed', path })
      this.indexFile(path)
    })

    this.watcher.on('unlink', (path) => {
      this.emit({ type: 'file-removed', path })
      this.removeFile(path)
    })
  }

  /**
   * Remove file from indices
   */
  private async removeFile(filePath: string): Promise<void> {
    // Remove from search index
    // Note: This requires the search engine to support deletion by metadata
    // For now, we'll log it
    this.logger.debug(`File removed: ${filePath}`)
  }
}
