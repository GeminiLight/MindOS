import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getRetrievalReceipt,
  listRetrievalReceipts,
  writeRetrievalReceipt,
} from './receipt.js';

describe('retrieval receipts', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-retrieval-receipts-'));
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('persists an immutable, inspectable receipt without recalled body content', () => {
    const receipt = writeRetrievalReceipt(mindRoot, {
      id: 'receipt-selected-1',
      query: 'find architecture decision sk-secret-value',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'selected',
      startedAt: '2026-09-02T03:00:00.000Z',
      completedAt: '2026-09-02T03:00:00.042Z',
      budget: { maxTokens: 1200, maxFiles: 3, minScore: 1, timeoutMs: 2000 },
      scope: { preferredPaths: ['Projects/MindOS'], excludePaths: ['Private/token.md'] },
      candidates: [
        { path: 'Projects/MindOS/architecture.md', score: 8.4, selected: true, reason: 'highest reranked chunk within budget' },
        { path: 'Projects/MindOS/old.md', score: 2.1, selected: false, reason: 'file diversity limit' },
      ],
      selections: [{
        assetId: 'asset-architecture',
        path: 'Projects/MindOS/architecture.md',
        score: 8.4,
        startLine: 12,
        endLine: 31,
        headingPath: ['Architecture', 'Decision'],
        estimatedTokens: 240,
        truncated: false,
        reason: 'highest reranked chunk within budget',
      }],
      totals: { candidateCount: 2, selectedCount: 1, usedTokens: 240 },
      metadata: { chatSessionId: 'chat-1', rawBody: 'THIS FULL BODY MUST NOT PERSIST' },
    });

    expect(receipt).toMatchObject({
      id: 'receipt-selected-1',
      outcome: 'selected',
      queryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      selections: [expect.objectContaining({ assetId: 'asset-architecture', startLine: 12, endLine: 31 })],
      durationMs: 42,
    });
    expect(JSON.stringify(receipt)).not.toContain('sk-secret-value');
    expect(JSON.stringify(receipt)).not.toContain('THIS FULL BODY MUST NOT PERSIST');
    expect(getRetrievalReceipt(mindRoot, receipt.id)).toEqual(receipt);
    expect(listRetrievalReceipts(mindRoot, { outcome: 'selected', limit: 1 })).toEqual([receipt]);
  });

  it('records bounded timeout and empty outcomes with redacted errors', () => {
    const timeout = writeRetrievalReceipt(mindRoot, {
      id: 'receipt-timeout-1',
      query: 'timeout query',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'timeout',
      startedAt: '2026-09-02T04:00:00.000Z',
      completedAt: '2026-09-02T04:00:02.000Z',
      budget: { maxTokens: 100, maxFiles: 1, minScore: 1, timeoutMs: 2000 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [],
      selections: [],
      totals: { candidateCount: 0, selectedCount: 0, usedTokens: 0 },
      error: `Authorization: Bearer secret-token ${'x'.repeat(1000)}`,
    });
    writeRetrievalReceipt(mindRoot, {
      id: 'receipt-empty-1',
      query: '',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'empty',
      startedAt: '2026-09-02T04:01:00.000Z',
      completedAt: '2026-09-02T04:01:00.000Z',
      budget: { maxTokens: 100, maxFiles: 1, minScore: 1, timeoutMs: 2000 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [],
      selections: [],
      totals: { candidateCount: 0, selectedCount: 0, usedTokens: 0 },
    });

    expect(timeout.error).not.toContain('secret-token');
    expect(timeout.error!.length).toBeLessThanOrEqual(280);
    expect(listRetrievalReceipts(mindRoot, { limit: 10 }).map((item) => item.id)).toEqual([
      'receipt-empty-1',
      'receipt-timeout-1',
    ]);
  });

  it('is idempotent for the same receipt and rejects immutable id collisions', () => {
    const input = {
      id: 'receipt-idempotent',
      query: 'stable query',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'empty' as const,
      startedAt: '2026-09-02T04:30:00.000Z',
      completedAt: '2026-09-02T04:30:00.001Z',
      budget: { maxTokens: 100, maxFiles: 1, minScore: 1, timeoutMs: 2_000 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [],
      selections: [],
      totals: { candidateCount: 0, selectedCount: 0, usedTokens: 0 },
    };
    const first = writeRetrievalReceipt(mindRoot, input);
    expect(writeRetrievalReceipt(mindRoot, input)).toEqual(first);
    expect(() => writeRetrievalReceipt(mindRoot, {
      ...input,
      query: 'different query under the same immutable id',
    })).toThrow(/collision|already exists/i);
  });

  it('refuses receipt writes through a symlinked metadata directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mindos-retrieval-outside-'));
    symlinkSync(outside, join(mindRoot, '.mindos'), 'dir');

    expect(() => writeRetrievalReceipt(mindRoot, {
      id: 'receipt-unsafe',
      query: 'unsafe',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'empty',
      startedAt: '2026-09-02T05:00:00.000Z',
      completedAt: '2026-09-02T05:00:00.000Z',
      budget: { maxTokens: 1, maxFiles: 1, minScore: 1, timeoutMs: 1 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [],
      selections: [],
      totals: { candidateCount: 0, selectedCount: 0, usedTokens: 0 },
    })).toThrow(/Access denied|symlink|escape/i);

    expect(listRetrievalReceipts(mindRoot)).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });
});
