import { createHash } from 'node:crypto';
import { resolveEvidenceQuote } from './evidence-quote.js';
import { coevolutionRunOutput } from '../../knowledge/coevolution/output.js';
import { Type } from '@sinclair/typebox';
import { z } from 'zod';
import type { CoevolutionTask } from '../../knowledge/coevolution/model.js';
import {
  getCurrentAgentRunContext,
  type AgentRunContext,
} from '../agent-run-context.js';
import {
  askUserQuestionViaBridge,
  hasAskUserQuestionBridge,
  getCurrentAskUserQuestionBridgeRunId,
  type AskUserQuestionResult,
} from '../bridges/user-question-bridge.js';
import {
  appendAgentRunEvent,
  getAgentRun,
  updateAgentRun,
} from '../ledger/run-ledger.js';
import type {
  AgentRunRecord,
  AppendAgentEventInput,
  UpdateAgentRunInput,
} from '../ledger/run-ledger-types.js';
import type { MindosAgentTool } from './kb-tools.js';
import {
  COEVOLUTION_QUESTION_METADATA,
  coevolutionQuestionMappings,
} from './coevolution-decision-bridge.js';

export interface CoevolutionToolServices {
  context(): AgentRunContext | undefined;
  hasQuestionBridge(): boolean;
  bridgeRunId?(): string | undefined;
  ask(input: {
    toolCallId: string;
    params: unknown;
    signal?: AbortSignal;
  }): Promise<AskUserQuestionResult>;
  find(
    root: string,
    sessionId: string,
  ): CoevolutionTask | null | Promise<CoevolutionTask | null>;
  get(
    root: string,
    id: string,
  ): CoevolutionTask | null | Promise<CoevolutionTask | null>;
  suggest(
    root: string,
    id: string,
    command: unknown,
    actor: { runId: string; chatSessionId: string },
  ): CoevolutionTask | Promise<CoevolutionTask>;
  update(
    root: string,
    id: string,
    command: unknown,
  ): CoevolutionTask | Promise<CoevolutionTask>;
  getRun(id: string): AgentRunRecord | undefined;
  completedOutput?(root: string, run: AgentRunRecord): string;
  updateRun(id: string, patch: UpdateAgentRunInput): AgentRunRecord | undefined;
  event(id: string, event: AppendAgentEventInput): unknown;
  suggestInquiry?(root: string, id: string, input: unknown, actor: { runId: string; chatSessionId: string }): unknown | Promise<unknown>;
}

const defaultServices: CoevolutionToolServices = {
  completedOutput: coevolutionRunOutput,
  context: getCurrentAgentRunContext,
  hasQuestionBridge: hasAskUserQuestionBridge,
  bridgeRunId: getCurrentAskUserQuestionBridgeRunId,
  ask: askUserQuestionViaBridge,
  find: async (root, id) =>
    (
      await import('../../knowledge/coevolution/index.js')
    ).findCoevolutionTaskBySession(root, id),
  get: async (root, id) =>
    (await import('../../knowledge/coevolution/index.js')).getCoevolutionTask(
      root,
      id,
    ),
  suggest: async (root, id, command, actor) =>
    (
      await import('../../knowledge/coevolution/index.js')
    ).recordCoevolutionAgentSuggestion(root, id, command, actor),
  update: async (root, id, command) =>
    (
      await import('../../knowledge/coevolution/index.js')
    ).updateCoevolutionTask(root, id, command),
  getRun: getAgentRun,
  updateRun: updateAgentRun,
  event: appendAgentRunEvent,
  suggestInquiry: async (root, id, input, actor) => (await import('../../knowledge/coevolution/suggestions.js')).suggestCoevolutionInquiry(root, id, input, actor),
};
const field = (max = 1600) => z.string().trim().min(1).max(max);
const decisionInput = z
  .object({
    question: field(2000),
    options: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
            label: field(200),
            tradeoff: field(),
          })
          .strict(),
      )
      .min(2)
      .max(5),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.options.map((item) => item.id)).size ===
        input.options.length &&
      new Set(input.options.map((item) => item.label)).size ===
        input.options.length,
    'Each option needs a distinct id and label.',
  );
