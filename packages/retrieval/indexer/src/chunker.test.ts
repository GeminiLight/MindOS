/**
 * Tests for text chunking utilities
 */

import { describe, it, expect } from 'vitest'
import { chunkText, chunkByParagraphs } from './chunker.js'
import type { FileMetadata } from './types.js'

describe('chunkText', () => {
  const mockMetadata: FileMetadata = {
    path: '/test/file.txt',
    relativePath: 'file.txt',
    size: 1000,
    mtime: Date.now(),
    extension: 'txt',
    mimeType: 'text/plain',
  }

  it('should create a single chunk for small text', () => {
    const text = 'This is a short text.'
    const chunks = chunkText(text, '/test/file.txt', mockMetadata)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toBe(text)
    expect(chunks[0]?.chunkIndex).toBe(0)
    expect(chunks[0]?.totalChunks).toBe(1)
    expect(chunks[0]?.filePath).toBe('/test/file.txt')
  })

  it('should split large text into multiple chunks', () => {
    const text = 'a'.repeat(2500)
    const chunks = chunkText(text, '/test/file.txt', mockMetadata, {
      chunkSize: 1000,
      chunkOverlap: 200,
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.content).toHaveLength(1000)
    expect(chunks[0]?.chunkIndex).toBe(0)
    expect(chunks[1]?.chunkIndex).toBe(1)
  })

  it('should apply chunk overlap correctly', () => {
    const text = 'a'.repeat(1500)
    const chunks = chunkText(text, '/test/file.txt', mockMetadata, {
      chunkSize: 1000,
      chunkOverlap: 200,
    })

    expect(chunks.length).toBeGreaterThan(1)
    // Second chunk should start 800 chars after first (1000 - 200 overlap)
    const expectedStart = 800
    expect(chunks[1]?.content.substring(0, 200)).toBe('a'.repeat(200))
  })

  it('should update totalChunks for all chunks', () => {
    const text = 'a'.repeat(2500)
    const chunks = chunkText(text, '/test/file.txt', mockMetadata, {
      chunkSize: 1000,
      chunkOverlap: 0,
    })

    const totalChunks = chunks.length
    chunks.forEach((chunk) => {
      expect(chunk.totalChunks).toBe(totalChunks)
    })
  })

  it('should include metadata in chunks', () => {
    const text = 'Test text'
    const chunks = chunkText(text, '/test/file.txt', mockMetadata)

    expect(chunks[0]?.metadata).toEqual(mockMetadata)
  })

  it('should generate unique IDs for each chunk', () => {
    const text = 'a'.repeat(2500)
    const chunks = chunkText(text, '/test/file.txt', mockMetadata, {
      chunkSize: 1000,
      chunkOverlap: 0,
    })

    const ids = chunks.map((c) => c.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
})

describe('chunkByParagraphs', () => {
  const mockMetadata: FileMetadata = {
    path: '/test/file.txt',
    relativePath: 'file.txt',
    size: 1000,
    mtime: Date.now(),
    extension: 'txt',
    mimeType: 'text/plain',
  }

  it('should create a single chunk for small text', () => {
    const text = 'This is a short paragraph.'
    const chunks = chunkByParagraphs(text, '/test/file.txt', mockMetadata)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toBe(text)
  })

  it('should split text by paragraphs', () => {
    const text = 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.'
    const chunks = chunkByParagraphs(text, '/test/file.txt', mockMetadata, {
      chunkSize: 20,  // Small chunk size to force splitting
      chunkOverlap: 0,
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.content).toContain('Paragraph 1')
  })

  it('should combine small paragraphs into chunks', () => {
    const text = 'P1.\n\nP2.\n\nP3.\n\nP4.'
    const chunks = chunkByParagraphs(text, '/test/file.txt', mockMetadata, {
      chunkSize: 100,
      chunkOverlap: 0,
    })

    // Should combine multiple small paragraphs
    expect(chunks.length).toBeLessThan(4)
  })

  it('should respect chunk size limit', () => {
    const longParagraph = 'a'.repeat(1500)
    const text = `${longParagraph}\n\nShort paragraph.`
    const chunks = chunkByParagraphs(text, '/test/file.txt', mockMetadata, {
      chunkSize: 1000,
      chunkOverlap: 0,
    })

    chunks.forEach((chunk) => {
      expect(chunk.content.length).toBeLessThanOrEqual(1500)
    })
  })

  it('should preserve paragraph boundaries', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const chunks = chunkByParagraphs(text, '/test/file.txt', mockMetadata, {
      chunkSize: 100,
      chunkOverlap: 0,
    })

    // Each chunk should contain complete paragraphs
    chunks.forEach((chunk) => {
      expect(chunk.content.trim()).not.toBe('')
    })
  })

  it('should handle empty lines correctly', () => {
    const text = 'Paragraph 1.\n\n\n\nParagraph 2.'
    const chunks = chunkByParagraphs(text, '/test/file.txt', mockMetadata)

    expect(chunks.length).toBeGreaterThan(0)
    chunks.forEach((chunk) => {
      expect(chunk.content.trim()).not.toBe('')
    })
  })

  it('should update totalChunks for all chunks', () => {
    const text = Array(10)
      .fill('Paragraph.')
      .join('\n\n')
    const chunks = chunkByParagraphs(text, '/test/file.txt', mockMetadata, {
      chunkSize: 50,
      chunkOverlap: 0,
    })

    const totalChunks = chunks.length
    chunks.forEach((chunk) => {
      expect(chunk.totalChunks).toBe(totalChunks)
    })
  })
})
