import fs from 'node:fs';
import { effectiveMindRoot } from '../../foundation/mind-root/index.js';
import { listKnowledgeAgentRuns } from '../agent-run-data.js';
import { listRetrievalReceipts } from '../../retrieval/receipt.js';
import { hashText, runSchema, type Inquiry, type InquiryRun } from './model.js';
import { fail } from './storage.js';
export function inquiryRuns(root: string, q: Inquiry): InquiryRun[] {
  if (!q.preparations.length) return [];
  if (fs.realpathSync(root) !== fs.realpathSync(effectiveMindRoot()))
    fail(
      'conflict',
      'Open the corresponding knowledge base to inspect its runs.',
    );
  const receipts = listRetrievalReceipts(root, { limit: 500 });
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const prepared = new Map(q.preparations.map((p) => [p.queryHash, p]));
  const result = new Map<string, InquiryRun>(
    q.runs.map((r) => [r.runId, { ...r, source: 'saved' }]),
  );
  for (const run of listKnowledgeAgentRuns({ limit: 1000 })) {
    // A saved terminal snapshot is immutable, even after the live ledger is edited or pruned.
    if (result.has(run.id)) continue;
    const ids = [
      run.metadata?.retrievalReceiptId,
      ...(Array.isArray(run.metadata?.retrievalReceiptIds)
        ? run.metadata.retrievalReceiptIds
        : []),
    ];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const receipt = byId.get(id);
      const prep = receipt && prepared.get(receipt.queryHash);
      if (
        !receipt ||
        !prep ||
        receipt.startedAt < prep.preparedAt ||
        run.startedAt < Date.parse(prep.preparedAt)
      )
        continue;
      const linked =
        prep.methodLinkId &&
        q.methodLinks?.find((l) => l.id === prep.methodLinkId);
      if (
        prep.methodLinkId &&
        (!linked ||
          !receipt.selections.some(
            (s) =>
              !s.truncated &&
              s.assetId === linked.asset.assetId &&
              s.path === linked.asset.path &&
              s.contentHash === linked.asset.contentHash &&
              s.assetVersion === linked.asset.assetVersion,
          ))
      )
        continue;
      const output = run.outputSummary ?? '';
      const parsed = runSchema.safeParse({
        preparationId: prep.id,
        runId: run.id,
        receiptId: receipt.id,
        status: run.status,
        output,
        error: run.error,
        runtimeId: run.runtimeId,
        model:
          typeof run.metadata?.model === 'string'
            ? run.metadata.model
            : undefined,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        capturedAt: new Date().toISOString(),
        outputHash: hashText(output),
      });
      if (parsed.success)
        result.set(run.id, { ...parsed.data, source: 'live' });
      break;
    }
  }
  return [...result.values()].sort(
    (a, b) => b.startedAt - a.startedAt || a.runId.localeCompare(b.runId),
  );
}
export function captureRuns(root: string, q: Inquiry) {
  for (const { source: _source, ...run } of inquiryRuns(root, q)) {
    if (
      !['completed', 'failed', 'canceled', 'timed_out'].includes(run.status) ||
      q.runs.some((r) => r.runId === run.runId)
    )
      continue;
    if (q.runs.length >= 60)
      fail('conflict', 'This question has reached its saved-run limit.');
    q.runs.push(run);
  }
}
