import { z } from 'zod';

export const phases = ['baseline', 'coaching', 'transfer', 'delayed'] as const;
export const phaseSchema = z.enum(phases);
const text = (max: number) => z.string().trim().min(1).max(max);
const draftText = (max: number) => z.string().max(max);
export const codeSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const timestamp = z.string().datetime();
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const studyIdSchema = z.string().regex(/^study-[a-f0-9]{24}$/);
export const participantIdSchema = z.string().regex(/^participant-[a-f0-9]{24}$/);
export const itemIdSchema = z.string().regex(/^work-[a-f0-9]{24}$/);
const unique = (values: string[]) => new Set(values).size === values.length;

export const studyDraftProtocolSchema = z.object({
  title: draftText(200), hypothesis: draftText(4000), consent: draftText(6000), withdrawal: draftText(4000),
  locale: z.enum(['en', 'zh']), delayDays: z.number().int().min(1).max(90), capacity: z.number().int().min(2).max(200),
  execution: z.object({ adapter: z.literal('isolated-chat-v1'), maxTurns: z.number().int().min(1).max(3) }).strict().optional(),
  conditions: z.array(z.object({
    id: codeSchema, label: draftText(200), instructions: draftText(6000),
    // A declared configuration is never evidence of what a provider actually executed.
    expectedRuntime: z.object({ provider: draftText(120), model: draftText(200), tools: z.array(text(120)).max(30), context: draftText(12000), endpoint: draftText(1000).optional(), temperature: z.number().finite().min(0).max(2).optional() }).strict(),
  }).strict()).min(2).max(4),
  tasks: z.array(z.object({
    phase: phaseSchema, prompt: draftText(6000), reference: draftText(6000), budgetSeconds: z.number().int().min(30).max(7200),
  }).strict()).length(4),
  rubric: z.array(z.object({ id: codeSchema, label: draftText(200), description: draftText(3000), maxScore: z.number().int().min(1).max(100) }).strict()).min(1).max(12),
}).strict().superRefine((protocol, ctx) => {
  if (!unique(protocol.conditions.map(c => c.id)) || protocol.capacity < protocol.conditions.length)
    ctx.addIssue({ code: 'custom', message: 'Choose distinct conditions and sufficient capacity.' });
  if (!unique(protocol.rubric.map(c => c.id))) ctx.addIssue({ code: 'custom', message: 'Rubric identifiers must be distinct.' });
  if (protocol.tasks.some((task, index) => task.phase !== phases[index])) ctx.addIssue({ code: 'custom', message: 'Provide all four stages in order.' });
});
export const studyProtocolSchema = studyDraftProtocolSchema.superRefine((protocol, ctx) => {
  const visit = (value: unknown, path: (string | number)[]) => {
    if (!protocol.execution && path.at(-1) === 'endpoint') return;
    if (typeof value === 'string' && !value.trim()) ctx.addIssue({ code: 'custom', message: 'Complete this field before freezing.', path });
    else if (Array.isArray(value)) value.forEach((item, i) => visit(item, [...path, i]));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, [...path, key]));
  };
  visit(protocol, []);
  if (protocol.execution) protocol.conditions.forEach((condition, i) => {
    try {
      const url = new URL(condition.expectedRuntime.endpoint ?? '');
      if (url.username || url.password || url.hash || url.search || !url.pathname.endsWith('/chat/completions') ||
        !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error();
    } catch { ctx.addIssue({ code: 'custom', message: 'Provide the exact HTTPS chat completions endpoint (local HTTP is allowed).', path: ['conditions', i, 'expectedRuntime', 'endpoint'] }); }
    if (condition.expectedRuntime.tools.length) ctx.addIssue({ code: 'custom', message: 'Isolated chat does not allow tools.', path: ['conditions', i, 'expectedRuntime', 'tools'] });
  });
});
export type StudyProtocol = z.infer<typeof studyProtocolSchema>;
export const responseFields = {
  answer: text(4000), confidence: z.number().int().min(0).max(100).nullable(),
  assistance: z.enum(['none', 'notes', 'agent', 'other']), familiar: z.boolean(),
};
const responseSchema = z.object({
  phase: phaseSchema, outcome: z.enum(['answered', 'skipped', 'timeout']),
  requestedAt: timestamp, submittedAt: timestamp, elapsedMs: z.number().nonnegative(), overBudget: z.boolean(),
  itemId: itemIdSchema.optional(), answer: responseFields.answer.optional(), confidence: responseFields.confidence.optional(),
  assistance: responseFields.assistance.optional(), familiar: z.boolean().optional(),
}).strict();
export const coachingRunSchema = z.object({
  id: z.string().regex(/^help-[a-f0-9]{24}$/), invitationId: z.string(), requestHash: digestSchema,
  question: text(2000), status: z.enum(['pending', 'succeeded', 'failed']),
  startedAt: timestamp, deadline: timestamp, completedAt: timestamp.optional(),
  inputHash: digestSchema, output: text(8000).optional(), reportedModel: text(200).optional(),
  failure: z.enum(['provider', 'configuration', 'interrupted', 'cancelled', 'invalid-output']).optional(),
  runtime: z.object({ adapter: z.literal('isolated-chat-v1'), provider: text(120), model: text(200), endpoint: text(1000),
    temperature: z.number().finite().min(0).max(2), maxOutputTokens: z.number().int().min(1024).max(4096), tools: z.array(z.never()).length(0) }).strict(),
}).strict();
export type StudyCoachingRun = z.infer<typeof coachingRunSchema>;
export const participantSchema = z.object({
  id: participantIdSchema, enrollmentHash: digestSchema.optional(), ordinal: z.number().int().nonnegative(),
  conditionId: codeSchema, version: z.number().int().positive(),
  enrolledAt: timestamp.optional(), consentAt: timestamp.optional(), consentHash: digestSchema.optional(),
  updatedAt: timestamp, requestedAt: timestamp.optional(), dueAt: timestamp.optional(),
  coachingRuns: z.array(coachingRunSchema).max(6).optional(),
  responses: z.array(responseSchema).max(4), withdrawnAt: timestamp.optional(), erasedAt: timestamp.optional(),
}).strict();
export type StudyParticipant = z.infer<typeof participantSchema>;
const ratingSchema = z.object({
  itemId: itemIdSchema, reviewerId: codeSchema, version: z.number().int().positive(),
  scores: z.record(codeSchema, z.number().int().nonnegative()), rationale: text(4000), recordedAt: timestamp,
  requestHash: digestSchema.optional(), contentHash: digestSchema.optional(),
}).strict();
export const studyRecordSchema = z.object({
  schemaVersion: z.literal(1), id: studyIdSchema, version: z.number().int().positive(),
  createdAt: timestamp, updatedAt: timestamp, status: z.enum(['draft', 'frozen']),
  creationHash: digestSchema, salt: digestSchema, protocol: studyDraftProtocolSchema,
  protocolHash: digestSchema.optional(), review: z.object({ reviewedBy: codeSchema, reviewNote: text(4000), frozenAt: timestamp }).strict().optional(),
  allocation: z.array(codeSchema).max(200), participants: z.array(participantSchema).max(200),
  invitations: z.array(z.object({
    id: z.string().regex(/^invitation-[a-f0-9]{24}$/), requestHash: digestSchema, tokenHash: digestSchema,
    protocolHash: digestSchema, createdAt: timestamp, expiresAt: timestamp, revokedAt: timestamp.optional(),
    participantId: participantIdSchema.optional(),
  }).strict()).max(1000).optional(),
  reviewerGrants: z.array(z.object({
    id: z.string().regex(/^review-grant-[a-f0-9]{24}$/), reviewerId: codeSchema, label: text(80),
    requestHash: digestSchema, creationHash: digestSchema, tokenHash: digestSchema, protocolHash: digestSchema,
    itemIds: z.array(itemIdSchema).min(1).max(800), createdAt: timestamp, expiresAt: timestamp,
    acceptedAt: timestamp.optional(), revokedAt: timestamp.optional(),
  }).strict()).max(50).optional(),
  ratings: z.array(ratingSchema).max(8000),
  events: z.array(z.object({
    sequence: z.number().int().positive(), type: z.enum(['created', 'draft-updated', 'frozen', 'enrolled', 'task-requested', 'answered', 'skipped', 'timeout', 'withdrawn', 'erased', 'rated', 'help-started', 'help-finished']),
    at: timestamp, participantId: participantIdSchema.optional(), itemId: itemIdSchema.optional(),
    phase: phaseSchema.optional(), reviewerId: codeSchema.optional(),
  }).strict()).max(12000),
}).strict();
export type StudyRecord = z.infer<typeof studyRecordSchema>;
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('answer'), version: z.number().int().positive(), ...responseFields }).strict(),
  z.object({ action: z.literal('skip'), version: z.number().int().positive(), reason: z.enum(['skipped', 'timeout']) }).strict(),
  z.object({ action: z.literal('withdraw'), version: z.number().int().positive(), eraseData: z.boolean() }).strict(),
]);

