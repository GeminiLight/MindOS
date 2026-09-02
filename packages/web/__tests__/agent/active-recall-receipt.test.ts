import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listContextAssets } from '@geminilight/mindos/knowledge';
import { listRetrievalReceipts } from '@geminilight/mindos/retrieval';

vi.mock('@/lib/core/hybrid-search', () => ({
  hybridSearch: vi.fn(),
}));

vi.mock('@/lib/fs', () => ({
  getFileContent: vi.fn(),
}));

vi.mock('@/lib/agent/context', () => ({
  estimateStringTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

import { hybridSearch } from '@/lib/core/hybrid-search';
import { getFileContent } from '@/lib/fs';
import { performActiveRecallWithReceipt } from '@/lib/agent/active-recall';

const mockSearch = vi.mocked(hybridSearch);
const mockGetFile = vi.mocked(getFileContent);

describe('active recall receipt integration', () => {
  let mindRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-active-recall-receipt-'));
    mockGetFile.mockImplementation((filePath: string) => readFileSync(join(mindRoot, filePath), 'utf-8'));
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('registers selected files and writes a provenance receipt without storing chunk bodies', async () => {
    mkdirSync(join(mindRoot, 'Projects', 'MindOS'), { recursive: true });
    writeFileSync(
      join(mindRoot, 'Projects', 'MindOS', 'architecture.md'),
      '# Architecture\n\n## Decision\nUse a review gate before durable memory promotion.\n',
      'utf-8',
    );
    mockSearch.mockResolvedValue([
      {
        path: 'Projects/MindOS/architecture.md',
        snippet: 'review gate before durable memory promotion',
        score: 6.2,
        occurrences: 1,
      },
    ]);

    const result = await performActiveRecallWithReceipt(
      mindRoot,
      'How should durable memory promotion work?',
      { maxTokens: 500, maxFiles: 2, preferredPaths: ['Projects/MindOS'] },
      { chatSessionId: 'chat-receipt-1' },
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        path: 'Projects/MindOS/architecture.md',
        headingPath: ['Architecture'],
      }),
    ]);
    expect(result.receipt).toMatchObject({
      outcome: 'selected',
      metadata: { chatSessionId: 'chat-receipt-1' },
      totals: { candidateCount: 1, selectedCount: 1 },
      selections: [expect.objectContaining({
        path: 'Projects/MindOS/architecture.md',
        assetId: expect.stringMatching(/^asset-/),
      })],
    });
    expect(result.metadata).toMatchObject({
      retrievalReceiptId: result.receipt.id,
      retrievalSelectedAssetIds: [result.receipt.selections[0]!.assetId],
      retrievalOutcome: 'selected',
    });
    expect(listContextAssets(mindRoot)).toEqual([
      expect.objectContaining({ kind: 'knowledge', path: 'Projects/MindOS/architecture.md', status: 'active' }),
    ]);
    const stored = listRetrievalReceipts(mindRoot)[0]!;
    expect(stored.id).toBe(result.receipt.id);
    expect(JSON.stringify(stored)).not.toContain('Use a review gate before durable memory promotion.');
  });

  it('records timeout and short-query skip outcomes without breaking recall', async () => {
    mockSearch.mockRejectedValue(new Error('timeout'));
    const timeout = await performActiveRecallWithReceipt(mindRoot, 'find timeout case', { timeoutMs: 5 });
    const skipped = await performActiveRecallWithReceipt(mindRoot, 'a');

    expect(timeout.items).toEqual([]);
    expect(timeout.receipt.outcome).toBe('timeout');
    expect(skipped.items).toEqual([]);
    expect(skipped.receipt.outcome).toBe('skipped');
    expect(listRetrievalReceipts(mindRoot, { limit: 10 })).toHaveLength(2);
  });

  it('keeps recalled items available when receipt persistence is unavailable', async () => {
    mkdirSync(join(mindRoot, 'notes'), { recursive: true });
    writeFileSync(join(mindRoot, 'notes', 'safe.md'), '# Safe\n\nretrieval still works', 'utf-8');
    mockSearch.mockResolvedValue([
      { path: 'notes/safe.md', snippet: 'retrieval still works', score: 5, occurrences: 1 },
    ]);
    mkdirSync(join(mindRoot, '.mindos', 'retrieval-receipts'), { recursive: true });
    writeFileSync(join(mindRoot, '.mindos', 'retrieval-receipts', 'blocking-file'), 'block', 'utf-8');

    const result = await performActiveRecallWithReceipt(mindRoot, 'retrieval still works', undefined, {
      receiptId: '../invalid',
    });

    expect(result.items).toHaveLength(1);
    expect(result.receipt).toBeNull();
    expect(result.metadata).toMatchObject({ retrievalOutcome: 'selected' });
  });
});
