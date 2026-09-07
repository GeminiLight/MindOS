import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { LearningError, learningMethodAt, learningIdSchema } from '../learning/model.js';
import { getLearningLoop } from '../learning/store.js';
import { approvedMethodAsset, verifyMethodContent } from '../learning/method-lifecycle.js';
import { privateRecordNames, readPrivateRecord, writePrivateRecord, withPrivateRecordLock } from '../private-records.js';
import { comparisonSchema, comparisonId, createComparisonSchema, comparisonRequestId, comparisonResultSchema, comparisonFrozenHash, comparisonHash, comparisonBodyHash, comparisonRunRequest, type MethodComparison, type MethodComparisonResult } from './model.js';
export type { MethodComparison, MethodComparisonRequest, MethodComparisonResult } from './model.js';
const limit = 3_000_000;
function read(root: string, id: string): MethodComparison | null {
  if (!comparisonId.safeParse(id).success) throw new LearningError('invalid', 'Choose a comparison.');
  const raw = readPrivateRecord(root, id + '.json', limit);
  if (raw === null) return null;
  try {
    const c = comparisonSchema.parse(raw);
    if (c.id !== id || comparisonFrozenHash(c) !== c.frozenHash || c.methods.some(m => comparisonBodyHash(m.body) !== m.contentHash)
      || c.slots.length !== c.repetitions * 6 || new Set(c.runs.map(r => r.id)).size !== c.runs.length
      || c.runs.some(r => !c.slots[r.slot] || comparisonHash(r.request) !== r.requestHash || r.requestHash !== comparisonHash(comparisonRunRequest(c, r.slot))
        || (r.status === 'succeeded' ? !r.output || r.outputHash !== comparisonBodyHash(r.output) || !!r.failure : r.output !== undefined || r.outputHash !== undefined)
        || (r.status === 'failed' && !r.failure))
      || c.assessments.some((a, i) => !c.runs.some(r => r.id === a.runId && r.status === 'succeeded' && r.output!.includes(a.quote))
        || (a.supersedes !== undefined && (a.supersedes >= i || c.assessments[a.supersedes]?.runId !== a.runId)))) throw Error('Integrity');
    return c;
  } catch { throw new LearningError('storage', 'This comparison is unreadable. Existing data was preserved.'); }
}
const write = (root: string, c: MethodComparison) => writePrivateRecord(root, c.id + '.json', comparisonSchema.parse(c), limit);
function required(root: string, id: string) { const c = read(root, id); if (!c) throw new LearningError('not-found', 'Comparison not found.'); return c; }
function checkVersion(c: MethodComparison, version: number, now: Date) {
  if (c.version !== version || now.getTime() < Date.parse(c.updatedAt)) throw new LearningError('conflict', 'Reload this comparison before saving.');
}
function save(root: string, c: MethodComparison, now: Date) { c.version++; c.updatedAt = now.toISOString(); write(root, c); return c; }
function expire(c: MethodComparison, now: Date) {
  let changed = false;
  for (const run of c.runs) if (run.status === 'running' && now.getTime() - Date.parse(run.startedAt) > 120000) { run.status = 'unknown'; run.finishedAt = now.toISOString(); changed = true; }
  return changed;
}
export function getMethodComparison(root: string, id: string, now = new Date()) {
  return withPrivateRecordLock(root, () => { const c = read(root, id); if (c && expire(c, now)) save(root, c, now); return c; });
}
export function listMethodComparisons(root: string, learningId: string, attemptIndex: number) {
  if (!learningIdSchema.safeParse(learningId).success || !Number.isSafeInteger(attemptIndex) || attemptIndex < -1 || attemptIndex > 99) throw new LearningError('invalid', 'Choose a method family.');
  const comparisons: MethodComparison[] = []; let unavailableCount = 0;
  for (const name of privateRecordNames(root)) {
    if (!/^comparison-[a-f0-9]{24}\.json$/.test(name)) continue;
    try { const c = read(root, name.slice(0, -5)); if (c?.learningId === learningId && c.attemptIndex === attemptIndex) comparisons.push(c); } catch { unavailableCount++; }
  }
  return { comparisons: comparisons.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)), unavailableCount };
}
export function createMethodComparison(root: string, input: unknown, now = new Date()): MethodComparison {
  const parsed = createComparisonSchema.safeParse(input);
  if (!parsed.success) throw new LearningError('invalid', 'Choose two versions, three different cases and a valid budget.');
  const p = parsed.data;
  return withPrivateRecordLock(root, () => {
    const id = 'comparison-' + comparisonHash([p.learningId, p.attemptIndex, p.requestId]).slice(0, 24);
    const { version, ...intent } = p; const inputHash = comparisonHash(intent);
    const existing = read(root, id);
    if (existing) { if (existing.inputHash !== inputHash) throw new LearningError('conflict', 'This request was already used for another comparison.'); return existing; }
    const loop = getLearningLoop(root, p.learningId);
    if (!loop) throw new LearningError('not-found', 'Method not found.');
    if (loop.version !== version || loop.archived) throw new LearningError('conflict', 'This method changed. Reload before comparing.');
    if (listMethodComparisons(root, loop.id, p.attemptIndex).comparisons.length >= 30) throw new LearningError('conflict', 'This family has reached thirty comparisons.');
    const methods = p.revisions.map(revisionIndex => {
      const method = learningMethodAt(loop, p.attemptIndex, revisionIndex);
      if (method?.review?.decision !== 'approved') throw new LearningError('conflict', 'Choose approved versions.');
      const asset = approvedMethodAsset(root, method);
      if (!['active', 'deprecated'].includes(asset.status)) throw new LearningError('conflict', 'This approved version is unavailable.');
      verifyMethodContent(root, asset);
      const body = fs.readFileSync(resolveExistingSafe(root, asset.path), 'utf8');
      // Recheck the bytes actually frozen after reading; a concurrent edit must not enter a valid snapshot.
      if (body.length > 16000 || comparisonBodyHash(body) !== asset.contentHash) throw new LearningError('conflict', 'This method file changed or exceeds the comparison budget.');
      return { revisionIndex, assetId: asset.id, assetVersion: asset.version, path: asset.path, contentHash: asset.contentHash, body, behavior: method.behavior, scope: method.scope, check: method.check };
    });
    const slots: MethodComparison['slots'] = [];
    for (let repetition = 0; repetition < p.repetitions; repetition++) for (const { kind } of p.cases) {
      const side = randomInt(2) as 0 | 1; slots.push({ kind, repetition, side }, { kind, repetition, side: (1 - side) as 0 | 1 });
    }
    const c = comparisonSchema.parse({ schemaVersion: 1, id, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), learningId: loop.id, title: loop.source.title, attemptIndex: p.attemptIndex, requestId: p.requestId, inputHash, frozenHash: 'pending', repetitions: p.repetitions, methods, cases: p.cases, runtime: p.runtime, slots, runs: [], assessments: [] });
    c.frozenHash = comparisonFrozenHash(c); write(root, c); return c;
  });
}
const beginSchema = z.object({ version: z.number().int().positive(), slot: z.number().int().min(0).max(17), requestId: comparisonRequestId });
export function beginMethodComparisonRun(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = beginSchema.safeParse(input); if (!parsed.success) throw new LearningError('invalid', 'Choose a valid comparison task.');
  const p = parsed.data;
  return withPrivateRecordLock(root, () => {
    const c = required(root, id); if (expire(c, now)) save(root, c, now);
    const prior = c.runs.find(r => r.id === p.requestId);
    if (prior) { if (prior.slot !== p.slot) throw new LearningError('conflict', 'This request belongs to another task.'); return { execute: false, runId: prior.id, record: c }; }
    checkVersion(c, p.version, now);
    if (!c.slots[p.slot] || c.runs.some(r => r.status === 'running') || c.runs.filter(r => r.slot === p.slot).length >= 2 || c.runs.some(r => r.slot === p.slot && r.status === 'succeeded')) throw new LearningError('conflict', 'This task cannot start another run.');
    const request = comparisonRunRequest(c, p.slot);
    c.runs.push({ id: p.requestId, slot: p.slot, startedAt: now.toISOString(), request, requestHash: comparisonHash(request), status: 'running' });
    save(root, c, now); return { execute: true, runId: p.requestId, request, record: c };
  });
}
export function finishMethodComparisonRun(root: string, id: string, runId: string, result: MethodComparisonResult, now = new Date()) {
  const parsed = comparisonResultSchema.safeParse(result); if (!parsed.success) throw new LearningError('invalid', 'Invalid execution result.');
  return withPrivateRecordLock(root, () => {
    const c = required(root, id); const run = c.runs.find(r => r.id === runId);
    if (!run || run.status !== 'running' || now.getTime() < Date.parse(run.startedAt)) throw new LearningError('conflict', 'This reservation is no longer active.');
    Object.assign(run, parsed.data, { finishedAt: now.toISOString() });
    if (parsed.data.status === 'succeeded') run.outputHash = comparisonBodyHash(parsed.data.output);
    return save(root, c, now);
  });
}
const assessSchema = z.object({ version: z.number().int().positive(), requestId: comparisonRequestId, runId: comparisonRequestId, outcome: z.enum(['met', 'missed', 'uncertain']), quote: z.string().trim().min(1).max(1200), reason: z.string().trim().min(1).max(1600) });
export function assessMethodComparison(root: string, id: string, input: unknown, now = new Date()) {
  const parsed = assessSchema.safeParse(input); if (!parsed.success) throw new LearningError('invalid', 'Quote the output and explain your judgment.');
  const { version, ...p } = parsed.data;
  return withPrivateRecordLock(root, () => {
    const c = required(root, id); const prior = c.assessments.find(a => a.requestId === p.requestId);
    if (prior) { if (Object.entries(p).some(([key, value]) => prior[key as keyof typeof p] !== value)) throw new LearningError('conflict', 'This assessment request changed.'); return c; }
    checkVersion(c, version, now); const run = c.runs.find(r => r.id === p.runId);
    if (run?.status !== 'succeeded' || !run.output?.includes(p.quote) || c.assessments.length >= 100) throw new LearningError('invalid', 'Choose successful output and an exact quotation.');
    const supersedes = c.assessments.map(a => a.runId).lastIndexOf(p.runId);
    c.assessments.push({ ...p, recordedAt: now.toISOString(), ...(supersedes >= 0 ? { supersedes } : {}) }); return save(root, c, now);
  });
}
