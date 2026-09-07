import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getLearningLoop, startLearningCorrection, updateLearningLoop, prepareLearningMethodTrial, learningMarkdown } from './index.js';
import { learningAgentEvidence } from './coevolution.js';
import { listContextAssets } from '../context-assets/registry.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, renameSync: (...args: Parameters<typeof fs.renameSync>) => actual.default.renameSync(...args) };
});
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'method-lifecycle-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const source = { cardId: 'correction', title: 'Causal wording', content: 'Inspect the study design.', sessions: [{ id: 'source', messageRefs: [{ messageIndex: 0, role: 'assistant', quote: 'Coffee causes longevity.' }] }] };
const method = { behavior: 'Inspect design first', scope: 'Research claims', check: 'Name the design' };
function approved() {
  const loop = startLearningCorrection(root, source, method);
  return updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: -1, version: loop.version });
}
function update(loop: ReturnType<typeof approved>, command: Record<string, unknown>) {
  return updateLearningLoop(root, loop.id, { attemptIndex: -1, version: loop.version, ...command });
}
it('records a counterexample without silently pausing and exports it as a user report', () => {
  let loop = approved();
  loop = update(loop, { action: 'counterexample-agent', observation: 'A randomized design still had severe attrition.' });
  expect(loop.directMethod?.counterexamples?.[0].observation).toContain('attrition');
  expect(listContextAssets(root)[0].status).toBe('active');
  expect(learningMarkdown(loop)).toContain('attrition');
  expect(loop.directMethod?.observations).toEqual([]);
});
it('pauses and resumes the exact approved content with durable reasons and rejects repeated or stale changes', () => {
  let loop = approved(); const stale = loop;
  loop = update(loop, { action: 'pause-agent', reason: 'Needs a narrower scope' });
  expect(listContextAssets(root)[0].status).toBe('deprecated');
  expect(loop.directMethod?.availability).toBe('deprecated');
  expect(loop.directMethod?.transitions?.[0].reason).toBe('Needs a narrower scope');
  expect(() => prepareLearningMethodTrial(root, loop.id, -1, loop.version)).toThrow();
  expect(() => update(loop, { action: 'pause-agent', reason: 'Duplicate' })).toThrow();
  expect(() => update(stale, { action: 'resume-agent', reason: 'Stale' })).toThrow();
  loop = update(loop, { action: 'resume-agent', reason: 'Checked the scope again' });
  expect(prepareLearningMethodTrial(root, loop.id, -1, loop.version).assetId).toBe(loop.directMethod?.review?.assetId);
  expect(loop.directMethod?.transitions).toHaveLength(2);
});
it('preserves old method and evidence while a separately reviewed revision gets a new asset', () => {
  let loop = approved(); const initial = structuredClone(loop.directMethod!);
  writeRetrievalReceipt(root, { id: 'old-run', query: 'Write a claim', strategy: 'test', outcome: 'selected', startedAt: '2099-01-01T00:00:00.000Z', completedAt: '2099-01-01T00:00:00.000Z',
    budget: { maxTokens: 100, maxFiles: 1, minScore: 0, timeoutMs: 1000 }, scope: { preferredPaths: [], excludePaths: [] }, candidates: [],
    selections: [{ assetId: initial.review!.assetId!, path: initial.review!.targetPath!, score: 1, estimatedTokens: 10, truncated: false, reason: 'Selected' }],
    totals: { candidateCount: 1, selectedCount: 1, usedTokens: 10 }, metadata: { runId: 'run-1' } });
  loop = update(loop, { action: 'revise-agent', reason: 'Design labels alone are insufficient', ...method, behavior: 'Inspect design and attrition' });
  expect(listContextAssets(root)).toHaveLength(1);
  expect(loop.directMethod?.behavior).toBe(initial.behavior);
  expect(loop.directMethod?.revisions?.[0].review).toBeUndefined();
  expect(() => update(loop, { action: 'approve-agent', revisionIndex: 1 })).toThrow();
  loop = update(loop, { action: 'pause-agent', reason: 'Replace with a narrower method' });
  loop = update(loop, { action: 'approve-agent', revisionIndex: 1 });
  const revision = loop.directMethod!.revisions![0];
  expect(revision.review!.assetId).not.toBe(initial.review!.assetId);
  expect(revision.review!.targetPath).not.toBe(initial.review!.targetPath);
  expect(fs.readFileSync(path.join(root, initial.review!.targetPath!), 'utf8')).toContain(initial.behavior);
  expect(() => update(loop, { action: 'resume-agent', reason: 'Revive obsolete version' })).toThrow();
  expect(prepareLearningMethodTrial(root, loop.id, -1, loop.version, 1).assetId).toBe(revision.review!.assetId);
  const evidence = learningAgentEvidence(root, loop);
  expect(evidence.find((item) => item.revisionIndex === 0)?.receipts[0].id).toBe('old-run');
  expect(evidence.find((item) => item.revisionIndex === 1)?.receipts).toEqual([]);
  expect(learningMarkdown(loop)).toContain('Design labels alone are insufficient');
});
it('recovers a status change and its reason after the learning journal rename fails', () => {
  const loop = approved(); const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).includes('/learning/')) throw new Error('disk unavailable');
    return rename(from, to);
  });
  expect(() => update(loop, { action: 'pause-agent', reason: 'Counterexample needs review' })).toThrow();
  vi.restoreAllMocks();
  const recovered = getLearningLoop(root, loop.id)!;
  expect(recovered.directMethod?.availability).toBe('deprecated');
  expect(recovered.directMethod?.transitions?.[0].reason).toBe('Counterexample needs review');
  expect(recovered.version).toBe(loop.version + 1);
  expect(getLearningLoop(root, loop.id)?.version).toBe(recovered.version);
  expect(update(recovered, { action: 'resume-agent', reason: 'Reviewed again' }).directMethod?.transitions).toHaveLength(2);
});
it('preserves state when registry persistence fails and refuses resuming changed content', () => {
  let loop = approved(); const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).endsWith('/registry.json')) throw new Error('disk full');
    return rename(from, to);
  });
  expect(() => update(loop, { action: 'pause-agent', reason: 'Check' })).toThrow();
  vi.restoreAllMocks();
  expect(getLearningLoop(root, loop.id)?.version).toBe(loop.version);
  expect(listContextAssets(root)[0].status).toBe('active');
  loop = update(loop, { action: 'pause-agent', reason: 'Inspect changed file' });
  fs.writeFileSync(path.join(root, loop.directMethod!.review!.targetPath!), 'Unapproved replacement');
  expect(() => update(loop, { action: 'resume-agent', reason: 'Try changed file' })).toThrow();
  expect(listContextAssets(root)[0].status).toBe('deprecated');
});
it('rejects empty, oversized, forged, archived and duplicate-draft inputs without mutations', () => {
  let loop = approved();
  for (const command of [
    { action: 'pause-agent', reason: '' }, { action: 'pause-agent', reason: 'x'.repeat(1601) },
    { action: 'counterexample-agent', observation: 'Claim', receiptId: 'invented' },
    { action: 'revise-agent', reason: 'No actual change', ...method },
    { action: 'revise-agent', reason: 'Missing version', revisionIndex: 99, ...method },
  ]) expect(() => update(loop, command)).toThrow();
  loop = update(loop, { action: 'revise-agent', reason: 'Narrow scope', ...method, scope: 'Observational research' });
  expect(() => update(loop, { action: 'revise-agent', reason: 'Another draft', ...method, scope: 'Experiments' })).toThrow();
  loop = update(loop, { action: 'archive' });
  expect(() => update(loop, { action: 'counterexample-agent', observation: 'Archived' })).toThrow();
  expect(() => update(loop, { action: 'pause-agent', reason: 'Archived' })).toThrow();
});

