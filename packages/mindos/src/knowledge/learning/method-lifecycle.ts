import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { readContextAssetRegistry, transitionContextAssetStatus } from '../context-assets/registry.js';
import { LearningError, learningMethodAt, learningMethods, methodTransitionSchema, type LearningLoop, type LearningMethod, type LearningCommand } from './model.js';

export function approvedMethodAsset(root: string, method: LearningMethod, assets = readContextAssetRegistry(root).assets) {
  const review = method.review;
  const asset = assets.find((item) => item.id === review?.assetId);
  if (review?.decision !== 'approved' || !asset || asset.path !== review.targetPath || asset.source.kind !== 'echo-card' || asset.source.ref !== 'echo-card:' + review.cardId) {
    throw new LearningError('conflict', 'This approved method is unavailable.');
  }
  return asset;
}
export function verifyMethodContent(root: string, asset: ReturnType<typeof approvedMethodAsset>) {
  try {
    const file = resolveExistingSafe(root, asset.path);
    if (fs.statSync(file).size > 64_000 || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== asset.contentHash) throw new Error('Changed');
  } catch { throw new LearningError('conflict', 'The method file changed or is unavailable. Review it before trying again.'); }
}
export function reconcileMethodLifecycle(root: string, loop: LearningLoop) {
  const assets = new Map(readContextAssetRegistry(root).assets.map((asset) => [asset.id, asset]));
  for (const { method } of learningMethods(loop)) {
    if (method.review?.decision !== 'approved') continue;
    const candidate = assets.get(method.review.assetId ?? '');
    const asset = candidate && candidate.path === method.review.targetPath && candidate.source.kind === 'echo-card' && candidate.source.ref === 'echo-card:' + method.review.cardId ? candidate : undefined;
    method.availability = asset?.status === 'active' || asset?.status === 'deprecated' ? asset.status : 'unavailable';
    const marker = methodTransitionSchema.safeParse(asset?.metadata?.learningTransition);
    if (marker.success && !method.transitions?.some((event) => event.id === marker.data.id)) {
      (method.transitions ??= []).push(marker.data);
      loop.version += 1;
      if (marker.data.recordedAt > loop.updatedAt) loop.updatedAt = marker.data.recordedAt;
    }
  }
  return loop;
}
export function assertNoOtherActiveVersion(root: string, loop: LearningLoop, index: number, revisionIndex: number) {
  const assets = readContextAssetRegistry(root).assets;
  for (const item of learningMethods(loop)) {
    if (item.attemptIndex !== index || item.revisionIndex === revisionIndex || item.method.review?.decision !== 'approved') continue;
    if (approvedMethodAsset(root, item.method, assets).status !== 'deprecated') throw new LearningError('conflict', 'Pause the previously approved method before enabling another version.');
  }
}
export function performMethodTransition(root: string, next: LearningLoop, command: LearningCommand, now: Date) {
  if (command.action !== 'pause-agent' && command.action !== 'resume-agent') return;
  const revisionIndex = command.revisionIndex ?? 0;
  const method = learningMethodAt(next, command.attemptIndex, revisionIndex)!;
  const asset = approvedMethodAsset(root, method);
  if (command.action === 'resume-agent') {
    if (learningMethods(next).some((item) => item.attemptIndex === command.attemptIndex && item.revisionIndex > revisionIndex && item.method.review?.decision === 'approved')) {
      throw new LearningError('conflict', 'This version has been superseded. Propose a new revision instead.');
    }
    assertNoOtherActiveVersion(root, next, command.attemptIndex, revisionIndex);
    verifyMethodContent(root, asset);
  }
  const marker = { id: randomUUID(), action: command.action, reason: command.reason, recordedAt: now.toISOString() };
  const updated = transitionContextAssetStatus(root, {
    assetId: asset.id, expectedStatus: command.action === 'pause-agent' ? 'active' : 'deprecated',
    status: command.action === 'pause-agent' ? 'deprecated' : 'active',
    sourceRef: asset.source.ref, path: asset.path, contentHash: asset.contentHash, marker,
  }, now);
  (method.transitions ??= []).push(marker);
  method.availability = updated.status === 'active' ? 'active' : 'deprecated';
}
