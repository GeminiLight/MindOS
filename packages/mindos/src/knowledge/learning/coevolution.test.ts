import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startLearningLoop, updateLearningLoop, getLearningLoop, learningMarkdown, startLearningCorrection } from './index.js';
import { learningAgentEvidence } from './coevolution.js';
import { listContextAssets } from '../context-assets/registry.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coevolution-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function reviewed() {
  let loop = startLearningLoop(root, { cardId: 'co-source', title: 'Evidence boundaries', content: 'Check causal claims.', sessions: [{ id: 'source-session', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'This study only shows correlation.' }] }] });
  for (const command of [
    { action: 'reflect', before: 'Trust fluent prose', understanding: 'Check study design' },
    { action: 'plan', situation: 'A new paper', experiment: 'Inspect methods', check: 'Identify the evidence boundary', reviewOn: '2026-09-09' },
    { action: 'review', outcome: 'mixed', observation: 'Caught one unsupported claim', revisedRule: 'Check design before causal wording' },
  ]) loop = updateLearningLoop(root, loop.id, { ...command, version: loop.version });
  return loop;
}
const proposal = { action: 'propose-agent', attemptIndex: 0, behavior: 'Check design before causal wording', scope: 'Research claims; not fictional writing', check: 'Each causal statement cites supporting design' };
function receipt(assetId: string, id = 'later-use', startedAt = '2099-01-01T00:00:00.000Z') {
  return writeRetrievalReceipt(root, { id, query: 'Write research', strategy: 'hybrid', outcome: 'selected', startedAt, completedAt: startedAt,
    budget: { maxTokens: 1000, maxFiles: 2, minScore: 0, timeoutMs: 1000 }, scope: { preferredPaths: [], excludePaths: [] }, candidates: [],
    selections: [{ assetId, path: 'Echo/Playbooks/rule.md', score: 1, estimatedTokens: 30, truncated: false, reason: 'Relevant' }],
    totals: { candidateCount: 1, selectedCount: 1, usedTokens: 30 }, metadata: { runId: 'later-run', chatSessionId: 'later-session' } });
}
it('keeps a scoped proposal private until approval and links subsequent evidence without inferring success', () => {
  let loop = reviewed();
  loop = updateLearningLoop(root, loop.id, { ...proposal, version: loop.version });
  expect(listContextAssets(root)).toHaveLength(0);
  loop = updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: 0, version: loop.version });
  const change = loop.attempts[0].agentChange!;
  expect(change.review?.decision).toBe('approved');
  expect(fs.readFileSync(path.join(root, change.review!.targetPath!), 'utf8')).toContain(proposal.scope);
  expect(learningAgentEvidence(root, loop)[0].receipts).toEqual([]);
  receipt(change.review!.assetId!);
  expect(learningAgentEvidence(root, loop)[0].receipts[0].id).toBe('later-use');
  expect(change.observations).toEqual([]);
  loop = updateLearningLoop(root, loop.id, { action: 'observe-agent', attemptIndex: 0, version: loop.version, receiptId: 'later-use', outcome: 'not-followed', observation: 'It retrieved the rule but still overstated causality.' });
  expect(loop.attempts[0].agentChange!.observations[0].outcome).toBe('not-followed');
  expect(learningMarkdown(loop)).toContain('It retrieved the rule');
});
it('rejects stale, unreviewed, archived, oversized and duplicate proposals', () => {
  const loop = reviewed();
  for (const command of [{ ...proposal, attemptIndex: -1 }, { ...proposal, scope: '' }, { ...proposal, behavior: 'x'.repeat(1601) }, { ...proposal, version: 1 }]) {
    expect(() => updateLearningLoop(root, loop.id, { version: loop.version, ...command })).toThrow();
  }
  const saved = updateLearningLoop(root, loop.id, { ...proposal, version: loop.version });
  expect(() => updateLearningLoop(root, loop.id, { ...proposal, version: saved.version })).toThrow();
  const archived = updateLearningLoop(root, loop.id, { action: 'archive', version: saved.version });
  expect(() => updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: 0, version: archived.version })).toThrow();
});
it('keeps rejection durable without publishing and refuses forged, prior or unrelated receipts', () => {
  let loop = reviewed();
  loop = updateLearningLoop(root, loop.id, { ...proposal, version: loop.version });
  loop = updateLearningLoop(root, loop.id, { action: 'reject-agent', attemptIndex: 0, version: loop.version });
  expect(listContextAssets(root)).toHaveLength(0);
  expect(() => updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: 0, version: loop.version })).toThrow();
  loop = updateLearningLoop(root, loop.id, { action: 'retry', version: loop.version });
  expect(loop.attempts[0].agentChange!.review?.decision).toBe('rejected');
  expect(() => updateLearningLoop(root, loop.id, { action: 'observe-agent', attemptIndex: 0, version: loop.version, receiptId: 'forged', outcome: 'followed', observation: 'Worked' })).toThrow();
});
it('reconciles a completed approval after learning record persistence fails', () => {
  let loop = reviewed(); loop = updateLearningLoop(root, loop.id, { ...proposal, version: loop.version });
  const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).includes('/learning/')) throw new Error('disk unavailable');
    return rename(from, to);
  });
  expect(() => updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: 0, version: loop.version })).toThrow();
  vi.restoreAllMocks();
  const recovered = getLearningLoop(root, loop.id)!;
  expect(recovered.attempts[0].agentChange!.review?.decision).toBe('approved');
  expect(recovered.version).toBe(loop.version + 1);
  expect(getLearningLoop(root, loop.id)!.version).toBe(recovered.version);
  expect(updateLearningLoop(root, loop.id, { action: 'archive', version: recovered.version }).archived).toBe(true);
  expect(listContextAssets(root)).toHaveLength(1);
});
it('only accepts later selections of this approved asset and records each use once', () => {
  let loop = reviewed(); loop = updateLearningLoop(root, loop.id, { ...proposal, version: loop.version });
  loop = updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: 0, version: loop.version });
  const assetId = loop.attempts[0].agentChange!.review!.assetId!;
  receipt('asset-unrelated', 'wrong-asset'); receipt(assetId, 'old-use', '2000-01-01T00:00:00.000Z');
  for (const receiptId of ['missing', 'wrong-asset', 'old-use']) expect(() => updateLearningLoop(root, loop.id, {
    action: 'observe-agent', version: loop.version, attemptIndex: 0, receiptId, outcome: 'followed', observation: 'A claim',
  })).toThrow();
  expect(learningAgentEvidence(root, loop)[0].receipts).toEqual([]);
  receipt(assetId);
  loop = updateLearningLoop(root, loop.id, { action: 'observe-agent', version: loop.version, attemptIndex: 0, receiptId: 'later-use', outcome: 'uncertain', observation: 'The output has not been inspected.' });
  expect(() => updateLearningLoop(root, loop.id, { action: 'observe-agent', version: loop.version, attemptIndex: 0, receiptId: 'later-use', outcome: 'followed', observation: 'Duplicate' })).toThrow();
  expect(loop.attempts[0].review?.outcome).toBe('mixed');
});
it('does not publish from an unreviewed practice and keeps old records compatible', () => {
  let loop = startLearningLoop(root, { cardId: 'empty', title: 'Test', content: 'A question', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Check this' }] }] });
  expect(() => updateLearningLoop(root, loop.id, { ...proposal, version: loop.version })).toThrow();
  expect(getLearningLoop(root, loop.id)).toEqual(loop);
  expect(learningAgentEvidence(root, loop)).toEqual([]);
});

it('starts a private method directly from a correction without fabricating human practice', () => {
  const source = { cardId: 'correction-1', title: 'Check the original design', content: 'Check the original design before wording a causal claim.', sessions: [{ id: 'session-1', messageRefs: [{ messageIndex: 1, role: 'assistant', quote: 'This proves causation.' }] }] };
  let loop = startLearningCorrection(root, source, { behavior: source.content, scope: 'Research writing only', check: 'Causal claims cite their design' });
  expect(loop.attempts).toEqual([]); expect(loop.reflection).toBeUndefined();
  expect(loop.directMethod?.review).toBeUndefined(); expect(listContextAssets(root)).toEqual([]);
  expect(startLearningCorrection(root, source, { behavior: source.content, scope: 'Research writing only', check: 'Causal claims cite their design' })).toEqual(loop);
  loop = updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: -1, version: loop.version });
  expect(loop.directMethod?.review?.decision).toBe('approved');
  expect(loop.attempts).toEqual([]); expect(loop.stage).toBe('reflecting');
  expect(learningMarkdown(loop)).toContain('Research writing only');
});
