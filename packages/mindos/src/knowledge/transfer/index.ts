import { createHash } from 'node:crypto';
import { privateRecordNames, readPrivateRecord, writePrivateRecord, withPrivateRecordLock as locked } from '../private-records.js';
import { getLearningLoop, LearningError, learningIdSchema } from '../learning/index.js';
import { evidencePracticePack } from './pack.js';
import { z } from 'zod';
import { methodMatchInput } from './support-model.js';
import { matchTransferMethod, validateTransferMethod, transferHelpPrompt, transferHelpRuns, projectTransferHelp, supportHash } from './support.js';
export { getTransferMethods } from './support.js';
import { applyTransferCommand, newTransferRecord, projectTransfer, transferIdSchema, transferRecordSchema, transferStateIsConsistent, type TransferRecord } from './model.js';
export type { TransferView, TransferStage, TransferResponse } from './model.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function read(root: string, id: string): TransferRecord | null {
  if (!transferIdSchema.safeParse(id).success) throw new LearningError('invalid', 'Invalid practice id.');
  const value = readPrivateRecord(root, id + '.json', 512_000); if (value === null) return null;
  try {
    const record = transferRecordSchema.parse(value);
    if (record.id !== id || !transferStateIsConsistent(record) || hash(JSON.stringify(record.pack)) !== record.packHash) throw new Error('Practice integrity mismatch');
    if ((!!record.method !== !!record.methodHash) || (record.method && supportHash(JSON.stringify(record.method)) !== record.methodHash)
      || (record.helpPreparation && (record.answers.length < 1 || record.helpPreparation.queryHash !== supportHash(transferHelpPrompt(record))))
      || record.helpRuns?.some(run => !record.helpPreparation || run.outputHash !== supportHash(run.output) || (run.viewRequestedAt && (run.status !== 'completed' || !!run.error || !run.output.trim())))) throw new Error('Practice support integrity mismatch');
    return record;
  } catch { throw new LearningError('storage', 'Could not read this private practice. Existing data was preserved.'); }
}
const write = (root: string, record: TransferRecord) => writePrivateRecord(root, record.id + '.json', transferRecordSchema.parse(record), 512_000);
function project(root: string, record: TransferRecord, now: Date) {
  return { ...projectTransfer(record, now), helpRuns: projectTransferHelp(record, transferHelpRuns(root, record)) };
}
export function getTransferPractice(root: string, id: string, now = new Date()) {
  const record = read(root, id); return record ? project(root, record, now) : null;
}
export function transferPracticeId(learningId: string) {
  if (!learningIdSchema.safeParse(learningId).success) throw new LearningError('invalid', 'Choose a valid learning record.');
  return 'transfer-' + hash(learningId + ':evidence-calibration:1').slice(0, 24);
}
export function startTransferPractice(root: string, learningId: string, locale: 'en' | 'zh', now = new Date(), methodMatch?: unknown) {
  const id = transferPracticeId(learningId);
  const learning = getLearningLoop(root, learningId);
  if (!learning || learning.archived) throw new LearningError('not-found', 'Choose an available learning record.');
  return locked(root, () => {
    const existing = read(root, id);
    if (existing) {
      if (methodMatch !== undefined) {
        const requested = methodMatchInput.safeParse(methodMatch);
        const frozen = methodMatchInput.safeParse(existing.method);
        if (!requested.success || !frozen.success || JSON.stringify(requested.data) !== JSON.stringify(frozen.data))
          throw new LearningError('conflict', 'This practice already has a frozen method match. Reload it before continuing.');
      }
      return project(root, existing, now);
    }
    const names = privateRecordNames(root).filter((name) => /^transfer-[a-f0-9]{24}\.json$/.test(name));
    // Every created record has already exposed the initial task; repeated packs are not unseen tests.
    const previousExposure = names.length > 0;
    const pack = transferRecordSchema.shape.pack.parse(evidencePracticePack(locale));
    const record = newTransferRecord(id, learningId, pack, hash(JSON.stringify(pack)), previousExposure, now);
    if (methodMatch !== undefined) { record.method = matchTransferMethod(root, learningId, methodMatch, now); record.methodHash = supportHash(JSON.stringify(record.method)); }
    write(root, record); return project(root, record, now);
  });
}
export function updateTransferPractice(root: string, id: string, input: unknown, now = new Date()) {
  return locked(root, () => {
    const record = read(root, id); if (!record) throw new LearningError('not-found', 'Practice not found.');
    const next = applyTransferCommand(record, input, now); write(root, next); return project(root, next, now);
  });
}

