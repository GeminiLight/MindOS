import { approvedMethodAsset, verifyMethodContent } from './method-lifecycle.js';
import { reconcileLearningReviews, performAgentCommand } from './coevolution.js';
import crypto from 'node:crypto';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  learningMethodAt, learningMethods, inquiryRevisionOriginSchema, agentText, applyLearningCommand, LearningError, learningCommandSchema, learningIdSchema,
  agentChangeSchema, learningLoopSchema, learningSourceSchema, type LearningLoop, type LearningSource, type LearningMethod,
} from './model.js';

const DIRECTORY = '.mindos/echo/learning';

function recordPath(root: string, id: string): string {
  const parsed = learningIdSchema.safeParse(id);
  if (!parsed.success) throw new LearningError('invalid', 'Invalid learning record id.');
  return resolveExistingSafe(root, DIRECTORY + '/' + parsed.data + '.json');
}

export function getLearningLoop(root: string, id: string): LearningLoop | null {
  const file = recordPath(root, id);
  try {
    const record = learningLoopSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (record.id !== id) throw new Error('Record id mismatch');
    return reconcileLearningReviews(root, record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new LearningError('storage', 'Could not read a learning record. Existing data was preserved.');
  }
}

export function listLearningLoops(root: string): LearningLoop[] {
  const directory = resolveExistingSafe(root, DIRECTORY);
  let names: string[];
  try { names = fs.readdirSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new LearningError('storage', 'Could not read learning records.');
  }
  return names.filter((name) => /^learn-[a-f0-9]{24}\.json$/.test(name))
    .map((name) => getLearningLoop(root, name.slice(0, -5)))
    .filter((loop): loop is LearningLoop => loop !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function startLearningLoop(root: string, input: unknown, now = new Date()): LearningLoop {
  const parsed = learningSourceSchema.safeParse(input);
  if (!parsed.success) throw new LearningError('invalid', 'A learning record needs an insight with message evidence.');
  return startRecord(root, parsed.data, now);
}

export function startLearningCorrection(root: string, sourceInput: unknown, methodInput: unknown, now = new Date()): LearningLoop {
  const source = learningSourceSchema.safeParse(sourceInput);
  const method = agentChangeSchema.safeParse({
    ...(methodInput && typeof methodInput === 'object' ? methodInput : {}),
    proposedAt: now.toISOString(), observations: [], review: undefined, revisions: undefined, transitions: undefined, counterexamples: undefined, availability: undefined,
  });
  if (!source.success || !method.success) throw new LearningError('invalid', 'A correction needs source evidence, a behavior, a scope and an observable check.');
  return startRecord(root, source.data, now, method.data);
}

function startRecord(root: string, source: LearningSource, now: Date, method?: LearningMethod): LearningLoop {
  const id = 'learn-' + crypto.createHash('sha256').update(source.cardId).digest('hex').slice(0, 24);
  return withRecordLock(root, id, () => {
    const existing = getLearningLoop(root, id);
    if (existing) {
      if (method && (!existing.directMethod || ['behavior', 'scope', 'check'].some((key) => existing.directMethod![key as 'behavior' | 'scope' | 'check'] !== method[key as 'behavior' | 'scope' | 'check']))) {
        throw new LearningError('conflict', 'This source already has a different correction.');
      }
      return existing;
    }
    const loop: LearningLoop = {
      schemaVersion: 1, id, version: 1, source, stage: 'reflecting', archived: false,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), attempts: [],
      ...(method ? { directMethod: method } : {}),
    };
    writeRecord(root, loop);
    return loop;
  });
}

export function updateLearningLoop(root: string, id: string, input: unknown, now = new Date()): LearningLoop {
  const command = learningCommandSchema.safeParse(input);
  if (!command.success) throw new LearningError('invalid', 'Complete all fields with valid text and a calendar date (maximum 4000 characters per field).');
  return withRecordLock(root, id, () => {
    const loop = getLearningLoop(root, id);
    if (!loop) throw new LearningError('not-found', 'Learning record not found.');
    const next = applyLearningCommand(loop, command.data, now.toISOString());
    performAgentCommand(root, next, command.data, now);
    writeRecord(root, next);
    return next;
  });
}

/** Hash the approved definition, excluding subsequent observations and availability. */
export function learningMethodFingerprint(method: LearningMethod): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        behavior: method.behavior,
        scope: method.scope,
        check: method.check,
        proposedAt: method.proposedAt,
        review: method.review
          ? {
              cardId: method.review.cardId,
              decision: method.review.decision,
              reviewedAt: method.review.reviewedAt,
              candidateHash: method.review.candidateHash,
              assetId: method.review.assetId,
              targetPath: method.review.targetPath,
            }
          : null,
      }),
    )
    .digest('hex');
}
const inquiryRevisionInput = inquiryRevisionOriginSchema
  .omit({ commandHash: true })
  .extend({
    attemptIndex: z.number().int().min(-1).max(99),
    revisionIndex: z.number().int().min(0).max(99),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: agentText,
    behavior: agentText,
    scope: agentText,
    check: agentText,
  })
  .strict();

