import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StudyAccessError } from './access.js';
import { codeSchema, digestSchema, itemIdSchema, type StudyRecord } from './model.js';
import { checkStudyTime, hashStudyValue, mutateStudy, newStudyIdentity, requireStudy, studyError } from './storage.js';
import { rateStudyAnswerInRecord, studyReviewerWorkspaceInRecord } from './review.js';
const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/);
const grantId = z.string().regex(/^review-grant-[a-f0-9]{24}$/);
const issueSchema = z.object({ requestId, protocolHash: digestSchema, expiresAt: z.string().datetime(), label: z.string().trim().min(1).max(80), reviewerId: codeSchema.optional() }).strict();
type Grant = NonNullable<StudyRecord['reviewerGrants']>[number];
const secret = (record: StudyRecord, id: string) => createHmac('sha256', record.salt).update('study-reviewer-grant:v1:' + id).digest('base64url');
export function issueStudyReviewer(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Choose a reviewer note, frozen protocol and expiry.');
  return mutateStudy(root, id, now, record => {
    const command = parsed.data;
    if (record.status !== 'frozen' || command.protocolHash !== record.protocolHash) return studyError('conflict', 'Use the reviewed frozen protocol.');
    const duration = Date.parse(command.expiresAt) - now.getTime();
    if (duration <= 0 || duration > 180 * 86400000) return studyError('invalid', 'Choose an expiry within 180 days.');
    record.reviewerGrants ??= [];
    const requestHash = hashStudyValue(command.requestId); const creationHash = hashStudyValue(command);
    const existing = record.reviewerGrants.find(g => g.requestHash === requestHash);
    if (existing) {
      if (existing.creationHash !== creationHash || existing.revokedAt) return studyError('conflict', 'This invitation request was already used.');
      return { id: existing.id, reviewerId: existing.reviewerId, token: secret(record, existing.id), expiresAt: existing.expiresAt };
    }
    if (record.reviewerGrants.length >= 50) return studyError('conflict', 'This study has reached its reviewer invitation limit.');
    if (command.reviewerId && !record.reviewerGrants.some(g => g.reviewerId === command.reviewerId)) return studyError('invalid', 'Choose an existing reviewer to update.');
    const itemIds = record.participants.flatMap(p => p.responses.flatMap(r => r.itemId ? [r.itemId] : [])).sort();
    if (!itemIds.length) return studyError('conflict', 'There are no submitted answers to review yet.');
    const id = newStudyIdentity('review-grant'); const reviewerId = command.reviewerId ?? newStudyIdentity('reviewer');
    const token = secret(record, id);
    record.reviewerGrants.push({ id, reviewerId, label: command.label, requestHash, creationHash, tokenHash: hashStudyValue(token), protocolHash: command.protocolHash,
      itemIds, createdAt: now.toISOString(), expiresAt: command.expiresAt });
    return { id, reviewerId, token, expiresAt: command.expiresAt };
  });
}
export function listStudyReviewers(root: string, id: string, now = new Date()) {
  checkStudyTime(now); const record = requireStudy(root, id);
  const available = new Set(record.participants.flatMap(p => p.responses.flatMap(r => r.itemId ? [r.itemId] : [])));
  return (record.reviewerGrants ?? []).map(g => ({ id: g.id, reviewerId: g.reviewerId, label: g.label, expiresAt: g.expiresAt,
    itemCount: g.itemIds.filter(item => available.has(item)).length, accepted: !!g.acceptedAt,
    status: g.revokedAt ? 'revoked' as const : Date.parse(g.expiresAt) <= now.getTime() ? 'expired' as const : 'active' as const }));
}
export function revokeStudyReviewer(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = z.object({ invitationId: grantId }).strict().safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Choose a reviewer invitation.');
  mutateStudy(root, id, now, record => {
    const grant = record.reviewerGrants?.find(g => g.id === parsed.data.invitationId);
    if (!grant) return studyError('not-found', 'Reviewer invitation not found.');
    grant.revokedAt ??= now.toISOString();
  });
  return listStudyReviewers(root, id, now);
}
function authorize(record: StudyRecord, token: unknown, now: Date): Grant {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new StudyAccessError();
  const digest = Buffer.from(hashStudyValue(token), 'hex');
  const grant = record.reviewerGrants?.find(g => timingSafeEqual(Buffer.from(g.tokenHash, 'hex'), digest));
  if (!grant || record.status !== 'frozen' || grant.protocolHash !== record.protocolHash || grant.revokedAt || Date.parse(grant.expiresAt) <= now.getTime()) throw new StudyAccessError();
  return grant;
}
function readRecord(root: string, id: string) {
  try { return requireStudy(root, id); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && ['invalid', 'not-found'].includes(String(error.code))) throw new StudyAccessError(); throw error; }
}
function project(record: StudyRecord, grant: Grant) {
  const common = { locale: record.protocol.locale, protocolHash: record.protocolHash!, expiresAt: grant.expiresAt };
  if (!grant.acceptedAt) return { kind: 'briefing' as const, ...common };
  const packet = studyReviewerWorkspaceInRecord(record, grant.reviewerId);
  const allowed = new Set(grant.itemIds);
  const items = packet.items.filter(item => allowed.has(item.id));
  const available = new Set(items.map(item => item.id));
  return { kind: 'workspace' as const, ...common, rubric: packet.rubric, items,
    assessments: packet.assessments.filter(a => available.has(a.itemId)).map(({ itemId, version, scores, rationale, recordedAt }) => ({ itemId, version, scores, rationale, recordedAt })) };
}
export type StudyReviewAccessView = ReturnType<typeof project>;
export function readStudyReviewer(root: string, id: string, token: unknown, now = new Date()): StudyReviewAccessView {
  checkStudyTime(now); const record = readRecord(root, id); return project(record, authorize(record, token, now));
}
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), accepted: z.literal(true), protocolHash: digestSchema }).strict(),
  z.object({ action: z.literal('rate'), requestId, itemId: itemIdSchema, version: z.number().int().nonnegative(), scores: z.record(codeSchema, z.number().int().nonnegative()), rationale: z.string().trim().min(1).max(4000) }).strict(),
]);
export function useStudyReviewer(root: string, id: string, token: unknown, input: unknown, now = new Date()): StudyReviewAccessView {
  authorize(readRecord(root, id), token, now);
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Complete the required scores and explanation.');
  return mutateStudy(root, id, now, record => {
    const grant = authorize(record, token, now); const command = parsed.data;
    if (command.action === 'accept') {
      if (command.protocolHash !== record.protocolHash) return studyError('conflict', 'Accept this packet’s frozen protocol.');
      grant.acceptedAt ??= now.toISOString();
    } else {
      if (!grant.acceptedAt || !grant.itemIds.includes(command.itemId)) throw new StudyAccessError();
      if (!record.participants.some(p => p.responses.some(r => r.itemId === command.itemId))) return studyError('conflict', 'This answer is no longer available. Reload the work packet.');
      const requestHash = hashStudyValue(command.requestId); const contentHash = hashStudyValue(command);
      const prior = record.ratings.find(r => r.reviewerId === grant.reviewerId && r.requestHash === requestHash);
      if (prior && prior.contentHash !== contentHash) return studyError('conflict', 'This submission already contains different scores.');
      if (!prior) {
        const { action: _action, requestId: _requestId, ...rating } = command;
        const saved = rateStudyAnswerInRecord(record, { ...rating, reviewerId: grant.reviewerId }, now);
        saved.requestHash = requestHash; saved.contentHash = contentHash;
      }
    }
    return project(record, grant);
  });
}
