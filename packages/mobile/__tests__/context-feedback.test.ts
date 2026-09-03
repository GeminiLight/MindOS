import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMobileContextFeedbackTargets,
  normalizeMobileContextFeedback,
  normalizeMobileRetrievalReceipts,
} from '@/lib/context-feedback';

describe('mobile context feedback projection', () => {
  it('builds asset-specific helpful, irrelevant, and stale targets plus receipt-level missing', () => {
    const [receipt] = normalizeMobileRetrievalReceipts({ receipts: [{
      id: 'receipt-1', queryPreview: 'launch plan', outcome: 'selected', startedAt: '2026-09-03T03:00:00.000Z',
      selections: [{ assetId: 'asset-1', path: 'Plans/launch.md', score: 1, reason: 'selected' }],
    }] });
    expect(buildMobileContextFeedbackTargets(receipt!)).toEqual([
      { receiptId: 'receipt-1', assetId: 'asset-1', assetPath: 'Plans/launch.md', signal: 'helpful' },
      { receiptId: 'receipt-1', assetId: 'asset-1', assetPath: 'Plans/launch.md', signal: 'irrelevant' },
      { receiptId: 'receipt-1', assetId: 'asset-1', assetPath: 'Plans/launch.md', signal: 'stale' },
      { receiptId: 'receipt-1', signal: 'missing' },
    ]);
  });

  it('drops malformed receipts and bounds duplicate selections', () => {
    expect(normalizeMobileRetrievalReceipts({ receipts: [null, { id: '', selections: [] }] })).toEqual([]);
    const [receipt] = normalizeMobileRetrievalReceipts({ receipts: [{
      id: 'receipt-2', selections: [
        { assetId: 'asset-1', path: 'one.md' },
        { assetId: 'asset-1', path: 'duplicate.md' },
        { assetId: 'asset-2', path: 'two.md' },
      ],
    }] });
    expect(receipt?.selections.map((item) => item.assetId)).toEqual(['asset-1', 'asset-2']);
  });

  it('restores valid persisted feedback and rejects malformed asset feedback', () => {
    expect(normalizeMobileContextFeedback({ feedback: [
      { id: 'feedback-1', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'helpful', status: 'active' },
      { id: 'feedback-2', receiptId: 'receipt-1', signal: 'missing', status: 'retracted' },
      { id: 'feedback-3', receiptId: 'receipt-1', signal: 'stale' },
    ] })).toEqual([
      { id: 'feedback-1', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'helpful', status: 'active' },
      { id: 'feedback-2', receiptId: 'receipt-1', signal: 'missing', status: 'retracted' },
    ]);
  });

  it('mounts all four explicit decisions on the connected Agent Runs surface', () => {
    const mobileRoot = resolve(__dirname, '..');
    const screen = readFileSync(resolve(mobileRoot, 'app/agent-runs.tsx'), 'utf-8');
    const card = readFileSync(resolve(mobileRoot, 'components/agent/ContextLearningCard.tsx'), 'utf-8');
    expect(screen).toContain("import ContextLearningCard from '@/components/agent/ContextLearningCard'");
    expect(screen).toContain('<ContextLearningCard enabled={connected} />');
    for (const label of ['Helpful', 'Irrelevant', 'Stale', 'Missing']) expect(card).toContain(label);
    expect(card).toContain('retractContextFeedback');
    expect(card).toContain('Stale feedback needs a separate review');
  });
});
