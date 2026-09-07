import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  createInquiry,
  getInquiry,
  listInquiries,
  updateInquiry,
  prepareInquiry,
  inquiryRuns,
} from './index.js';
import { getLearningLoop } from '../learning/index.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  startAgentRun,
  completeAgentRun,
  failAgentRun,
  resetAgentRunsForTest,
} from '../../agent/ledger/run-ledger.js';
let home: string, root: string;
const source = {
  sessionId: 'source-chat',
  messageIndex: 1,
  messageHash: 'a'.repeat(64),
  quote: 'The highest ranked model is best.',
  question: 'Which model should we choose?',
  questionHash: 'b'.repeat(64),
};
const frame = {
  question: 'Which model is robust to missing inputs?',
  explanationA: 'The ranking generalizes.',
  explanationB: 'Missing inputs reverse the ranking.',
  distinction: 'Compare the same models with complete and missing inputs.',
  capability: 'Frame a falsifiable question',
};
const plan = {
  task: 'Compare two models under both input conditions using held-out tasks.',
  supportsA: 'The ranking remains consistent.',
  supportsB: 'The ranking reverses under missing inputs.',
  inconclusive: 'Differences are too uncertain to distinguish explanations.',
  scope: 'This task set only',
  budget: 'A fixed equal time budget for each condition.',
};
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-'));
  root = path.join(home, 'mind');
  fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  setMindRootResolverForTests(() => root);
  resetAgentRunsForTest();
});
afterEach(() => {
  resetAgentRunsForTest();
  setMindRootResolverForTests(null);
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
const create = () =>
  createInquiry(root, { requestId: 'new-question', locale: 'en', source });
function update(
  record: ReturnType<typeof create>,
  action: string,
  extra: object = {},
  requestId = action,
) {
  return updateInquiry(root, record.id, {
    action,
    requestId,
    version: record.version,
    ...extra,
  });
}
function frozen() {
  let q = create();
  q = update(q, 'save-draft', { draft: frame });
  return update(q, 'commit-frame');
}
it('saves incomplete drafts, locks the human-authored frame before help, and preserves earlier explanations after reframing', () => {
  let q = create();
  expect(create()).toEqual(q);
  expect(() =>
    prepareInquiry(root, q.id, {
      requestId: 'too-early',
      version: q.version,
      kind: 'challenge',
    }),
  ).toThrow();
  q = update(q, 'save-draft', { draft: { ...frame, explanationB: '' } });
  expect(getInquiry(root, q.id)?.draft?.explanationB).toBe('');
  expect(() => update(q, 'commit-frame')).toThrow();
  q = update(q, 'save-draft', { draft: frame }, 'complete');
  q = update(q, 'commit-frame');
  expect(q.frames[0].authorship).toBe('human');
  expect(q.source.quote).toBe(source.quote);
  expect(q.draft).toBeNull();
  q = update(q, 'plan', { frameId: q.frames[0].id, ...plan });
  q = update(q, 'observe', {
    planId: q.plans[0].id,
    kind: 'manual',
    sourceLabel: 'User-provided synthetic comparison',
    quote: 'The ordering reversed.',
    interpretation: 'Input conditions matter.',
    outcome: 'b',
  });
  q = update(q, 'decide', {
    frameId: q.frames[0].id,
    outcome: 'reframe',
    evidenceIds: [q.observations[0].id],
    reason: 'Investigate the change in ranking.',
    nextQuestion: 'Which missing-input patterns reverse the ranking?',
  });
  const original = structuredClone(q.frames[0]);
  q = update(q, 'revise', { frameId: original.id });
  q = update(
    q,
    'save-draft',
    {
      draft: {
        ...frame,
        question: 'Which missing-input patterns reverse the ranking?',
      },
    },
    'new-draft',
  );
  q = update(q, 'commit-frame', {}, 'new-frame');
  expect(q.frames).toHaveLength(2);
  expect(q.frames[0]).toEqual(original);
  expect(q.frames[1].basedOn).toBe(original.id);
  expect(q.decisions[0].outcome).toBe('reframe');
  expect(listInquiries(root).inquiries).toHaveLength(1);
  expect(fs.readdirSync(root)).toEqual([]);
});
it('recovers repeated commands without duplicating plans and protects data on stale, invalid or failed writes', () => {
  let q = frozen();
  const command = {
    action: 'plan',
    requestId: 'plan-one',
    version: q.version,
    frameId: q.frames[0].id,
    ...plan,
  };
  const saved = updateInquiry(root, q.id, command);
  expect(updateInquiry(root, q.id, command)).toEqual(saved);
  expect(saved.plans).toHaveLength(1);
  expect(() =>
    updateInquiry(root, q.id, { ...command, task: 'Different task' }),
  ).toThrow();
  expect(() =>
    updateInquiry(root, q.id, { ...command, requestId: 'new-stale' }),
  ).toThrow();
  for (const input of [
    null,
    {},
    { ...command, version: NaN },
    { ...command, supportsA: '' },
    { ...command, task: 'x'.repeat(4001) },
    { ...command, role: 'agent' },
  ])
    expect(() => updateInquiry(root, q.id, input)).toThrow();
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
    throw Error('disk unavailable');
  });
  expect(() => update(saved, 'archive', { archived: true })).toThrow();
  rename.mockRestore();
  expect(getInquiry(root, q.id)).toEqual(saved);
  expect(() => getInquiry(root, '../escape')).toThrow();
  expect(getInquiry(root, 'inquiry-' + 'f'.repeat(24))).toBeNull();
});
function run(
  prepared: ReturnType<typeof prepareInquiry>,
  failed = false,
  query = prepared.draft.prompt,
) {
  const receipt = writeRetrievalReceipt(root, {
    id: 'receipt-' + randomUUID(),
    query,
    strategy: 'inquiry-test',
    outcome: 'empty',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    budget: { maxTokens: 1000, maxFiles: 2, minScore: 0, timeoutMs: 1000 },
    scope: { preferredPaths: [], excludePaths: [] },
    candidates: [],
    selections: [],
    totals: { candidateCount: 0, selectedCount: 0, usedTokens: 0 },
  });
  const r = startAgentRun({
    runtimeId: 'claude',
    displayName: 'Synthetic inquiry',
    agentKind: 'native-runtime',
    permissionMode: 'read',
    inputSummary: query,
    metadata: { retrievalReceiptId: receipt.id, model: 'fixture' },
  });
  if (failed)
    failAgentRun(r.id, { error: new Error('synthetic provider failure') });
  else
    completeAgentRun(r.id, {
      outputSummary: 'The ordering reversed under missing inputs.',
    });
  return r.id;
}
it('binds actual runs to the frozen preparation, retains failures, and refuses unrelated or unsupported observations', () => {
  let q = frozen();
  q = update(q, 'plan', { frameId: q.frames[0].id, ...plan });
  const prepared = prepareInquiry(root, q.id, {
    version: q.version,
    requestId: 'prepare',
    kind: 'test',
    planId: q.plans[0].id,
  });
  q = prepared.inquiry;
  expect(prepared.draft.prompt).toContain(plan.task);
  expect(prepared.draft.prompt).not.toContain(plan.supportsA);
  expect(inquiryRuns(root, q)).toEqual([]);
  const wrong = run(prepared, false, 'unrelated task');
  const failed = run(prepared, true);
  const actual = run(prepared);
  expect(inquiryRuns(root, q).map((r) => r.runId)).not.toContain(wrong);
  expect(() =>
    update(q, 'observe', {
      planId: q.plans[0].id,
      kind: 'run',
      runId: failed,
      quote: 'synthetic',
      interpretation: 'Success',
      outcome: 'a',
    }),
  ).toThrow();
  expect(() =>
    update(q, 'observe', {
      planId: q.plans[0].id,
      kind: 'run',
      runId: actual,
      quote: 'invented quote',
      interpretation: 'Unsupported',
      outcome: 'b',
    }),
  ).toThrow();
  q = update(q, 'capture');
  expect(q.runs).toHaveLength(2);
  expect(q.runs.find((r) => r.runId === failed)?.status).toBe('failed');
  q = update(q, 'observe', {
    planId: q.plans[0].id,
    kind: 'run',
    runId: actual,
    quote: 'ordering reversed',
    interpretation: 'A conditional effect.',
    outcome: 'b',
  });
  resetAgentRunsForTest();
  expect(inquiryRuns(root, q)).toHaveLength(2);
  expect(q.observations[0].runId).toBe(actual);
  q = update(q, 'decide', {
    frameId: q.frames[0].id,
    outcome: 'keep-b',
    evidenceIds: [q.observations[0].id],
    reason: 'The saved observation supports the alternative.',
  });
  q = update(q, 'method-draft', {
    decisionId: q.decisions[0].id,
    behavior: 'Check input conditions before comparing rankings.',
    scope: 'Model comparisons',
    check: 'Report the input conditions and exceptions.',
  });
  const method = getLearningLoop(root, q.decisions[0].methodDraftId!);
  expect(method?.directMethod?.review).toBeUndefined();
  expect(method?.source.content).toContain(q.decisions[0].reason);
});
it('keeps an unresolved question open without fabricating evidence and isolates corrupt records in the list', () => {
  let q = frozen();
  expect(() =>
    update(q, 'decide', {
      frameId: q.frames[0].id,
      outcome: 'keep-a',
      evidenceIds: [],
      reason: 'No evidence',
    }),
  ).toThrow();
  q = update(q, 'decide', {
    frameId: q.frames[0].id,
    outcome: 'open',
    evidenceIds: [],
    reason: 'More evidence is needed.',
  });
  expect(q.decisions[0].outcome).toBe('open');
  const dir = path.join(
    home,
    '.mindos/private-learning',
    fs.readdirSync(path.join(home, '.mindos/private-learning'))[0],
  );
  fs.writeFileSync(
    path.join(dir, 'inquiry-' + 'f'.repeat(24) + '.json'),
    '{broken',
  );
  expect(listInquiries(root).unavailableCount).toBe(1);
  expect(listInquiries(root).inquiries).toHaveLength(1);
});
it('replays the original preparation after later activity, freezes archived questions, and rejects a backwards clock', () => {
  let q = frozen();
  const command = {
    version: q.version,
    requestId: 'first-help',
    kind: 'challenge',
  };
  const first = prepareInquiry(root, q.id, command);
  q = first.inquiry;
  q = prepareInquiry(root, q.id, {
    version: q.version,
    requestId: 'second-help',
    kind: 'challenge',
  }).inquiry;
  expect(prepareInquiry(root, q.id, command).draft).toEqual(first.draft);
  expect(getInquiry(root, q.id)?.preparations).toHaveLength(2);
  expect(() =>
    updateInquiry(
      root,
      q.id,
      {
        action: 'archive',
        version: q.version,
        requestId: 'old-time',
        archived: true,
      },
      new Date(Date.parse(q.createdAt) - 1000),
    ),
  ).toThrow();
  q = update(q, 'archive', { archived: true });
  expect(() =>
    prepareInquiry(root, q.id, {
      version: q.version,
      requestId: 'archived-help',
      kind: 'challenge',
    }),
  ).toThrow();
  expect(() => update(q, 'revise', { frameId: q.frames[0].id })).toThrow();
  q = update(q, 'archive', { archived: false }, 'restore');
  expect(q.archived).toBe(false);
  expect(() =>
    createInquiry(root, {
      requestId: 'new-question',
      locale: 'en',
      source: { ...source, question: 'Changed' },
    }),
  ).toThrow();
});
it('does not reuse an earlier plan run as evidence for a later plan', () => {
  let q = frozen();
  q = update(q, 'plan', { frameId: q.frames[0].id, ...plan });
  const prepared = prepareInquiry(root, q.id, {
    version: q.version,
    requestId: 'test-one',
    kind: 'test',
    planId: q.plans[0].id,
  });
  q = prepared.inquiry;
  const actual = run(prepared);
  q = update(
    q,
    'plan',
    { frameId: q.frames[0].id, ...plan, task: 'A different held-out case' },
    'second-plan',
  );
  expect(() =>
    update(q, 'observe', {
      planId: q.plans[1].id,
      kind: 'run',
      runId: actual,
      quote: 'ordering reversed',
      interpretation: 'No new run',
      outcome: 'b',
    }),
  ).toThrow();
  expect(getInquiry(root, q.id)?.observations).toHaveLength(0);
});
it('recovers a method proposal when its creation succeeded but linking it back failed', () => {
  let q = frozen();
  q = update(q, 'plan', { frameId: q.frames[0].id, ...plan });
  q = update(q, 'observe', {
    planId: q.plans[0].id,
    kind: 'manual',
    sourceLabel: 'Synthetic',
    quote: 'Ordering reversed',
    interpretation: 'Input-dependent',
    outcome: 'b',
  });
  q = update(q, 'decide', {
    frameId: q.frames[0].id,
    outcome: 'keep-b',
    evidenceIds: [q.observations[0].id],
    reason: 'Input conditions matter.',
  });
  const command = {
    action: 'method-draft',
    requestId: 'method-link',
    version: q.version,
    decisionId: q.decisions[0].id,
    behavior: 'Check input conditions',
    scope: 'Comparisons',
    check: 'Names input conditions',
  };
  const rename = fs.renameSync;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).endsWith(q.id + '.json')) throw Error('link failed');
    return rename(from, to);
  });
  expect(() => updateInquiry(root, q.id, command)).toThrow();
  spy.mockRestore();
  expect(getInquiry(root, q.id)?.decisions[0].methodDraftId).toBeUndefined();
  q = updateInquiry(root, q.id, command);
  const saved = q.decisions[0].methodDraftId!;
  expect(updateInquiry(root, q.id, command).decisions[0].methodDraftId).toBe(
    saved,
  );
  expect(getLearningLoop(root, saved)?.directMethod?.review).toBeUndefined();
});
