import { createHash, randomBytes } from 'node:crypto';
import { LearningError } from '../learning/model.js';
import { readPrivateRecord, writePrivateRecord, withPrivateRecordLock } from '../private-records.js';
import { phases, studyIdSchema, studyProtocolSchema, studyRecordSchema, type StudyRecord } from './model.js';

export const hashStudyValue = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const newStudyIdentity = (prefix: string) => prefix + '-' + randomBytes(12).toString('hex');
export function studyError(kind: 'invalid' | 'conflict' | 'not-found' | 'storage', message: string): never { throw new LearningError(kind, message); }
export function checkStudyTime(now: Date, previous?: string) {
  if (!Number.isFinite(now.getTime())) studyError('invalid', 'Use a valid study time.');
  if (previous && now.getTime() < Date.parse(previous)) studyError('conflict', 'The clock moved backwards. Retry when the time is correct.');
}
// Up to 200 participants with four answers, three replies and six questions, including UTF-8 expansion.
const maxBytes = 48_000_000;
function consistent(record: StudyRecord) {
  if (record.status === 'draft') return !record.protocolHash && !record.review && !record.participants.length && !record.allocation.length && !record.ratings.length && !record.invitations?.length && !record.reviewerGrants?.length;
  if (!record.review || !studyProtocolSchema.safeParse(record.protocol).success || record.protocolHash !== hashStudyValue(record.protocol) || record.allocation.length !== record.protocol.capacity) return false;
  const conditions = record.protocol.conditions.map(c => c.id);
  if (record.allocation.some(c => !conditions.includes(c))) return false;
  for (let i = 0; i + conditions.length <= record.allocation.length; i += conditions.length)
    if (new Set(record.allocation.slice(i, i + conditions.length)).size !== conditions.length) return false;
  const participantIds = record.participants.map(p => p.id);
  const enrollmentHashes = record.participants.flatMap(p => p.enrollmentHash ? [p.enrollmentHash] : []);
  if (new Set(participantIds).size !== participantIds.length || new Set(enrollmentHashes).size !== enrollmentHashes.length) return false;
  const invitations = record.invitations ?? [];
  if (new Set(invitations.map(i => i.id)).size !== invitations.length || new Set(invitations.map(i => i.tokenHash)).size !== invitations.length) return false;
  const invitedParticipants = invitations.flatMap(i => i.participantId ? [i.participantId] : []);
  if (new Set(invitedParticipants).size !== invitedParticipants.length) return false;
  if (invitations.some(i => i.protocolHash !== record.protocolHash || (i.participantId && !participantIds.includes(i.participantId))
    || Date.parse(i.expiresAt) <= Date.parse(i.createdAt) || Date.parse(i.createdAt) > Date.parse(record.updatedAt)
    || (i.revokedAt && (Date.parse(i.revokedAt) < Date.parse(i.createdAt) || Date.parse(i.revokedAt) > Date.parse(record.updatedAt))))) return false;
  const grants = record.reviewerGrants ?? [];
  if (new Set(grants.map(g => g.id)).size !== grants.length || new Set(grants.map(g => g.requestHash)).size !== grants.length || new Set(grants.map(g => g.tokenHash)).size !== grants.length) return false;
  if (grants.some(g => g.protocolHash !== record.protocolHash || new Set(g.itemIds).size !== g.itemIds.length
    || Date.parse(g.expiresAt) <= Date.parse(g.createdAt) || Date.parse(g.createdAt) > Date.parse(record.updatedAt)
    || [g.acceptedAt, g.revokedAt].some(at => at && (Date.parse(at) < Date.parse(g.createdAt) || Date.parse(at) > Date.parse(record.updatedAt))))) return false;
  const items = new Set<string>();
  for (const [index, p] of record.participants.entries()) {
    if (p.ordinal !== index || p.conditionId !== record.allocation[index]) return false;
    if (p.erasedAt) {
      if (!p.withdrawnAt || p.responses.length || p.enrollmentHash || p.consentHash || p.consentAt || p.enrolledAt || p.dueAt || p.requestedAt || p.coachingRuns) return false;
      continue;
    }
    if (!p.enrollmentHash || !p.enrolledAt || !p.consentAt || p.consentHash !== record.protocolHash) return false;
    if ((p.withdrawnAt || p.responses.length === 4) && p.requestedAt) return false;
    const runs = p.coachingRuns ?? [];
    if (runs.length && (!record.protocol.execution || !p.responses.length)) return false;
    if (new Set(runs.map(r => r.id)).size !== runs.length || new Set(runs.map(r => r.requestHash)).size !== runs.length) return false;
    if (runs.filter(r => r.status === 'succeeded').length > (record.protocol.execution?.maxTurns ?? 0)) return false;
    const expected = record.protocol.conditions.find(c => c.id === p.conditionId)!.expectedRuntime;
    for (const run of runs) {
      if (!invitations.some(i => i.id === run.invitationId && i.participantId === p.id) || run.runtime.temperature !== (expected.temperature ?? 0) || run.runtime.provider !== expected.provider || run.runtime.model !== expected.model || run.runtime.endpoint !== expected.endpoint) return false;
      if (Date.parse(run.startedAt) < Date.parse(p.responses[0]!.submittedAt) || Date.parse(run.deadline) !== Date.parse(run.startedAt) + 120000) return false;
      if (run.status === 'pending' ? !!run.completedAt || !!run.output || !!run.failure : !run.completedAt || Date.parse(run.completedAt) < Date.parse(run.startedAt) || Date.parse(run.completedAt) > Date.parse(record.updatedAt)) return false;
      if (run.status === 'succeeded' ? !run.output || !!run.failure : !!run.output || !!run.reportedModel) return false;
      if (run.status === 'failed' && !run.failure) return false;
    }
    let previous = p.enrolledAt;
    for (const [i, response] of p.responses.entries()) {
      if (response.phase !== phases[i] || Date.parse(response.requestedAt) < Date.parse(previous)
        || response.elapsedMs !== Date.parse(response.submittedAt) - Date.parse(response.requestedAt)
        || response.elapsedMs < 0 || response.overBudget !== (response.elapsedMs > record.protocol.tasks[i]!.budgetSeconds * 1000)) return false;
      if (response.outcome === 'answered') {
        if (!response.itemId || !response.answer || response.confidence === undefined || !response.assistance || response.familiar === undefined || items.has(response.itemId)) return false;
        items.add(response.itemId);
      } else if (response.itemId || response.answer !== undefined || response.confidence !== undefined || response.assistance || response.familiar !== undefined) return false;
      if (response.outcome === 'timeout' && response.elapsedMs < record.protocol.tasks[i]!.budgetSeconds * 1000) return false;
      previous = response.submittedAt;
    }
    if (p.responses.length >= 3 && Date.parse(p.dueAt ?? '') !== Date.parse(p.responses[2]!.submittedAt) + record.protocol.delayDays * 86_400_000) return false;
    if (p.responses.length < 3 && p.dueAt) return false;
    if (p.requestedAt && Date.parse(p.requestedAt) < Date.parse(previous)) return false;
    if ((p.responses[3] && Date.parse(p.responses[3].requestedAt) < Date.parse(p.dueAt!))
      || (p.responses.length === 3 && p.requestedAt && Date.parse(p.requestedAt) < Date.parse(p.dueAt!))) return false;
    if (Date.parse(p.updatedAt) < Date.parse(previous) || Date.parse(p.updatedAt) > Date.parse(record.updatedAt)) return false;
  }
  const revisions = new Map<string, number>();
  const submissions = new Set<string>();
  for (const rating of record.ratings) {
    if (!items.has(rating.itemId) || !scoresMatch(record, rating.scores)) return false;
    if (!!rating.requestHash !== !!rating.contentHash) return false;
    if (rating.requestHash) { const key = rating.reviewerId + ':' + rating.requestHash; if (submissions.has(key)) return false; submissions.add(key); }
    const key = rating.itemId + ':' + rating.reviewerId;
    if (rating.version !== (revisions.get(key) ?? 0) + 1) return false;
    revisions.set(key, rating.version);
  }
  return record.events.every((event, i) => event.sequence === i + 1 && Date.parse(event.at) <= Date.parse(record.updatedAt)
    && (!event.participantId || participantIds.includes(event.participantId)) && (!event.itemId || items.has(event.itemId)));
}
export function scoresMatch(record: StudyRecord, scores: Record<string, number>) {
  return Object.keys(scores).length === record.protocol.rubric.length && record.protocol.rubric.every(criterion =>
    Object.hasOwn(scores, criterion.id) && Number.isInteger(scores[criterion.id]) && scores[criterion.id]! >= 0 && scores[criterion.id]! <= criterion.maxScore);
}
export function readStudy(root: string, id: string): StudyRecord | null {
  if (!studyIdSchema.safeParse(id).success) return studyError('invalid', 'Choose a valid study.');
  const value = readPrivateRecord(root, id + '.json', maxBytes);
  if (value === null) return null;
  try {
    const { recordHash, ...body } = value as Record<string, unknown>;
    const record = studyRecordSchema.parse(body);
    if (record.id !== id || recordHash !== hashStudyValue(record) || !consistent(record)) throw new Error('Study integrity mismatch');
    return record;
  } catch { return studyError('storage', 'Could not read this study. Existing data was preserved.'); }
}
export function requireStudy(root: string, id: string) {
  const record = readStudy(root, id); if (!record) return studyError('not-found', 'Study not found.'); return record;
}
export function writeStudy(root: string, value: StudyRecord) {
  const parsed = studyRecordSchema.safeParse(value);
  if (!parsed.success) return studyError('storage', 'This study reached a record limit or has invalid data. Existing data was preserved.');
  const record = parsed.data;
  if (!consistent(record)) return studyError('storage', 'This study cannot be saved consistently. Existing data was preserved.');
  writePrivateRecord(root, record.id + '.json', { ...record, recordHash: hashStudyValue(record) }, maxBytes);
}
export function studyEvent(record: StudyRecord, type: StudyRecord['events'][number]['type'], now: Date, detail: Partial<Pick<StudyRecord['events'][number], 'participantId' | 'phase' | 'itemId' | 'reviewerId'>> = {}) {
  record.events.push({ sequence: record.events.length + 1, type, at: now.toISOString(), ...detail });
}
export function mutateStudy<T>(root: string, id: string, now: Date, operation: (record: StudyRecord) => T): T {
  return withPrivateRecordLock(root, () => {
    const record = requireStudy(root, id); checkStudyTime(now, record.updatedAt);
    const result = operation(record); record.version++; record.updatedAt = now.toISOString(); writeStudy(root, record); return result;
  });
}