const method = { behavior: field(), scope: field(), check: field() };
const suggestionInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('correction'),
      before: field(4000),
      after: field(4000),
      ...method,
    })
    .strict(),
  z.object({ kind: z.literal('agreement'), ...method }).strict(),
  z.object({ kind: z.literal('inquiry'), question: field(4000), explanationA: field(4000), explanationB: field(4000), distinction: field(4000), capability: field() }).strict(),
]);
const observationInput = z
  .object({
    decisionId: field(100),
    observation: field(4000),
    quote: field(4000),
  })
  .strict();
const pendingObservation = observationInput
  .extend({ taskId: field(100), requestId: field(100) })
  .strict();
type PendingObservation = z.infer<typeof pendingObservation>;
const metadataKey = 'echoPendingObservations';
const output = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value),
    },
  ],
  details: {},
});
const requestId = (runId: string, callId: string, action: string) =>
  'echo-' +
  createHash('sha256')
    .update(`${runId}:${callId}:${action}`)
    .digest('hex')
    .slice(0, 32);
const stringParam = (description: string, maxLength = 1600) =>
  Type.String({ description, minLength: 1, maxLength });
const methodParams = {
  behavior: stringParam('The observable behavior to try.'),
  scope: stringParam('Where it applies, and exceptions.'),
  check: stringParam('What evidence would show that the behavior helped.'),
};

