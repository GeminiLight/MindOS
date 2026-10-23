import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withPrivateRecordLock } from '../private-records.js';
import { coevolutionPrepareSchema, coevolutionTextHash } from './model.js';
import { coevolutionIntentRequest } from './intent.js';
import {
  readTask,
  writeTask,
  mutateTask,
  fail,
  checkTime,
  listCoevolutionTasks,
} from './storage.js';

export function prepareCoevolutionTaskRun(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = coevolutionPrepareSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid', 'Choose the saved task version to prepare.');
  const command = { ...parsed.data, action: 'prepare' };
  const { task } = mutateTask(root, id, command, now, (task) => {
    if (task.archived) fail('conflict', 'Restore this task before continuing.');
    if (task.preparations.length >= 100)
      fail('conflict', 'This task has reached its prepared-session limit.');
    const preparationId = randomUUID();
    const mode = {
      guide: '带我做：示范一个关键步骤，再让我判断。',
      together: '一起做：关键取舍由我选择，你协助推进。',
      try: '让我试：先听我的方案，需要时再给提示。',
    }[task.mode];
    // Source excerpts and current standards are injected by the host every turn.
    // The composer stays readable; this exact short draft still binds by hash.
    const request = command.intent ? `\n\n${coevolutionIntentRequest[command.intent]}` : '';
    const prompt = `我们来推进「${task.title}」。\n\n这次希望完成：${task.goal}\n\n${mode}${request}\n\n[coevolution-task: ${task.id}; preparation: ${preparationId}]`;
    task.preparations.push({
      id: preparationId,
      requestId: command.requestId,
      prompt,
      queryHash: coevolutionTextHash(prompt),
      preparedAt: now.toISOString(),
      ...(command.intent ? { intent: command.intent } : {}),
    });
  });
  if (task.archived) fail('conflict', 'Restore this task before continuing.');
  const preparation = task.preparations.find(
    (p) => p.requestId === command.requestId,
  )!;
  return {
    task,
    draft: { prompt: preparation.prompt, preparationId: preparation.id, ...(preparation.intent ? { intent: preparation.intent, chatSessionId: task.chatSessionId } : {}) },
  };
}
export function consumeCoevolutionDraft(
  root: string,
  input: { prompt: string; chatSessionId: string },
  now = new Date(),
) {
  if (
    !z
      .object({
        prompt: z.string().min(1).max(24000),
        chatSessionId: z.string().trim().min(1).max(200),
      })
      .safeParse(input).success
  )
    return null;
  const marker = input.prompt.match(
    /\[coevolution-task: (coevolution-[a-f0-9]{24}); preparation: ([a-f0-9-]{36})\]$/,
  );
  if (!marker) return null;
  return withPrivateRecordLock(root, () => {
    const task = readTask(root, marker[1]!);
    if (!task) return null;
    const preparation = task.preparations.find((p) => p.id === marker[2]);
    if (
      !preparation ||
      preparation.prompt !== input.prompt ||
      preparation.queryHash !== coevolutionTextHash(input.prompt)
    )
      return null;
    if (task.archived)
      fail(
        'conflict',
        'Restore the task before opening its prepared conversation.',
      );
    if (preparation.chatSessionId) {
      if (preparation.chatSessionId !== input.chatSessionId)
        fail(
          'conflict',
          'This prepared task already belongs to another conversation. Prepare a new session.',
        );
      if (task.chatSessionId !== input.chatSessionId)
        fail(
          'conflict',
          'This task now uses a new active conversation. Open its current session or prepare a new one.',
        );
      return task;
    }
    const other = listCoevolutionTasks(root).tasks.find(
      (t) =>
        t.id !== task.id &&
        t.chatSessionId === input.chatSessionId &&
        !t.archived,
    );
    if (other)
      fail(
        'conflict',
        'This conversation already belongs to another task. Start a new conversation.',
      );
    checkTime(now, task.updatedAt);
    preparation.chatSessionId = input.chatSessionId;
    preparation.consumedAt = now.toISOString();
    task.chatSessionId = input.chatSessionId;
    task.updatedAt = now.toISOString();
    task.version++;
    writeTask(root, task);
    return task;
  });
}
export function findCoevolutionTaskBySession(
  root: string,
  chatSessionId: string,
) {
  return (
    listCoevolutionTasks(root).tasks.find(
      (task) => !task.archived && task.chatSessionId === chatSessionId,
    ) ?? null
  );
}
