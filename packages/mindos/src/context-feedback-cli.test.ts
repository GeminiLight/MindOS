import { describe, expect, it } from 'vitest';
import { parseContextCommand } from '../bin/commands/context.js';

describe('context feedback CLI', () => {
  it('parses the four feedback signals against the shared receipt/asset contract', () => {
    expect(parseContextCommand(['feedback', 'receipt-1', 'helpful'], { asset: 'asset-1', note: 'Useful' })).toEqual({
      action: 'submit', receiptId: 'receipt-1', signal: 'helpful', assetId: 'asset-1', note: 'Useful',
    });
    expect(parseContextCommand(['feedback', 'receipt-1', 'missing'], { 'expected-path': 'Plans/current.md' })).toEqual({
      action: 'submit', receiptId: 'receipt-1', signal: 'missing', expectedPath: 'Plans/current.md',
    });
    expect(parseContextCommand(['feedback', 'receipt-1', 'irrelevant'], { asset: 'asset-1' }).signal).toBe('irrelevant');
    expect(parseContextCommand(['feedback', 'receipt-1', 'stale'], { asset: 'asset-1' }).signal).toBe('stale');
  });

  it('parses undo and explicit stale review while rejecting ambiguous targets', () => {
    expect(parseContextCommand(['feedback', 'undo', 'feedback-1'], {})).toEqual({ action: 'retract', feedbackId: 'feedback-1' });
    expect(parseContextCommand(['review-stale', 'asset-1', 'deprecate'], { key: 'review-1' })).toEqual({
      action: 'review-stale', assetId: 'asset-1', decision: 'deprecate', idempotencyKey: 'review-1',
    });
    expect(() => parseContextCommand(['feedback', 'receipt-1', 'helpful'], {})).toThrow(/asset/i);
    expect(() => parseContextCommand(['feedback', 'receipt-1', 'missing'], { asset: 'asset-1' })).toThrow(/must not|asset/i);
    expect(() => parseContextCommand(['review-stale', 'asset-1', 'deprecate'], {})).toThrow(/key/i);
  });
});
