import { z } from 'zod';
import type { TransferPack } from './pack.js';
import { LearningError } from '../learning/model.js';
import { transferMethodSchema, helpPreparationSchema, helpRunSchema } from './support-model.js';
import { projectTransferHelp } from './support.js';
export const transferIdSchema = z.string().regex(/^transfer-[a-f0-9]{24}$/);
const phase = z.enum(['baseline', 'coaching', 'transfer', 'delayed']);
const response = z.object({ answer: z.string().trim().min(1).max(4000), confidence: z.number().int().min(0).max(100).nullable(), assistance: z.enum(['none', 'notes', 'agent']), familiar: z.boolean() });
export const transferCommandSchema = z.discriminatedUnion('action', [
  response.extend({ action: z.literal('answer'), version: z.number().int().positive() }),
  z.object({ action: z.literal('prepare-agent'), version: z.number().int().positive() }),
  z.object({ action: z.literal('guidance'), version: z.number().int().positive() }),
  z.object({ action: z.literal('begin-delayed'), version: z.number().int().positive() }),
  z.object({ action: z.literal('end'), version: z.number().int().positive(), reason: z.enum(['stopped', 'skipped', 'timeout']) }),
]);
export const transferRecordSchema = z.object({
  id: transferIdSchema, schemaVersion: z.literal(1), learningId: z.string(), version: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), phaseOpenedAt: z.string().datetime(),
  stage: z.enum(['baseline', 'coaching', 'transfer', 'waiting', 'delayed', 'complete', 'ended']),
  pack: z.object({ id: z.string(), version: z.number(), locale: z.enum(['en', 'zh']), delayDays: z.number().int().min(1).max(90), title: z.string(), guidance: z.string(), criteria: z.array(z.string()), tasks: z.array(z.object({ id: z.string(), prompt: z.string(), reference: z.string() })).length(3) }),
  packHash: z.string().regex(/^[a-f0-9]{64}$/), previousExposure: z.boolean(),
  answers: z.array(response.extend({ phase, submittedAt: z.string().datetime(), elapsedMs: z.number().nonnegative() })).max(4),
  agentHelpPreparedAt: z.string().datetime().optional(),
  method: transferMethodSchema.optional(), methodHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  helpPreparation: helpPreparationSchema.optional(), helpRuns: z.array(helpRunSchema).max(8).optional(),
  guidanceViewedAt: z.string().datetime().optional(), dueAt: z.string().datetime().optional(),
  ending: z.object({ reason: z.enum(['stopped', 'skipped', 'timeout']), stage: z.string(), recordedAt: z.string().datetime() }).optional(),
});
export type TransferRecord = z.infer<typeof transferRecordSchema>;
export type TransferResponse = TransferRecord['answers'][number];
export type TransferStage = TransferRecord['stage'];
const taskIndex = (stage: string) => stage === 'delayed' ? 2 : stage === 'transfer' ? 1 : 0;
export function projectTransfer(record: TransferRecord, now: Date) {
  const terminal = record.stage === 'complete' || record.stage === 'ended';
  return {
    id: record.id, learningId: record.learningId, version: record.version, stage: record.stage, createdAt: record.createdAt,
    method: record.method,
    helpRuns: projectTransferHelp(record, record.helpRuns ?? []),
    title: record.pack.title, locale: record.pack.locale, previousExposure: record.previousExposure,
    protocol: { id: record.pack.id, version: record.pack.version, hash: record.packHash, delayDays: record.pack.delayDays },
    dueAt: record.dueAt, delayedReady: !!record.dueAt && now.getTime() >= Date.parse(record.dueAt),
    canRecordTimeout: !terminal && record.stage !== 'waiting' && now.getTime() - Date.parse(record.phaseOpenedAt) >= 15 * 60_000,
    task: !terminal && record.stage !== 'waiting' ? { id: record.pack.tasks[taskIndex(record.stage)]!.id, prompt: record.pack.tasks[taskIndex(record.stage)]!.prompt } : undefined,
    guidance: record.stage === 'coaching' && record.guidanceViewedAt ? record.pack.guidance : undefined,
    previousAnswer: record.stage === 'coaching' ? record.answers[0] : undefined,
    ending: record.ending,
    history: terminal ? record.answers.map((answer) => ({
      response: answer, task: record.pack.tasks[taskIndex(answer.phase)]!.prompt,
      reference: record.pack.tasks[taskIndex(answer.phase)]!.reference,
      independent: answer.phase !== 'coaching' && answer.assistance === 'none' && !answer.familiar && !record.previousExposure,
    })) : undefined,
    criteria: terminal ? record.pack.criteria : undefined,
    // These are exposure facts, never an inferred learning score.
    guidanceViewedAt: record.guidanceViewedAt, agentHelpPreparedAt: record.agentHelpPreparedAt,
  };
}
export type TransferView = ReturnType<typeof projectTransfer>;
export function transferStateIsConsistent(record: TransferRecord) {
  const counts: Record<string, number> = { baseline: 0, coaching: 1, transfer: 2, waiting: 3, delayed: 3, complete: 4 };
  const expected = record.stage === 'ended' ? counts[record.ending?.stage ?? ''] : counts[record.stage];
  if (record.answers.length !== expected || (record.stage === 'ended') !== !!record.ending) return false;
  if (record.answers.some((answer, index) => answer.phase !== ['baseline', 'coaching', 'transfer', 'delayed'][index]
    || Date.parse(answer.submittedAt) < Date.parse(record.answers[index - 1]?.submittedAt ?? record.createdAt)
    || Date.parse(answer.submittedAt) > Date.parse(record.updatedAt))) return false;
  if ((record.guidanceViewedAt || record.agentHelpPreparedAt) && record.answers.length < 1) return false;
  if (record.answers.length >= 3 && (!record.dueAt || Date.parse(record.dueAt) !== Date.parse(record.answers[2]!.submittedAt) + record.pack.delayDays * 86_400_000)) return false;
  if ((record.stage === 'delayed' || record.stage === 'complete') && Date.parse(record.phaseOpenedAt) < Date.parse(record.dueAt!)) return false;
  return Date.parse(record.updatedAt) >= Date.parse(record.createdAt);
}
export function applyTransferCommand(record: TransferRecord, input: unknown, now: Date): TransferRecord {
  const parsed = transferCommandSchema.safeParse(input);
  if (!parsed.success) throw new LearningError('invalid', 'Complete the answer and report assistance and familiarity.');
  const command = parsed.data;
  if (record.version !== command.version || ['complete', 'ended'].includes(record.stage)) throw new LearningError('conflict', 'This practice changed. Reload before saving.');
  if (now.getTime() < Date.parse(record.updatedAt)) throw new LearningError('conflict', 'The clock moved backwards. Please retry when the time is correct.');
  const next = structuredClone(record);
  const reject = () => { throw new LearningError('conflict', 'This action is unavailable at this practice step.'); };
  if (command.action === 'answer') {
    const current = phase.safeParse(record.stage); if (!current.success) return reject();
    next.answers.push({ answer: command.answer, confidence: command.confidence, assistance: command.assistance, familiar: command.familiar, phase: current.data, submittedAt: now.toISOString(), elapsedMs: now.getTime() - Date.parse(record.phaseOpenedAt) });
    next.stage = { baseline: 'coaching', coaching: 'transfer', transfer: 'waiting', delayed: 'complete' }[current.data] as TransferStage;
    if (next.stage === 'waiting') next.dueAt = new Date(now.getTime() + record.pack.delayDays * 86_400_000).toISOString();
    next.phaseOpenedAt = now.toISOString();
  } else if (command.action === 'prepare-agent') {
    if (record.stage !== 'coaching' || record.agentHelpPreparedAt) return reject();
    next.agentHelpPreparedAt = now.toISOString();
  } else if (command.action === 'guidance') {
    if (record.stage !== 'coaching' || record.guidanceViewedAt) return reject();
    next.guidanceViewedAt = now.toISOString();
  } else if (command.action === 'begin-delayed') {
    if (record.stage !== 'waiting' || !record.dueAt || now.getTime() < Date.parse(record.dueAt)) return reject();
    next.stage = 'delayed'; next.phaseOpenedAt = now.toISOString();
  } else {
    if (command.reason === 'timeout' && !projectTransfer(record, now).canRecordTimeout) return reject();
    next.ending = { reason: command.reason, stage: record.stage, recordedAt: now.toISOString() }; next.stage = 'ended';
  }
  next.version++; next.updatedAt = now.toISOString();
  return transferRecordSchema.parse(next);
}
export function newTransferRecord(id: string, learningId: string, pack: TransferPack, packHash: string, previousExposure: boolean, now: Date): TransferRecord {
  return { id, learningId, schemaVersion: 1, version: 1, stage: 'baseline', createdAt: now.toISOString(), updatedAt: now.toISOString(), phaseOpenedAt: now.toISOString(), pack, packHash, previousExposure, answers: [] };
}
