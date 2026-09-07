import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { startLearningCorrection, updateLearningLoop, getLearningLoop } from '../learning/index.js';
import { createMethodComparison, getMethodComparison, beginMethodComparisonRun, finishMethodComparisonRun, assessMethodComparison } from './index.js';
import { readPrivateRecord, writePrivateRecord } from '../private-records.js';
let home: string, root: string;
let loop: ReturnType<typeof startLearningCorrection>;
const runtime = { adapter: 'isolated-chat-v1', provider: 'ollama', model: 'qa', endpoint: 'http://localhost:9999/v1/chat/completions', temperature: 0, maxOutputTokens: 1024, tools: [] };
const cases = [
  { kind: 'use', task: 'Observational comparison', expected: 'Private confounding criterion' },
  { kind: 'exception', task: 'Randomized experiment', expected: 'Private exception criterion' },
  { kind: 'retention', task: 'Report uncertainty', expected: 'Private retention criterion' },
];
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'comparison-')); root = path.join(home, 'mind'); fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  loop = startLearningCorrection(root, { cardId: 'compare', title: 'Evidence', content: 'Design', sessions: [{ id: 'source', messageRefs: [{ messageIndex: 0, role: 'assistant', quote: 'All associations are causal.' }] }] }, { behavior: 'Old method', scope: 'Research', check: 'Inspect design' });
  const change = (command: Record<string, unknown>) => { loop = updateLearningLoop(root, loop.id, { version: loop.version, attemptIndex: -1, ...command }); };
  change({ action: 'approve-agent' });
  change({ action: 'revise-agent', revisionIndex: 0, reason: 'Clarify exceptions', behavior: 'New method', scope: 'Research', check: 'Inspect randomization' });
  change({ action: 'pause-agent', revisionIndex: 0, reason: 'Replaced' });
  change({ action: 'approve-agent', revisionIndex: 1 });
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
const input = () => ({ learningId: loop.id, version: loop.version, attemptIndex: -1, revisions: [0, 1], requestId: 'freeze-1', repetitions: 2, cases, runtime });
const create = () => createMethodComparison(root, input());
it('freezes both approved versions with paired tasks and a stable order without reactivating the old method', () => {
  const before = getLearningLoop(root, loop.id); const c = create();
  expect(c.slots).toHaveLength(12); expect(c.methods.map(m => m.revisionIndex)).toEqual([0, 1]);
  expect(c.methods[0].body).toContain('Old method'); expect(c.methods[1].body).toContain('New method');
  for (let i = 0; i < 12; i += 2) { expect(new Set(c.slots.slice(i, i + 2).map(s => s.side)).size).toBe(2); expect(c.slots[i].kind).toBe(c.slots[i + 1].kind); }
  expect(create()).toEqual(c); expect(getMethodComparison(root, c.id)).toEqual(c); expect(getLearningLoop(root, loop.id)).toEqual(before);
  expect(() => createMethodComparison(root, { ...input(), repetitions: 1 })).toThrow();
});
it('records the exact isolated request and recovers the same reservation without a second execution', () => {
  const c = create(); const command = { version: c.version, slot: 0, requestId: 'run-1' };
  const run = beginMethodComparisonRun(root, c.id, command);
  expect(run.execute).toBe(true);
  const contents = JSON.stringify(run.request);
  expect(contents).not.toContain('Private'); expect(contents).not.toContain('source');
  expect(contents).toContain(c.cases.find(item => item.kind === c.slots[0].kind)!.task);
  expect(contents).not.toContain(c.methods[1 - c.slots[0].side].behavior);
  expect(beginMethodComparisonRun(root, c.id, command).execute).toBe(false);
  expect(() => beginMethodComparisonRun(root, c.id, { version: run.record.version, slot: 1, requestId: 'concurrent' })).toThrow();
  const done = finishMethodComparisonRun(root, c.id, run.runId, { status: 'succeeded', output: 'Inspect the design.', reportedModel: 'qa' });
  expect(done.runs[0].request).toEqual(run.request); expect(done.runs[0].status).toBe('succeeded');
  expect(beginMethodComparisonRun(root, c.id, command).execute).toBe(false);
});
it('retains interrupted reservations and failures while allowing explicit bounded retries', () => {
  const now = new Date(); const c = create();
  const r = beginMethodComparisonRun(root, c.id, { version: c.version, slot: 0, requestId: 'first' }, now);
  const expired = getMethodComparison(root, c.id, new Date(now.getTime() + 121000))!;
  expect(expired.runs[0].status).toBe('unknown');
  const again = beginMethodComparisonRun(root, c.id, { version: expired.version, slot: 0, requestId: 'explicit-retry' }, new Date(now.getTime() + 122000));
  const failed = finishMethodComparisonRun(root, c.id, again.runId, { status: 'failed', failure: 'provider' }, new Date(now.getTime() + 123000));
  expect(failed.runs.map(x => x.status)).toEqual(['unknown', 'failed']);
  expect(() => beginMethodComparisonRun(root, c.id, { version: failed.version, slot: 0, requestId: 'third' }, new Date(now.getTime() + 124000))).toThrow();
  expect(() => finishMethodComparisonRun(root, c.id, r.runId, { status: 'succeeded', output: 'Late', reportedModel: 'qa' })).toThrow();
});
it('requires successful quoted evidence and appends corrections instead of overwriting a judgment', () => {
  const c = create(); const r = beginMethodComparisonRun(root, c.id, { version: c.version, slot: 0, requestId: 'score' });
  let done = finishMethodComparisonRun(root, c.id, r.runId, { status: 'succeeded', output: 'Design is uncertain.', reportedModel: 'qa' });
  const score = { version: done.version, runId: r.runId, requestId: 'rating-1', outcome: 'uncertain', quote: 'uncertain', reason: 'Need evidence' };
  expect(() => assessMethodComparison(root, c.id, { ...score, quote: 'Fabricated' })).toThrow();
  done = assessMethodComparison(root, c.id, score);
  expect(assessMethodComparison(root, c.id, score)).toEqual(done);
  done = assessMethodComparison(root, c.id, { ...score, version: done.version, requestId: 'rating-2', outcome: 'met', reason: 'Rechecked criterion' });
  expect(done.assessments).toHaveLength(2); expect(done.assessments[1].supersedes).toBe(0);
});
it('rejects same versions, duplicated tasks, invalid limits and credential-bearing endpoints', () => {
  for (const patch of [{ revisions: [0, 0] }, { repetitions: 0 }, { repetitions: 4 }, { cases: [cases[0], cases[0], cases[2]] }, { runtime: { ...runtime, endpoint: 'https://secret@example.com/chat/completions' } }])
    expect(() => createMethodComparison(root, { ...input(), ...patch })).toThrow();
  expect(() => getMethodComparison(root, '../secret')).toThrow();
  expect(getMethodComparison(root, 'comparison-' + '0'.repeat(24))).toBeNull();
});
it('rejects changed source bytes and retains frozen records after the source becomes unavailable', () => {
  const c = create();
  const file = path.join(root, c.methods[0].path); fs.appendFileSync(file, '\nChanged outside approval.');
  expect(() => createMethodComparison(root, { ...input(), requestId: 'changed-file' })).toThrow();
  expect(getMethodComparison(root, c.id)).toEqual(c);
  const r = beginMethodComparisonRun(root, c.id, { version: c.version, slot: 0, requestId: 'frozen-only' });
  expect(JSON.stringify(r.request)).not.toContain('Changed outside approval');
});
it('preserves Unicode exactly and detects modified persisted requests or outputs', () => {
  const c = createMethodComparison(root, { ...input(), cases: cases.map(item => ({ ...item, task: item.task + ' 比较🧪' })) });
  const r = beginMethodComparisonRun(root, c.id, { version: c.version, slot: 0, requestId: 'unicode' });
  const finished = finishMethodComparisonRun(root, c.id, r.runId, { status: 'succeeded', output: '证据🧪', responseId: 'provider-42' });
  expect(getMethodComparison(root, c.id)?.runs[0].responseId).toBe('provider-42');
  const raw = readPrivateRecord(root, c.id + '.json', 3000000) as typeof finished;
  raw.runs[0].output = 'tampered'; writePrivateRecord(root, c.id + '.json', raw);
  expect(() => getMethodComparison(root, c.id)).toThrow();
  raw.runs[0].output = '证据🧪'; raw.runs[0].request.messages[0].content += 'extra context'; writePrivateRecord(root, c.id + '.json', raw);
  expect(() => getMethodComparison(root, c.id)).toThrow();
});
