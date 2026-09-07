import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStudy, freezeStudy, getStudy, exportStudyData } from './index.js';
import { issueStudyInvitation, listStudyInvitations, revokeStudyInvitation, readStudyAccess, useStudyAccess } from './access.js';
import { readStudy } from './storage.js';
let home: string;
let root: string;
const now = new Date('2026-09-07T08:00:00Z');
const later = new Date('2026-09-09T08:00:00Z');
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'study-access-')); root = path.join(home, 'mind'); fs.mkdirSync(root); vi.spyOn(os, 'homedir').mockReturnValue(home); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
function study(key = 'study-access') {
    const draft = createStudy(root, { requestId: key, protocol: {
            title: 'Synthetic access study', hypothesis: 'PRIVATE HYPOTHESIS', consent: 'Synthetic consent', withdrawal: 'You may stop or erase answers.', locale: 'en', capacity: 4, delayDays: 1,
            conditions: ['a', 'b'].map(id => ({ id, label: id, instructions: 'PRIVATE CONDITION', expectedRuntime: { provider: 'fixture', model: 'fixture', context: 'PRIVATE CONTEXT', tools: [] } })),
            tasks: ['baseline', 'coaching', 'transfer', 'delayed'].map(phase => ({ phase, prompt: phase + ' PROMPT', reference: 'SECRET SCORING KEY', budgetSeconds: 60 })),
            rubric: [{ id: 'reasoning', label: 'Reasoning', description: 'PRIVATE RUBRIC', maxScore: 3 }],
        } }, now);
    return freezeStudy(root, draft.id, { version: draft.version, confirmed: true, reviewedBy: 'researcher', reviewNote: 'QA' }, now);
}
function invite(s: ReturnType<typeof study>, key = 'invite-one') { return issueStudyInvitation(root, s.id, { requestId: key, protocolHash: s.protocolHash, expiresAt: later.toISOString() }, now); }
it('issues repeatable scoped invitations without storing raw secrets or revealing research materials', () => {
    const s = study();
    const invitation = invite(s);
    expect(invite(s)).toEqual(invitation);
    expect(getStudy(root, s.id)?.enrolledCount).toBe(0);
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(readStudy(root, s.id))).not.toContain(invitation.token);
    const view = readStudyAccess(root, s.id, invitation.token, now);
    expect(view.kind).toBe('consent');
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE|PROMPT|SECRET|allocation|rubric|conditionId|tokenHash/);
    expect(JSON.stringify(listStudyInvitations(root, s.id, now))).not.toContain(invitation.token);
    const other = study('other-study');
    expect(() => readStudyAccess(root, other.id, invitation.token, now)).toThrow('Invitation unavailable');
    expect(() => readStudyAccess(root, s.id, 'x'.repeat(43), now)).toThrow('Invitation unavailable');
    for (const token of [null, '', '../bad', {}, 'x'.repeat(1000)])
        expect(() => readStudyAccess(root, s.id, token, now)).toThrow('Invitation unavailable');
});
it('binds an invitation to one consenting participant and rejects identity injection, stale answers and revoked writes', () => {
    const s = study();
    const i = invite(s);
    const join = { action: 'join', protocolHash: s.protocolHash, consentAccepted: true };
    expect(() => useStudyAccess(root, s.id, i.token, { ...join, consentAccepted: false }, now)).toThrow();
    const joined = useStudyAccess(root, s.id, i.token, join, now);
    expect(joined.kind).toBe('participant');
    if (joined.kind !== 'participant')
        throw new Error('Missing participant');
    expect(useStudyAccess(root, s.id, i.token, join, now)).toEqual(joined);
    expect(getStudy(root, s.id)?.enrolledCount).toBe(1);
    expect(() => useStudyAccess(root, s.id, i.token, { action: 'open', version: joined.participant.version, participantId: 'someone-else' }, now)).toThrow();
    const opened = useStudyAccess(root, s.id, i.token, { action: 'open', version: joined.participant.version }, now);
    if (opened.kind !== 'participant')
        throw new Error('Missing participant');
    expect(opened.participant.task?.prompt).toBe('baseline PROMPT');
    expect(JSON.stringify(opened)).not.toMatch(/SECRET|PRIVATE|coaching PROMPT|transfer PROMPT/);
    const command = { action: 'answer', version: opened.participant.version, answer: 'Synthetic independent answer', confidence: 60, assistance: 'none', familiar: false };
    const saved = useStudyAccess(root, s.id, i.token, command, now);
    expect(() => useStudyAccess(root, s.id, i.token, command, now)).toThrow();
    expect(exportStudyData(root, s.id).participants[0]?.responses).toHaveLength(1);
    revokeStudyInvitation(root, s.id, { invitationId: i.id }, now);
    expect(() => readStudyAccess(root, s.id, i.token, now)).toThrow('Invitation unavailable');
    expect(() => useStudyAccess(root, s.id, i.token, { action: 'open', version: saved.kind === 'participant' ? saved.participant.version : 0 }, now)).toThrow('Invitation unavailable');
});
it('expires task access at the exact boundary but permits erasure without resurrecting the participant', () => {
    const s = study();
    const i = invite(s);
    const joined = useStudyAccess(root, s.id, i.token, { action: 'join', protocolHash: s.protocolHash, consentAccepted: true }, now);
    expect(readStudyAccess(root, s.id, i.token, later).kind).toBe('expired');
    expect(() => useStudyAccess(root, s.id, i.token, { action: 'open', version: 1 }, later)).toThrow();
    if (joined.kind !== 'participant')
        throw new Error('Missing participant');
    const erased = useStudyAccess(root, s.id, i.token, { action: 'withdraw', version: joined.participant.version, eraseData: true }, later);
    expect(erased.kind).toBe('participant');
    if (erased.kind === 'participant')
        expect(erased.participant.erasedAt).toBe(later.toISOString());
    expect(() => useStudyAccess(root, s.id, i.token, { action: 'join', protocolHash: s.protocolHash, consentAccepted: true }, later)).toThrow();
    expect(getStudy(root, s.id)?.enrolledCount).toBe(1);
    expect(exportStudyData(root, s.id).participants[0]?.responses).toHaveLength(0);
});
it('rejects mismatched frozen versions, expiry extremes, extra fields and changed request reuse', () => {
    const s = study();
    const input = { requestId: 'bounded', protocolHash: s.protocolHash, expiresAt: later.toISOString() };
    for (const extra of [{ protocolHash: '0'.repeat(64) }, { expiresAt: now.toISOString() }, { expiresAt: 'invalid' }, { expiresAt: '2030-01-01T00:00:00Z' }, { role: 'researcher' }])
        expect(() => issueStudyInvitation(root, s.id, { ...input, ...extra }, now)).toThrow();
    issueStudyInvitation(root, s.id, input, now);
    expect(() => issueStudyInvitation(root, s.id, { ...input, expiresAt: '2026-09-10T08:00:00Z' }, now)).toThrow();
    expect(listStudyInvitations(root, s.id, now)).toHaveLength(1);
});
