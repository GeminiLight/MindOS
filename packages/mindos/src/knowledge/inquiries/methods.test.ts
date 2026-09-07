import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createInquiry,
  updateInquiry,
  prepareInquiry,
  inquiryRuns,
  getInquiry,
} from './index.js';
import {
  startLearningCorrection,
  updateLearningLoop,
  getLearningLoop,
  learningMethodFingerprint,
} from '../learning/index.js';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import {
  startAgentRun,
  completeAgentRun,
  resetAgentRunsForTest,
} from '../../agent/ledger/run-ledger.js';
let root: string, home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-method-'));
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
const source = {
  sessionId: 'source',
  messageIndex: 1,
  messageHash: 'a'.repeat(64),
  questionHash: 'b'.repeat(64),
  question: 'When does A help?',
  quote: 'Always A',
};
const edit = (
  q: ReturnType<typeof createInquiry>,
  action: string,
  body: object = {},
) =>
  updateInquiry(root, q.id, {
    action,
    requestId: randomUUID(),
    version: q.version,
    ...body,
  });
function setup() {
  let q = createInquiry(root, {
    requestId: randomUUID(),
    locale: 'en',
    source,
  });
  q = edit(q, 'save-draft', {
    draft: {
      question: 'When does A help?',
      explanationA: 'Always',
      explanationB: 'Only complete inputs',
      distinction: 'Compare input conditions',
      capability: 'Define limits',
    },
  });
  q = edit(q, 'commit-frame');
  let loop = startLearningCorrection(
    root,
    {
      cardId: 'method',
      title: 'Prefer A',
      content: 'Use A',
      sessions: [
        {
          id: 'source',
          messageRefs: [
            { messageIndex: 1, role: 'assistant', quote: 'Always A' },
          ],
        },
      ],
    },
    { behavior: 'Choose A', scope: 'Comparisons', check: 'Names A' },
  );
  loop = updateLearningLoop(root, loop.id, {
    action: 'approve-agent',
    version: loop.version,
    attemptIndex: -1,
  });
  return { q, loop };
}
function link(
  q: ReturnType<typeof createInquiry>,
  loop: ReturnType<typeof setup>['loop'],
) {
  return edit(q, 'link-method', {
    frameId: q.frames[0].id,
    learningId: loop.id,
    attemptIndex: -1,
    revisionIndex: 0,
    baseHash: learningMethodFingerprint(loop.directMethod!),
  });
}
const plan = {
  task: 'Compare complete and missing inputs',
  supportsA: 'A always wins',
  supportsB: 'B wins with missing inputs',
  inconclusive: 'No usable output',
  scope: 'Synthetic fixtures',
  budget: 'One task',
};
function decide(q: ReturnType<typeof createInquiry>) {
  q = edit(q, 'observe', {
    planId: q.plans[0].id,
    kind: 'manual',
    sourceLabel: 'Synthetic fixture',
    quote: 'B wins with missing inputs',
    interpretation: 'A is conditional',
    outcome: 'b',
  });
  return edit(q, 'decide', {
    frameId: q.frames[0].id,
    outcome: 'keep-b',
    evidenceIds: [q.observations[0].id],
    reason: 'The condition matters',
  });
}
const revision = {
  reason: 'Consider incomplete inputs',
  behavior: 'Compare A and B under current input conditions',
  scope: 'Comparisons',
  check: 'States the conditions',
};
it('freezes the method version and requires both its asset and task receipt before counting a run', () => {
  let { q, loop } = setup();
  q = link(q, loop);
  const linked = q.methodLinks![0];
  q = edit(q, 'plan', {
    frameId: q.frames[0].id,
    methodLinkId: linked.id,
    ...plan,
  });
  const prepared = prepareInquiry(root, q.id, {
    requestId: randomUUID(),
    version: q.version,
    kind: 'test',
    planId: q.plans[0].id,
  });
  q = prepared.inquiry;
  expect(prepared.draft.attachedFiles).toEqual([linked.asset.path]);
  for (const mode of ['absent', 'truncated', 'complete']) {
    const matching = mode !== 'absent';
    const at = new Date().toISOString();
    const receipt = writeRetrievalReceipt(root, {
      id: 'receipt-' + randomUUID(),
      query: prepared.draft.prompt,
      strategy: 'inquiry',
      outcome: matching ? 'selected' : 'empty',
      startedAt: at,
      completedAt: at,
      budget: { maxTokens: 1000, maxFiles: 2, minScore: 0, timeoutMs: 1000 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [],
      selections: matching
        ? [
            {
              assetId: linked.asset.assetId,
              path: linked.asset.path,
              assetVersion: linked.asset.assetVersion,
              contentHash: linked.asset.contentHash,
              score: 1,
              estimatedTokens: 10,
              truncated: mode === 'truncated',
              reason: 'Synthetic attached method',
            },
          ]
        : [],
      totals: {
        candidateCount: 0,
        selectedCount: matching ? 1 : 0,
        usedTokens: 0,
      },
    });
    const run = startAgentRun({
      runtimeId: 'claude',
      displayName: 'Synthetic',
      agentKind: 'native-runtime',
      permissionMode: 'read',
      inputSummary: prepared.draft.prompt,
      metadata: { retrievalReceiptId: receipt.id },
    });
    completeAgentRun(run.id, { outputSummary: 'B wins with missing inputs' });
  }
  expect(inquiryRuns(root, q)).toHaveLength(1);
  q = decide(q);
  q = edit(q, 'method-revision', {
    decisionId: q.decisions[0].id,
    methodLinkId: linked.id,
    ...revision,
  });
  expect(q.decisions[0].methodDraftId).toBe(loop.id);
  expect(q.decisions[0].methodRevision).toMatchObject({
    methodLinkId: linked.id,
    revisionIndex: 1,
  });
  expect(
    getLearningLoop(root, loop.id)?.directMethod?.revisions?.[0].review,
  ).toBeUndefined();
  expect(q.methodLinks![0]).toEqual(linked);
});
it('allows a paused method to receive a proposal but refuses to execute it or silently change its base', () => {
  let { q, loop } = setup();
  loop = updateLearningLoop(root, loop.id, {
    action: 'pause-agent',
    version: loop.version,
    attemptIndex: -1,
    reason: 'Found an exception',
  });
  q = link(q, loop);
  q = edit(q, 'plan', {
    frameId: q.frames[0].id,
    methodLinkId: q.methodLinks![0].id,
    ...plan,
  });
  expect(() =>
    prepareInquiry(root, q.id, {
      requestId: randomUUID(),
      version: q.version,
      kind: 'test',
      planId: q.plans[0].id,
    }),
  ).toThrow();
  q = decide(q);
  q = edit(q, 'method-revision', {
    decisionId: q.decisions[0].id,
    methodLinkId: q.methodLinks![0].id,
    ...revision,
  });
  expect(getLearningLoop(root, loop.id)?.directMethod?.availability).toBe(
    'deprecated',
  );
  expect(() =>
    edit(q, 'method-draft', { decisionId: q.decisions[0].id, ...revision }),
  ).toThrow();
});
it('recovers a created revision after the private question link fails without duplicating the method version', () => {
  let { q, loop } = setup();
  q = link(q, loop);
  q = edit(q, 'plan', {
    frameId: q.frames[0].id,
    methodLinkId: q.methodLinks![0].id,
    ...plan,
  });
  q = decide(q);
  const command = {
    action: 'method-revision',
    requestId: 'recover',
    version: q.version,
    decisionId: q.decisions[0].id,
    methodLinkId: q.methodLinks![0].id,
    ...revision,
  };
  const rename = fs.renameSync;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).endsWith(q.id + '.json'))
      throw Error('private write failed');
    return rename(from, to);
  });
  expect(() => updateInquiry(root, q.id, command)).toThrow();
  spy.mockRestore();
  expect(getLearningLoop(root, loop.id)?.directMethod?.revisions).toHaveLength(
    1,
  );
  expect(getInquiry(root, q.id)?.decisions[0].methodDraftId).toBeUndefined();
  q = updateInquiry(root, q.id, command);
  expect(getLearningLoop(root, loop.id)?.directMethod?.revisions).toHaveLength(
    1,
  );
  expect(updateInquiry(root, q.id, command)).toEqual(q);
  expect(() =>
    updateInquiry(root, q.id, {
      ...command,
      requestId: 'different-content',
      version: q.version,
      behavior: 'Another revision',
    }),
  ).toThrow();
});

