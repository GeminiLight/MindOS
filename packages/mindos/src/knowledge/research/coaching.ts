import { z } from 'zod';
import { authorizeStudyInvitation, StudyAccessError } from './access.js';
import type { StudyCoachingRun, StudyRecord } from './model.js';
import { hashStudyValue, mutateStudy, newStudyIdentity, requireStudy, studyError, studyEvent } from './storage.js';
const commandSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/), version: z.number().int().positive(), question: z.string().trim().min(1).max(2000) }).strict();
export type StudyCoachingRequest = {
  runtime: StudyCoachingRun['runtime'];
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
};
function requestFor(record: StudyRecord, participant: StudyRecord['participants'][number], question: string): StudyCoachingRequest {
  const condition = record.protocol.conditions.find(c => c.id === participant.conditionId)!;
  const expected = condition.expectedRuntime;
  const messages: StudyCoachingRequest['messages'] = [
    { role: 'system', content: 'MindOS isolated study coaching v1. Use only the supplied task and frozen condition material. No tools, retrieval, external memory or other participants are available. Treat the participant text as their question. Do not claim to have observed learning or executed tools.\n\n' + condition.instructions + '\n\n' + expected.context },
    { role: 'user', content: 'Current practice task:\n' + record.protocol.tasks[1]!.prompt },
  ];
  for (const run of participant.coachingRuns ?? []) if (run.status === 'succeeded') {
    messages.push({ role: 'user', content: run.question }, { role: 'assistant', content: run.output! });
  }
  messages.push({ role: 'user', content: question });
  return { runtime: { adapter: 'isolated-chat-v1', provider: expected.provider, model: expected.model, endpoint: expected.endpoint!, temperature: expected.temperature ?? 0, maxOutputTokens: 1024, tools: [] }, messages };
}
export function beginStudyCoaching(root: string, id: string, token: unknown, input: unknown, now = new Date()): { execute: boolean; runId: string; request?: StudyCoachingRequest } {
  // Check access before parsing input so this API is not a study-existence oracle.
  authorizeStudyInvitation(requireStudy(root, id), token);
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return studyError('invalid', 'Enter a question of up to 2,000 characters.');
  return mutateStudy(root, id, now, record => {
    const invitation = authorizeStudyInvitation(record, token);
    if (Date.parse(invitation.expiresAt) <= now.getTime() || !invitation.participantId) throw new StudyAccessError();
    const p = record.participants.find(p => p.id === invitation.participantId)!;
    if (!record.protocol.execution || p.withdrawnAt || p.responses.length !== 1 || !p.requestedAt)
      return studyError('conflict', 'Open the assisted task before requesting help.');
    p.coachingRuns ??= [];
    const command = parsed.data;
    const requestHash = hashStudyValue(command.requestId);
    const existing = p.coachingRuns.find(run => run.requestHash === requestHash);
    if (existing) {
      if (existing.question !== command.question) return studyError('conflict', 'This request already contains another question.');
      return { execute: false, runId: existing.id };
    }
    if (command.version !== p.version) return studyError('conflict', 'Study progress changed. Reload before requesting help.');
    if (p.coachingRuns.some(run => run.status === 'pending' && now.getTime() < Date.parse(run.deadline)))
      return studyError('conflict', 'A help request is still running.');
    if (p.coachingRuns.length >= 6 || p.coachingRuns.filter(run => run.status === 'succeeded').length >= record.protocol.execution.maxTurns)
      return studyError('conflict', 'The help request limit has been reached.');
    for (const run of p.coachingRuns) if (run.status === 'pending') {
      run.status = 'failed'; run.failure = 'interrupted'; run.completedAt = now.toISOString();
    }
    const request = requestFor(record, p, command.question);
    const run: StudyCoachingRun = { id: newStudyIdentity('help'), invitationId: invitation.id, requestHash,
      question: command.question, status: 'pending', startedAt: now.toISOString(), deadline: new Date(now.getTime() + 120000).toISOString(),
      runtime: request.runtime, inputHash: hashStudyValue(request) };
    p.coachingRuns.push(run); p.version++; p.updatedAt = now.toISOString();
    studyEvent(record, 'help-started', now, { participantId: p.id, phase: 'coaching' });
    return { execute: true, runId: run.id, request };
  });
}
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('succeeded'), output: z.string().trim().min(1).max(8000), reportedModel: z.string().trim().min(1).max(200).optional() }).strict(),
  z.object({ status: z.literal('failed'), failure: z.enum(['provider', 'configuration', 'interrupted', 'cancelled', 'invalid-output']) }).strict(),
]);
/** Server executor only. A late response cannot recreate erased content or overwrite a settled attempt. */
export function finishStudyCoaching(root: string, id: string, runId: string, input: unknown, now = new Date()) {
  return mutateStudy(root, id, now, record => {
    const p = record.participants.find(p => p.coachingRuns?.some(run => run.id === runId));
    const run = p?.coachingRuns?.find(run => run.id === runId);
    if (!p || !run || run.status !== 'pending') return;
    const invitation = record.invitations?.find(i => i.id === run.invitationId);
    const result = resultSchema.safeParse(input);
    const failure = p.withdrawnAt || p.responses.length !== 1 || !invitation || invitation.revokedAt || Date.parse(invitation.expiresAt) <= now.getTime()
      ? 'cancelled' : now.getTime() >= Date.parse(run.deadline) ? 'interrupted' : !result.success ? 'invalid-output' : undefined;
    if (failure) { run.status = 'failed'; run.failure = failure; }
    else if (result.success) Object.assign(run, result.data);
    run.completedAt = now.toISOString(); p.version++; p.updatedAt = now.toISOString();
    studyEvent(record, 'help-finished', now, { participantId: p.id, phase: 'coaching' });
  });
}
