/**
 * Tests for file indexer
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FileIndexer } from './indexer.js'
import { MemoryFileSystem } from '@geminilight/mindos/knowledge'
import { createLogger } from '@geminilight/mindos/foundation'
import type { SearchEngine } from '@mindos/search'
import type { VectorDatabase } from '@mindos/vector'
import type { IndexerConfig, IndexerEvent } from './types.js'
import { ok } from '@geminilight/mindos/foundation'

// Mock search engine
class MockSearchEngine implements SearchEngine {
  documents: any[] = []

  async indexDocument(doc: any) {
    this.documents.push(doc)
    return ok(undefined)
  }

  async indexDocuments(docs: any[]) {
    this.documents.push(...docs)
    return ok(undefined)
  }

  async search() {
    return ok([])
  }

  async deleteDocument() {
    return ok(undefined)
  }

  async clear() {
    this.documents = []
    return ok(undefined)
  }

  async getStats() {
    return ok({ documentCount: this.documents.length, indexSize: 0 })
  }

  async health() {
    return ok(true)
  }
}

// Mock vector database
class MockVectorDatabase implements VectorDatabase {
  vectors: any[] = []

  async addVector() {
    return ok(undefined)
  }

  async addVectors(vectors: any[]) {
    this.vectors.push(...vectors)
    return ok(undefined)
  }

  async search() {
    return ok([])
  }

  async getVector() {
    return ok(null)
  }

  async removeVector() {
    return ok(undefined)
  }

  async removeVectors() {
    return ok(undefined)
  }

  async clear() {
    this.vectors = []
    return ok(undefined)
  }

  async getStats() {
    return ok({ vectorCount: this.vectors.length, dimensions: 0 })
  }

  async health() {
    return ok(true)
  }
}

describe('FileIndexer', () => {
  let fs: MemoryFileSystem
  let search: MockSearchEngine
  let vector: MockVectorDatabase
  let logger: ReturnType<typeof createLogger>
  let config: IndexerConfig

  beforeEach(() => {
    fs = new MemoryFileSystem()
    search = new MockSearchEngine()
    vector = new MockVectorDatabase()
    logger = createLogger({ level: 'silent' })
    config = {
      rootPath: '/test',
      include: ['**/*.md', '**/*.txt'],
      exclude: ['**/node_modules/**'],
      maxFileSize: 1024 * 1024,
      chunkSize: 100,
      chunkOverlap: 20,
      watch: false,
    }
  })

  describe('Initialization', () => {
    it('should create indexer with config', () => {
      const indexer = new FileIndexer(config, fs, search, vector, logger)
      expect(indexer).toBeInstanceOf(FileIndexer)
    })

    it('should initialize with default config values', () => {
      const minimalConfig: IndexerConfig = {
        rootPath: '/test',
      }
      const indexer = new FileIndexer(minimalConfig, fs, search, vector, logger)
      expect(indexer).toBeInstanceOf(FileIndexer)
    })
  })

  describe('Event Handling', () => {
    it('should register event handlers', () => {
      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const events: IndexerEvent[] = []

      indexer.on((event) => events.push(event))
      expect(events).toHaveLength(0)
    })

    it('should emit index-started event', async () => {
      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const events: IndexerEvent[] = []

      indexer.on((event) => events.push(event))

      await fs.writeFile('/test/file.md', 'content')
      await indexer.start()

      expect(events.some((e) => e.type === 'index-started')).toBe(true)
    })

    it('should emit index-completed event', async () => {
      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const events: IndexerEvent[] = []

      indexer.on((event) => events.push(event))

      await fs.writeFile('/test/file.md', 'content')
      await indexer.start()

      expect(events.some((e) => e.type === 'index-completed')).toBe(true)
    })
  })

  describe('File Indexing', () => {
    it('should index markdown files', async () => {
      await fs.writeFile('/test/file.md', 'Test content')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const result = await indexer.start()

      expect(result.ok).toBe(true)
      expect(search.documents.length).toBeGreaterThan(0)
    })

    it('should index text files', async () => {
      await fs.writeFile('/test/file.txt', 'Test content')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const result = await indexer.start()

      expect(result.ok).toBe(true)
      expect(search.documents.length).toBeGreaterThan(0)
    })

    it('should skip excluded files', async () => {
      await fs.writeFile('/test/node_modules/file.md', 'Should be excluded')
      await fs.writeFile('/test/file.md', 'Should be included')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      expect(search.documents.length).toBe(1)
    })

    it('should skip files not matching include patterns', async () => {
      await fs.writeFile('/test/file.js', 'JavaScript file')
      await fs.writeFile('/test/file.md', 'Markdown file')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      expect(search.documents.length).toBe(1)
    })

    it('should chunk large files', async () => {
      const largeContent = 'a'.repeat(500)
      await fs.writeFile('/test/large.md', largeContent)

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      expect(search.documents.length).toBeGreaterThan(1)
    })

    it('should skip files exceeding max size', async () => {
      const smallConfig = { ...config, maxFileSize: 10 }
      await fs.writeFile('/test/large.md', 'This content exceeds 10 bytes')

      const indexer = new FileIndexer(smallConfig, fs, search, vector, logger)
      await indexer.start()

      expect(search.documents.length).toBe(0)
    })
  })

  describe('Stats', () => {
    it('should track total files indexed', async () => {
      await fs.writeFile('/test/file1.md', 'Content 1')
      await fs.writeFile('/test/file2.md', 'Content 2')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      const stats = indexer.getStats()
      expect(stats.totalFiles).toBe(2)
    })

    it('should track total chunks created', async () => {
      const largeContent = 'a'.repeat(500)
      await fs.writeFile('/test/large.md', largeContent)

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      const stats = indexer.getStats()
      expect(stats.totalChunks).toBeGreaterThan(1)
    })

    it('should track total bytes indexed', async () => {
      const content = 'Test content'
      await fs.writeFile('/test/file.md', content)

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      const stats = indexer.getStats()
      expect(stats.totalBytes).toBeGreaterThan(0)
    })

    it('should track index duration', async () => {
      await fs.writeFile('/test/file.md', 'Content')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      const stats = indexer.getStats()
      expect(stats.indexDuration).toBeGreaterThanOrEqual(0)
    })

    it('should track last index time', async () => {
      await fs.writeFile('/test/file.md', 'Content')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const beforeTime = Date.now()
      await indexer.start()
      const afterTime = Date.now()

      const stats = indexer.getStats()
      expect(stats.lastIndexTime).toBeGreaterThanOrEqual(beforeTime)
      expect(stats.lastIndexTime).toBeLessThanOrEqual(afterTime)
    })
  })

  describe('Stop', () => {
    it('should stop indexer successfully', async () => {
      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      const result = await indexer.stop()
      expect(result.ok).toBe(true)
    })

    it('should stop without starting', async () => {
      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const result = await indexer.stop()
      expect(result.ok).toBe(true)
    })
  })

  describe('Pattern Matching', () => {
    it('should match wildcard patterns', async () => {
      await fs.writeFile('/test/file.md', 'Content')
      await fs.writeFile('/test/file.txt', 'Content')
      await fs.writeFile('/test/file.js', 'Content')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      // Should only index .md and .txt files
      expect(search.documents.length).toBe(2)
    })

    it('should match recursive patterns', async () => {
      await fs.writeFile('/test/dir1/file.md', 'Content')
      await fs.writeFile('/test/dir2/file.md', 'Content')

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      await indexer.start()

      expect(search.documents.length).toBe(2)
    })
  })

  describe('Error Handling', () => {
    it('should handle read errors gracefully', async () => {
      // Create a file that will fail to read
      await fs.writeFile('/test/file.md', 'Content')

      // Mock fs.readFile to fail
      const originalRead = fs.readFile.bind(fs)
      fs.readFile = async () => ({ ok: false, error: new Error('Read failed') } as any)

      const indexer = new FileIndexer(config, fs, search, vector, logger)
      const result = await indexer.start()

      // Should complete but with no documents indexed
      expect(result.ok).toBe(true)
      expect(search.documents.length).toBe(0)

      // Restore original read
      fs.readFile = originalRead
    })

    it('should emit error events on failures', async () => {
      const events: IndexerEvent[] = []
      const indexer = new FileIndexer(config, fs, search, vector, logger)
      indexer.on((event) => events.push(event))

      // Mock fs.readdir to fail
      const originalReaddir = fs.readdir.bind(fs)
      fs.readdir = async () => ({ ok: false, error: new Error('List failed') } as any)

      await indexer.start()

      expect(events.some((e) => e.type === 'index-error')).toBe(true)

      // Restore
      fs.readdir = originalReaddir
    })
  })
})