export function studyParticipantView(record: StudyRecord, participant: StudyParticipant, now: Date) {
  const nextPhase = !participant.withdrawnAt ? phases[participant.responses.length] : undefined;
  const waiting = nextPhase === 'delayed' && !!participant.dueAt && now.getTime() < Date.parse(participant.dueAt);
  const status = participant.withdrawnAt ? 'withdrawn' : !nextPhase ? 'complete' : waiting ? 'waiting' : participant.requestedAt ? 'answering' : 'ready';
  const task = participant.requestedAt && nextPhase && !waiting ? record.protocol.tasks[participant.responses.length] : undefined;
  return {
    id: participant.id, studyId: record.id, version: participant.version, title: record.protocol.title,
    protocolHash: record.protocolHash, locale: record.protocol.locale,
    consent: record.protocol.consent, withdrawal: record.protocol.withdrawal,
    status, nextPhase, completedStages: participant.responses.length, dueAt: participant.dueAt,
    task: task ? { prompt: task.prompt, budgetSeconds: task.budgetSeconds, requestedAt: participant.requestedAt } : undefined,
    instructions: task?.phase === 'coaching' ? record.protocol.conditions.find(c => c.id === participant.conditionId)!.instructions : undefined,
    ...(record.protocol.execution ? { coachingAvailable: true } : {}),
    ...(nextPhase === 'coaching' && task && record.protocol.execution ? { coaching: {
      maxTurns: record.protocol.execution.maxTurns,
      runs: (participant.coachingRuns ?? []).map(run => ({ id: run.id, question: run.question,
        status: run.status === 'pending' && now.getTime() >= Date.parse(run.deadline) ? 'interrupted' as const : run.status,
        output: run.output, startedAt: run.startedAt, deadline: run.deadline,
      })),
    } } : {}),
    erasedAt: participant.erasedAt,
  };
}
export type StudyParticipantView = ReturnType<typeof studyParticipantView>;
export function studyAdminView(record: StudyRecord) {
  return {
    id: record.id, version: record.version, status: record.status, protocol: record.protocol,
    protocolHash: record.protocolHash, review: record.review, createdAt: record.createdAt,
    updatedAt: record.updatedAt, enrolledCount: record.participants.length,
  };
}
export type StudyAdminView = ReturnType<typeof studyAdminView>;