it('does not retroactively attach a later method link to an earlier plan', () => {
  let { q, loop } = setup();
  q = edit(q, 'plan', { frameId: q.frames[0].id, ...plan });
  q = link(q, loop);
  const prepared = prepareInquiry(root, q.id, {
    requestId: randomUUID(),
    version: q.version,
    kind: 'test',
    planId: q.plans[0].id,
  });
  expect(prepared.draft.attachedFiles).toBeUndefined();
  expect(prepared.inquiry.preparations[0].methodLinkId).toBeUndefined();
  q = prepared.inquiry;
  q = edit(q, 'revise', { frameId: q.frames[0].id });
  q = edit(q, 'commit-frame');
  expect(() =>
    edit(q, 'plan', {
      frameId: q.frames[1].id,
      methodLinkId: q.methodLinks![0].id,
      ...plan,
    }),
  ).toThrow();
});
it('keeps the old snapshot after approving a revision and requires a new link to test the new version', () => {
  let { q, loop } = setup();
  q = link(q, loop);
  const old = q.methodLinks![0];
  q = edit(q, 'plan', {
    frameId: q.frames[0].id,
    methodLinkId: old.id,
    ...plan,
  });
  q = decide(q);
  q = edit(q, 'method-revision', {
    decisionId: q.decisions[0].id,
    methodLinkId: old.id,
    ...revision,
  });
  loop = getLearningLoop(root, loop.id)!;
  loop = updateLearningLoop(root, loop.id, {
    action: 'pause-agent',
    version: loop.version,
    attemptIndex: -1,
    revisionIndex: 0,
    reason: 'Replace after counterexample',
  });
  loop = updateLearningLoop(root, loop.id, {
    action: 'approve-agent',
    version: loop.version,
    attemptIndex: -1,
    revisionIndex: 1,
  });
  expect(() =>
    prepareInquiry(root, q.id, {
      requestId: randomUUID(),
      version: q.version,
      kind: 'test',
      planId: q.plans[0].id,
    }),
  ).toThrow();
  q = edit(q, 'link-method', {
    frameId: q.frames[0].id,
    learningId: loop.id,
    attemptIndex: -1,
    revisionIndex: 1,
    baseHash: learningMethodFingerprint(loop.directMethod!.revisions![0]),
  });
  q = edit(q, 'plan', {
    frameId: q.frames[0].id,
    methodLinkId: q.methodLinks![1].id,
    ...plan,
  });
  const next = prepareInquiry(root, q.id, {
    requestId: randomUUID(),
    version: q.version,
    kind: 'test',
    planId: q.plans[1].id,
  });
  expect(next.draft.attachedFiles).toEqual([
    loop.directMethod!.revisions![0].review!.targetPath,
  ]);
  expect(next.inquiry.methodLinks![0]).toEqual(old);
});
it('revalidates a paused link after explicit resume without changing its attachment snapshot', () => {
  let { q, loop } = setup();
  loop = updateLearningLoop(root, loop.id, {
    action: 'pause-agent',
    version: loop.version,
    attemptIndex: -1,
    reason: 'Review before using again',
  });
  q = link(q, loop);
  const old = q.methodLinks![0];
  q = edit(q, 'plan', {
    frameId: q.frames[0].id,
    methodLinkId: old.id,
    ...plan,
  });
  expect(() =>
    prepareInquiry(root, q.id, {
      requestId: randomUUID(),
      version: q.version,
      kind: 'test',
      planId: q.plans[0].id,
    }),
  ).toThrow();
  loop = updateLearningLoop(root, loop.id, {
    action: 'resume-agent',
    version: loop.version,
    attemptIndex: -1,
    reason: 'Scope reviewed',
  });
  expect(() => link(q, loop)).toThrow();
  const prepared = prepareInquiry(root, q.id, {
    requestId: randomUUID(),
    version: q.version,
    kind: 'test',
    planId: q.plans[0].id,
  });
  expect(prepared.draft.attachedFiles).toEqual([old.asset.path]);
  expect(prepared.inquiry.methodLinks![0]).toEqual(old);
});
