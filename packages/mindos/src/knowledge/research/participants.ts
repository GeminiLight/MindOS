import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { commandSchema, digestSchema, participantIdSchema, phases, studyParticipantView, type StudyParticipant, type StudyRecord } from './model.js';
import { checkStudyTime, mutateStudy, newStudyIdentity, requireStudy, studyError, studyEvent } from './storage.js';
function participantIn(record: StudyRecord, id: string) {
    if (!participantIdSchema.safeParse(id).success)
        return studyError('invalid', 'Choose a valid study participant.');
    const participant = record.participants.find(p => p.id === id);
    if (!participant)
        return studyError('not-found', 'Participant not found.');
    return participant;
}
export function enrollStudy(root: string, id: string, input: unknown, now = new Date()) {
    const { record, participant } = mutateStudy(root, id, now, record => ({ record, participant: enrollStudyInRecord(record, input, now) }));
    return studyParticipantView(record, participant, now);
}
export function enrollStudyInRecord(record: StudyRecord, input: unknown, now: Date) {
    const parsed = z.object({ enrollmentKey: z.string().trim().min(3).max(100), protocolHash: digestSchema, consentAccepted: z.literal(true) }).strict().safeParse(input);
    if (!parsed.success)
        return studyError('invalid', 'Confirm consent to the frozen protocol before joining.');
    if (record.status !== 'frozen' || record.protocolHash !== parsed.data.protocolHash)
        return studyError('conflict', 'Consent must refer to this frozen protocol.');
    const enrollmentHash = createHmac('sha256', record.salt).update(parsed.data.enrollmentKey).digest('hex');
    const existing = record.participants.find(p => p.enrollmentHash === enrollmentHash);
    if (existing)
        return existing;
    if (record.participants.length >= record.protocol.capacity)
        return studyError('conflict', 'This study has reached its enrollment limit.');
    const participant: StudyParticipant = {
        id: newStudyIdentity('participant'), ordinal: record.participants.length,
        conditionId: record.allocation[record.participants.length]!, enrollmentHash,
        version: 1, enrolledAt: now.toISOString(), updatedAt: now.toISOString(),
        consentAt: now.toISOString(), consentHash: record.protocolHash, responses: [],
    };
    record.participants.push(participant);
    studyEvent(record, 'enrolled', now, { participantId: participant.id });
    return participant;
}
export function getStudyParticipant(root: string, id: string, participantId: string, now = new Date()) {
    checkStudyTime(now);
    const record = requireStudy(root, id);
    return studyParticipantView(record, participantIn(record, participantId), now);
}
export function updateStudyParticipant(root: string, id: string, participantId: string, input: unknown, now = new Date()) {
    const { record, participant } = mutateStudy(root, id, now, record => ({ record, participant: updateStudyParticipantInRecord(record, participantId, input, now) }));
    return studyParticipantView(record, participant, now);
}
export function updateStudyParticipantInRecord(record: StudyRecord, participantId: string, input: unknown, now: Date) {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
        return studyError('invalid', 'Complete the answer and report any assistance or familiar material.');
    const command = parsed.data;
    const p = participantIn(record, participantId);
    if (record.status !== 'frozen' || command.version !== p.version)
        return studyError('conflict', 'This response changed. Reload before saving.');
    if (command.action === 'withdraw') {
        if (p.erasedAt || (p.withdrawnAt && !command.eraseData))
            return studyError('conflict', 'This withdrawal was already recorded.');
        p.withdrawnAt ??= now.toISOString();
        p.requestedAt = undefined;
        for (const run of p.coachingRuns ?? []) if (run.status === 'pending') { run.status = 'failed'; run.failure = 'cancelled'; run.completedAt = now.toISOString(); }
        if (command.eraseData) {
            const items = new Set(p.responses.flatMap(r => r.itemId ? [r.itemId] : []));
            record.ratings = record.ratings.filter(r => !items.has(r.itemId));
            record.events = record.events.filter(e => e.participantId !== p.id && !(e.itemId && items.has(e.itemId)));
            record.events.forEach((e, i) => { e.sequence = i + 1; });
            p.responses = [];
            p.coachingRuns = undefined;
            p.enrollmentHash = undefined;
            p.enrolledAt = undefined;
            p.consentAt = undefined;
            p.consentHash = undefined;
            p.dueAt = undefined;
            p.erasedAt = now.toISOString();
        }
        studyEvent(record, command.eraseData ? 'erased' : 'withdrawn', now, { participantId: p.id });
    }
    else {
        const phase = phases[p.responses.length];
        if (p.withdrawnAt || !phase)
            return studyError('conflict', 'This participant has completed or left the study.');
        if (command.action === 'open') {
            if (p.requestedAt)
                return p;
            if (phase === 'delayed' && now.getTime() < Date.parse(p.dueAt!))
                return studyError('conflict', 'The delayed task is not due yet.');
            p.requestedAt = now.toISOString();
            studyEvent(record, 'task-requested', now, { participantId: p.id, phase });
        }
        else {
            if (!p.requestedAt)
                return studyError('conflict', 'Request the current task before submitting.');
            if (phase === 'coaching' && record.protocol.execution) {
                const runs = p.coachingRuns ?? [];
                if (runs.some(run => run.status === 'pending' && now.getTime() < Date.parse(run.deadline)))
                    return studyError('conflict', 'Wait for the current help request before submitting or skipping.');
                if (command.action === 'answer' && !runs.some(run => run.status === 'succeeded'))
                    return studyError('conflict', 'Obtain actual help before submitting this assisted task, or skip it.');
            }
            const elapsedMs = now.getTime() - Date.parse(p.requestedAt);
            const budgetMs = record.protocol.tasks[p.responses.length]!.budgetSeconds * 1000;
            if (command.action === 'skip' && command.reason === 'timeout' && elapsedMs < budgetMs)
                return studyError('conflict', 'The task time budget has not elapsed.');
            const outcome = command.action === 'answer' ? 'answered' : command.reason;
            const itemId = command.action === 'answer' ? newStudyIdentity('work') : undefined;
            p.responses.push({ phase, outcome, requestedAt: p.requestedAt, submittedAt: now.toISOString(), elapsedMs, overBudget: elapsedMs > budgetMs,
                ...(command.action === 'answer' ? { itemId, answer: command.answer, confidence: command.confidence, assistance: command.assistance, familiar: command.familiar } : {}),
            });
            p.requestedAt = undefined;
            if (phase === 'transfer')
                p.dueAt = new Date(now.getTime() + record.protocol.delayDays * 86400000).toISOString();
            studyEvent(record, outcome, now, { participantId: p.id, phase, ...(itemId ? { itemId } : {}) });
        }
    }
    p.version++;
    p.updatedAt = now.toISOString();
    return p;
}
