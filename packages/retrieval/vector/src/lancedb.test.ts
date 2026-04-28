/**
 * LanceDB vector database tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LanceDBVectorDatabase } from './lancedb.js'
import type { VectorEmbedding, VectorQuery } from './types.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('LanceDBVectorDatabase', () => {
  let db: LanceDBVectorDatabase
  let testDir: string

  beforeEach(() => {
    // Create temporary directory for test database
    testDir = join(tmpdir(), `lancedb-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    db = new LanceDBVectorDatabase({
      path: testDir,
      tableName: 'test_vectors',
      dimension: 3,
    })
  })

  afterEach(async () => {
    await db.close()
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('addVector', () => {
    it('should add a single vector successfully', async () => {
      const embedding: VectorEmbedding = {
        id: 'doc1',
        vector: [1.0, 2.0, 3.0],
        metadata: { title: 'Document 1' },
      }

      const result = await db.addVector(embedding)
      expect(result.ok).toBe(true)
    })

    it('should retrieve added vector by ID', async () => {
      const embedding: VectorEmbedding = {
        id: 'doc1',
        vector: [1.0, 2.0, 3.0],
        metadata: { title: 'Document 1' },
      }

      await db.addVector(embedding)
      const result = await db.getVector('doc1')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).not.toBeNull()
        expect(result.value?.id).toBe('doc1')
        expect(result.value?.vector).toEqual([1.0, 2.0, 3.0])
        expect(result.value?.metadata.title).toBe('Document 1')
      }
    })
  })

  describe('addVectors', () => {
    it('should add multiple vectors successfully', async () => {
      const embeddings: VectorEmbedding[] = [
        {
          id: 'doc1',
          vector: [1.0, 2.0, 3.0],
          metadata: { title: 'Document 1' },
        },
        {
          id: 'doc2',
          vector: [4.0, 5.0, 6.0],
          metadata: { title: 'Document 2' },
        },
      ]

      const result = await db.addVectors(embeddings)
      expect(result.ok).toBe(true)
    })

    it('should handle empty array', async () => {
      const result = await db.addVectors([])
      expect(result.ok).toBe(true)
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      // Add test vectors
      const embeddings: VectorEmbedding[] = [
        {
          id: 'doc1',
          vector: [1.0, 0.0, 0.0],
          metadata: { category: 'A', title: 'Document 1' },
        },
        {
          id: 'doc2',
          vector: [0.0, 1.0, 0.0],
          metadata: { category: 'B', title: 'Document 2' },
        },
        {
          id: 'doc3',
          vector: [0.0, 0.0, 1.0],
          metadata: { category: 'A', title: 'Document 3' },
        },
      ]
      await db.addVectors(embeddings)
    })

    it('should find similar vectors', async () => {
      const query: VectorQuery = {
        vector: [1.0, 0.0, 0.0],
        limit: 2,
      }

      const result = await db.search(query)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.items.length).toBeGreaterThan(0)
        expect(result.value.items.length).toBeLessThanOrEqual(2)
        expect(result.value.items[0].id).toBe('doc1')
      }
    })

    it('should apply metadata filters', async () => {
      const query: VectorQuery = {
        vector: [1.0, 0.0, 0.0],
        limit: 10,
        filter: { category: 'A' },
      }

      const result = await db.search(query)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.items.length).toBe(2)
        expect(result.value.items.every((item) => item.metadata.category === 'A')).toBe(true)
      }
    })

    it('should apply minimum score filter', async () => {
      const query: VectorQuery = {
        vector: [1.0, 0.0, 0.0],
        limit: 10,
        minScore: 0.9,
      }

      const result = await db.search(query)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.items.every((item) => item.score >= 0.9)).toBe(true)
      }
    })

    it('should return processing time', async () => {
      const query: VectorQuery = {
        vector: [1.0, 0.0, 0.0],
        limit: 10,
      }

      const result = await db.search(query)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.processingTime).toBeGreaterThan(0)
      }
    })
  })

  describe('getVector', () => {
    it('should return null for non-existent ID', async () => {
      const result = await db.getVector('nonexistent')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBeNull()
      }
    })

    it('should retrieve vector with metadata', async () => {
      const embedding: VectorEmbedding = {
        id: 'doc1',
        vector: [1.0, 2.0, 3.0],
        metadata: { title: 'Test', count: 42 },
      }

      await db.addVector(embedding)
      const result = await db.getVector('doc1')

      expect(result.ok).toBe(true)
      if (result.ok && result.value) {
        expect(result.value.metadata.title).toBe('Test')
        expect(result.value.metadata.count).toBe(42)
      }
    })
  })

  describe('removeVector', () => {
    it('should remove a single vector', async () => {
      const embedding: VectorEmbedding = {
        id: 'doc1',
        vector: [1.0, 2.0, 3.0],
        metadata: { title: 'Document 1' },
      }

      await db.addVector(embedding)
      const removeResult = await db.removeVector('doc1')
      expect(removeResult.ok).toBe(true)

      const getResult = await db.getVector('doc1')
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value).toBeNull()
      }
    })
  })

  describe('removeVectors', () => {
    it('should remove multiple vectors', async () => {
      const embeddings: VectorEmbedding[] = [
        {
          id: 'doc1',
          vector: [1.0, 2.0, 3.0],
          metadata: { title: 'Document 1' },
        },
        {
          id: 'doc2',
          vector: [4.0, 5.0, 6.0],
          metadata: { title: 'Document 2' },
        },
      ]

      await db.addVectors(embeddings)
      const removeResult = await db.removeVectors(['doc1', 'doc2'])
      expect(removeResult.ok).toBe(true)

      const get1 = await db.getVector('doc1')
      const get2 = await db.getVector('doc2')
      expect(get1.ok && get1.value).toBeNull()
      expect(get2.ok && get2.value).toBeNull()
    })

    it('should handle empty array', async () => {
      const result = await db.removeVectors([])
      expect(result.ok).toBe(true)
    })
  })

  describe('clear', () => {
    it('should remove all vectors', async () => {
      const embeddings: VectorEmbedding[] = [
        {
          id: 'doc1',
          vector: [1.0, 2.0, 3.0],
          metadata: { title: 'Document 1' },
        },
        {
          id: 'doc2',
          vector: [4.0, 5.0, 6.0],
          metadata: { title: 'Document 2' },
        },
      ]

      await db.addVectors(embeddings)
      const clearResult = await db.clear()
      expect(clearResult.ok).toBe(true)

      const statsResult = await db.getStats()
      expect(statsResult.ok).toBe(true)
      if (statsResult.ok) {
        expect(statsResult.value.vectorCount).toBe(0)
      }
    })
  })

  describe('getStats', () => {
    it('should return correct vector count', async () => {
      const embeddings: VectorEmbedding[] = [
        {
          id: 'doc1',
          vector: [1.0, 2.0, 3.0],
          metadata: {},
        },
        {
          id: 'doc2',
          vector: [4.0, 5.0, 6.0],
          metadata: {},
        },
      ]

      await db.addVectors(embeddings)
      const result = await db.getStats()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.vectorCount).toBe(2)
        expect(result.value.dimension).toBe(3)
        expect(result.value.lastUpdatedAt).toBeInstanceOf(Date)
      }
    })

    it('should return zero count for empty database', async () => {
      const result = await db.getStats()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.vectorCount).toBe(0)
      }
    })
  })

  describe('health', () => {
    it('should return true for healthy database', async () => {
      const result = await db.health()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(true)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle vectors with empty metadata', async () => {
      const embedding: VectorEmbedding = {
        id: 'doc1',
        vector: [1.0, 2.0, 3.0],
        metadata: {},
      }

      const addResult = await db.addVector(embedding)
      expect(addResult.ok).toBe(true)

      const getResult = await db.getVector('doc1')
      expect(getResult.ok).toBe(true)
      if (getResult.ok && getResult.value) {
        expect(getResult.value.metadata).toEqual({})
      }
    })

    it('should handle special characters in IDs', async () => {
      const embedding: VectorEmbedding = {
        id: 'doc-with-special_chars.123',
        vector: [1.0, 2.0, 3.0],
        metadata: { title: 'Test' },
      }

      const addResult = await db.addVector(embedding)
      expect(addResult.ok).toBe(true)

      const getResult = await db.getVector('doc-with-special_chars.123')
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value?.id).toBe('doc-with-special_chars.123')
      }
    })

    it('should handle metadata with various types', async () => {
      const embedding: VectorEmbedding = {
        id: 'doc1',
        vector: [1.0, 2.0, 3.0],
        metadata: {
          string: 'text',
          number: 42,
          boolean: true,
          nested: { key: 'value' },
        },
      }

      const addResult = await db.addVector(embedding)
      expect(addResult.ok).toBe(true)

      const getResult = await db.getVector('doc1')
      expect(getResult.ok).toBe(true)
      if (getResult.ok && getResult.value) {
        expect(getResult.value.metadata.string).toBe('text')
        expect(getResult.value.metadata.number).toBe(42)
        expect(getResult.value.metadata.boolean).toBe(true)
      }
    })
  })
})
