import { assertNoOtherActiveVersion, performMethodTransition, reconcileMethodLifecycle } from './method-lifecycle.js';
import { readEchoPromotionReview, reviewEchoPromotionCandidate } from '../context-assets/echo-promotion.js';
import { listRetrievalReceipts, getRetrievalReceipt, type RetrievalReceipt } from '../../retrieval/receipt.js';
import { learningMethodAt, learningMethods, LearningError, type LearningLoop, type LearningCommand } from './model.js';

const candidateId = (loop: LearningLoop, index: number, revisionIndex = 0) => (index === -1 ? `${loop.id}-correction` : `${loop.id}-attempt-${index + 1}`) + (revisionIndex ? `-v${revisionIndex + 1}` : '');

// The promotion ledger is authoritative: a crash after publication must never make
// an already-authorized method look like a private draft again.
export function reconcileLearningReviews(root: string, loop: LearningLoop): LearningLoop {
  learningMethods(loop).forEach(({ method, attemptIndex: index, revisionIndex }) => {
    const review = readEchoPromotionReview(root, candidateId(loop, index, revisionIndex));
    if (review) {
      if (!method.review) {
        // Expose the completed transition to open editors too, even if the last
        // journal rename failed. The next successful write persists this version.
        loop.version += 1;
        if (review.reviewedAt > loop.updatedAt) loop.updatedAt = review.reviewedAt;
      }
      method.review = review;
    }
  });
  return reconcileMethodLifecycle(root, loop);
}

function applicableReceipt(receipt: RetrievalReceipt, assetId: string, reviewedAt: string) {
  return receipt.outcome === 'selected' && receipt.startedAt >= reviewedAt
    && !!(receipt.metadata?.runId || receipt.metadata?.chatSessionId)
    && receipt.selections.some((selection) => selection.assetId === assetId);
}

export type LearningAgentEvidence = {
  attemptIndex: number;
  revisionIndex: number;
  receipts: Array<{ id: string; startedAt: string; title: string; runId?: string; sessionId?: string }>;
};

export function learningAgentEvidence(root: string, loop: LearningLoop): LearningAgentEvidence[] {
  // One bounded projection per selected learning record; do not scan per attempt.
  const receipts = listRetrievalReceipts(root, { outcome: 'selected', limit: 500 });
  return learningMethods(loop).flatMap(({ method, attemptIndex, revisionIndex }) => {
    const review = method.review;
    if (review?.decision !== 'approved' || !review.assetId) return [];
    return [{ attemptIndex, revisionIndex, receipts: receipts.filter((receipt) => applicableReceipt(receipt, review.assetId!, review.reviewedAt))
      .slice(0, 20).map((receipt) => ({ id: receipt.id, title: receipt.queryPreview, startedAt: receipt.startedAt, runId: receipt.metadata?.runId, sessionId: receipt.metadata?.chatSessionId })) }];
  });
}

export function performAgentCommand(root: string, next: LearningLoop, command: LearningCommand, now: Date) {
  if (!('attemptIndex' in command)) return;
  const change = learningMethodAt(next, command.attemptIndex, 'revisionIndex' in command ? command.revisionIndex : 0)!;
  performMethodTransition(root, next, command, now);
  if (command.action === 'approve-agent' || command.action === 'reject-agent') {
    if (command.action === 'approve-agent') assertNoOtherActiveVersion(root, next, command.attemptIndex, command.revisionIndex ?? 0);
    // Bounded method fields fit the existing promotion contract without truncation.
    // Original message quotes remain separate from the user's later interpretation.
    change.review = reviewEchoPromotionCandidate(root, {
      decision: command.action === 'approve-agent' ? 'approve' : 'reject',
      candidate: {
        id: candidateId(next, command.attemptIndex, command.revisionIndex), kind: 'playbook', title: next.source.title,
        content: `Learning record: ${next.id}; source: ${command.attemptIndex === -1 ? 'work correction' : 'attempt ' + (command.attemptIndex + 1)}. User-proposed method, not proof of effectiveness.\n\nBehavior: ${change.behavior}\n\nScope and exceptions: ${change.scope}\n\nObservable check: ${change.check}`,
        source: { label: 'Learning practice', sessions: next.source.sessions },
      },
    }, now);
    if (change.review.decision === 'approved') change.availability = 'active';
  }
  if (command.action === 'observe-agent' || (command.action === 'counterexample-agent' && command.receiptId)) {
    const review = change.review!;
    const receipt = getRetrievalReceipt(root, command.receiptId!);
    if (!receipt || !review.assetId || !applicableReceipt(receipt, review.assetId, review.reviewedAt)) {
      throw new LearningError('invalid', 'Choose a subsequent run that actually retrieved this method.');
    }
  }
}
