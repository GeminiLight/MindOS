import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import { handleRetrievalReceiptsGet } from './retrieval-receipts.js';

describe('retrieval receipt server handler', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-retrieval-handler-'));
    writeRetrievalReceipt(mindRoot, {
      id: 'receipt-handler-1',
      query: 'architecture',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'selected',
      startedAt: '2026-09-02T06:00:00.000Z',
      completedAt: '2026-09-02T06:00:00.010Z',
      budget: { maxTokens: 500, maxFiles: 2, minScore: 1, timeoutMs: 2000 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [{ assetId: 'asset-one', path: 'one.md', score: 5, selected: true, reason: 'selected' }],
      selections: [{ assetId: 'asset-one', path: 'one.md', score: 5, estimatedTokens: 20, truncated: false, reason: 'selected' }],
      totals: { candidateCount: 1, selectedCount: 1, usedTokens: 20 },
      metadata: { chatSessionId: 'chat-handler' },
    });
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('lists and resolves immutable receipts by receipt or asset id', async () => {
    const list = await handleRetrievalReceiptsGet(
      new URLSearchParams('assetId=asset-one&chatSessionId=chat-handler'),
      { mindRoot },
    );
    expect(list).toMatchObject({
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        receipts: [expect.objectContaining({ id: 'receipt-handler-1', outcome: 'selected' })],
        summary: { total: 1, selected: 1 },
      },
    });

    const one = await handleRetrievalReceiptsGet(
      new URLSearchParams('id=receipt-handler-1'),
      { mindRoot },
    );
    expect(one).toMatchObject({ status: 200, body: { receipt: { id: 'receipt-handler-1' } } });
  });

  it('returns 404 for a missing exact receipt without exposing filesystem paths', async () => {
    const response = await handleRetrievalReceiptsGet(new URLSearchParams('id=missing'), { mindRoot });
    expect(response).toMatchObject({ status: 404, body: { error: 'Retrieval receipt not found' } });
  });
});