it('lets a rejected revision be revised again but never publishes the rejected text', () => {
  let loop = approved();
  loop = update(loop, { action: 'revise-agent', reason: 'Try a narrower scope', ...method, scope: 'Clinical research' });
  loop = update(loop, { action: 'reject-agent', revisionIndex: 1 });
  loop = update(loop, { action: 'revise-agent', revisionIndex: 1, reason: 'Avoid domain assumptions', ...method, scope: 'Empirical research with available methods' });
  expect(loop.directMethod?.revisions).toHaveLength(2);
  expect(loop.directMethod?.revisions?.[0].review?.decision).toBe('rejected');
  expect(loop.directMethod?.revisions?.[1].review).toBeUndefined();
  expect(listContextAssets(root)).toHaveLength(1);
});
it('recovers approval of a new version after a journal failure without reactivating its predecessor', () => {
  let loop = approved();
  loop = update(loop, { action: 'pause-agent', reason: 'Revise scope' });
  loop = update(loop, { action: 'revise-agent', reason: 'Narrow scope', ...method, scope: 'Observational research' });
  const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).includes('/learning/')) throw new Error('disk unavailable');
    return rename(from, to);
  });
  expect(() => update(loop, { action: 'approve-agent', revisionIndex: 1 })).toThrow();
  vi.restoreAllMocks();
  const recovered = getLearningLoop(root, loop.id)!;
  expect(recovered.directMethod?.availability).toBe('deprecated');
  expect(recovered.directMethod?.revisions?.[0].availability).toBe('active');
  expect(recovered.version).toBe(loop.version + 1);
  expect(getLearningLoop(root, loop.id)?.version).toBe(recovered.version);
});
it('does not accept injected lifecycle history or reviewed revisions in a new correction', () => {
  const loop = startLearningCorrection(root, source, { ...method, availability: 'active', revisions: [{ ...method, review: { decision: 'approved' } }], counterexamples: [{ observation: 'Invented' }], transitions: [{ reason: 'Invented' }] });
  expect(loop.directMethod?.review).toBeUndefined();
  expect(loop.directMethod?.revisions).toBeUndefined();
  expect(loop.directMethod?.transitions).toBeUndefined();
  expect(loop.directMethod?.counterexamples).toBeUndefined();
  expect(listContextAssets(root)).toEqual([]);
});