function coachingRecord(root: string, id: string, version: number, now: Date) {
  const record = read(root, id);
  if (!record) throw new LearningError('not-found', 'Practice not found.');
  if (record.stage !== 'coaching' || record.version !== version || now.getTime() < Date.parse(record.updatedAt))
    throw new LearningError('conflict', 'Help is available after committing the initial answer and before moving on.');
  return record;
}
const helpCommand = z.object({ version: z.number().int().positive() });
export function prepareTransferHelp(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = helpCommand.safeParse(input);
  if (!parsed.success) throw new LearningError('invalid', 'Reload before preparing help.');
  return locked(root, () => {
    const record = coachingRecord(root, id, parsed.data.version, now);
    const method = validateTransferMethod(root, record);
    const prompt = transferHelpPrompt(record);
    if (!record.helpPreparation) {
      record.agentHelpPreparedAt ??= now.toISOString();
      record.helpPreparation = { queryHash: supportHash(prompt), preparedAt: now.toISOString() };
      record.version++; record.updatedAt = now.toISOString(); write(root, record);
    }
    return { practice: project(root, record, now), draft: { prompt, ...(method ? { path: method.path, title: method.title } : {}) } };
  });
}
export function inspectTransferHelp(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = helpCommand.extend({ runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/) }).safeParse(input);
  if (!parsed.success) throw new LearningError('invalid', 'Choose a recorded help run.');
  return locked(root, () => {
    const record = coachingRecord(root, id, parsed.data.version, now);
    const run = transferHelpRuns(root, record).find(item => item.runId === parsed.data.runId);
    if (!run || ['queued', 'running', 'streaming'].includes(run.status)) throw new LearningError('conflict', 'This help has not returned a result.');
    const index = record.helpRuns?.findIndex(item => item.runId === run.runId) ?? -1;
    if (index < 0 && (record.helpRuns?.length ?? 0) >= 8) throw new LearningError('conflict', 'The saved help limit was reached; existing results remain available.');
    const snapshot = { ...run, capturedAt: now.toISOString(), viewRequestedAt: run.status === 'completed' && !run.error && run.output.trim() ? (run.viewRequestedAt ?? now.toISOString()) : undefined };
    record.helpRuns ??= [];
    if (index < 0) record.helpRuns.push(snapshot); else record.helpRuns[index] = snapshot;
    record.version++; record.updatedAt = now.toISOString(); write(root, record);
    return project(root, record, now);
  });
}

export type TransferSummary = {
  id: string; learningId: string; title: string; stage: TransferRecord['stage'];
  version: number; updatedAt: string; dueAt?: string; status: 'due' | 'continue' | 'scheduled';
};
export function listTransferPractices(root: string, now = new Date()): { practices: TransferSummary[]; unavailableCount: number } {
  const practices: TransferSummary[] = []; let unavailableCount = 0;
  try {
    // Read one bounded record at a time; never accumulate task packs or answers in the list response.
    for (const name of privateRecordNames(root)) {
      if (!/^transfer-[a-f0-9]{24}\.json$/.test(name)) continue;
      try {
        const record = read(root, name.slice(0, -5));
        if (!record || ['complete', 'ended'].includes(record.stage)) continue;
        const status = record.stage !== 'waiting' ? 'continue' : now.getTime() >= Date.parse(record.dueAt!) ? 'due' : 'scheduled';
        practices.push({ id: record.id, learningId: record.learningId, title: record.pack.title, stage: record.stage, version: record.version, updatedAt: record.updatedAt, dueAt: record.dueAt, status });
      } catch { unavailableCount++; }
    }
  } catch { throw new LearningError('storage', 'Could not load pending practices. Please retry.'); }
  const priority = { due: 0, continue: 1, scheduled: 2 };
  practices.sort((a, b) => priority[a.status] - priority[b.status]
    || (a.status === 'continue' ? b.updatedAt.localeCompare(a.updatedAt) : (a.dueAt ?? '').localeCompare(b.dueAt ?? '')) || a.id.localeCompare(b.id));
  return { practices, unavailableCount };
}
