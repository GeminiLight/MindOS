import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerContextAsset } from '../../knowledge/context-assets/registry.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import { handleContextFeedbackGet, handleContextFeedbackPost } from './context-feedback.js';

describe('context feedback server handler', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-context-feedback-handler-'));
    registerContextAsset(mindRoot, {
      id: 'asset-1', kind: 'knowledge', status: 'active', title: 'One', path: 'one.md',
      contentHash: 'a'.repeat(64), source: { kind: 'file', ref: 'file:one.md' },
    });
    writeRetrievalReceipt(mindRoot, {
      id: 'receipt-1', query: 'one', strategy: 'test', outcome: 'selected',
      startedAt: '2026-09-03T02:00:00.000Z', completedAt: '2026-09-03T02:00:00.001Z',
      budget: { maxTokens: 10, maxFiles: 1, minScore: 0, timeoutMs: 100 },
      scope: { preferredPaths: [], excludePaths: [] }, candidates: [],
      selections: [{ assetId: 'asset-1', path: 'one.md', score: 1, estimatedTokens: 1, truncated: false, reason: 'test' }],
      totals: { candidateCount: 1, selectedCount: 1, usedTokens: 1 }, metadata: { runId: 'run-1' },
    });
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('submits, lists, filters, and retracts feedback with learning profiles', async () => {
    const created = await handleContextFeedbackPost({
      action: 'submit', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'helpful',
    }, { mindRoot });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ok: true, feedback: { signal: 'helpful' } });
    const feedbackId = (created.body as { feedback: { id: string } }).feedback.id;

    const listed = await handleContextFeedbackGet(new URLSearchParams('receiptId=receipt-1&assetId=asset-1'), { mindRoot });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      schemaVersion: 1,
      feedback: [{ id: feedbackId }],
      profiles: [{ assetId: 'asset-1', adjustment: 0 }],
      summary: { total: 1, active: 1, missing: 0, pendingStaleReviews: 0 },
    });

    const retracted = await handleContextFeedbackPost({ action: 'retract', feedbackId }, { mindRoot });
    expect(retracted.body).toMatchObject({ ok: true, feedback: { status: 'retracted' } });
  });

  it('requires explicit stale review and reports useful client errors', async () => {
    await handleContextFeedbackPost({ action: 'submit', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'stale' }, { mindRoot });
    const reviewed = await handleContextFeedbackPost({
      action: 'review-stale', assetId: 'asset-1', decision: 'keep', idempotencyKey: 'keep-asset-1-v1',
    }, { mindRoot });
    expect(reviewed.body).toMatchObject({ ok: true, review: { decision: 'keep', status: 'applied' } });

    expect((await handleContextFeedbackPost(null, { mindRoot })).status).toBe(400);
    expect((await handleContextFeedbackPost({ action: 'submit', receiptId: 'receipt-1', signal: 'bogus' }, { mindRoot })).status).toBe(400);
    expect((await handleContextFeedbackPost({ action: 'retract', feedbackId: 'not-found' }, { mindRoot })).status).toBe(404);
    expect((await handleContextFeedbackPost({ action: 'unknown' }, { mindRoot })).status).toBe(400);
  });
});
