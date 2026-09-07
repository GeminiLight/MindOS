import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createStudy, getStudy, updateStudyDraft, freezeStudy, enrollStudy,
  getStudyParticipant, updateStudyParticipant, exportStudyForReview,
  rateStudyAnswer, getStudyReviewerWorkspace, exportStudyData,
  listStudies, getStudyReadiness,
} from './index.js';

let home: string; let root: string;
const now = new Date('2026-09-07T08:00:00Z');
const protocol = () => ({
  title: 'Synthetic protocol', hypothesis: 'A revisable method supports independent transfer.',
  consent: 'Synthetic QA only. Participation is optional.',
  withdrawal: 'Stop at any time. Delete answers or retain them; minimal withdrawal counts remain.',
  locale: 'en', delayDays: 7, capacity: 8,
  conditions: ['baseline', 'revised'].map(id => ({ id, label: id, instructions: id + ' coaching instruction',
    expectedRuntime: { provider: 'provider-fixture', model: 'model-fixture', tools: ['read'], context: 'Frozen QA context ' + id } })),
  tasks: ['baseline', 'coaching', 'transfer', 'delayed'].map(phase => ({
    phase, prompt: phase + ' PRIVATE PROMPT', reference: phase + ' SECRET KEY', budgetSeconds: 60,
  })),
  rubric: [{ id: 'evidence', label: 'Evidence', description: 'Distinguish evidence from assumptions.', maxScore: 3 }],
});
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'research-')); root = path.join(home, 'mind'); fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
function frozen() {
  const draft = createStudy(root, { requestId: 'qa-create', protocol: protocol() }, now);
  return freezeStudy(root, draft.id, { version: draft.version, confirmed: true, reviewedBy: 'reviewer-a', reviewNote: 'Reviewed synthetic materials for this flow test.' }, now);
}
function enroll(study: ReturnType<typeof frozen>, key = 'participant-one') {
  return enrollStudy(root, study.id, { enrollmentKey: key, protocolHash: study.protocolHash, consentAccepted: true }, now);
}
const answer = { action: 'answer', answer: 'Synthetic answer: check alternative explanations.', confidence: 50, assistance: 'none', familiar: false };
function change(studyId: string, view: ReturnType<typeof enroll>, command: Record<string, unknown>, time = now) {
  return updateStudyParticipant(root, studyId, view.id, { version: view.version, ...command }, time);
}
it('keeps creation idempotent and freezes exactly the reviewed protocol against stale edits', () => {
  const input = { requestId: 'qa-create', protocol: protocol() };
  const draft = createStudy(root, input, now);
  expect(createStudy(root, input, now).id).toBe(draft.id);
  expect(() => createStudy(root, { ...input, protocol: { ...protocol(), title: 'Different' } }, now)).toThrow();
  expect(() => enroll(draft as ReturnType<typeof frozen>)).toThrow();
  const updated = updateStudyDraft(root, draft.id, { version: 1, protocol: { ...protocol(), title: 'Reviewed title' } }, now);
  expect(() => freezeStudy(root, draft.id, { version: 1, confirmed: true, reviewedBy: 'reviewer-a', reviewNote: 'checked' }, now)).toThrow();
  const study = freezeStudy(root, draft.id, { version: updated.version, confirmed: true, reviewedBy: 'reviewer-a', reviewNote: 'checked' }, now);
  expect(study.protocol.title).toBe('Reviewed title'); expect(study.protocolHash).toMatch(/^[a-f0-9]{64}$/);
  expect(() => updateStudyDraft(root, study.id, { version: study.version, protocol: protocol() }, now)).toThrow();
  expect(getStudy(root, study.id)?.protocolHash).toBe(study.protocolHash);
});
it('persists balanced assignments, counts retries once, and requires consent to the frozen version', () => {
  const study = frozen(); const first = enroll(study);
  expect(enroll(study).id).toBe(first.id);
  for (const input of [
    { enrollmentKey: 'other', protocolHash: study.protocolHash, consentAccepted: false },
    { enrollmentKey: 'other', protocolHash: '0'.repeat(64), consentAccepted: true },
  ]) expect(() => enrollStudy(root, study.id, input, now)).toThrow();
  for (let i = 1; i < 8; i++) enroll(study, 'participant-' + i);
  const data = exportStudyData(root, study.id);
  expect(data.participants).toHaveLength(8);
  for (let i = 0; i < 8; i += 2) expect(data.participants.slice(i, i + 2).map(p => p.conditionId).sort()).toEqual(['baseline', 'revised']);
  expect(() => enroll(study, 'over-capacity')).toThrow();
  expect(enroll(study).id).toBe(first.id);
  expect(JSON.stringify(data)).not.toContain('participant-one');
  expect(JSON.stringify(first)).not.toMatch(/PRIVATE PROMPT|SECRET KEY|instructions|model-fixture|conditionId|allocation/);
});
it('opens only the current task, locks answers, and releases delayed material at the exact boundary', () => {
  const study = frozen(); let view = enroll(study);
  expect(() => change(study.id, view, answer)).toThrow();
  for (let i = 0; i < 3; i++) {
    view = change(study.id, view, { action: 'open' });
    expect(view.task?.prompt).toBe(['baseline', 'coaching', 'transfer'][i] + ' PRIVATE PROMPT');
    expect(JSON.stringify(view)).not.toMatch(/SECRET KEY|delayed PRIVATE PROMPT/);
    expect(!!view.instructions).toBe(i === 1);
    const before = view; view = change(study.id, view, answer);
    expect(() => change(study.id, before, answer)).toThrow();
    expect(view.task).toBeUndefined(); expect(view.instructions).toBeUndefined();
  }
  expect(view.status).toBe('waiting'); expect(view.dueAt).toBe('2026-09-14T08:00:00.000Z');
  expect(() => change(study.id, view, { action: 'open' }, new Date(Date.parse(view.dueAt!) - 1))).toThrow();
  view = change(study.id, view, { action: 'open' }, new Date(view.dueAt!));
  const later = new Date(Date.parse(view.dueAt!) + 61_000);
  view = change(study.id, view, answer, later);
  expect(view.status).toBe('complete'); expect(view.task).toBeUndefined();
  const data = exportStudyData(root, study.id);
  expect(data.participants[0].responses).toHaveLength(4);
  expect(data.participants[0].responses[3].overBudget).toBe(true);
  expect(() => change(study.id, view, answer, later)).toThrow();
});
it('produces separate review packets and retains independent rating revisions with strict rubric scores', () => {
  const study = frozen(); let view = enroll(study);
  view = change(study.id, view, { action: 'open' }); view = change(study.id, view, answer);
  const packet = exportStudyForReview(root, study.id);
  expect(packet.items).toHaveLength(1);
  expect(packet.items[0].answer).toBe(answer.answer);
  expect(JSON.stringify(packet)).not.toMatch(/participant-one|conditionId|coaching instruction|model-fixture|submittedAt|phase|confidence/);
  expect(JSON.stringify(packet)).not.toContain(view.id);
  const input = { itemId: packet.items[0].id, reviewerId: 'rater-one', version: 0, scores: { evidence: 2 }, rationale: 'Supported, but incomplete.' };
  for (const scores of [{}, { evidence: 4 }, { evidence: -1 }, { evidence: NaN }, { evidence: 1, extra: 0 }])
    expect(() => rateStudyAnswer(root, study.id, { ...input, scores }, now)).toThrow();
  rateStudyAnswer(root, study.id, input, now);
  expect(() => rateStudyAnswer(root, study.id, input, now)).toThrow();
  rateStudyAnswer(root, study.id, { ...input, version: 1, scores: { evidence: 3 }, rationale: 'Rechecked the evidence.' }, now);
  rateStudyAnswer(root, study.id, { ...input, reviewerId: 'rater-two', scores: { evidence: 1 } }, now);
  expect(exportStudyData(root, study.id).ratings).toHaveLength(3);
  expect(exportStudyForReview(root, study.id)).toEqual(packet);
});
it('records missingness and withdrawal without assigning zero scores, and erases retained answer content on request', () => {
  const study = frozen(); let view = enroll(study);
  view = change(study.id, view, { action: 'open' });
  expect(() => change(study.id, view, { action: 'skip', reason: 'timeout' })).toThrow();
  view = change(study.id, view, { action: 'skip', reason: 'timeout' }, new Date(now.getTime() + 60_000));
  view = change(study.id, view, { action: 'open' }, new Date(now.getTime() + 60_000));
  view = change(study.id, view, answer, new Date(now.getTime() + 60_000));
  const packet = exportStudyForReview(root, study.id);
  rateStudyAnswer(root, study.id, { itemId: packet.items[0].id, reviewerId: 'rater', version: 0, scores: { evidence: 1 }, rationale: 'Synthetic rating.' }, new Date(now.getTime() + 60_000));
  view = change(study.id, view, { action: 'withdraw', eraseData: false }, new Date(now.getTime() + 60_000));
  expect(view.status).toBe('withdrawn'); expect(() => change(study.id, view, { action: 'open' })).toThrow();
  expect(exportStudyData(root, study.id).participants[0].responses[0].outcome).toBe('timeout');
  view = change(study.id, view, { action: 'withdraw', eraseData: true }, new Date(now.getTime() + 60_000));
  const data = exportStudyData(root, study.id);
  expect(data.participants[0].responses).toEqual([]); expect(data.participants[0].erasedAt).toBeTruthy();
  expect(data.ratings).toEqual([]); expect(exportStudyForReview(root, study.id).items).toEqual([]);
  expect(JSON.stringify(data)).not.toContain(answer.answer);
  expect(enrollStudy(root, study.id, { enrollmentKey: 'participant-one', protocolHash: study.protocolHash, consentAccepted: true }, new Date(now.getTime() + 60_000)).id).not.toBe(view.id);
});
it('rejects malformed materials and commands and preserves records across clock reversal and failed writes', () => {
  for (const patch of [{ title: 'x'.repeat(201) }, { tasks: [] }, { conditions: [protocol().conditions[0], protocol().conditions[0]] }, { rubric: [] }, { capacity: 0 }])
    expect(() => createStudy(root, { requestId: 'bad', protocol: { ...protocol(), ...patch } }, now)).toThrow();
  const study = frozen(); const initial = enroll(study);
  expect(() => getStudy(root, '../escape')).toThrow();
  expect(() => change(study.id, initial, { action: 'open' }, new Date(now.getTime() - 1))).toThrow();
  let view = change(study.id, initial, { action: 'open' });
  for (const patch of [{ answer: ' ' }, { answer: '字'.repeat(4001) }, { confidence: Infinity }, { assistance: null }])
    expect(() => change(study.id, view, { ...answer, ...patch })).toThrow();
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Disk full'); });
  expect(() => change(study.id, view, answer)).toThrow(); rename.mockRestore();
  expect(getStudyParticipant(root, study.id, view.id, now)?.version).toBe(view.version);
  view = change(study.id, view, { ...answer, answer: '边界 🧪' });
  expect(view.nextPhase).toBe('coaching');
  expect(fs.readdirSync(root)).toEqual([]);
});
it('refuses changed frozen material and inconsistent allocation instead of projecting private tasks', () => {
  const study = frozen(); const participant = enroll(study);
  const base = path.join(home, '.mindos', 'private-learning');
  const file = path.join(base, fs.readdirSync(base)[0], study.id + '.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...record, protocol: { ...record.protocol, title: 'Tampered' } }));
  expect(() => getStudyParticipant(root, study.id, participant.id, now)).toThrow();
  record.participants[0].conditionId = 'unknown'; fs.writeFileSync(file, JSON.stringify(record));
  expect(() => getStudy(root, study.id)).toThrow();
});

it('keeps each reviewer able to resume their own ratings without revealing another reviewer’s work', () => {
  const study = frozen(); let view = enroll(study);
  view = change(study.id, view, { action: 'open' }); change(study.id, view, answer);
  const itemId = exportStudyForReview(root, study.id).items[0].id;
  const rating = { itemId, reviewerId: 'rater-a', version: 0, scores: { evidence: 2 }, rationale: 'First reviewer rationale' };
  rateStudyAnswer(root, study.id, rating, now);
  rateStudyAnswer(root, study.id, { ...rating, reviewerId: 'rater-b', rationale: 'Second reviewer private rationale' }, now);
  const workspace = getStudyReviewerWorkspace(root, study.id, 'rater-a');
  expect(workspace.assessments).toHaveLength(1); expect(workspace.assessments[0].version).toBe(1);
  expect(JSON.stringify(workspace)).not.toMatch(/Second reviewer|rater-b|conditionId/);
  expect(getStudyReviewerWorkspace(root, study.id, 'rater-c').assessments).toEqual([]);
  expect(() => getStudyReviewerWorkspace(root, study.id, '../invalid')).toThrow();
});
it('keeps participant versions independent and repeated task requests from resetting the time budget', () => {
  const study = frozen(); let one = enroll(study); let two = enroll(study, 'participant-two');
  one = change(study.id, one, { action: 'open' });
  two = change(study.id, two, { action: 'open' });
  const repeated = change(study.id, one, { action: 'open' }, new Date(now.getTime() + 30_000));
  expect(repeated.version).toBe(one.version); expect(repeated.task?.requestedAt).toBe(now.toISOString());
  two = change(study.id, two, answer, new Date(now.getTime() + 30_000));
  one = change(study.id, one, { action: 'skip', reason: 'skipped' }, new Date(now.getTime() + 30_000));
  expect(one.nextPhase).toBe('coaching'); expect(two.nextPhase).toBe('coaching');
  const data = exportStudyData(root, study.id);
  expect(data.events.filter(e => e.type === 'task-requested')).toHaveLength(2);
  expect(data.participants[0].responses[0].outcome).toBe('skipped');
  expect(exportStudyForReview(root, study.id).items).toHaveLength(1);
});

it('keeps a failed freeze as an editable draft and a failed erasure as an intact participant record', () => {
  const draft = createStudy(root, { requestId: 'qa-create', protocol: protocol() }, now);
  let rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Disk full'); });
  expect(() => freezeStudy(root, draft.id, { version: draft.version, confirmed: true, reviewedBy: 'reviewer', reviewNote: 'checked' }, now)).toThrow();
  rename.mockRestore(); expect(getStudy(root, draft.id)?.status).toBe('draft');
  const study = frozen(); let view = enroll(study);
  view = change(study.id, view, { action: 'open' }); view = change(study.id, view, answer);
  rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Disk full'); });
  expect(() => change(study.id, view, { action: 'withdraw', eraseData: true })).toThrow();
  rename.mockRestore(); expect(getStudyParticipant(root, study.id, view.id, now).version).toBe(view.version);
  expect(exportStudyForReview(root, study.id).items[0].answer).toBe(answer.answer);
});

it('saves incomplete drafts but identifies missing fields and refuses freezing until they are completed', () => {
  const partial = protocol(); partial.title = ''; partial.conditions[0].expectedRuntime.model = ' ';
  partial.tasks[2].reference = '';
  const draft = createStudy(root, { requestId: 'partial-draft', protocol: partial }, now);
  expect(getStudy(root, draft.id)?.protocol.title).toBe('');
  expect(getStudyReadiness(root, draft.id).missing).toEqual(expect.arrayContaining(['title', 'conditions.0.expectedRuntime.model', 'tasks.2.reference']));
  expect(() => freezeStudy(root, draft.id, { version: draft.version, confirmed: true, reviewedBy: 'qa', reviewNote: 'Not ready' }, now)).toThrow();
  expect(getStudy(root, draft.id)?.status).toBe('draft');
  const updated = updateStudyDraft(root, draft.id, { version: draft.version, protocol: protocol() }, now);
  expect(getStudyReadiness(root, draft.id).missing).toEqual([]);
  const frozen = freezeStudy(root, draft.id, { version: updated.version, confirmed: true, reviewedBy: 'qa', reviewNote: 'Ready for QA' }, now);
  expect(frozen.status).toBe('frozen');
});
it('lists recoverable study summaries without returning materials and counts unreadable records separately', () => {
  const study = frozen();
  const other = createStudy(root, { requestId: 'other-study', protocol: { ...protocol(), title: '' } }, new Date(now.getTime() + 1000));
  const base = path.join(home, '.mindos', 'private-learning');
  fs.writeFileSync(path.join(base, fs.readdirSync(base)[0], 'study-' + 'f'.repeat(24) + '.json'), '{broken');
  const list = listStudies(root);
  expect(list.studies.map(item => item.id)).toEqual([other.id, study.id]);
  expect(list.unavailableCount).toBe(1);
  expect(JSON.stringify(list)).not.toMatch(/PRIVATE PROMPT|SECRET KEY|instructions|expectedRuntime|salt|allocation/);
});
