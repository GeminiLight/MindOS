/**
 * MeiliSearch engine tests
 *
 * Note: These are integration tests that require a running MeiliSearch instance.
 * If MeiliSearch is not available, tests will be skipped.
 * Start MeiliSearch with: docker run -p 7700:7700 getmeili/meilisearch:latest
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MeiliSearchEngine } from './meilisearch.js'
import type { SearchDocument } from './types.js'

const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://localhost:7700'
const TEST_INDEX = `test_index_${Date.now()}`

describe('MeiliSearchEngine', () => {
  let engine: MeiliSearchEngine
  let isAvailable = false

  beforeAll(async () => {
    engine = new MeiliSearchEngine({
      host: MEILISEARCH_HOST,
      indexName: TEST_INDEX,
    })

    const healthResult = await engine.health()
    isAvailable = healthResult.ok && healthResult.value === true
  })

  beforeEach(async () => {
    if (isAvailable) {
      await engine.clear()
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })

  afterAll(async () => {
    if (isAvailable) {
      await engine.clear()
    }
  })

  it('should check MeiliSearch availability', async () => {
    const result = await engine.health()
    expect(result.ok).toBe(true)
    expect(typeof result.value).toBe('boolean')

    if (!result.value) {
      console.warn('⚠️  MeiliSearch is not running. Start it with:')
      console.warn('   docker run -p 7700:7700 getmeili/meilisearch:latest')
    }
  })

  it.skipIf(!isAvailable)('should index a single document', async () => {
    const document: SearchDocument = {
      id: 'doc1',
      title: 'Test Document',
      content: 'This is a test document',
      path: '/test/doc1.md',
      tags: ['test'],
      createdAt: new Date(),
      modifiedAt: new Date(),
    }

    const result = await engine.indexDocument(document)
    expect(result.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 100))

    const getResult = await engine.getDocument('doc1')
    expect(getResult.ok).toBe(true)
    if (getResult.ok) {
      expect(getResult.value?.id).toBe('doc1')
      expect(getResult.value?.title).toBe('Test Document')
    }
  })

  it.skipIf(!isAvailable)('should index multiple documents', async () => {
    const documents: SearchDocument[] = [
      {
        id: 'doc1',
        title: 'Document 1',
        content: 'Content 1',
        path: '/test/doc1.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      {
        id: 'doc2',
        title: 'Document 2',
        content: 'Content 2',
        path: '/test/doc2.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    ]

    const result = await engine.indexDocuments(documents)
    expect(result.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 100))

    const statsResult = await engine.getStats()
    expect(statsResult.ok).toBe(true)
    if (statsResult.ok) {
      expect(statsResult.value.documentCount).toBe(2)
    }
  })

  it.skipIf(!isAvailable)('should search documents by query', async () => {
    const documents: SearchDocument[] = [
      {
        id: 'doc1',
        title: 'JavaScript Tutorial',
        content: 'Learn JavaScript programming',
        path: '/tutorials/javascript.md',
        tags: ['programming'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      {
        id: 'doc2',
        title: 'Cooking Recipe',
        content: 'How to cook pasta',
        path: '/recipes/pasta.md',
        tags: ['cooking'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    ]

    await engine.indexDocuments(documents)
    await new Promise((resolve) => setTimeout(resolve, 200))

    const result = await engine.search('programming')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.items.length).toBeGreaterThan(0)
      expect(result.value.processingTime).toBeGreaterThanOrEqual(0)
    }
  })

  it.skipIf(!isAvailable)('should filter by tags', async () => {
    const documents: SearchDocument[] = [
      {
        id: 'doc1',
        title: 'JavaScript Tutorial',
        content: 'Learn JavaScript',
        path: '/tutorials/js.md',
        tags: ['programming', 'javascript'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      {
        id: 'doc2',
        title: 'Cooking Recipe',
        content: 'How to cook',
        path: '/recipes/pasta.md',
        tags: ['cooking'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    ]

    await engine.indexDocuments(documents)
    await new Promise((resolve) => setTimeout(resolve, 200))

    const result = await engine.search('', { tags: ['cooking'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.items.length).toBe(1)
      expect(result.value.items[0].document.id).toBe('doc2')
    }
  })

  it.skipIf(!isAvailable)('should filter by path prefix', async () => {
    const documents: SearchDocument[] = [
      {
        id: 'doc1',
        title: 'Tutorial 1',
        content: 'Content 1',
        path: '/tutorials/doc1.md',
        tags: [],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      {
        id: 'doc2',
        title: 'Recipe 1',
        content: 'Content 2',
        path: '/recipes/doc2.md',
        tags: [],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    ]

    await engine.indexDocuments(documents)
    await new Promise((resolve) => setTimeout(resolve, 200))

    const result = await engine.search('', { pathPrefix: '/tutorials' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.items.length).toBe(1)
      expect(result.value.items[0].document.path).toContain('/tutorials')
    }
  })

  it.skipIf(!isAvailable)('should apply limit and offset', async () => {
    const documents: SearchDocument[] = Array.from({ length: 5 }, (_, i) => ({
      id: `doc${i + 1}`,
      title: `Document ${i + 1}`,
      content: `Content ${i + 1}`,
      path: `/test/doc${i + 1}.md`,
      tags: ['test'],
      createdAt: new Date(),
      modifiedAt: new Date(),
    }))

    await engine.indexDocuments(documents)
    await new Promise((resolve) => setTimeout(resolve, 200))

    const result = await engine.search('', { limit: 2, offset: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.items.length).toBeLessThanOrEqual(2)
      expect(result.value.limit).toBe(2)
      expect(result.value.offset).toBe(1)
    }
  })

  it.skipIf(!isAvailable)('should get document by ID', async () => {
    const document: SearchDocument = {
      id: 'doc1',
      title: 'Test Document',
      content: 'Content',
      path: '/test/doc1.md',
      tags: ['test'],
      createdAt: new Date(),
      modifiedAt: new Date(),
    }

    await engine.indexDocument(document)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const result = await engine.getDocument('doc1')
    expect(result.ok).toBe(true)
    if (result.ok && result.value) {
      expect(result.value.id).toBe('doc1')
      expect(result.value.title).toBe('Test Document')
    }
  })

  it.skipIf(!isAvailable)('should return null for non-existent document', async () => {
    const result = await engine.getDocument('nonexistent')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeNull()
    }
  })

  it.skipIf(!isAvailable)('should remove a document', async () => {
    const document: SearchDocument = {
      id: 'doc1',
      title: 'Test Document',
      content: 'Content',
      path: '/test/doc1.md',
      tags: ['test'],
      createdAt: new Date(),
      modifiedAt: new Date(),
    }

    await engine.indexDocument(document)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const removeResult = await engine.removeDocument('doc1')
    expect(removeResult.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 100))

    const getResult = await engine.getDocument('doc1')
    expect(getResult.ok).toBe(true)
    if (getResult.ok) {
      expect(getResult.value).toBeNull()
    }
  })

  it.skipIf(!isAvailable)('should remove multiple documents', async () => {
    const documents: SearchDocument[] = [
      {
        id: 'doc1',
        title: 'Document 1',
        content: 'Content 1',
        path: '/test/doc1.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      {
        id: 'doc2',
        title: 'Document 2',
        content: 'Content 2',
        path: '/test/doc2.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    ]

    await engine.indexDocuments(documents)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const removeResult = await engine.removeDocuments(['doc1', 'doc2'])
    expect(removeResult.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 100))

    const statsResult = await engine.getStats()
    expect(statsResult.ok).toBe(true)
    if (statsResult.ok) {
      expect(statsResult.value.documentCount).toBe(0)
    }
  })

  it.skipIf(!isAvailable)('should clear all documents', async () => {
    const documents: SearchDocument[] = [
      {
        id: 'doc1',
        title: 'Document 1',
        content: 'Content 1',
        path: '/test/doc1.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      {
        id: 'doc2',
        title: 'Document 2',
        content: 'Content 2',
        path: '/test/doc2.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    ]

    await engine.indexDocuments(documents)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const clearResult = await engine.clear()
    expect(clearResult.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 100))

    const statsResult = await engine.getStats()
    expect(statsResult.ok).toBe(true)
    if (statsResult.ok) {
      expect(statsResult.value.documentCount).toBe(0)
    }
  })

  it.skipIf(!isAvailable)('should get index stats', async () => {
    const documents: SearchDocument[] = [
      {
        id: 'doc1',
        title: 'Document 1',
        content: 'Content 1',
        path: '/test/doc1.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      {
        id: 'doc2',
        title: 'Document 2',
        content: 'Content 2',
        path: '/test/doc2.md',
        tags: ['test'],
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    ]

    await engine.indexDocuments(documents)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const result = await engine.getStats()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.documentCount).toBe(2)
      expect(result.value.lastUpdatedAt).toBeInstanceOf(Date)
    }
  })
})