/** Tools are offered only to write-capable turns; execution rechecks the live run. */
export function createCoevolutionTools(
  host: { getMindRoot(): string },
  services = defaultServices,
): MindosAgentTool[] {
  async function bound() {
    const context = services.context();
    const runId = context?.parentRunId ?? context?.rootRunId;
    if (!context?.chatSessionId || !runId)
      throw new Error(
        'Start this task from the Echo workspace before using collaboration tools.',
      );
    const run = services.getRun(runId);
    if (
      !run ||
      run.chatSessionId !== context.chatSessionId ||
      run.permissionMode === 'read' ||
      !['running', 'streaming'].includes(run.status)
    )
      throw new Error('This run cannot write collaboration records.');
    const root = host.getMindRoot();
    const task = await services.find(root, context.chatSessionId);
    if (!task || task.archived)
      throw new Error('No active Echo task is bound to this conversation.');
    return {
      root,
      task,
      run,
      actor: { runId, chatSessionId: context.chatSessionId },
    };
  }
  const safe =
    (
      fn: (
        callId: string,
        params: unknown,
        signal?: AbortSignal,
      ) => Promise<ReturnType<typeof output>>,
    ) =>
    async (callId: string, params: unknown, signal?: AbortSignal) => {
      try {
        if (signal?.aborted)
          return output('Cancelled. No choice or observation was recorded.');
        return await fn(callId, params, signal);
      } catch (error) {
        return output(
          `Error: ${error instanceof z.ZodError ? 'Invalid fields: ' + error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ').slice(0, 1500) : error instanceof Error ? error.message : 'Could not save this collaboration record.'}`,
        );
      }
    };
  return [
    {
      name: 'echo_decide',
      label: 'Decide together',
      description:
        'Pause at an important tradeoff in the current Echo task. Propose 2–5 realistic options, then wait for the human to choose and predict an outcome. Cancellation is not consent. Do not execute a branch before a human answer. This does not approve tool permissions.',
      parameters: Type.Object({
        question: stringParam(
          'The decision that changes the next action.',
          2000,
        ),
        options: Type.Array(
          Type.Object({
            id: stringParam('Stable option id: letters, digits, hyphens.', 40),
            label: stringParam('Short action label.', 200),
            tradeoff: stringParam(
              'Benefit and cost, based on currently available evidence.',
            ),
          }),
          { minItems: 2, maxItems: 5 },
        ),
      }),
      execute: safe(async (callId, params, signal) => {
        const input = decisionInput.parse(params);
        const { root, task, actor } = await bound();
        if (!services.hasQuestionBridge())
          throw new Error(
            'This runtime cannot wait for a human answer here. Ask in the conversation; do not assume a choice.',
          );
        const proposed = await services.suggest(
          root,
          task.id,
          {
            version: task.version,
            requestId: requestId(actor.runId, callId, 'propose'),
            action: 'add-decision',
            ...input,
          },
          actor,
        );
        const decision = proposed.decisions.at(-1);
        if (!decision) throw new Error('The decision was not saved.');
        const bridgeRunId = services.bridgeRunId?.();
        if (bridgeRunId) {
          const run = services.getRun(actor.runId);
          const mappings = coevolutionQuestionMappings(
            run?.metadata?.[COEVOLUTION_QUESTION_METADATA],
          );
          services.updateRun(actor.runId, {
            metadata: {
              [COEVOLUTION_QUESTION_METADATA]: [
                ...mappings.filter(
                  (item) =>
                    item.decisionId !== decision.id || item.taskId !== task.id,
                ),
                {
                  taskId: task.id,
                  decisionId: decision.id,
                  bridgeRunId,
                  toolCallId: callId,
                  status: 'waiting',
                },
              ],
            },
          });
        }
        const zh = /[\u3400-\u9fff]/.test(input.question);
        const answer = await services.ask({
          toolCallId: callId,
          signal,
          params: {
            questions: [
              {
                header: zh ? '关键取舍' : 'Decision',
                question: input.question,
                options: input.options.map((item) => ({
                  label: item.label,
                  description: item.tradeoff,
                })),
              },
              {
                header: zh ? '先做预测' : 'Prediction',
                question: zh
                  ? '选了之后，你预计最先看到什么变化？'
                  : 'What change do you expect to see first?',
                options: [],
              },
              {
                header: zh ? '把握多大' : 'Confidence',
                question: zh
                  ? '你对这个预测有多大把握？'
                  : 'How confident are you in that prediction?',
                options: [25, 50, 75, 95].map((value) => ({
                  label: `${value}%`,
                  description: zh
                    ? {
                        25: '还在探索',
                        50: '各有可能',
                        75: '比较有把握',
                        95: '非常有把握',
                      }[value]!
                    : {
                        25: 'Exploring',
                        50: 'Could go either way',
                        75: 'Fairly confident',
                        95: 'Very confident',
                      }[value]!,
                })),
              },
            ],
          },
        });
        const markDelivery = (status: 'answered' | 'cancelled') => {
          const runAfterAnswer = services.getRun(actor.runId);
          const mappings = coevolutionQuestionMappings(
            runAfterAnswer?.metadata?.[COEVOLUTION_QUESTION_METADATA],
          );
          if (mappings.length)
            services.updateRun(actor.runId, {
              metadata: {
                [COEVOLUTION_QUESTION_METADATA]: mappings.map((item) =>
                  item.taskId === task.id && item.decisionId === decision.id
                    ? { ...item, status }
                    : item,
                ),
              },
            });
        };
        if (answer.cancelled) {
          markDelivery('cancelled');
          return output({
            status: 'not chosen',
            decisionId: decision.id,
            instruction:
              'The human did not choose. Keep the decision open and wait; do not execute a default branch.',
          });
        }
        // The canvas may have already stored the same human answer before delivering it to this bridge.
        // Its first committed choice wins even when two human surfaces submit concurrently.
        const savedChoice = (await services.get(root, task.id))?.decisions.find(
          (item) => item.id === decision.id,
        )?.choice;
        if (savedChoice) {
          markDelivery('answered');
          return output({
            status: 'chosen',
            decisionId: decision.id,
            ...savedChoice,
            instruction:
              'Use this saved human choice. Carry out only this branch within the existing permission policy, then record the actual result with echo_observe.',
          });
        }
        const selected = input.options.find(
          (item) =>
            item.label ===
            answer.answers.find((item) => item.questionIndex === 0)?.answer,
        );
        const prediction = answer.answers
          .find((item) => item.questionIndex === 1)
          ?.answer?.trim();
        const confidenceText = answer.answers
          .find((item) => item.questionIndex === 2)
          ?.answer?.trim();
        const confidence =
          confidenceText && /^\d{1,3}%?$/.test(confidenceText)
            ? Number(confidenceText.replace('%', ''))
            : NaN;
        if (
          !selected ||
          !prediction ||
          prediction.length > 1600 ||
          !Number.isInteger(confidence) ||
          confidence < 0 ||
          confidence > 100
        ) {
          markDelivery('cancelled');
          return output({
            status: 'not chosen',
            decisionId: decision.id,
            humanAnswers: answer.answers,
            instruction:
              'The reply does not map to one supplied branch with a prediction and confidence. Clarify it with the human; do not infer a choice.',
          });
        }
        const current = await services.get(root, task.id);
        if (!current) throw new Error('The task is no longer available.');
        await services.update(root, task.id, {
          version: current.version,
          requestId: requestId(actor.runId, callId, 'choose'),
          action: 'choose-decision',
          decisionId: decision.id,
          optionId: selected.id,
          prediction,
          confidence,
        });
        markDelivery('answered');
        return output({
          status: 'chosen',
          decisionId: decision.id,
          optionId: selected.id,
          prediction,
          confidence,
          instruction:
            'Carry out the chosen next step within the existing permission policy. Then use echo_observe with a quotation from the actual result.',
        });
      }),
    },
    {
      name: 'echo_suggest',
      label: 'Suggest a working standard',
      description:
        'Save a reviewable draft. kind=correction REQUIRES before, after, behavior, scope, check. kind=agreement REQUIRES behavior, scope, check. kind=inquiry REQUIRES question, explanationA, explanationB, distinction, capability. Omit fields belonging to other kinds. Before/after must be verbatim excerpts, without added citation labels or paraphrases. The human confirms all candidates; never invent a human correction or present a hypothesis as their view.',
      parameters: Type.Object({
        kind: Type.Union([
          Type.Literal('correction'),
          Type.Literal('agreement'),
          Type.Literal('inquiry'),
        ]),
        before: Type.Optional(
          stringParam(
            'For a correction: exact original excerpt. Omit for an agreement.',
            4000,
          ),
        ),
        after: Type.Optional(
          stringParam(
            'For a correction: exact human-edited excerpt. Omit for an agreement.',
            4000,
          ),
        ),
        behavior: Type.Optional(methodParams.behavior),
        scope: Type.Optional(methodParams.scope),
        check: Type.Optional(methodParams.check),
        question: Type.Optional(stringParam('For inquiry: the concrete question to compare.', 4000)),
        explanationA: Type.Optional(stringParam('For inquiry: one perspective and its basis. Mark any inferred perspective as a hypothesis.', 4000)),
        explanationB: Type.Optional(stringParam('For inquiry: the other perspective and its basis.', 4000)),
        distinction: Type.Optional(stringParam('For inquiry: observable evidence that could distinguish the views.', 4000)),
        capability: Type.Optional(stringParam('For inquiry: what judgment the person can practice.')),
      }),
      execute: safe(async (callId, params) => {
        const { kind, ...fields } = suggestionInput.parse(params);
        const { root, task, actor } = await bound();
        if (kind === 'inquiry') {
          if (!services.suggestInquiry) throw new Error('Inquiry suggestions are unavailable in this host.');
          await services.suggestInquiry(root, task.id, fields, actor);
        } else await services.suggest(
          root,
          task.id,
          {
            version: task.version,
            requestId: requestId(actor.runId, callId, 'suggest'),
            action:
              kind === 'correction' ? 'draft-correction' : 'propose-agreement',
            ...fields,
          },
          actor,
        );
        return output({
          status: 'awaiting human review',
          taskId: task.id,
          workspace: `/echo/workspace?task=${encodeURIComponent(task.id)}`,
          instruction:
            'Tell the human the suggestion is ready to review. Do not claim it has been adopted or proven effective.',
        });
      }),
    },
    {
      name: 'echo_observe',
      label: 'Record the observed result',
      description:
        'Queue feedback for a chosen decision in this task. The quote must be a verbatim excerpt of the actual observation that you include in the final response. It is saved as run evidence only after this run completes and the quote is verified; a queued report is not a verified outcome.',
      parameters: Type.Object({
        decisionId: stringParam(
          'Chosen decision id returned by echo_decide.',
          100,
        ),
        observation: stringParam(
          'What actually happened; include limits or unresolved effects.',
          4000,
        ),
        quote: stringParam(
          'Verbatim observed-result quotation, also present in the final response.',
          4000,
        ),
      }),
      execute: safe(async (callId, params) => {
        const input = observationInput.parse(params);
        const { task, run, actor } = await bound();
        const decision = task.decisions.find(
          (item) => item.id === input.decisionId,
        );
        if (!decision?.choice || decision.outcome)
          throw new Error(
            'Choose a decision before recording an outcome; existing outcomes cannot be replaced by this tool.',
          );
        const pending = readPending(run.metadata?.[metadataKey]);
        const id = requestId(actor.runId, callId, 'observe');
        if (pending.some((item) => item.requestId === id))
          return output({
            status: 'pending verification',
            decisionId: input.decisionId,
          });
        if (pending.length >= 10)
          throw new Error(
            'This run already has ten feedback reports awaiting verification.',
          );
        const item: PendingObservation = {
          ...input,
          taskId: task.id,
          requestId: id,
        };
        if (
          !services.updateRun(run.id, {
            metadata: { [metadataKey]: [...pending, item] },
          })
        )
          throw new Error('The pending report was not saved.');
        return output({
          status: 'pending verification',
          decisionId: input.decisionId,
          instruction:
            'Include the exact observed-result quotation in the final response. A successful run and a matching quotation are required before this becomes feedback in the workspace.',
        });
      }),
    },
  ];
}

