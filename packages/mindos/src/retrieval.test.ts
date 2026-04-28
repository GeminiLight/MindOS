import { describe, expect, it } from 'vitest';
import {
  chunkByParagraphs,
  chunkText,
  retrievalCapabilityBoundary,
  type FileMetadata,
  type SearchDocument,
  type SearchEngine,
  type VectorDatabase,
} from './retrieval.js';

const metadata: FileMetadata = {
  path: '/notes/long.md',
  relativePath: 'long.md',
  size: 4096,
  mtime: 1710000000000,
  extension: 'md',
  mimeType: 'text/markdown',
};

describe('MindOS retrieval core contracts', () => {
  it('exposes retrieval as an optional product capability owned by MindOS', () => {
    expect(retrievalCapabilityBoundary).toMatchObject({
      owner: '@geminilight/mindos',
      loadMode: 'optional',
      defaultRuntime: false,
      activation: 'explicit',
    });
  });

  it('chunks long text with stable indexes, totals, and caller metadata', () => {
    const chunks = chunkText('abcdefghij', '/notes/long.md', metadata, {
      chunkSize: 4,
      chunkOverlap: 1,
    });

    expect(chunks.map((chunk) => chunk.content)).toEqual(['abcd', 'defg', 'ghij', 'j']);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3]);
    expect(chunks.every((chunk) => chunk.totalChunks === 4)).toBe(true);
    expect(chunks.every((chunk) => chunk.metadata === metadata)).toBe(true);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
  });

  it('chunks paragraphs without dropping oversized paragraphs', () => {
    const chunks = chunkByParagraphs('intro\n\nabcdefghij\n\noutro', '/notes/long.md', metadata, {
      chunkSize: 5,
      chunkOverlap: 0,
    });

    expect(chunks.map((chunk) => chunk.content)).toEqual(['intro', 'abcde', 'fghij', 'outro']);
    expect(chunks.every((chunk) => chunk.totalChunks === 4)).toBe(true);
  });

  it('makes search and vector interfaces available without importing adapter packages', () => {
    const doc: SearchDocument = {
      id: 'doc-1',
      title: 'Doc',
      content: 'Body',
      path: 'Doc.md',
      tags: [],
      createdAt: 1710000000000,
      modifiedAt: 1710000000000,
    };

    const searchEngine: Pick<SearchEngine, 'indexDocument'> = {
      indexDocument: async () => ({ ok: true, value: undefined }),
    };
    const vectorDb: Pick<VectorDatabase, 'health'> = {
      health: async () => ({ ok: true, value: true }),
    };

    expect(doc.id).toBe('doc-1');
    expect(searchEngine.indexDocument).toBeTypeOf('function');
    expect(vectorDb.health).toBeTypeOf('function');
  });
});
