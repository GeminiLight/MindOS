import { z } from 'zod';
import { createInquiry, getInquiry } from '../inquiries/index.js';
import {
  coevolutionPrepareSchema,
  coevolutionHash,
  coevolutionTextHash,
} from './model.js';
import { readTask, mutateTask, fail } from './storage.js';

const inputSchema = coevolutionPrepareSchema
  .extend({ locale: z.enum(['en', 'zh']).default('zh') })
  .strict();
export function createCoevolutionInquiry(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      'invalid',
      'Choose this task’s saved version to start an inquiry.',
    );
  const task = readTask(root, id);
  if (!task) return fail('not-found', 'Task not found.');
  if (task.archived)
    fail('conflict', 'Restore this task before starting an inquiry.');
  if (task.inquiryId) {
    const inquiry = getInquiry(root, task.inquiryId);
    if (!inquiry)
      return fail('not-found', 'The linked inquiry is unavailable.');
    return { task, inquiry };
  }
  if (task.version !== parsed.data.version)
    fail('conflict', 'This task changed. Reload before creating the inquiry.');
  const source = task.source;
  const question = source?.question ?? task.goal;
  // The inquiry and workspace each use the same private-record lock. Create the
  // idempotent inquiry first, then link it; a retry repairs a failed second write.
  const inquiry = createInquiry(
    root,
    {
      requestId: 'coevolution-' + coevolutionHash(task.id).slice(0, 24),
      locale: parsed.data.locale,
      source: source
        ? {
            kind: source.kind ?? 'session',
            ...(source.storyId ? { storyId: source.storyId } : {}),
            ...(source.runtime ? { runtime: source.runtime } : {}),
            sessionId: source.sessionId,
            messageIndex: source.messageIndex,
            messageHash: source.messageHash,
            quote: source.quote.slice(0, 1000),
            question,
            questionHash: coevolutionTextHash(question),
          }
        : {
            kind: 'task',
            taskId: task.id,
            title: task.title,
            quote: task.goal.slice(0, 1000),
            question,
            questionHash: coevolutionTextHash(question),
          },
    },
    now,
  );
  const command = { ...parsed.data, action: 'create-inquiry' };
  const linked = mutateTask(root, id, command, now, (current) => {
    if (
      current.archived ||
      (current.inquiryId && current.inquiryId !== inquiry.id)
    )
      fail(
        'conflict',
        'This task’s inquiry changed. Reload before continuing.',
      );
    current.inquiryId = inquiry.id;
  }).task;
  return { task: linked, inquiry };
}
