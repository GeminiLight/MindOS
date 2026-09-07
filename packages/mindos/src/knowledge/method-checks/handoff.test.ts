import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  startLearningCorrection,
  updateLearningLoop,
} from '../learning/index.js';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  startAgentRun,
  completeAgentRun,
  failAgentRun,
  resetAgentRunsForTest,
} from '../../agent/ledger/run-ledger.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import {
  createMethodCheck,
  prepareMethodCheck,
  getMethodCheck,
  previewMethodHandoff,
  createMethodHandoff,
  captureMethodCheck,
  assessMethodCheck,
} from './index.js';
let home: string;
let root: string;
let check: ReturnType<typeof createMethodCheck>;
let sourceId: string;
const target = { id: 'claude', kind: 'claude', name: 'Claude Code' };
function run(
  prepared: ReturnType<typeof prepareMethodCheck>,
  runtimeId = 'codex',
  failed = false,
) {
  const id = 'receipt-' + Math.random().toString(36).slice(2);
  const now = new Date().toISOString();
  const method = prepared.check.method;
  writeRetrievalReceipt(root, {
    id,
    query: prepared.draft.prompt,
    strategy: 'explicit-approved-method-context-v1',
    outcome: 'selected',
    startedAt: now,
    completedAt: now,
    budget: { maxTokens: 2000, maxFiles: 1, minScore: 0, timeoutMs: 0 },
    scope: { preferredPaths: [method.path], excludePaths: [] },
    candidates: [],
    selections: [
      {
        assetId: method.assetId,
        path: method.path,
        contentHash: method.contentHash,
        assetVersion: prepared.draft.assetVersion,
        truncated: false,
        estimatedTokens: 100,
        score: 1,
        reason: 'Attached approved method',
      },
    ],
    totals: { candidateCount: 1, selectedCount: 1, usedTokens: 100 },
  });
  const record = startAgentRun({
    runtimeId,
    displayName: 'Handoff test fixture',
    agentKind: 'native-runtime',
    permissionMode: 'read',
    metadata: { retrievalReceiptIds: [id] },
  });
  if (failed)
    failAgentRun(record.id, { error: new Error('Provider unavailable') });
  else
    completeAgentRun(record.id, {
      outputSummary: 'Original private response: inspect identification.',
    });
  return record.id;
}
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'method-handoff-'));
  root = path.join(home, 'mind');
  fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  setMindRootResolverForTests(() => root);
  resetAgentRunsForTest();
  let loop = startLearningCorrection(
    root,
    {
      cardId: 'handoff',
      title: 'Identification',
      content: 'Evidence',
      sessions: [
        {
          id: 'source',
          messageRefs: [
            {
              messageIndex: 0,
              role: 'assistant',
              quote: 'The claim needs qualification.',
            },
          ],
        },
      ],
    },
    {
      behavior: 'Inspect design before claiming cause',
      scope: 'Evidence interpretation',
      check: 'Explain identification',
    },
  );
  loop = updateLearningLoop(root, loop.id, {
    action: 'approve-agent',
    attemptIndex: -1,
    version: loop.version,
  });
  loop = updateLearningLoop(root, loop.id, {
    action: 'counterexample-agent',
    attemptIndex: -1,
    version: loop.version,
    observation: 'Random assignment can identify a causal effect.',
  });
  check = createMethodCheck(root, {
    learningId: loop.id,
    version: loop.version,
    attemptIndex: -1,
    revisionIndex: 0,
    locale: 'en',
    useTask: 'An uncontrolled observation',
    useExpected: 'Private criterion one',
    exceptionTask: 'Randomized experiment',
    exceptionExpected: 'Private criterion two',
  });
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'use',
  });
  check = prepared.check;
  sourceId = run(prepared);
});
afterEach(() => {
  resetAgentRunsForTest();
  setMindRootResolverForTests(null);
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
function create(extra: Record<string, unknown> = {}) {
  const preview = previewMethodHandoff(root, check.id);
  return createMethodHandoff(root, check.id, {
    version: check.version,
    sourceRunId: sourceId,
    target,
    rationale: 'Continue evidence checking with another Agent',
    previewHash: preview.previewHash,
    counterexampleIds: [preview.counterexamples[0].id],
    ...extra,
  });
}
it('freezes the preview and target, sends only selected handoff notes, and correlates the actual receiving Agent', () => {
  check = create();
  const handoff = check.handoffs![0];
  expect(handoff.source.runtimeId).toBe('codex');
  expect(handoff.target).toEqual(target);
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'exception',
    handoffId: handoff.id,
  });
  expect(prepared.draft.runtime).toEqual(target);
  expect(prepared.draft.prompt).toContain('Random assignment');
  expect(prepared.draft.prompt).not.toContain('Original private response');
  expect(prepared.draft.prompt).not.toContain('Private criterion');
  expect(prepared.draft.prompt).not.toContain('An uncontrolled observation');
  const runId = run(prepared, 'claude');
  const view = getMethodCheck(root, check.id)!;
  expect(view.runs.find((item) => item.runId === runId)).toMatchObject({
    handoffId: handoff.id,
    targetMatches: true,
    runtimeId: 'claude',
  });
  const captured = captureMethodCheck(root, check.id, {
    version: prepared.check.version,
  });
  resetAgentRunsForTest();
  expect(
    getMethodCheck(root, check.id)?.runs.find((item) => item.runId === runId),
  ).toMatchObject({
    source: 'saved',
    handoffId: handoff.id,
    targetMatches: true,
  });
  expect(captured.handoffs![0].methodBody).toContain('Inspect design');
});
it('keeps an unexpected executor visible and allows the intended target to run despite another case run', () => {
  check = create();
  const handoff = check.handoffs![0];
  let prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'use',
    handoffId: handoff.id,
  });
  const wrong = run(prepared, 'codex');
  expect(
    getMethodCheck(root, check.id)?.runs.find((item) => item.runId === wrong),
  ).toMatchObject({ targetMatches: false, handoffId: handoff.id });
  prepared = prepareMethodCheck(root, check.id, {
    version: prepared.check.version,
    kind: 'use',
    handoffId: handoff.id,
  });
  expect(prepared.draft.runtime).toEqual(target);
});
it('rejects stale previews, same-Agent handoffs, unknown counterexamples and failed sources without saving a handoff', () => {
  expect(() => create({ previewHash: '0'.repeat(64) })).toThrow();
  expect(() =>
    create({ target: { id: 'codex', kind: 'codex', name: 'Codex' } }),
  ).toThrow();
  expect(() => create({ counterexampleIds: ['unknown'] })).toThrow();
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'exception',
  });
  check = prepared.check;
  const failed = run(prepared, 'codex', true);
  expect(() => create({ sourceRunId: failed })).toThrow();
  expect(getMethodCheck(root, check.id)?.check.handoffs ?? []).toHaveLength(0);
});
it('retains the frozen packet after the method changes, but refuses to prepare it', () => {
  check = create();
  const loopId = check.learningId;
  const original = fs.readFileSync(path.join(root, check.method.path), 'utf8');
  fs.writeFileSync(
    path.join(root, check.method.path),
    original + '\nUnreviewed edit',
  );
  expect(getMethodCheck(root, check.id)?.check.handoffs![0].methodBody).toBe(
    original,
  );
  expect(() =>
    prepareMethodCheck(root, check.id, {
      version: check.version,
      kind: 'use',
      handoffId: check.handoffs![0].id,
    }),
  ).toThrow();
  expect(check.learningId).toBe(loopId);
});
it('does not commit a packet when private storage publication fails', () => {
  vi.spyOn(fs, 'renameSync').mockImplementation(() => {
    throw new Error('Disk full');
  });
  expect(() => create()).toThrow();
  expect(getMethodCheck(root, check.id)?.check.version).toBe(check.version);
});

it('keeps assessed receiving-Agent results visible after recent runs expire without requiring a separate capture', () => {
  check = create();
  const handoff = check.handoffs![0];
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version, kind: 'use', handoffId: handoff.id,
  });
  const runId = run(prepared, 'claude');
  assessMethodCheck(root, check.id, {
    version: prepared.check.version, kind: 'use', runId,
    outcome: 'uncertain', quote: 'inspect identification',
    reason: 'Needs independent review.',
  });
  resetAgentRunsForTest();
  expect(getMethodCheck(root, check.id)?.runs.find(item => item.runId === runId)).toMatchObject({
    source: 'saved', status: 'completed', handoffId: handoff.id, targetMatches: true,
  });
});
