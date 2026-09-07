import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  startLearningCorrection,
  updateLearningLoop,
} from '../learning/index.js';
import { writeRetrievalReceipt } from '../../retrieval/receipt.js';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  startAgentRun,
  completeAgentRun,
  failAgentRun,
  resetAgentRunsForTest,
} from '../../agent/ledger/run-ledger.js';
import {
  createMethodCheck,
  getMethodCheck,
  prepareMethodCheck,
  assessMethodCheck,
  captureMethodCheck,
} from './index.js';
let home: string;
let root: string;
let loop: ReturnType<typeof startLearningCorrection>;
const cases = {
  useTask: 'Interpret an uncontrolled observational comparison.',
  useExpected: 'Identify confounding before any causal claim.',
  exceptionTask: 'Interpret a well-randomized controlled experiment.',
  exceptionExpected:
    'Do not reject causal identification just because an association was measured.',
};
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'method-check-'));
  root = path.join(home, 'mind');
  fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  setMindRootResolverForTests(() => root);
  resetAgentRunsForTest();
  loop = startLearningCorrection(
    root,
    {
      cardId: 'method-check',
      title: 'Evidence',
      content: 'Check the design',
      sessions: [
        {
          id: 'source',
          messageRefs: [
            {
              messageIndex: 0,
              role: 'assistant',
              quote: 'A comparison proves causation.',
            },
          ],
        },
      ],
    },
    {
      behavior: 'Inspect the design',
      scope: 'Research conclusions and their limits',
      check: 'Explain what the design identifies',
    },
  );
  loop = updateLearningLoop(root, loop.id, {
    action: 'approve-agent',
    attemptIndex: -1,
    version: loop.version,
  });
});
afterEach(() => {
  resetAgentRunsForTest();
  setMindRootResolverForTests(null);
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
const create = () =>
  createMethodCheck(root, {
    learningId: loop.id,
    attemptIndex: -1,
    revisionIndex: 0,
    version: loop.version,
    locale: 'en',
    ...cases,
  });
function run(
  prepared: ReturnType<typeof prepareMethodCheck>,
  options: {
    query?: string;
    hash?: string;
    failed?: boolean;
    noReceipt?: boolean;
  } = {},
) {
  const id = 'receipt-' + Math.random().toString(36).slice(2);
  const now = new Date().toISOString();
  const method = prepared.check.method;
  writeRetrievalReceipt(root, {
    id,
    query: options.query ?? prepared.draft.prompt,
    strategy: 'explicit-approved-method-context-v1',
    outcome: 'selected',
    startedAt: now,
    completedAt: now,
    budget: { maxTokens: 1000, maxFiles: 1, minScore: 0, timeoutMs: 0 },
    scope: { preferredPaths: [method.path], excludePaths: [] },
    candidates: [],
    selections: [
      {
        assetId: method.assetId,
        path: method.path,
        contentHash: options.hash ?? method.contentHash,
        sourceContentHash: method.contentHash,
        assetVersion: prepared.draft.assetVersion,
        truncated: false,
        estimatedTokens: 100,
        score: 1,
        reason: 'Attached method',
      },
    ],
    totals: { candidateCount: 1, selectedCount: 1, usedTokens: 100 },
  });
  const record = startAgentRun({
    runtimeId: 'test-runtime',
    displayName: 'Explicit test fixture',
    agentKind: 'native-runtime',
    permissionMode: 'read',
    inputSummary: prepared.draft.prompt,
    metadata: options.noReceipt
      ? {}
      : { retrievalReceiptIds: [id], model: 'fixture-model' },
  });
  if (options.failed)
    failAgentRun(record.id, { error: new Error('Provider unavailable') });
  else
    completeAgentRun(record.id, {
      outputSummary:
        'The comparison may be confounded. Stronger identification is needed.',
    });
  return record.id;
}
it('freezes an approved method and two distinct cases without leaking assessment criteria into the prepared task', () => {
  const check = create();
  expect(create().id).toBe(check.id);
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'use',
  });
  expect(prepared.draft.prompt).toContain(cases.useTask);
  expect(prepared.draft.prompt).not.toContain(cases.useExpected);
  expect(prepared.draft.prompt).not.toContain(cases.exceptionTask);
  expect(
    prepareMethodCheck(root, check.id, {
      version: prepared.check.version,
      kind: 'use',
    }).check.preparations,
  ).toHaveLength(1);
  expect(prepared.check.cases[0].expected).toBe(cases.useExpected);
  expect(getMethodCheck(root, check.id)?.check.method.contentHash).toBe(
    check.method.contentHash,
  );
  expect(fs.readdirSync(root)).toEqual(['.mindos', 'Echo']);
  const base = path.join(home, '.mindos', 'private-learning');
  expect(
    fs.existsSync(path.join(base, fs.readdirSync(base)[0], check.id + '.json')),
  ).toBe(true);
  for (const name of fs.readdirSync(root, { recursive: true }) as string[]) {
    const file = path.join(root, name);
    if (fs.statSync(file).isFile())
      expect(fs.readFileSync(file, 'utf8')).not.toContain(
        cases.exceptionExpected,
      );
  }
});
it('accepts an assessment only for a completed run with matching input and exact approved context, and retains its output snapshot', () => {
  const check = create();
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'use',
  });
  const runId = run(prepared);
  const loaded = getMethodCheck(root, check.id)!;
  expect(loaded.runs.map((item) => item.runId)).toContain(runId);
  expect(() =>
    assessMethodCheck(root, check.id, {
      version: prepared.check.version,
      runId,
      kind: 'use',
      outcome: 'met',
      quote: 'made-up quote',
      reason: 'No',
    }),
  ).toThrow();
  const saved = assessMethodCheck(root, check.id, {
    version: prepared.check.version,
    runId,
    kind: 'use',
    outcome: 'met',
    quote: 'may be confounded',
    reason: 'It identified the uncontrolled comparison.',
  });
  expect(saved.assessments[0].output).toContain('confounded');
  expect(saved.assessments[0].runtimeId).toBe('test-runtime');
  expect(() =>
    assessMethodCheck(root, check.id, {
      version: saved.version,
      runId,
      kind: 'use',
      outcome: 'met',
      quote: 'made-up quote',
      reason: 'No',
    }),
  ).toThrow();
});
it('excludes edited tasks, wrong fingerprints and runs that never carried the receipt; failed runs remain visible but cannot pass', () => {
  const check = create();
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'use',
  });
  run(prepared, { query: 'Different task' });
  run(prepared, { hash: '0'.repeat(64) });
  run(prepared, { noReceipt: true });
  const failed = run(prepared, { failed: true });
  const loaded = getMethodCheck(root, check.id)!;
  expect(loaded.runs.map((item) => item.runId)).toEqual([failed]);
  expect(() =>
    assessMethodCheck(root, check.id, {
      version: prepared.check.version,
      runId: failed,
      kind: 'use',
      outcome: 'met',
      quote: 'Provider',
      reason: 'Failed',
    }),
  ).toThrow();
});
it('refuses stale, unapproved, duplicate-case and malformed inputs, while keeping frozen checks readable after pause', () => {
  const check = create();
  expect(() =>
    prepareMethodCheck(root, check.id, { version: 0, kind: 'use' }),
  ).toThrow();
  expect(() =>
    createMethodCheck(root, {
      learningId: loop.id,
      attemptIndex: -1,
      revisionIndex: 0,
      version: loop.version,
      locale: 'en',
      ...cases,
      exceptionTask: cases.useTask,
    }),
  ).toThrow();
  loop = updateLearningLoop(root, loop.id, {
    version: loop.version,
    attemptIndex: -1,
    action: 'pause-agent',
    reason: 'Inspect a counterexample',
  });
  expect(() =>
    prepareMethodCheck(root, check.id, { version: check.version, kind: 'use' }),
  ).toThrow();
  expect(getMethodCheck(root, check.id)?.check.cases).toHaveLength(2);
  expect(() => getMethodCheck(root, '../escape')).toThrow();
});
it('preserves the last version if private record publication fails', () => {
  const check = create();
  vi.spyOn(fs, 'renameSync').mockImplementation(() => {
    throw new Error('Disk full');
  });
  expect(() =>
    prepareMethodCheck(root, check.id, { version: check.version, kind: 'use' }),
  ).toThrow();
  expect(getMethodCheck(root, check.id)?.check.version).toBe(check.version);
});

