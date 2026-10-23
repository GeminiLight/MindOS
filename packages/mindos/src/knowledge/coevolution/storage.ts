import {
  privateRecordNames,
  readPrivateRecord,
  writePrivateRecord,
  withPrivateRecordLock,
} from '../private-records.js';
import { createHash } from 'node:crypto';
import { getLearningLoop } from '../learning/store.js';
import { LearningError } from '../learning/model.js';
import {
  coevolutionHash,
  coevolutionIdSchema,
  coevolutionTaskSchema,
  coevolutionTextHash,
  type CoevolutionTask,
} from './model.js';

const maxBytes = 4_000_000;
function reconcileAuthorizations(root: string, task: CoevolutionTask) {
  const items = [
    ...task.corrections.filter((c) => c.status === 'draft'),
    ...task.agreements.filter((a) => a.status === 'trying'),
  ];
  for (const item of items) {
    const learningId =
      'learn-' +
      createHash('sha256')
        .update(`${task.id}:${item.id}`)
        .digest('hex')
        .slice(0, 24);
    const loop = getLearningLoop(root, learningId);
    const method = loop?.directMethod;
    if (method?.review?.decision !== 'approved') continue;
    if (
      ['behavior', 'scope', 'check'].some(
        (key) =>
          method[key as 'behavior' | 'scope' | 'check'] !==
          item[key as 'behavior' | 'scope' | 'check'],
      )
    )
      fail(
        'storage',
        'The published standard does not match this task draft. Existing data was preserved.',
      );
    item.learningId = learningId;
    if ('before' in item) {
      item.status = 'confirmed';
      item.resolvedAt = method.review.reviewedAt;
    } else item.status = 'kept';
    task.version++;
    if (method.review.reviewedAt > task.updatedAt)
      task.updatedAt = method.review.reviewedAt;
  }
  return task;
}
export function fail(
  code: 'invalid' | 'not-found' | 'conflict' | 'storage',
  message: string,
): never {
  throw new LearningError(code, message);
}
export function checkTime(now: Date, previous?: string) {
  if (!Number.isFinite(now.getTime())) fail('invalid', 'Choose a valid time.');
  if (previous && now.getTime() < Date.parse(previous))
    fail('conflict', 'The clock moved behind this saved task.');
}
function consistent(task: CoevolutionTask) {
  if (
    task.updatedAt < task.createdAt ||
    new Set(task.commands.map((c) => c.requestId)).size !== task.commands.length
  )
    return false;
  if (
    task.decisions.some(
      (d) =>
        (d.choice && !d.options.some((o) => o.id === d.choice!.optionId)) ||
        (d.outcome && !d.choice),
    )
  )
    return false;
  if (
    task.corrections.some(
      (c) =>
        c.before === c.after || (c.status === 'confirmed' && !c.learningId),
    )
  )
    return false;
  if (
    task.applications.some(
      (a) => (a.disposition === 'adjust') !== !!a.adjustment,
    )
  )
    return false;
  if (
    task.agreements.some(
      (a) =>
        (a.status === 'kept' && (!a.learningId || !a.observations.length)) ||
        (a.revisionOf &&
          !task.agreements.some(
            (old) => old.id === a.revisionOf && old.status === 'revised',
          )),
    )
  )
    return false;
  if (
    task.preparations.some(
      (p) =>
        coevolutionTextHash(p.prompt) !== p.queryHash ||
        !!p.chatSessionId !== !!p.consumedAt,
    )
  )
    return false;
  if (task.runs.some((r) => coevolutionTextHash(r.output) !== r.outputHash))
    return false;
  return [
    task.decisions,
    task.corrections,
    task.applications,
    task.agreements,
    task.preparations,
  ].every((items) => new Set(items.map((i) => i.id)).size === items.length);
}
export function readTask(root: string, id: string): CoevolutionTask | null {
  if (!coevolutionIdSchema.safeParse(id).success)
    fail('invalid', 'Choose a valid collaboration task.');
  const value = readPrivateRecord(root, id + '.json', maxBytes);
  if (value === null) return null;
  try {
    const { recordHash, ...rest } = value as Record<string, unknown>;
    const task = coevolutionTaskSchema.parse(rest);
    if (
      task.id !== id ||
      recordHash !== coevolutionHash(task) ||
      !consistent(task)
    )
      throw Error();
    return reconcileAuthorizations(root, task);
  } catch {
    return fail(
      'storage',
      'Could not read this collaboration task. Existing data was preserved.',
    );
  }
}
export function writeTask(root: string, task: CoevolutionTask) {
  const parsed = coevolutionTaskSchema.safeParse(task);
  if (!parsed.success || !consistent(parsed.data))
    fail(
      'storage',
      'This task reached its record limit or could not be saved consistently. Existing data was preserved.',
    );
  writePrivateRecord(
    root,
    task.id + '.json',
    { ...parsed.data, recordHash: coevolutionHash(parsed.data) },
    maxBytes,
  );
}
export function listCoevolutionTasks(root: string) {
  const tasks: CoevolutionTask[] = [];
  let unavailableCount = 0;
  for (const name of privateRecordNames(root)) {
    if (!/^coevolution-[a-f0-9]{24}\.json$/.test(name)) continue;
    try {
      const task = readTask(root, name.slice(0, -5));
      if (task) tasks.push(task);
    } catch {
      unavailableCount++;
    }
  }
  tasks.sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  return { tasks, unavailableCount };
}
export function mutateTask<T>(
  root: string,
  id: string,
  command: { version: number; requestId: string },
  now: Date,
  action: (task: CoevolutionTask) => T,
  canRecover?: (task: CoevolutionTask) => boolean,
) {
  return withPrivateRecordLock(root, () => {
    const task = readTask(root, id);
    if (!task) return fail('not-found', 'Collaboration task not found.');
    const hash = coevolutionHash(command);
    const prior = task.commands.find((c) => c.requestId === command.requestId);
    if (prior) {
      if (hash !== prior.hash)
        fail('conflict', 'This request already contains different content.');
      return { task, result: undefined as T | undefined };
    }
    checkTime(now, task.updatedAt);
    if (command.version !== task.version && !canRecover?.(task))
      fail(
        'conflict',
        'This task changed. Reload the saved version before trying again.',
      );
    if (task.commands.length >= 600)
      fail(
        'conflict',
        'This task has reached its history limit. Start a new task.',
      );
    const result = action(task);
    task.commands.push({ requestId: command.requestId, hash });
    task.updatedAt = now.toISOString();
    task.version++;
    writeTask(root, task);
    return { task, result };
  });
}
