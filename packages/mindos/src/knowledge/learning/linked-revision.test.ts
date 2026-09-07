import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  startLearningCorrection,
  updateLearningLoop,
  getLearningLoop,
  proposeInquiryMethodRevision,
  learningMethodFingerprint,
} from './store.js';
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-revision-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
function approved() {
  let loop = startLearningCorrection(
    root,
    {
      cardId: 'source',
      title: 'Conditions',
      content: 'Check the conditions',
      sessions: [
        {
          id: 's',
          messageRefs: [
            { messageIndex: 1, role: 'assistant', quote: 'Always use A' },
          ],
        },
      ],
    },
    { behavior: 'Use A', scope: 'Comparisons', check: 'Names the choice' },
  );
  return updateLearningLoop(root, loop.id, {
    action: 'approve-agent',
    version: loop.version,
    attemptIndex: -1,
  });
}
function proposal(loop: ReturnType<typeof approved>) {
  return {
    inquiryId: 'inquiry-' + 'a'.repeat(24),
    decisionId: 'decision-1',
    linkId: 'method-1',
    attemptIndex: -1,
    revisionIndex: 0,
    baseHash: learningMethodFingerprint(loop.directMethod!),
    reason: 'A depends on input conditions',
    behavior: 'Compare A and B under the stated conditions',
    scope: 'Comparisons',
    check: 'Names conditions before choosing',
  };
}
it('adds an unapproved version without resuming the paused approved method and replays the same proposal', () => {
  let loop = approved();
  const input = proposal(loop);
  loop = updateLearningLoop(root, loop.id, {
    action: 'pause-agent',
    version: loop.version,
    attemptIndex: -1,
    reason: 'Counterexample found',
  });
  const next = proposeInquiryMethodRevision(root, loop.id, input);
  expect(next.directMethod?.availability).toBe('deprecated');
  expect(next.directMethod?.revisions).toHaveLength(1);
  expect(next.directMethod?.revisions?.[0].review).toBeUndefined();
  expect(next.directMethod?.revisions?.[0].inquiryOrigin).toMatchObject({
    inquiryId: input.inquiryId,
    decisionId: 'decision-1',
    linkId: 'method-1',
  });
  expect(proposeInquiryMethodRevision(root, loop.id, input)).toEqual(next);
  const archived = updateLearningLoop(root, next.id, {
    action: 'archive',
    version: next.version,
  });
  expect(proposeInquiryMethodRevision(root, loop.id, input)).toEqual(archived);
  expect(() =>
    proposeInquiryMethodRevision(root, loop.id, {
      ...input,
      behavior: 'Changed request',
    }),
  ).toThrow();
});
it('rejects stale or unapproved bases and a competing proposal after another revision', () => {
  const loop = approved(),
    input = proposal(loop);
  for (const bad of [
    null,
    {},
    { ...input, baseHash: 'f'.repeat(64) },
    { ...input, revisionIndex: 99 },
    { ...input, reason: '' },
    { ...input, inquiryId: '../outside' },
  ])
    expect(() => proposeInquiryMethodRevision(root, loop.id, bad)).toThrow();
  proposeInquiryMethodRevision(root, loop.id, input);
  expect(() =>
    proposeInquiryMethodRevision(root, loop.id, {
      ...input,
      decisionId: 'decision-2',
    }),
  ).toThrow();
  expect(getLearningLoop(root, loop.id)?.directMethod?.revisions).toHaveLength(
    1,
  );
});
it('preserves the previous record if publishing the new version fails and recovers on retry', () => {
  const loop = approved(),
    input = proposal(loop);
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
    throw Error('disk unavailable');
  });
  expect(() => proposeInquiryMethodRevision(root, loop.id, input)).toThrow();
  spy.mockRestore();
  expect(getLearningLoop(root, loop.id)).toEqual(loop);
  const saved = proposeInquiryMethodRevision(root, loop.id, input);
  expect(saved.directMethod?.revisions).toHaveLength(1);
  const manual = updateLearningLoop(root, loop.id, {
    action: 'reject-agent',
    version: saved.version,
    attemptIndex: -1,
    revisionIndex: 1,
  });
  expect(proposeInquiryMethodRevision(root, loop.id, input)).toEqual(manual);
});
it('rejects an unapproved base and does not accept inquiry provenance through ordinary manual commands', () => {
  const loop = approved();
  const input = proposal(loop);
  const unapproved = startLearningCorrection(
    root,
    {
      cardId: 'pending',
      title: 'Pending',
      content: 'Pending method',
      sessions: [
        {
          id: 's',
          messageRefs: [
            { messageIndex: 1, role: 'assistant', quote: 'Pending' },
          ],
        },
      ],
    },
    { behavior: 'Wait', scope: 'Pending scope', check: 'Wait for review' },
  );
  expect(() =>
    proposeInquiryMethodRevision(root, unapproved.id, {
      ...input,
      baseHash: learningMethodFingerprint(unapproved.directMethod!),
    }),
  ).toThrow();
  const manual = updateLearningLoop(root, loop.id, {
    action: 'revise-agent',
    version: loop.version,
    attemptIndex: -1,
    revisionIndex: 0,
    reason: input.reason,
    behavior: input.behavior,
    scope: input.scope,
    check: input.check,
    inquiryOrigin: {
      inquiryId: input.inquiryId,
      decisionId: input.decisionId,
      linkId: input.linkId,
      commandHash: 'a'.repeat(64),
    },
  });
  expect(manual.directMethod?.revisions?.[0].inquiryOrigin).toBeUndefined();
});
it('refuses a changed method artifact as the basis of a new linked revision', () => {
  const loop = approved();
  const input = proposal(loop);
  fs.appendFileSync(
    path.join(root, loop.directMethod!.review!.targetPath!),
    '\nUnexpected edit',
  );
  expect(() => proposeInquiryMethodRevision(root, loop.id, input)).toThrow();
  expect(
    getLearningLoop(root, loop.id)?.directMethod?.revisions,
  ).toBeUndefined();
});