it('retains captured failures after the live run index is unavailable without turning them into successful assessments', () => {
  const check = create();
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'exception',
  });
  const runId = run(prepared, { failed: true });
  const captured = captureMethodCheck(root, check.id, {
    version: prepared.check.version,
  });
  expect(captured.capturedRuns[0].status).toBe('failed');
  resetAgentRunsForTest();
  const loaded = getMethodCheck(root, check.id)!;
  expect(loaded.runs[0].runId).toBe(runId);
  expect(loaded.runs[0].source).toBe('saved');
  expect(() =>
    assessMethodCheck(root, check.id, {
      version: captured.version,
      runId,
      kind: 'exception',
      outcome: 'met',
      quote: 'Unavailable',
      reason: 'No output',
    }),
  ).toThrow();
});

it('revises a judgment by appending a linked assessment without replacing its earlier evidence', () => {
  const check = create();
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'use',
  });
  const runId = run(prepared);
  const input = {
    runId,
    kind: 'use',
    outcome: 'met',
    quote: 'may be confounded',
    reason: 'It identifies confounding.',
  };
  const first = assessMethodCheck(root, check.id, {
    ...input,
    version: prepared.check.version,
  });
  expect(() =>
    assessMethodCheck(root, check.id, { ...input, version: first.version }),
  ).toThrow();
  const revised = assessMethodCheck(root, check.id, {
    ...input,
    version: first.version,
    outcome: 'uncertain',
    reason: 'Identification is still underspecified.',
  });
  expect(revised.assessments).toHaveLength(2);
  expect(revised.assessments[0].outcome).toBe('met');
  expect(revised.assessments[1].supersedes).toBe(0);
});

