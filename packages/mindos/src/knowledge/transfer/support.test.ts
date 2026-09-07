import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startLearningCorrection, updateLearningLoop } from '../learning/index.js';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { startAgentRun, completeAgentRun, failAgentRun, resetAgentRunsForTest } from '../../agent/ledger/run-ledger.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import { getTransferMethods, startTransferPractice, updateTransferPractice, prepareTransferHelp, inspectTransferHelp, getTransferPractice } from './index.js';

let home: string; let root: string; let loop: ReturnType<typeof startLearningCorrection>;
const answer = { action: 'answer', answer: 'My initial reasoning stays distinct.', confidence: 60, assistance: 'none', familiar: false };
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-support-'));
  root = path.join(home, 'mind'); fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  setMindRootResolverForTests(() => root); resetAgentRunsForTest();
  loop = startLearningCorrection(root, { cardId: 'support', title: 'Evidence', content: 'Evidence', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'assistant', quote: 'Inspect the design.' }] }] }, { behavior: 'Inspect identification before causal claims.', scope: 'Research interpretation', check: 'Explain alternatives.' });
  loop = updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: -1, version: loop.version });
});
afterEach(() => { resetAgentRunsForTest(); setMindRootResolverForTests(null); vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
function start() {
  const method = getTransferMethods(root, loop.id)[0];
  return startTransferPractice(root, loop.id, 'en', new Date(), { ...method, reason: 'This method checks the comparison and alternative explanations.', fitConfirmed: true });
}
function send(view: ReturnType<typeof start>, input: Record<string, unknown>) {
  return updateTransferPractice(root, view.id, { version: view.version, ...input });
}
function actualRun(prepared: ReturnType<typeof prepareTransferHelp>, failed = false, query = prepared.draft.prompt) {
  const method = prepared.practice.method!;
  const stamp = new Date().toISOString(); const id = 'receipt-' + Math.random().toString(36).slice(2);
  writeRetrievalReceipt(root, { id, query, strategy: 'explicit-approved-method-context-v1', outcome: 'selected', startedAt: stamp, completedAt: stamp,
    budget: { maxTokens: 2000, maxFiles: 1, minScore: 0, timeoutMs: 0 }, scope: { preferredPaths: [method.path], excludePaths: [] }, candidates: [],
    selections: [{ assetId: method.assetId, path: method.path, contentHash: method.contentHash, assetVersion: method.assetVersion, truncated: false, estimatedTokens: 100, score: 1, reason: 'approved attachment' }],
    totals: { candidateCount: 1, selectedCount: 1, usedTokens: 100 } });
  const run = startAgentRun({ runtimeId: 'claude', displayName: 'Explicit test fixture', agentKind: 'native-runtime', permissionMode: 'read', metadata: { retrievalReceiptIds: [id] } });
  if (failed) failAgentRun(run.id, { error: new Error('Provider unavailable') });
  else completeAgentRun(run.id, { outputSummary: 'Review the comparison before drawing a causal conclusion.' });
  return run.id;
}
it('freezes an explicitly reviewed method match and prepares only the current task after the initial answer', () => {
  let view = start();
  expect(view.method).toMatchObject({ attemptIndex: -1, revisionIndex: 0, fitConfirmed: true });
  expect(() => prepareTransferHelp(root, view.id, { version: view.version })).toThrow();
  view = send(view, answer);
  const prepared = prepareTransferHelp(root, view.id, { version: view.version });
  expect(prepared.draft.path).toBe(view.method!.path);
  expect(prepared.draft.prompt).toContain(answer.answer);
  expect(prepared.draft.prompt).not.toMatch(/school|workshop|calibrated statement/);
  expect(prepared.practice.helpRuns).toEqual([]);
  expect(prepareTransferHelp(root, view.id, { version: prepared.practice.version }).practice.version).toBe(prepared.practice.version);
});
it('requires an explicit match and rejects changed, paused or mismatched method identities', () => {
  const method = getTransferMethods(root, loop.id)[0];
  expect(() => startTransferPractice(root, loop.id, 'en', new Date(), { ...method, reason: ' ', fitConfirmed: true })).toThrow();
  expect(() => startTransferPractice(root, loop.id, 'en', new Date(), { ...method, reason: 'Relevant', fitConfirmed: false })).toThrow();
  expect(() => startTransferPractice(root, loop.id, 'en', new Date(), { ...method, reason: 'Relevant', fitConfirmed: true, contentHash: '0'.repeat(64) })).toThrow();
  let view = start(); view = send(view, answer);
  loop = updateLearningLoop(root, loop.id, { action: 'pause-agent', attemptIndex: -1, revisionIndex: 0, version: loop.version, reason: 'Needs revision.' });
  expect(() => prepareTransferHelp(root, view.id, { version: view.version })).toThrow();
  expect(getTransferPractice(root, view.id)?.method).toEqual(view.method);
  expect(getTransferMethods(root, loop.id)).toEqual([]);
});
it('links actual help without exposing it until requested and preserves viewed output after run cleanup', () => {
  let view = start(); view = send(view, answer);
  const prepared = prepareTransferHelp(root, view.id, { version: view.version });
  const wrong = actualRun(prepared, false, 'Another conversation');
  const runId = actualRun(prepared);
  view = getTransferPractice(root, view.id)!;
  expect(view.helpRuns.map(item => item.runId)).toEqual([runId]);
  expect(view.helpRuns[0].output).toBeUndefined();
  expect(() => inspectTransferHelp(root, view.id, { version: view.version, runId: wrong })).toThrow();
  view = inspectTransferHelp(root, view.id, { version: view.version, runId });
  expect(view.helpRuns[0]).toMatchObject({ status: 'completed', output: 'Review the comparison before drawing a causal conclusion.' });
  expect(view.helpRuns[0].viewRequestedAt).toBeTruthy();
  resetAgentRunsForTest();
  view = getTransferPractice(root, view.id)!;
  expect(view.helpRuns[0].output).toContain('comparison');
  view = send(view, { ...answer, assistance: 'agent' });
  expect(JSON.stringify(view)).not.toContain('Review the comparison');
  expect(() => inspectTransferHelp(root, view.id, { version: view.version, runId })).toThrow();
  view = send(view, { action: 'end', reason: 'stopped' });
  expect(view.helpRuns[0].output).toContain('comparison');
});
it('keeps failed help separate from received help and retains the state when saving a snapshot fails', () => {
  let view = start(); view = send(view, answer);
  const prepared = prepareTransferHelp(root, view.id, { version: view.version });
  const runId = actualRun(prepared, true);
  view = getTransferPractice(root, view.id)!;
  const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Disk full'); });
  expect(() => inspectTransferHelp(root, view.id, { version: view.version, runId })).toThrow();
  vi.mocked(fs.renameSync).mockImplementation(rename);
  expect(getTransferPractice(root, view.id)?.version).toBe(view.version);
  view = inspectTransferHelp(root, view.id, { version: view.version, runId });
  expect(view.helpRuns[0]).toMatchObject({ status: 'failed', output: '', error: 'Provider unavailable' });
  expect(view.helpRuns[0].viewRequestedAt).toBeUndefined();
});

it('does not silently replace or mislabel an existing practice when its match request changes', () => {
  const view = start(); const method = getTransferMethods(root, loop.id)[0];
  expect(() => startTransferPractice(root, loop.id, 'en', new Date(), { ...method, reason: 'A different match than the one frozen.', fitConfirmed: true })).toThrow();
  expect(getTransferPractice(root, view.id)?.method).toEqual(view.method);
});

it('rejects help carrying a different method version and preserves saved results at the snapshot limit', () => {
  let view = start(); view = send(view, answer);
  const prepared = prepareTransferHelp(root, view.id, { version: view.version });
  const otherVersion = structuredClone(prepared); otherVersion.practice.method!.assetVersion++;
  const wrong = actualRun(otherVersion);
  expect(getTransferPractice(root, view.id)?.helpRuns.some(item => item.runId === wrong)).toBe(false);
  for (let i = 0; i < 8; i++) {
    const runId = actualRun(prepared); view = getTransferPractice(root, view.id)!;
    view = inspectTransferHelp(root, view.id, { version: view.version, runId });
  }
  const overflow = actualRun(prepared);
  expect(() => inspectTransferHelp(root, view.id, { version: view.version, runId: overflow })).toThrow();
  expect(getTransferPractice(root, view.id)?.helpRuns.filter(item => item.output !== undefined)).toHaveLength(8);
});
