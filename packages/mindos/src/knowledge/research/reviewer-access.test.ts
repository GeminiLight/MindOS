import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createStudy, freezeStudy, enrollStudy, updateStudyParticipant, exportStudyData, rateStudyAnswer } from './index.js';
import { issueStudyInvitation } from './access.js';
import { issueStudyReviewer, listStudyReviewers, revokeStudyReviewer, readStudyReviewer, useStudyReviewer } from './reviewer-access.js';
let home: string, root: string;
const now = new Date('2026-09-07T10:00:00Z'); const later = new Date('2026-09-08T10:00:00Z');
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'study-reviewer-')); root = path.join(home, 'mind'); fs.mkdirSync(root); vi.spyOn(os, 'homedir').mockReturnValue(home); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
function setup() {
  const draft = createStudy(root, { requestId: 'reviewer-study', protocol: { title: 'PRIVATE TITLE', hypothesis: 'PRIVATE HYPOTHESIS', consent: 'Consent', withdrawal: 'Stop', locale: 'en', capacity: 4, delayDays: 1,
    conditions: ['a', 'b'].map(id => ({ id, label: 'PRIVATE LABEL', instructions: 'PRIVATE CONDITION', expectedRuntime: { provider: 'PRIVATE PROVIDER', model: 'PRIVATE MODEL', tools: [], context: 'PRIVATE CONTEXT' } })),
    tasks: ['baseline', 'coaching', 'transfer', 'delayed'].map(phase => ({ phase, prompt: 'Public task ' + phase, reference: 'Scoring reference ' + phase, budgetSeconds: 60 })), rubric: [{ id: 'reason', label: 'Reasoning', description: 'Use an alternative explanation', maxScore: 3 }],
  } }, now);
  const study = freezeStudy(root, draft.id, { version: draft.version, confirmed: true, reviewedBy: 'owner', reviewNote: 'PRIVATE REVIEW' }, now);
  let participant = enrollStudy(root, study.id, { enrollmentKey: 'one', protocolHash: study.protocolHash, consentAccepted: true }, now);
  const act = (input: object) => participant = updateStudyParticipant(root, study.id, participant.id, { ...input, version: participant.version }, now);
  const answer = () => { act({ action: 'open' }); act({ action: 'answer', answer: 'Synthetic reasoning', confidence: 70, assistance: 'none', familiar: false }); };
  answer(); return { study, act, answer };
}
function invite(s: ReturnType<typeof setup>, requestId = 'one', label = 'PRIVATE OWNER NOTE') { return issueStudyReviewer(root, s.study.id, { requestId, label, protocolHash: s.study.protocolHash, expiresAt: later.toISOString() }, now); }
function accept(s: ReturnType<typeof setup>, token: string) { return useStudyReviewer(root, s.study.id, token, { action: 'accept', protocolHash: s.study.protocolHash, accepted: true }, now); }
it('issues one fixed work packet, requires acknowledgement and never reveals identities or future work', () => {
  const s = setup(); const g = invite(s); expect(invite(s)).toEqual(g);
  expect(JSON.stringify(readStudyReviewer(root, s.study.id, g.token, now))).not.toMatch(/Synthetic reasoning|Scoring reference|PRIVATE|rubric|participants|condition/);
  const view = accept(s, g.token); expect(view.kind).toBe('workspace'); if (view.kind !== 'workspace') throw Error();
  expect(view.items).toHaveLength(1); expect(view.items[0].reference).toContain('Scoring reference');
  expect(JSON.stringify(view)).not.toMatch(/PRIVATE|participant-|conditionId|phase|allocation|enrolledAt/);
  s.answer(); expect((accept(s, g.token) as typeof view).items).toHaveLength(1);
  const updated = issueStudyReviewer(root, s.study.id, { requestId: 'updated', reviewerId: g.reviewerId, label: 'PRIVATE OWNER NOTE', protocolHash: s.study.protocolHash, expiresAt: later.toISOString() }, now);
  const next = accept(s, updated.token); expect(next.kind === 'workspace' && next.items.length).toBe(2);
  expect(listStudyReviewers(root, s.study.id, now)).toHaveLength(2); expect(JSON.stringify(listStudyReviewers(root, s.study.id, now))).not.toContain(g.token);
  const p = issueStudyInvitation(root, s.study.id, { requestId: 'participant', protocolHash: s.study.protocolHash, expiresAt: later.toISOString() }, now);
  expect(() => readStudyReviewer(root, s.study.id, p.token, now)).toThrow();
});
it('saves and revises only one reviewer’s assessments, with idempotent submission recovery', () => {
  const s = setup(); const g = invite(s); const view = accept(s, g.token); if (view.kind !== 'workspace') throw Error();
  const itemId = view.items[0].id;
  rateStudyAnswer(root, s.study.id, { itemId, reviewerId: 'another-reviewer', version: 0, scores: { reason: 1 }, rationale: 'PRIVATE OTHER ASSESSMENT' }, now);
  const command = { action: 'rate', requestId: 'rating-one', itemId, version: 0, scores: { reason: 2 }, rationale: 'Explains a plausible alternative.' };
  const first = useStudyReviewer(root, s.study.id, g.token, command, now); expect(first.kind).toBe('workspace');
  expect(useStudyReviewer(root, s.study.id, g.token, command, now)).toEqual(first);
  expect(JSON.stringify(first)).not.toMatch(/PRIVATE OTHER|another-reviewer|requestHash/);
  expect(() => useStudyReviewer(root, s.study.id, g.token, { ...command, rationale: 'Changed content' }, now)).toThrow();
  expect(() => useStudyReviewer(root, s.study.id, g.token, { ...command, requestId: 'stale' }, now)).toThrow();
  const second = useStudyReviewer(root, s.study.id, g.token, { ...command, requestId: 'revision', version: 1, scores: { reason: 3 } }, now);
  expect(second.kind === 'workspace' && second.assessments.map(a => a.version)).toEqual([1, 2]);
  expect(exportStudyData(root, s.study.id).ratings).toHaveLength(3);
});
it('denies malformed, expired or revoked credentials and refuses erased or unauthorized work', () => {
  const s = setup(); const g = invite(s); const view = accept(s, g.token); if (view.kind !== 'workspace') throw Error();
  const command = { action: 'rate', requestId: 'one', itemId: view.items[0].id, version: 0, scores: { reason: 2 }, rationale: 'Assessment' };
  for (const patch of [{ scores: {} }, { scores: { reason: -1 } }, { scores: { reason: 4 } }, { scores: { reason: NaN } }, { rationale: ' ' }, { rationale: 'x'.repeat(4001) }, { reviewerId: 'another' }, { itemId: 'work-' + 'f'.repeat(24) }]) expect(() => useStudyReviewer(root, s.study.id, g.token, { ...command, ...patch }, now)).toThrow();
  expect(() => readStudyReviewer(root, s.study.id, g.token, later)).toThrow();
  for (const token of [null, '', {}, 'x'.repeat(43)]) expect(() => readStudyReviewer(root, s.study.id, token, now)).toThrow();
  s.act({ action: 'withdraw', eraseData: true });
  expect((accept(s, g.token) as typeof view).items).toEqual([]);
  expect(() => useStudyReviewer(root, s.study.id, g.token, command, now)).toThrow();
  revokeStudyReviewer(root, s.study.id, { invitationId: g.id }, now);
  expect(() => useStudyReviewer(root, s.study.id, g.token, { action: 'accept', protocolHash: s.study.protocolHash, accepted: true }, now)).toThrow();
});
