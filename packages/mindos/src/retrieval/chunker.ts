import { generateUUID } from '../foundation/shared/index.js';
import type { DocumentChunk, FileMetadata } from './types.js';

export interface ChunkerOptions {
  chunkSize: number;
  chunkOverlap: number;
}

const DEFAULT_OPTIONS: ChunkerOptions = {
  chunkSize: 1000,
  chunkOverlap: 200,
};

function normalizeOptions(options: Partial<ChunkerOptions>): ChunkerOptions {
  const chunkSize = options.chunkSize ?? DEFAULT_OPTIONS.chunkSize;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_OPTIONS.chunkOverlap;

  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive finite number');
  }
  if (!Number.isFinite(chunkOverlap) || chunkOverlap < 0) {
    throw new Error('chunkOverlap must be a non-negative finite number');
  }
  if (chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap must be smaller than chunkSize');
  }

  return { chunkSize, chunkOverlap };
}

function makeChunk(
  content: string,
  filePath: string,
  metadata: FileMetadata,
  chunkIndex: number,
): DocumentChunk {
  return {
    id: generateUUID(),
    filePath,
    content,
    chunkIndex,
    totalChunks: 0,
    metadata,
  };
}

function setTotals(chunks: DocumentChunk[]): DocumentChunk[] {
  const totalChunks = chunks.length;
  for (const chunk of chunks) chunk.totalChunks = totalChunks;
  return chunks;
}

export function chunkText(
  text: string,
  filePath: string,
  metadata: FileMetadata,
  options: Partial<ChunkerOptions> = {},
): DocumentChunk[] {
  const opts = normalizeOptions(options);

  if (text.length <= opts.chunkSize) {
    return [{
      ...makeChunk(text, filePath, metadata, 0),
      totalChunks: 1,
    }];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + opts.chunkSize, text.length);
    chunks.push(makeChunk(text.slice(start, end), filePath, metadata, chunks.length));
    start += opts.chunkSize - opts.chunkOverlap;
  }

  return setTotals(chunks);
}

export function chunkByParagraphs(
  text: string,
  filePath: string,
  metadata: FileMetadata,
  options: Partial<ChunkerOptions> = {},
): DocumentChunk[] {
  const opts = normalizeOptions(options);
  const paragraphs = text.split(/\n\n+/);
  const chunks: DocumentChunk[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (trimmed.length > opts.chunkSize) {
      if (currentChunk) {
        chunks.push(makeChunk(currentChunk, filePath, metadata, chunks.length));
        currentChunk = '';
      }

      const subChunks = chunkText(trimmed, filePath, metadata, opts);
      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          chunkIndex: chunks.length,
          totalChunks: 0,
        });
      }
      continue;
    }

    const separatorLength = currentChunk ? 2 : 0;
    if (currentChunk.length + separatorLength + trimmed.length <= opts.chunkSize) {
      currentChunk += `${currentChunk ? '\n\n' : ''}${trimmed}`;
      continue;
    }

    if (currentChunk) chunks.push(makeChunk(currentChunk, filePath, metadata, chunks.length));
    currentChunk = trimmed;
  }

  if (currentChunk) chunks.push(makeChunk(currentChunk, filePath, metadata, chunks.length));

  return setTotals(chunks);
}