it('does not reuse a run from another frozen check with a different criterion', () => {
  const first = create();
  const prepared = prepareMethodCheck(root, first.id, {
    version: first.version,
    kind: 'use',
  });
  const second = createMethodCheck(root, {
    learningId: loop.id,
    attemptIndex: -1,
    revisionIndex: 0,
    version: loop.version,
    locale: 'en',
    ...cases,
    useExpected: 'Identify both confounding and the sampling limitations.',
  });
  prepareMethodCheck(root, second.id, { version: second.version, kind: 'use' });
  run(prepared);
  expect(getMethodCheck(root, first.id)?.runs).toHaveLength(1);
  expect(getMethodCheck(root, second.id)?.runs).toHaveLength(0);
});

it('reports null records and altered assessment evidence as damaged instead of missing or trustworthy', () => {
  const check = create();
  const prepared = prepareMethodCheck(root, check.id, {
    version: check.version,
    kind: 'use',
  });
  const runId = run(prepared);
  const saved = assessMethodCheck(root, check.id, {
    version: prepared.check.version,
    runId,
    kind: 'use',
    outcome: 'met',
    quote: 'may be confounded',
    reason: 'Explains a limitation.',
  });
  const base = path.join(home, '.mindos', 'private-learning');
  const file = path.join(base, fs.readdirSync(base)[0], check.id + '.json');
  saved.assessments[0].output = 'Unrelated edited output';
  fs.writeFileSync(file, JSON.stringify(saved));
  expect(() => getMethodCheck(root, check.id)).toThrow();
  fs.writeFileSync(file, 'null');
  expect(() => getMethodCheck(root, check.id)).toThrow();
});
