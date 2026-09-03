import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentRunCapsule, finalizeAgentRunCapsule } from '../../agent/capsules/store.js';
import { registerContextAsset } from '../context-assets/registry.js';
import { reviewEchoPromotionCandidate } from '../context-assets/echo-promotion.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import {
  buildEchoPromotionCandidateFromCapsule,
  getContextFeedbackProfile,
  listContextFeedback,
  listContextStaleReviews,
  readContextFeedbackLedger,
  retractContextFeedback,
  reviewStaleContextAsset,
  submitContextFeedback,
} from './store.js';

describe('context feedback learning ledger', () => {
  let mindRoot: string;
  const start = new Date('2026-09-03T01:00:00.000Z');

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-context-feedback-'));
    registerContextAsset(mindRoot, {
      id: 'asset-guide',
      kind: 'knowledge',
      status: 'active',
      title: 'Guide',
      path: 'Notes/guide.md',
      contentHash: 'a'.repeat(64),
      source: { kind: 'file', ref: 'file:Notes/guide.md' },
    }, start);
    writeReceipt('receipt-1', 'run-1');
    writeReceipt('receipt-2', 'run-2');
    writeReceipt('receipt-3', 'run-3');
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('needs three current-version signals before applying a bounded, explainable ranking hint', () => {
    submitContextFeedback(mindRoot, { receiptId: 'receipt-1', assetId: 'asset-guide', signal: 'helpful' }, start);
    submitContextFeedback(mindRoot, { receiptId: 'receipt-2', assetId: 'asset-guide', signal: 'helpful' }, new Date(start.getTime() + 1));

    expect(getContextFeedbackProfile(mindRoot, 'asset-guide')).toMatchObject({
      activeCount: 2,
      eligible: false,
      adjustment: 0,
      counts: { helpful: 2, irrelevant: 0, stale: 0 },
    });

    submitContextFeedback(mindRoot, { receiptId: 'receipt-3', assetId: 'asset-guide', signal: 'helpful' }, new Date(start.getTime() + 2));
    const profile = getContextFeedbackProfile(mindRoot, 'asset-guide');
    expect(profile).toMatchObject({ activeCount: 3, eligible: true, adjustment: 0.05625, confidence: 0.375 });
    expect(profile.explanation).toContain('3 current-version signals');
    expect(profile.adjustment).toBeLessThanOrEqual(0.15);
    expect(statSync(join(mindRoot, '.mindos/context-feedback/ledger.json')).mode & 0o777).toBe(0o600);
  });

  it('validates receipt ownership, updates one decision idempotently, redacts notes, and supports undo', () => {
    const first = submitContextFeedback(mindRoot, {
      receiptId: 'receipt-1', assetId: 'asset-guide', signal: 'irrelevant', note: 'Bearer super-secret-token',
    }, start);
    const repeated = submitContextFeedback(mindRoot, {
      receiptId: 'receipt-1', assetId: 'asset-guide', signal: 'irrelevant', note: 'Bearer super-secret-token',
    }, new Date(start.getTime() + 1));
    const changed = submitContextFeedback(mindRoot, {
      receiptId: 'receipt-1', assetId: 'asset-guide', signal: 'helpful', note: 'This became useful.',
    }, new Date(start.getTime() + 2));

    expect(repeated).toEqual(first);
    expect(first.note).not.toContain('super-secret-token');
    expect(changed).toMatchObject({ id: first.id, revision: 2, signal: 'helpful', status: 'active' });
    expect(changed.history).toHaveLength(1);
    expect(retractContextFeedback(mindRoot, changed.id, new Date(start.getTime() + 3))).toMatchObject({ status: 'retracted', revision: 3 });
    expect(getContextFeedbackProfile(mindRoot, 'asset-guide').activeCount).toBe(0);
    expect(() => submitContextFeedback(mindRoot, {
      receiptId: 'receipt-1', assetId: 'asset-missing', signal: 'helpful',
    })).toThrow(/asset|reference/i);
    expect(() => submitContextFeedback(mindRoot, { receiptId: 'not-found', signal: 'missing' })).toThrow(/receipt/i);

    registerContextAsset(mindRoot, {
      id: 'asset-not-selected', kind: 'knowledge', status: 'active', title: 'Unused', path: 'Notes/unused.md',
      contentHash: 'b'.repeat(64), source: { kind: 'file', ref: 'file:Notes/unused.md' },
    }, start);
    writeRetrievalReceipt(mindRoot, {
      id: 'receipt-candidate-only', query: 'guide', strategy: 'test', outcome: 'selected',
      startedAt: start.toISOString(), completedAt: start.toISOString(),
      budget: { maxTokens: 100, maxFiles: 1, minScore: 0, timeoutMs: 100 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [{ assetId: 'asset-not-selected', path: 'Notes/unused.md', score: 0.5, selected: false, reason: 'not selected' }],
      selections: [], totals: { candidateCount: 1, selectedCount: 0, usedTokens: 0 }, metadata: { runId: 'run-unused' },
    });
    expect(() => submitContextFeedback(mindRoot, {
      receiptId: 'receipt-candidate-only', assetId: 'asset-not-selected', signal: 'helpful',
    })).toThrow(/select/i);
  });

  it('records missing context without inventing an asset and aggregates by linked run', () => {
    const feedback = submitContextFeedback(mindRoot, {
      receiptId: 'receipt-1', signal: 'missing', expectedPath: 'Projects/Launch plan.md', note: 'Needed the current rollout plan.',
    }, start);

    expect(feedback).toMatchObject({ signal: 'missing', runId: 'run-1', expectedPath: 'Projects/Launch plan.md' });
    expect(feedback).not.toHaveProperty('assetId');
    expect(listContextFeedback(mindRoot, { runId: 'run-1' })).toEqual([feedback]);
  });

  it('never deprecates stale context until a separate explicit, idempotent review', () => {
    submitContextFeedback(mindRoot, { receiptId: 'receipt-1', assetId: 'asset-guide', signal: 'stale' }, start);
    expect(getContextFeedbackProfile(mindRoot, 'asset-guide')).toMatchObject({ staleReviewRecommended: true });
    expect(readContextFeedbackLedger(mindRoot).feedback).toHaveLength(1);

    const reviewed = reviewStaleContextAsset(mindRoot, {
      assetId: 'asset-guide', decision: 'deprecate', idempotencyKey: 'review-stale-guide-v1', note: 'Superseded by v2.',
    }, new Date(start.getTime() + 10));
    const repeated = reviewStaleContextAsset(mindRoot, {
      assetId: 'asset-guide', decision: 'deprecate', idempotencyKey: 'review-stale-guide-v1', note: 'Superseded by v2.',
    }, new Date(start.getTime() + 20));

    expect(reviewed).toMatchObject({ decision: 'deprecate', status: 'applied', assetVersion: 1 });
    expect(repeated).toEqual(reviewed);
    expect(listContextStaleReviews(mindRoot, { assetId: 'asset-guide' })).toEqual([reviewed]);
    expect(readContextFeedbackLedger(mindRoot)).toMatchObject({ schemaVersion: 1 });
  });

  it('degrades to a neutral hint on a corrupt ledger and refuses mutation or symlink escape', () => {
    const ledger = join(mindRoot, '.mindos/context-feedback/ledger.json');
    mkdirSync(join(mindRoot, '.mindos/context-feedback'), { recursive: true });
    writeFileSync(ledger, '{broken', 'utf-8');
    chmodSync(ledger, 0o600);
    expect(getContextFeedbackProfile(mindRoot, 'asset-guide')).toMatchObject({ adjustment: 0, activeCount: 0 });
    expect(() => submitContextFeedback(mindRoot, { receiptId: 'receipt-1', signal: 'missing' })).toThrow(/corrupt|preserved/i);

    rmSync(join(mindRoot, '.mindos'), { recursive: true, force: true });
    const outside = mkdtempSync(join(tmpdir(), 'mindos-context-feedback-outside-'));
    symlinkSync(outside, join(mindRoot, '.mindos'), 'dir');
    expect(() => submitContextFeedback(mindRoot, { receiptId: 'receipt-1', signal: 'missing' })).toThrow(/Access denied|symlink|escape/i);
    rmSync(outside, { recursive: true, force: true });
  });

  it('bridges only message evidence verifiable in a run capsule into the existing Echo review gate', () => {
    createAgentRunCapsule(mindRoot, {
      id: 'capsule-run-1', runId: 'run-1', rootRunId: 'run-1', chatSessionId: 'session-1', source: 'interactive',
      request: {
        messages: [{ role: 'user', content: 'How should memory changes work?' }],
        runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
        context: { attachedFiles: [], uploadedFiles: [], receiptIds: ['receipt-1'], assetIds: ['asset-guide'] },
      },
      now: start,
    });
    finalizeAgentRunCapsule(mindRoot, 'capsule-run-1', {
      status: 'completed', outputText: 'Require review before durable memory promotion.', now: start,
    } as never);
    const candidate = buildEchoPromotionCandidateFromCapsule(mindRoot, {
      capsuleId: 'capsule-run-1', candidateId: 'promotion-run-1', kind: 'playbook', title: 'Review memory changes',
      content: 'Generated memory changes only become durable after explicit review.',
      evidence: [{ source: 'output', quote: 'Require review before durable memory promotion.' }],
    } as never);
    expect(candidate.source.sessions[0]).toMatchObject({ id: 'session-1', runtime: 'Codex' });
    expect(reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate }, start)).toMatchObject({ decision: 'approved' });
    expect(() => buildEchoPromotionCandidateFromCapsule(mindRoot, {
      capsuleId: 'capsule-run-1', candidateId: 'promotion-forged', kind: 'practice', title: 'Forged', content: 'No.',
      evidence: [{ source: 'output', quote: 'This quote never appeared.' }],
    } as never)).toThrow(/evidence|capsule/i);
  });

  function writeReceipt(id: string, runId: string) {
    writeRetrievalReceipt(mindRoot, {
      id, query: 'guide', strategy: 'test', outcome: 'selected',
      startedAt: start.toISOString(), completedAt: start.toISOString(),
      budget: { maxTokens: 100, maxFiles: 1, minScore: 0, timeoutMs: 100 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [{ assetId: 'asset-guide', path: 'Notes/guide.md', score: 1, selected: true, reason: 'test' }],
      selections: [{ assetId: 'asset-guide', path: 'Notes/guide.md', score: 1, estimatedTokens: 1, truncated: false, reason: 'test' }],
      totals: { candidateCount: 1, selectedCount: 1, usedTokens: 1 }, metadata: { runId },
    });
  }
});
