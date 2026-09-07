import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { digestSchema, studyParticipantView, type StudyRecord, type StudyParticipantView } from './model.js';
import { checkStudyTime, hashStudyValue, mutateStudy, requireStudy, studyError } from './storage.js';
import { enrollStudyInRecord, updateStudyParticipantInRecord } from './participants.js';
const invitationId = z.string().regex(/^invitation-[a-f0-9]{24}$/);
const issueSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/), protocolHash: digestSchema, expiresAt: z.string().datetime() }).strict();
type Invitation = NonNullable<StudyRecord['invitations']>[number];
export class StudyAccessError extends Error {
    constructor() { super('Invitation unavailable'); }
}
const deny = (): never => { throw new StudyAccessError(); };
const secretFor = (record: StudyRecord, id: string) => createHmac('sha256', record.salt).update('study-participant-invitation:v1:' + id).digest('base64url');
export function issueStudyInvitation(root: string, id: string, input: unknown, now = new Date()) {
    const parsed = issueSchema.safeParse(input);
    if (!parsed.success)
        return studyError('invalid', 'Choose a valid frozen version and invitation expiry.');
    return mutateStudy(root, id, now, record => {
        const { requestId, protocolHash, expiresAt } = parsed.data;
        if (record.status !== 'frozen' || record.protocolHash !== protocolHash)
            return studyError('conflict', 'Invite only to the reviewed frozen version.');
        const duration = Date.parse(expiresAt) - now.getTime();
        if (duration <= 0 || duration > 180 * 86400000)
            return studyError('invalid', 'Choose an expiry within 180 days.');
        const requestHash = hashStudyValue(requestId);
        const existing = record.invitations?.find(i => i.requestHash === requestHash);
        if (existing && (existing.expiresAt !== expiresAt || existing.revokedAt))
            return studyError('conflict', 'This invitation request has already been used.');
        const grantId = 'invitation-' + requestHash.slice(0, 24);
        const token = secretFor(record, grantId);
        if (!existing) {
            record.invitations ??= [];
            if (record.invitations.length >= 1000)
                return studyError('conflict', 'Invitation limit reached.');
            record.invitations.push({ id: grantId, requestHash, tokenHash: hashStudyValue(token), protocolHash, createdAt: now.toISOString(), expiresAt });
        }
        return { id: grantId, token, expiresAt };
    });
}
export function listStudyInvitations(root: string, id: string, now = new Date()) {
    checkStudyTime(now);
    return (requireStudy(root, id).invitations ?? []).map(i => ({ id: i.id, createdAt: i.createdAt, expiresAt: i.expiresAt,
        status: i.revokedAt ? 'revoked' as const : Date.parse(i.expiresAt) <= now.getTime() ? 'expired' as const : 'active' as const,
        enrolled: !!i.participantId }));
}
export function revokeStudyInvitation(root: string, id: string, input: unknown, now = new Date()) {
    const parsed = z.object({ invitationId }).strict().safeParse(input);
    if (!parsed.success)
        return studyError('invalid', 'Choose an invitation.');
    mutateStudy(root, id, now, record => {
        const invitation = record.invitations?.find(i => i.id === parsed.data.invitationId);
        if (!invitation)
            return studyError('not-found', 'Invitation not found.');
        invitation.revokedAt ??= now.toISOString();
    });
    return listStudyInvitations(root, id, now);
}
export function authorizeStudyInvitation(record: StudyRecord, token: unknown): Invitation {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
        return deny();
    const digest = Buffer.from(hashStudyValue(token), 'hex');
    const invitation = record.invitations?.find(i => timingSafeEqual(Buffer.from(i.tokenHash, 'hex'), digest));
    if (record.status !== 'frozen' || !invitation || invitation.revokedAt || invitation.protocolHash !== record.protocolHash)
        return deny();
    return invitation;
}
export type StudyAccessView = {
    kind: 'consent';
    title: string;
    locale: 'en' | 'zh';
    consent: string;
    withdrawal: string;
    protocolHash: string;
    expiresAt: string;
    coachingAvailable?: boolean;
} | {
    kind: 'expired';
    title: string;
    locale: 'en' | 'zh';
    withdrawal: string;
    expiresAt: string;
    version?: number;
    canErase: boolean;
} | {
    kind: 'participant';
    participant: StudyParticipantView;
    expiresAt: string;
};
function project(record: StudyRecord, invitation: Invitation, now: Date): StudyAccessView {
    const p = record.participants.find(p => p.id === invitation.participantId);
    if (invitation.participantId && !p)
        return deny();
    // Expired credentials retain only the right to withdraw/erase; no task content.
    if (Date.parse(invitation.expiresAt) <= now.getTime() && !p?.withdrawnAt)
        return {
            kind: 'expired', title: record.protocol.title, locale: record.protocol.locale, withdrawal: record.protocol.withdrawal,
            expiresAt: invitation.expiresAt, version: p?.version, canErase: !!p && !p.erasedAt,
        };
    if (p)
        return { kind: 'participant', participant: studyParticipantView(record, p, now), expiresAt: invitation.expiresAt };
    return { kind: 'consent', title: record.protocol.title, locale: record.protocol.locale, consent: record.protocol.consent,
        withdrawal: record.protocol.withdrawal, protocolHash: record.protocolHash!, expiresAt: invitation.expiresAt, ...(record.protocol.execution ? { coachingAvailable: true } : {}) };
}
function accessRecord(root: string, id: string) {
    try {
        return requireStudy(root, id);
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error.code === 'not-found' || error.code === 'invalid'))
            return deny();
        throw error;
    }
}
export function readStudyAccess(root: string, id: string, token: unknown, now = new Date()): StudyAccessView {
    checkStudyTime(now);
    const record = accessRecord(root, id);
    return project(record, authorizeStudyInvitation(record, token), now);
}
export function useStudyAccess(root: string, id: string, token: unknown, input: unknown, now = new Date()): StudyAccessView {
    // Authenticate again inside the same write lock as the participant transition.
    // A concurrent revocation must not slip between authorization and a write.
    accessRecord(root, id);
    return mutateStudy(root, id, now, record => {
        const invitation = authorizeStudyInvitation(record, token);
        if (!input || typeof input !== 'object' || Array.isArray(input))
            return studyError('invalid', 'Choose a study action.');
        const action = (input as {
            action?: unknown;
        }).action;
        if (Date.parse(invitation.expiresAt) <= now.getTime() && action !== 'withdraw')
            return deny();
        if (action === 'join') {
            const parsed = z.object({ action: z.literal('join'), protocolHash: digestSchema, consentAccepted: z.literal(true) }).strict().safeParse(input);
            if (!parsed.success)
                return studyError('invalid', 'Confirm consent to join.');
            if (parsed.data.protocolHash !== record.protocolHash)
                return studyError('conflict', 'Consent refers to another version.');
            if (!invitation.participantId) {
                const p = enrollStudyInRecord(record, { enrollmentKey: invitation.id, protocolHash: parsed.data.protocolHash, consentAccepted: true }, now);
                invitation.participantId = p.id;
            }
        }
        else {
            if (!invitation.participantId)
                return deny();
            updateStudyParticipantInRecord(record, invitation.participantId, input, now);
        }
        return project(record, invitation, now);
    });
}
