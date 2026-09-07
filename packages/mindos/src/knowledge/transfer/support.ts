import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { getLearningLoop, learningMethods, prepareLearningMethodTrial, LearningError } from '../learning/index.js';
import { effectiveMindRoot } from '../../foundation/mind-root/index.js';
import { listAgentRuns } from '../../agent/ledger/run-ledger.js';
import { listRetrievalReceipts } from '../../retrieval/receipt.js';
import { methodMatchInput, transferMethodSchema, helpRunSchema, type TransferHelpRun } from './support-model.js';
import type { TransferRecord } from './model.js';
export const supportHash = (value: string) => createHash('sha256').update(value).digest('hex');

export function getTransferMethods(root: string, learningId: string) {
  const loop = getLearningLoop(root, learningId);
  if (!loop || loop.archived) return [];
  return learningMethods(loop).flatMap(({ attemptIndex, revisionIndex, method }) => {
    if (method.review?.decision !== 'approved') return [];
    try {
      const trial = prepareLearningMethodTrial(root, loop.id, attemptIndex, loop.version, revisionIndex);
      return [{ ...trial, attemptIndex, revisionIndex, behavior: method.behavior, scope: method.scope }];
    } catch { return []; } // Invalidated approvals must not be offered as active methods.
  });
}
export function matchTransferMethod(root: string, learningId: string, input: unknown, now: Date) {
  const parsed = methodMatchInput.safeParse(input);
  if (!parsed.success) throw new LearningError('invalid', 'Review how this method fits evidence interpretation before starting.');
  const selected = getTransferMethods(root, learningId).find(item => item.attemptIndex === parsed.data.attemptIndex && item.revisionIndex === parsed.data.revisionIndex);
  if (!selected || selected.assetVersion !== parsed.data.assetVersion || selected.contentHash !== parsed.data.contentHash)
    throw new LearningError('conflict', 'This approved method changed or is unavailable. Reload the choices.');
  return transferMethodSchema.parse({ ...selected, ...parsed.data, matchedAt: now.toISOString() });
}
export function validateTransferMethod(root: string, record: TransferRecord) {
  if (!record.method) return undefined;
  const loop = getLearningLoop(root, record.learningId);
  if (!loop) throw new LearningError('not-found', 'The method source is unavailable.');
  const current = prepareLearningMethodTrial(root, loop.id, record.method.attemptIndex, loop.version, record.method.revisionIndex);
  if (current.assetId !== record.method.assetId || current.assetVersion !== record.method.assetVersion || current.contentHash !== record.method.contentHash || current.path !== record.method.path)
    throw new LearningError('conflict', 'This practice refers to an earlier approved method. Its help cannot be silently replaced.');
  return current;
}
export function transferHelpPrompt(record: TransferRecord) {
  const zh = record.pack.locale === 'zh';
  return (zh ? '请帮我检查这段虚构练习材料中的推理，解释证据边界和可能的替代解释。不要评价我的一般能力。' : 'Help me examine this fictional situation. Explain evidence boundaries and alternative explanations without assessing my general ability.')
    + '\n\n' + record.pack.tasks[0]!.prompt
    + '\n\n' + (zh ? '我已提交的初始判断：' : 'My committed initial judgment:') + '\n' + (record.answers[0]?.answer ?? '')
    + '\n\n[practice-help: ' + record.id + ']';
}
export function transferHelpRuns(root: string, record: TransferRecord): TransferHelpRun[] {
  const saved = new Map((record.helpRuns ?? []).map(item => [item.runId, item]));
  if (!record.helpPreparation || fs.realpathSync(root) !== fs.realpathSync(effectiveMindRoot())) return [...saved.values()];
  const prep = record.helpPreparation; const method = record.method;
  const receipts = listRetrievalReceipts(root, { limit: 500, ...(method ? { assetId: method.assetId, outcome: 'selected' as const } : {}) });
  for (const run of listAgentRuns({ limit: 1000 })) {
    const ids = [run.metadata?.retrievalReceiptId, ...(Array.isArray(run.metadata?.retrievalReceiptIds) ? run.metadata.retrievalReceiptIds : [])];
    const receipt = receipts.find(item => ids.includes(item.id) && item.queryHash === prep.queryHash && item.startedAt >= prep.preparedAt
      && (!method || item.selections.some(selection => selection.assetId === method.assetId && selection.contentHash === method.contentHash && selection.assetVersion === method.assetVersion && !selection.truncated)));
    if (!receipt || run.startedAt < Date.parse(prep.preparedAt)) continue;
    const output = (run.outputSummary ?? '').slice(0, 5000);
    const parsed = helpRunSchema.safeParse({ runId: run.id, receiptId: receipt.id, runtimeId: run.runtimeId, status: run.status,
      output, outputHash: supportHash(output), error: run.error?.slice(0, 5000),
      model: typeof run.metadata?.model === 'string' ? run.metadata.model : undefined,
      startedAt: run.startedAt, completedAt: run.completedAt, capturedAt: new Date().toISOString(), viewRequestedAt: saved.get(run.id)?.viewRequestedAt });
    if (parsed.success) saved.set(run.id, parsed.data);
  }
  return [...saved.values()].sort((a, b) => b.startedAt - a.startedAt || a.runId.localeCompare(b.runId));
}
export function projectTransferHelp(record: TransferRecord, runs: TransferHelpRun[]) {
  const visible = ['coaching', 'complete', 'ended'].includes(record.stage);
  const snapshots = record.helpRuns ?? [];
  return runs.map(item => {
    const saved = snapshots.find(snapshot => snapshot.runId === item.runId);
    return {
      runId: item.runId, runtimeId: item.runtimeId, model: item.model, status: item.status,
      hasReply: item.status === 'completed' && !item.error && !!item.output.trim(),
      startedAt: item.startedAt, completedAt: item.completedAt, viewRequestedAt: saved?.viewRequestedAt,
      // The read endpoint never silently exposes an answer. Viewing is an explicit write.
      output: visible ? saved?.output : undefined, error: visible ? saved?.error : undefined,
    };
  });
}
