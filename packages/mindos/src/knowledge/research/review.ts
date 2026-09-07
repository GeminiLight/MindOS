import { z } from 'zod';
import { codeSchema, itemIdSchema, type StudyRecord } from './model.js';
import { mutateStudy, requireStudy, scoresMatch, studyError, studyEvent } from './storage.js';

function reviewPacket(record: StudyRecord) {
  if (record.status !== 'frozen') return studyError('conflict', 'Freeze the study before preparing review material.');
  const items = record.participants.flatMap(p => p.responses.flatMap((response, index) =>
    response.outcome === 'answered' ? [{
      id: response.itemId!, prompt: record.protocol.tasks[index]!.prompt, answer: response.answer!, reference: record.protocol.tasks[index]!.reference,
    }] : []));
  // Random item identities give a stable order unrelated to enrollment, stage or group.
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { rubric: record.protocol.rubric, items };
}
/** Projection only: caller authorization and leakage inside free text need separate review. */
export function exportStudyForReview(root: string, id: string) {
  return reviewPacket(requireStudy(root, id));
}
export function getStudyReviewerWorkspace(root: string, id: string, reviewerId: string) {
  if (!codeSchema.safeParse(reviewerId).success) return studyError('invalid', 'Choose a valid reviewer identifier.');
  const record = requireStudy(root, id);
  return studyReviewerWorkspaceInRecord(record, reviewerId);
}
export function studyReviewerWorkspaceInRecord(record: StudyRecord, reviewerId: string) {
  // Read one snapshot so a concurrent erasure cannot pair new items with old assessments.
  return { ...reviewPacket(record), assessments: record.ratings.filter(rating => rating.reviewerId === reviewerId) };
}
export function rateStudyAnswer(root: string, id: string, input: unknown, now = new Date()) {
  return mutateStudy(root, id, now, record => rateStudyAnswerInRecord(record, input, now));
}
export function rateStudyAnswerInRecord(record: StudyRecord, input: unknown, now: Date) {
  const parsed = z.object({
    itemId: itemIdSchema, reviewerId: codeSchema, version: z.number().int().nonnegative(),
    scores: z.record(codeSchema, z.number().int().nonnegative()), rationale: z.string().trim().min(1).max(4000),
  }).strict().safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Complete every rubric score and explain the assessment.');
  const command = parsed.data;
  const participant = record.participants.find(p => p.responses.some(r => r.itemId === command.itemId));
  if (!participant || !scoresMatch(record, command.scores)) return studyError('invalid', 'Choose an available answer and use the frozen rubric ranges.');
  const previous = record.ratings.filter(r => r.itemId === command.itemId && r.reviewerId === command.reviewerId).at(-1);
  if (command.version !== (previous?.version ?? 0)) return studyError('conflict', 'This assessment changed. Reload before revising.');
  const rating: StudyRecord['ratings'][number] = { ...command, version: command.version + 1, recordedAt: now.toISOString() };
  record.ratings.push(rating);
  studyEvent(record, 'rated', now, { participantId: participant.id, itemId: command.itemId, reviewerId: command.reviewerId });
  return rating;
}
/** Researcher-only analysis export. Never use as a participant or reviewer API response. */
export function exportStudyData(root: string, id: string) {
  const record = requireStudy(root, id);
  return {
    schemaVersion: record.schemaVersion, id: record.id, version: record.version, status: record.status,
    protocol: record.protocol, protocolHash: record.protocolHash, review: record.review,
    allocationMethod: 'permuted-equal-blocks-individual-v1',
    participants: record.participants.map(({ enrollmentHash: _enrollmentHash, ...participant }) => participant),
    ratings: record.ratings, events: record.events,
    limits: ['Declared configuration is not actual execution evidence; coaching receipts record application requests and provider-reported model names, not backend attestation.', 'Assistance and familiarity are self-reported.', 'Free text can reveal identity or assignment.', 'Local files are not tamper-proof.'],
  };
}
