import { z } from 'zod';
import type { CoevolutionTask } from '../../knowledge/coevolution/model.js';
import { getAgentRun, updateAgentRun } from '../ledger/run-ledger.js';
import { answerAskUserQuestionOrForward } from '../bridges/pending-prompt-resolution.js';
import {
  pendingPromptKey,
  readOpenPendingPrompt,
} from '../bridges/pending-prompt-store.js';

export const COEVOLUTION_QUESTION_METADATA = 'echoDecisionQuestions';
const mappingSchema = z.object({
  taskId: z.string().min(1).max(100),
  decisionId: z.string().min(1).max(100),
  bridgeRunId: z.string().min(1).max(200),
  toolCallId: z.string().min(1).max(200),
  status: z.enum(['waiting', 'answered', 'cancelled']),
});
export type CoevolutionQuestionMapping = z.infer<typeof mappingSchema>;
export function coevolutionQuestionMappings(
  value: unknown,
): CoevolutionQuestionMapping[] {
  return Array.isArray(value)
    ? value.slice(-50).flatMap((item) => {
        const parsed = mappingSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}
export type CoevolutionDecisionDelivery = {
  status: 'delivered' | 'already-delivered' | 'not-waiting' | 'unavailable';
  message?: string;
};

/** The HTTP host passes the saved human choice; this function cannot choose or approve on their behalf. */
export function resolveCoevolutionDecisionBridge(
  task: CoevolutionTask,
  decisionId: string,
): CoevolutionDecisionDelivery {
  const decision = task.decisions.find((item) => item.id === decisionId);
  if (!decision?.choice || decision.actor.kind !== 'agent')
    return { status: 'not-waiting' };
  const run = getAgentRun(decision.actor.runId);
  if (
    !run ||
    run.chatSessionId !== task.chatSessionId ||
    run.chatSessionId !== decision.actor.chatSessionId
  )
    return {
      status: 'unavailable',
      message:
        'The choice is saved, but its original conversation is no longer available.',
    };
  const mappings = coevolutionQuestionMappings(
    run.metadata?.[COEVOLUTION_QUESTION_METADATA],
  );
  const mapping = mappings.find(
    (item) => item.taskId === task.id && item.decisionId === decisionId,
  );
  if (mapping?.status === 'answered') return { status: 'already-delivered' };
  if (
    !mapping ||
    mapping.status !== 'waiting' ||
    !['running', 'streaming'].includes(run.status)
  )
    return {
      status: 'not-waiting',
      message:
        'The choice is saved. The Agent is no longer waiting on this question; continue the task in a new turn.',
    };
  const row = readOpenPendingPrompt(
    pendingPromptKey({
      kind: 'user-question',
      runId: mapping.bridgeRunId,
      toolCallId: mapping.toolCallId,
    }),
    Date.now(),
  );
  if (
    !row ||
    row.snapshot.kind !== 'user-question' ||
    row.snapshot.questions.length !== 3
  )
    return {
      status: 'unavailable',
      message:
        'The choice is saved, but the question is no longer open. Continue the task in the conversation.',
    };
  const option = decision.options.find(
    (item) => item.id === decision.choice!.optionId,
  );
  if (!option)
    return {
      status: 'unavailable',
      message: 'The saved choice does not match this question.',
    };
  const values = [
    option.label,
    decision.choice.prediction,
    `${decision.choice.confidence}%`,
  ];
  const answers = row.snapshot.questions.map((question, questionIndex) => ({
    questionIndex,
    question: question.question,
    kind: question.options.some((item) => item.label === values[questionIndex])
      ? ('option' as const)
      : ('custom' as const),
    answer: values[questionIndex]!,
  }));
  const result = answerAskUserQuestionOrForward({
    runId: mapping.bridgeRunId,
    toolCallId: mapping.toolCallId,
    answers,
  });
  if (!result.ok)
    return {
      status: 'unavailable',
      message:
        'The choice is saved, but it could not be delivered to the waiting Agent. Reopen this task to retry.',
    };
  updateAgentRun(run.id, {
    metadata: {
      [COEVOLUTION_QUESTION_METADATA]: mappings.map((item) =>
        item === mapping ? { ...item, status: 'answered' } : item,
      ),
    },
  });
  return { status: 'delivered' };
}