function readPending(value: unknown): PendingObservation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item) => {
    const parsed = pendingObservation.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** After the ledger has completed the run, promote only verifiable reports. Never fail the run. */
export async function finalizeCoevolutionObservations(
  root: string,
  runId: string,
  services = defaultServices,
): Promise<void> {
  let run: AgentRunRecord | undefined;
  try {
    run = services.getRun(runId);
  } catch {
    return;
  }
  if (!run || run.status !== 'completed' || !run.chatSessionId) return;
  for (const item of readPending(run.metadata?.[metadataKey])) {
    try {
      const task = await services.get(root, item.taskId);
      if (!task || task.archived || task.chatSessionId !== run.chatSessionId)
        throw new Error(
          'This report belongs to an inactive or different conversation.',
        );
      const existing = task.decisions.find(
        (decision) => decision.id === item.decisionId,
      )?.outcome;
      const output = services.completedOutput?.(root, run) ?? run.outputSummary;
      const quote = output !== undefined ? resolveEvidenceQuote(output, item.quote) : item.quote;
      if (!quote) throw new Error('The quotation does not match a unique span of the actual output.');
      if (
        existing?.evidence.kind === 'run' &&
        existing.evidence.runId === runId &&
        existing.evidence.quote === quote
      )
        continue;
      await services.update(root, task.id, {
        version: task.version,
        requestId: item.requestId,
        action: 'observe-decision',
        decisionId: item.decisionId,
        observation: item.observation,
        evidence: { kind: 'run', runId, quote },
      });
    } catch (error) {
      try {
        services.event(runId, {
          type: 'status',
          category: 'status',
          message:
            'Echo feedback was not verified. Review the run evidence in the workspace.',
          metadata: {
            echoTaskId: item.taskId,
            echoDecisionId: item.decisionId,
            echoFeedbackError:
              error instanceof Error
                ? error.message
                : 'Could not verify this report.',
          },
        });
      } catch {
        /* Feedback is supplemental; an unavailable ledger must not reverse a completed run. */
      }
    }
  }
}
