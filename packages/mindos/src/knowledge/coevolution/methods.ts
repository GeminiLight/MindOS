import {
  listLearningLoops,
  startLearningCorrection,
  updateLearningLoop,
  getLearningLoop,
  learningMethodFingerprint,
} from '../learning/store.js';
import { learningMethods, learningMethodAt } from '../learning/model.js';
import {
  approvedMethodAsset,
  verifyMethodContent,
} from '../learning/method-lifecycle.js';
import {
  coevolutionMethodSchema,
  type CoevolutionMethod,
  type CoevolutionTask,
} from './model.js';
import { fail } from './storage.js';

function terms(text: string) {
  const normalized = text.toLocaleLowerCase();
  const result: string[] = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  for (const group of normalized.match(/[\u3400-\u9fff]+/g) ?? [])
    for (let i = 0; i < group.length - 1; i++)
      result.push(group.slice(i, i + 2));
  return [...new Set(result)].slice(0, 300);
}
export function coevolutionMethods(
  root: string,
  query = '',
): Array<CoevolutionMethod & { matchScore: number; matchedTerms: string[] }> {
  const matches: Array<
    CoevolutionMethod & { matchScore: number; matchedTerms: string[] }
  > = [];
  const queryTerms = terms(query);
  for (const loop of listLearningLoops(root)) {
    if (loop.archived) continue;
    for (const { method, attemptIndex, revisionIndex } of learningMethods(
      loop,
    )) {
      if (
        method.review?.decision !== 'approved' ||
        method.availability !== 'active'
      )
        continue;
      try {
        const asset = approvedMethodAsset(root, method);
        verifyMethodContent(root, asset);
        const value = coevolutionMethodSchema.parse({
          learningId: loop.id,
          attemptIndex,
          revisionIndex,
          baseHash: learningMethodFingerprint(method),
          behavior: method.behavior,
          scope: method.scope,
          check: method.check,
          assetId: asset.id,
          assetVersion: asset.version,
          contentHash: asset.contentHash,
          path: asset.path,
        });
        const content =
          `${method.behavior} ${method.scope} ${method.check}`.toLocaleLowerCase();
        const matchedTerms = queryTerms.filter((term) =>
          content.includes(term),
        );
        matches.push({
          ...value,
          matchScore: matchedTerms.length,
          matchedTerms: matchedTerms.slice(0, 8),
        });
      } catch {
        /* Unavailable or externally changed methods cannot be offered as current standards. */
      }
    }
  }
  return matches
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore || a.behavior.localeCompare(b.behavior),
    )
    .slice(0, 30);
}
export function selectMethod(
  root: string,
  selected: {
    learningId: string;
    attemptIndex: number;
    revisionIndex: number;
    baseHash: string;
  },
): CoevolutionMethod {
  const loop = getLearningLoop(root, selected.learningId);
  const method =
    loop &&
    learningMethodAt(loop, selected.attemptIndex, selected.revisionIndex);
  if (
    !loop ||
    loop.archived ||
    !method ||
    method.review?.decision !== 'approved' ||
    method.availability !== 'active' ||
    learningMethodFingerprint(method) !== selected.baseHash
  )
    return fail(
      'conflict',
      'This standard changed or is unavailable. Reload the available standards.',
    );
  const asset = approvedMethodAsset(root, method);
  verifyMethodContent(root, asset);
  return coevolutionMethodSchema.parse({
    ...selected,
    behavior: method.behavior,
    scope: method.scope,
    check: method.check,
    assetId: asset.id,
    assetVersion: asset.version,
    contentHash: asset.contentHash,
    path: asset.path,
  });
}
export function confirmTaskMethod(
  root: string,
  task: CoevolutionTask,
  item: { id: string; behavior: string; scope: string; check: string },
  content: string,
  now: Date,
) {
  let loop = startLearningCorrection(
    root,
    {
      cardId: `${task.id}:${item.id}`,
      title: item.behavior.slice(0, 100),
      content: content.slice(0, 4000),
      sessions: [
        {
          // A user-authored workspace record is explicitly named as such. It is not an imported conversation.
          id: task.source?.sessionId ?? `workspace:${task.id}`,
          title: task.source?.title ?? `User-authored task: ${task.title}`,
          messageRefs: [
            {
              messageIndex: task.source?.messageIndex ?? 0,
              role: task.source ? 'assistant' : 'user',
              quote: (task.source?.quote ?? task.goal).slice(0, 1000),
            },
          ],
        },
      ],
    },
    { behavior: item.behavior, scope: item.scope, check: item.check },
    now,
  );
  if (!loop.directMethod?.review)
    loop = updateLearningLoop(
      root,
      loop.id,
      { version: loop.version, action: 'approve-agent', attemptIndex: -1 },
      now,
    );
  if (loop.directMethod?.review?.decision !== 'approved')
    return fail(
      'conflict',
      'This standard was previously declined. Create a revision before confirming again.',
    );
  return loop.id;
}
function approvedTaskMethod(root: string, learningId: string | undefined) {
  if (!learningId) return null;
  const loop = getLearningLoop(root, learningId);
  if (!loop) return null;
  const current = learningMethods(loop)
    .filter(
      (item) =>
        item.attemptIndex === -1 &&
        item.method.review?.decision === 'approved' &&
        item.method.availability === 'active',
    )
    .at(-1);
  return current ? { ...current, loop } : null;
}
export function activeTaskMethod(root: string, learningId: string | undefined) {
  try {
    const current = approvedTaskMethod(root, learningId);
    if (!current || current.loop.archived) return null;
    verifyMethodContent(root, approvedMethodAsset(root, current.method));
    return current;
  } catch {
    return null;
  }
}
export function pauseTaskMethod(
  root: string,
  learningId: string | undefined,
  reason: string,
  now: Date,
) {
  // Revoking an authorization must not depend on the authorized file still
  // being readable or unchanged. Registry/approval identity is checked below.
  const current = approvedTaskMethod(root, learningId);
  if (current)
    updateLearningLoop(
      root,
      current.loop.id,
      {
        version: current.loop.version,
        action: 'pause-agent',
        attemptIndex: -1,
        revisionIndex: current.revisionIndex,
        reason,
      },
      now,
    );
}
