import { approvedMethodAsset, verifyMethodContent } from './method-lifecycle.js';
import { getLearningLoop } from './store.js';
import { LearningError, learningMethodAt } from './model.js';

/** Validate preparation against the current approval; this never executes a task. */
export function prepareLearningMethodTrial(root: string, id: string, attemptIndex: number, version: number, revisionIndex = 0) {
  if (!Number.isSafeInteger(revisionIndex) || revisionIndex < 0 || revisionIndex > 99 || !Number.isSafeInteger(attemptIndex) || attemptIndex < -1 || attemptIndex > 99 || !Number.isSafeInteger(version) || version < 1) {
    throw new LearningError('invalid', 'Choose a valid method version.');
  }
  const loop = getLearningLoop(root, id);
  if (!loop) throw new LearningError('not-found', 'This learning record is unavailable.');
  if (loop.version !== version || loop.archived) throw new LearningError('conflict', 'This record changed. Reload before preparing a task.');
  const method = learningMethodAt(loop, attemptIndex, revisionIndex);
  const review = method?.review;
  if (review?.decision !== 'approved' || !review.assetId || !review.targetPath) throw new LearningError('conflict', 'Approve a method before trying it.');
  const asset = approvedMethodAsset(root, method!);
  if (asset.status !== 'active') throw new LearningError('conflict', 'This method is no longer active.');
  verifyMethodContent(root, asset);
  return { path: asset.path, assetId: asset.id, assetVersion: asset.version, contentHash: asset.contentHash, title: loop.source.title };
}
