import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStudy, freezeStudy, exportStudyData } from './index.js';
import { issueStudyInvitation, readStudyAccess, useStudyAccess, revokeStudyInvitation } from './access.js';
import { beginStudyCoaching, finishStudyCoaching } from './coaching.js';
let home: string, root: string;
const now = new Date('2026-09-07T08:00:00Z');
const after = (ms: number) => new Date(now.getTime() + ms);
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'study-coaching-')); root = path.join(home, 'mind'); fs.mkdirSync(root); vi.spyOn(os, 'homedir').mockReturnValue(home); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
function setup() {
  const draft = createStudy(root, { requestId: 'coaching', protocol: {
    title: 'Synthetic study', hypothesis: 'PRIVATE HYPOTHESIS', consent: 'QA consent', withdrawal: 'Stop or erase', locale: 'en', capacity: 4, delayDays: 1,
    execution: { adapter: 'isolated-chat-v1', maxTurns: 2 },
    conditions: ['a', 'b'].map(id => ({ id, label: id, instructions: 'CONDITION ' + id,
      expectedRuntime: { provider: 'fixture', model: 'fixture-model', endpoint: 'http://localhost:9876/v1/chat/completions', context: 'CONTEXT ' + id, tools: [] } })),
    tasks: ['baseline', 'coaching', 'transfer', 'delayed'].map(phase => ({ phase, prompt: phase + ' PROMPT', reference: 'SECRET KEY', budgetSeconds: 60 })),
    rubric: [{ id: 'reasoning', label: 'Reasoning', description: 'PRIVATE RUBRIC', maxScore: 3 }],
  } }, now);
  const study = freezeStudy(root, draft.id, { version: draft.version, confirmed: true, reviewedBy: 'owner', reviewNote: 'QA' }, now);
  const invitation = issueStudyInvitation(root, study.id, { requestId: 'one', protocolHash: study.protocolHash, expiresAt: after(86400000).toISOString() }, now);
  const read = (at = now) => { const view = readStudyAccess(root, study.id, invitation.token, at); if (view.kind !== 'participant') throw Error('No participant'); return view.participant; };
  const act = (input: object, at = now) => useStudyAccess(root, study.id, invitation.token, { ...input, version: read(at).version }, at);
  useStudyAccess(root, study.id, invitation.token, { action: 'join', protocolHash: study.protocolHash, consentAccepted: true }, now);
  act({ action: 'open' });
  act({ action: 'answer', answer: 'PRIVATE BASELINE ANSWER', confidence: null, assistance: 'none', familiar: false });
  act({ action: 'open' });
  return { study, invitation, read, act };
}
const success = { status: 'succeeded', output: 'Consider another explanation.', reportedModel: 'fixture-model' };
it('reserves one execution, isolates frozen coaching material, and hides help again during transfer', () => {
  const s = setup(); const command = { requestId: 'help-one', version: s.read().version, question: 'How should I compare explanations?' };
  const run = beginStudyCoaching(root, s.study.id, s.invitation.token, command, now);
  expect(run.execute).toBe(true);
  expect(JSON.stringify(run)).not.toMatch(/SECRET KEY|PRIVATE RUBRIC|transfer PROMPT|PRIVATE BASELINE ANSWER/);
  expect(run.request?.messages.map(m => m.content).join('\n')).toContain('coaching PROMPT');
  expect(beginStudyCoaching(root, s.study.id, s.invitation.token, command, now).execute).toBe(false);
  expect(() => beginStudyCoaching(root, s.study.id, s.invitation.token, { ...command, question: 'Changed' }, now)).toThrow();
  expect(() => s.act({ action: 'answer', answer: 'Premature', confidence: null, assistance: 'agent', familiar: false })).toThrow();
  finishStudyCoaching(root, s.study.id, run.runId, success, now);
  expect(s.read().coaching?.runs[0].output).toBe(success.output);
  s.act({ action: 'answer', answer: 'Revised reasoning', confidence: 50, assistance: 'agent', familiar: false });
  expect(s.read().nextPhase).toBe('transfer');
  expect(JSON.stringify(s.read())).not.toMatch(/explanation|CONTEXT|CONDITION|reportedModel/);
  const receipt = exportStudyData(root, s.study.id).participants[0].coachingRuns?.[0];
  expect(receipt?.status).toBe('succeeded'); expect(receipt?.inputHash).toMatch(/^[a-f0-9]{64}$/);
});
it('rejects identity injection, missing help, overlapping requests and exhausted turn budgets', () => {
  const s = setup();
  expect(() => s.act({ action: 'answer', answer: 'No actual help', confidence: null, assistance: 'none', familiar: false })).toThrow();
  for (const question of ['', ' ', 'x'.repeat(2001), null]) expect(() => beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'one', version: s.read().version, question }, now)).toThrow();
  expect(() => beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'one', version: s.read().version, question: 'Q', participantId: 'other' }, now)).toThrow();
  for (let index = 0; index < 2; index++) {
    const run = beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'run-' + index, version: s.read().version, question: 'Question ' + index }, now);
    expect(() => beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'concurrent', version: s.read().version, question: 'Q' }, now)).toThrow();
    if (index === 1) expect(run.request?.messages.some(m => m.role === 'assistant' && m.content === success.output)).toBe(true);
    finishStudyCoaching(root, s.study.id, run.runId, success, now);
  }
  expect(() => beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'third', version: s.read().version, question: 'Q' }, now)).toThrow();
});
it('records interrupted and failed executions without retrying or accepting late results', () => {
  const s = setup();
  const one = beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'one', version: s.read().version, question: 'Q' }, now);
  expect(s.read(after(120000)).coaching?.runs[0].status).toBe('interrupted');
  const two = beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'two', version: s.read(after(120000)).version, question: 'Retry explicitly' }, after(120000));
  expect(two.execute).toBe(true);
  finishStudyCoaching(root, s.study.id, one.runId, success, after(120000));
  finishStudyCoaching(root, s.study.id, two.runId, { status: 'failed', failure: 'provider' }, after(120000));
  expect(s.read(after(120000)).coaching?.runs.map(r => r.status)).toEqual(['failed', 'failed']);
  expect(JSON.stringify(s.read(after(120000)))).not.toContain(success.output);
  s.act({ action: 'skip', reason: 'skipped' }, after(120000));
  expect(s.read(after(120000)).nextPhase).toBe('transfer');
});
it('never restores late model output after revocation, withdrawal or erasure', () => {
  const s = setup();
  const run = beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'one', version: s.read().version, question: 'PRIVATE QUESTION' }, now);
  s.act({ action: 'withdraw', eraseData: true });
  finishStudyCoaching(root, s.study.id, run.runId, success, now);
  expect(JSON.stringify(exportStudyData(root, s.study.id))).not.toMatch(/PRIVATE QUESTION|Consider another|coachingRuns/);
});
it('discards a result when its invitation was revoked in flight', () => {
  const s = setup();
  const run = beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'one', version: s.read().version, question: 'Q' }, now);
  revokeStudyInvitation(root, s.study.id, { invitationId: s.invitation.id }, now);
  finishStudyCoaching(root, s.study.id, run.runId, success, now);
  const receipt = exportStudyData(root, s.study.id).participants[0].coachingRuns?.[0];
  expect(receipt?.failure).toBe('cancelled'); expect(receipt?.output).toBeUndefined();
});
it('keeps another participant’s conversation out of the next execution', () => {
  const s = setup();
  const first = beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'one', version: s.read().version, question: 'FIRST PRIVATE QUESTION' }, now);
  finishStudyCoaching(root, s.study.id, first.runId, { ...success, output: 'FIRST PRIVATE REPLY' }, now);
  const second = issueStudyInvitation(root, s.study.id, { requestId: 'second', protocolHash: s.study.protocolHash, expiresAt: after(86400000).toISOString() }, now);
  let v = useStudyAccess(root, s.study.id, second.token, { action: 'join', protocolHash: s.study.protocolHash, consentAccepted: true }, now);
  for (const command of [{ action: 'open' }, { action: 'answer', answer: 'SECOND BASELINE', confidence: null, assistance: 'none', familiar: false }, { action: 'open' }]) {
    if (v.kind !== 'participant') throw Error();
    v = useStudyAccess(root, s.study.id, second.token, { ...command, version: v.participant.version }, now);
  }
  if (v.kind !== 'participant') throw Error();
  const run = beginStudyCoaching(root, s.study.id, second.token, { requestId: 'one', version: v.participant.version, question: 'SECOND QUESTION' }, now);
  expect(JSON.stringify(run.request)).not.toMatch(/FIRST PRIVATE|SECOND BASELINE/);
  expect(run.request?.messages.filter(m => m.role === 'assistant')).toEqual([]);
});
it('rejects partial output and freezes execution only with tool-free, explicit safe endpoints', () => {
  const s = setup();
  const run = beginStudyCoaching(root, s.study.id, s.invitation.token, { requestId: 'one', version: s.read().version, question: 'Q' }, now);
  finishStudyCoaching(root, s.study.id, run.runId, { status: 'succeeded', output: ' ' }, now);
  expect(exportStudyData(root, s.study.id).participants[0].coachingRuns?.[0].failure).toBe('invalid-output');
  for (const [index, runtime] of [{ endpoint: 'http://remote.example/v1/chat/completions' }, { endpoint: 'https://user:secret@example.com/v1/chat/completions' }, { endpoint: 'https://example.com/v1/chat/completions?key=secret' }, { endpoint: '' }, { tools: ['read-file'] }].entries()) {
    const protocol = structuredClone(s.study.protocol);
    Object.assign(protocol.conditions[0].expectedRuntime, runtime);
    const draft = createStudy(root, { requestId: 'invalid-' + index, protocol }, now);
    expect(() => freezeStudy(root, draft.id, { version: draft.version, confirmed: true, reviewedBy: 'owner', reviewNote: 'QA' }, now)).toThrow();
  }
});
