import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { privateRecordNames, withPrivateRecordLock } from '../private-records.js';
import { codeSchema, studyAdminView, studyDraftProtocolSchema, studyParticipantView, studyProtocolSchema, type StudyRecord } from './model.js';
import { checkStudyTime, hashStudyValue, mutateStudy, readStudy, requireStudy, studyError, studyEvent, writeStudy } from './storage.js';
export { enrollStudy, getStudyParticipant, updateStudyParticipant } from './participants.js';
export { exportStudyForReview, getStudyReviewerWorkspace, rateStudyAnswer, exportStudyData } from './review.js';
export type { StudyProtocol, StudyParticipantView, StudyAdminView } from './model.js';

const createSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/), protocol: studyDraftProtocolSchema }).strict();
export function createStudy(root: string, input: unknown, now = new Date()) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Complete the protocol, four tasks, conditions and rubric.');
  checkStudyTime(now);
  return withPrivateRecordLock(root, () => {
    const id = 'study-' + hashStudyValue(parsed.data.requestId).slice(0, 24);
    const creationHash = hashStudyValue(parsed.data.protocol);
    const existing = readStudy(root, id);
    if (existing) {
      if (existing.creationHash !== creationHash) return studyError('conflict', 'This creation request already has different materials. Open the saved study.');
      return studyAdminView(existing);
    }
    const record: StudyRecord = {
      id, schemaVersion: 1, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), status: 'draft',
      creationHash, salt: randomBytes(32).toString('hex'), protocol: parsed.data.protocol,
      allocation: [], participants: [], ratings: [], events: [],
    };
    studyEvent(record, 'created', now); writeStudy(root, record); return studyAdminView(record);
  });
}
export function getStudy(root: string, id: string) {
  const record = readStudy(root, id); return record ? studyAdminView(record) : null;
}
export function updateStudyDraft(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = z.object({ version: z.number().int().positive(), protocol: studyDraftProtocolSchema }).strict().safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Complete the study materials before saving.');
  const record = mutateStudy(root, id, now, record => {
    if (record.status !== 'draft' || record.version !== parsed.data.version) return studyError('conflict', 'This draft changed or was frozen. Reload it before saving.');
    record.protocol = parsed.data.protocol; studyEvent(record, 'draft-updated', now); return record;
  });
  return studyAdminView(record);
}
export function freezeStudy(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = z.object({ version: z.number().int().positive(), confirmed: z.literal(true), reviewedBy: codeSchema, reviewNote: z.string().trim().min(1).max(4000) }).strict().safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Explicitly confirm the reviewed protocol and record who checked it.');
  const record = mutateStudy(root, id, now, record => {
    if (record.status !== 'draft' || record.version !== parsed.data.version) return studyError('conflict', 'This draft changed or was frozen. Reload before confirming.');
    if (!studyProtocolSchema.safeParse(record.protocol).success) return studyError('invalid', 'Complete the missing protocol fields before freezing.');
    record.protocolHash = hashStudyValue(record.protocol);
    record.review = { reviewedBy: parsed.data.reviewedBy, reviewNote: parsed.data.reviewNote, frozenAt: now.toISOString() };
    // Persist the shuffled blocks once; retries and restarts must not redraw assignments.
    while (record.allocation.length < record.protocol.capacity) {
      const block = record.protocol.conditions.map(c => c.id);
      for (let i = block.length - 1; i > 0; i--) { const j = randomInt(i + 1); [block[i], block[j]] = [block[j]!, block[i]!]; }
      record.allocation.push(...block.slice(0, record.protocol.capacity - record.allocation.length));
    }
    record.status = 'frozen'; studyEvent(record, 'frozen', now); return record;
  });
  return studyAdminView(record);
}

export function getStudyReadiness(root: string, id: string) {
  const record = requireStudy(root, id);
  const parsed = studyProtocolSchema.safeParse(record.protocol);
  return { missing: parsed.success ? [] : parsed.error.issues.map(issue => issue.path.join('.')) };
}
/** Researcher-only progress: stage counts and help outcomes per participant, never answer text or scoring keys. */
export function getStudyProgress(root: string, id: string, now = new Date()) {
  checkStudyTime(now);
  const record = requireStudy(root, id);
  const participants = record.participants.map(p => {
    const view = studyParticipantView(record, p, now); const runs = p.coachingRuns ?? [];
    return {
      id: p.id, ordinal: p.ordinal, conditionId: p.conditionId, status: view.status, nextPhase: view.nextPhase, completedStages: view.completedStages,
      dueAt: p.dueAt, withdrawnAt: p.withdrawnAt, erased: !!p.erasedAt,
      answered: p.responses.filter(r => r.outcome === 'answered').length, missing: p.responses.filter(r => r.outcome !== 'answered').length,
      helpSucceeded: runs.filter(r => r.status === 'succeeded').length, helpFailed: runs.filter(r => r.status === 'failed').length,
      rated: record.ratings.filter(r => p.responses.some(x => x.itemId === r.itemId)).length, updatedAt: p.updatedAt,
    };
  });
  const count = (fn: (p: (typeof participants)[number]) => boolean) => participants.filter(fn).length;
  return {
    participants,
    summary: {
      enrolled: participants.length, capacity: record.protocol.capacity,
      active: count(p => !p.withdrawnAt && p.status !== 'complete'), waiting: count(p => p.status === 'waiting'),
      complete: count(p => p.status === 'complete'), withdrawn: count(p => !!p.withdrawnAt),
      ratings: record.ratings.length, failedRuns: participants.reduce((n, p) => n + p.helpFailed, 0),
    },
  };
}
export type StudyProgress = ReturnType<typeof getStudyProgress>;
export type StudySummary = Pick<ReturnType<typeof studyAdminView>, 'id' | 'version' | 'status' | 'createdAt' | 'updatedAt' | 'enrolledCount'> & { title: string };
export function listStudies(root: string): { studies: StudySummary[]; unavailableCount: number } {
  const studies: StudySummary[] = []; let unavailableCount = 0;
  for (const name of privateRecordNames(root)) {
    if (!/^study-[a-f0-9]{24}\.json$/.test(name)) continue;
    try {
      const record = readStudy(root, name.slice(0, -5)); if (!record) continue;
      studies.push({ id: record.id, version: record.version, status: record.status, title: record.protocol.title,
        createdAt: record.createdAt, updatedAt: record.updatedAt, enrolledCount: record.participants.length });
    } catch { unavailableCount++; }
  }
  studies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { studies, unavailableCount };
}

export { issueStudyInvitation, listStudyInvitations, revokeStudyInvitation, readStudyAccess, useStudyAccess, StudyAccessError } from './access.js';
export type { StudyAccessView } from './access.js';

export { beginStudyCoaching, finishStudyCoaching } from './coaching.js';
export type { StudyCoachingRequest } from './coaching.js';
export { issueStudyReviewer, listStudyReviewers, revokeStudyReviewer, readStudyReviewer, useStudyReviewer } from './reviewer-access.js';
export type { StudyReviewAccessView } from './reviewer-access.js';
