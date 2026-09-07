import {
  getLearningLoop,
  listLearningLoops,
  learningMethodAt,
  learningMethods,
  learningMethodFingerprint,
  prepareLearningMethodTrial,
  proposeInquiryMethodRevision,
} from '../learning/index.js';
import {
  approvedMethodAsset,
  verifyMethodContent,
} from '../learning/method-lifecycle.js';
import { fail } from './storage.js';
import type { Inquiry, InquiryMethodLink } from './model.js';
export function inquiryMethodOptions(root: string) {
  return listLearningLoops(root)
    .filter((loop) => !loop.archived)
    .flatMap((loop) =>
      learningMethods(loop)
        .filter((item) => {
          const family = learningMethodAt(loop, item.attemptIndex)!;
          return (
            item.revisionIndex === (family.revisions?.length ?? 0) &&
            item.method.review?.decision === 'approved' &&
            ['active', 'deprecated'].includes(item.method.availability ?? '')
          );
        })
        .map((item) => ({
          learningId: loop.id,
          attemptIndex: item.attemptIndex,
          revisionIndex: item.revisionIndex,
          baseHash: learningMethodFingerprint(item.method),
          title: loop.source.title,
          behavior: item.method.behavior,
          scope: item.method.scope,
          check: item.method.check,
          status: item.method.availability,
        })),
    );
}
export function linkInquiryMethod(
  root: string,
  q: Inquiry,
  c: {
    frameId: string;
    learningId: string;
    attemptIndex: number;
    revisionIndex: number;
    baseHash: string;
  },
  now: Date,
) {
  if (q.draft || !q.frames.some((f) => f.id === c.frameId))
    fail('conflict', 'Commit the framing before linking a method.');
  const loop = getLearningLoop(root, c.learningId);
  const method =
    loop && learningMethodAt(loop, c.attemptIndex, c.revisionIndex);
  const family = loop && learningMethodAt(loop, c.attemptIndex);
  if (
    !loop ||
    loop.archived ||
    !method ||
    method.review?.decision !== 'approved' ||
    c.revisionIndex !== (family?.revisions?.length ?? 0) ||
    learningMethodFingerprint(method) !== c.baseHash
  )
    fail('conflict', 'Review the current approved method before linking it.');
  if (
    q.methodLinks?.some(
      (l) =>
        l.frameId === c.frameId &&
        l.learningId === c.learningId &&
        l.attemptIndex === c.attemptIndex &&
        l.revisionIndex === c.revisionIndex,
    )
  )
    fail('conflict', 'This method version is already linked to this framing.');
  const asset = approvedMethodAsset(root, method);
  verifyMethodContent(root, asset);
  if (!['active', 'deprecated'].includes(asset.status))
    fail('conflict', 'This method is unavailable.');
  const review = method.review!;
  (q.methodLinks ??= []).push({
    id: 'method-' + ((q.methodLinks?.length ?? 0) + 1),
    frameId: c.frameId,
    linkedAt: now.toISOString(),
    learningId: c.learningId,
    attemptIndex: c.attemptIndex,
    revisionIndex: c.revisionIndex,
    baseHash: c.baseHash,
    method: {
      behavior: method.behavior,
      scope: method.scope,
      check: method.check,
      proposedAt: method.proposedAt,
      review: {
        cardId: review.cardId,
        decision: 'approved',
        reviewedAt: review.reviewedAt,
        candidateHash: review.candidateHash,
        assetId: asset.id,
        targetPath: asset.path,
      },
    },
    asset: {
      assetId: asset.id,
      path: asset.path,
      assetVersion: asset.version,
      contentHash: asset.contentHash,
    },
  });
}
export function linkedInquiryMethod(q: Inquiry, id: string): InquiryMethodLink {
  const link = q.methodLinks?.find((l) => l.id === id);
  if (!link) return fail('invalid', 'Choose a linked method.');
  return link;
}
export function prepareLinkedInquiryMethod(
  root: string,
  link: InquiryMethodLink,
): string {
  const loop = getLearningLoop(root, link.learningId);
  const method =
    loop && learningMethodAt(loop, link.attemptIndex, link.revisionIndex);
  if (!loop || !method || learningMethodFingerprint(method) !== link.baseHash)
    return fail('conflict', 'The linked method changed. Review it again.');
  const trial = prepareLearningMethodTrial(
    root,
    loop.id,
    link.attemptIndex,
    loop.version,
    link.revisionIndex,
  );
  if (
    trial.assetId !== link.asset.assetId ||
    trial.path !== link.asset.path ||
    trial.assetVersion !== link.asset.assetVersion ||
    trial.contentHash !== link.asset.contentHash
  )
    return fail(
      'conflict',
      'The linked method asset changed. Review it again.',
    );
  return trial.path;
}
export function reviseInquiryMethod(
  root: string,
  q: Inquiry,
  c: {
    decisionId: string;
    methodLinkId: string;
    reason: string;
    behavior: string;
    scope: string;
    check: string;
  },
  now: Date,
) {
  const decision = q.decisions.find((d) => d.id === c.decisionId);
  const link = linkedInquiryMethod(q, c.methodLinkId);
  if (
    q.draft ||
    !decision ||
    decision.outcome === 'open' ||
    !decision.evidenceIds.length ||
    link.frameId !== decision.frameId ||
    (decision.methodDraftId &&
      (!decision.methodRevision ||
        decision.methodRevision.methodLinkId !== link.id))
  )
    fail(
      'conflict',
      'Choose an evidence-linked decision and its revision target.',
    );
  const loop = proposeInquiryMethodRevision(
    root,
    link.learningId,
    {
      inquiryId: q.id,
      decisionId: decision.id,
      linkId: link.id,
      attemptIndex: link.attemptIndex,
      revisionIndex: link.revisionIndex,
      baseHash: link.baseHash,
      reason: c.reason,
      behavior: c.behavior,
      scope: c.scope,
      check: c.check,
    },
    now,
  );
  decision.methodDraftId = loop.id;
  decision.methodRevision = {
    methodLinkId: link.id,
    revisionIndex: link.revisionIndex + 1,
  };
}