/** Host-only bridge: the inquiry workflow validates the decision and immutable link first.
 * Keep proposal creation and replay under the same learning lock. No publication or resume occurs here.
 */
export function proposeInquiryMethodRevision(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
): LearningLoop {
  const parsed = inquiryRevisionInput.safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    throw new LearningError(
      'invalid',
      'Choose a saved method and complete the revision.',
    );
  const c = parsed.data;
  const commandHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(c))
    .digest('hex');
  return withRecordLock(root, id, () => {
    const loop = getLearningLoop(root, id);
    if (!loop)
      throw new LearningError('not-found', 'This method is unavailable.');
    const prior = learningMethods(loop).find(
      ({ method }) =>
        method.inquiryOrigin?.inquiryId === c.inquiryId &&
        method.inquiryOrigin.decisionId === c.decisionId &&
        method.inquiryOrigin.linkId === c.linkId,
    );
    // Recover an already committed revision even if it has since been reviewed or archived.
    if (prior) {
      if (
        prior.method.inquiryOrigin!.commandHash !== commandHash ||
        prior.attemptIndex !== c.attemptIndex ||
        prior.revisionIndex !== c.revisionIndex + 1
      )
        throw new LearningError(
          'conflict',
          'This decision already proposed a different revision.',
        );
      return loop;
    }
    const base = learningMethodAt(loop, c.attemptIndex, c.revisionIndex);
    if (
      !base ||
      base.review?.decision !== 'approved' ||
      base.availability === 'unavailable' ||
      learningMethodFingerprint(base) !== c.baseHash ||
      now.getTime() < Date.parse(loop.updatedAt)
    )
      throw new LearningError(
        'conflict',
        'The saved method is no longer a valid revision base. Review it again.',
      );
    verifyMethodContent(root, approvedMethodAsset(root, base));
    const command = {
      action: 'revise-agent' as const,
      version: loop.version,
      attemptIndex: c.attemptIndex,
      revisionIndex: c.revisionIndex,
      reason: c.reason,
      behavior: c.behavior,
      scope: c.scope,
      check: c.check,
    };
    const next = applyLearningCommand(loop, command, now.toISOString());
    const revised = learningMethodAt(
      next,
      c.attemptIndex,
      c.revisionIndex + 1,
    )!;
    revised.inquiryOrigin = {
      inquiryId: c.inquiryId,
      decisionId: c.decisionId,
      linkId: c.linkId,
      commandHash,
    };
    performAgentCommand(root, next, command, now);
    writeRecord(root, next);
    return next;
  });
}

function writeRecord(root: string, loop: LearningLoop) {
  const target = recordPath(root, loop.id);
  const temporary = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(loop, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } catch {
    throw new LearningError('storage', 'Could not save this learning record. Please try again.');
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* A successful rename has already removed the temporary file. */ }
  }
}

function withRecordLock<T>(root: string, id: string, action: () => T): T {
  const target = recordPath(root, id);
  const lock = target + '.lock';
  let acquired = false;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      // All work within the lock is synchronous and local. Expire locks left by a crashed process.
      if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 30_000) fs.unlinkSync(lock);
      fs.writeFileSync(lock, '', { mode: 0o600, flag: 'wx' });
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LearningError('conflict', 'This record is being saved. Please retry.');
      throw error;
    }
    return action();
  } catch (error) {
    if (error instanceof LearningError) throw error;
    throw new LearningError('storage', 'Could not save this learning record. Existing data was preserved.');
  } finally {
    if (acquired) fs.unlinkSync(lock);
  }
}
