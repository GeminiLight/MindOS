import { AsyncLocalStorage } from 'node:async_hooks';

export type AskUserQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

export type AskUserQuestionQuestion = {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
};

export type AskUserQuestionParams = {
  questions: AskUserQuestionQuestion[];
};

export type AskUserQuestionAnswer = {
  questionIndex: number;
  question: string;
  kind: 'option' | 'custom' | 'chat' | 'multi';
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
};

export type AskUserQuestionResult = {
  answers: AskUserQuestionAnswer[];
  cancelled: boolean;
  error?: string;
};

export type UserQuestionStartEvent = {
  type: 'user_question_start';
  runId: string;
  toolCallId: string;
  questions: AskUserQuestionQuestion[];
};

export type UserQuestionAnsweredEvent = {
  type: 'user_question_answered';
  runId: string;
  toolCallId: string;
  answers: AskUserQuestionAnswer[];
};

export type UserQuestionCancelledEvent = {
  type: 'user_question_cancelled';
  runId: string;
  toolCallId: string;
  reason: string;
};

export type AskUserQuestionBridgeSend = (
  event: UserQuestionStartEvent | UserQuestionAnsweredEvent | UserQuestionCancelledEvent,
) => void;

export type AskUserQuestionBridgeContext = {
  runId: string;
  send: AskUserQuestionBridgeSend;
  timeoutMs?: number;
};

type PendingQuestion = {
  runId: string;
  toolCallId: string;
  params: AskUserQuestionParams;
  send: AskUserQuestionBridgeSend;
  resolve: (result: AskUserQuestionResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type AskUserQuestionBridgeGlobalState = {
  bridgeContext: AsyncLocalStorage<AskUserQuestionBridgeContext>;
  runs: Map<string, AskUserQuestionBridgeContext>;
  pendingQuestions: Map<string, PendingQuestion>;
};

const BRIDGE_GLOBAL_KEY = Symbol.for('mindos.askUserQuestionBridge');

function getGlobalBridgeState(): AskUserQuestionBridgeGlobalState {
  const root = globalThis as typeof globalThis & {
    [BRIDGE_GLOBAL_KEY]?: AskUserQuestionBridgeGlobalState;
  };
  root[BRIDGE_GLOBAL_KEY] ??= {
    bridgeContext: new AsyncLocalStorage<AskUserQuestionBridgeContext>(),
    runs: new Map<string, AskUserQuestionBridgeContext>(),
    pendingQuestions: new Map<string, PendingQuestion>(),
  };
  return root[BRIDGE_GLOBAL_KEY];
}

const bridgeState = getGlobalBridgeState();
const bridgeContext = bridgeState.bridgeContext;
const runs = bridgeState.runs;
const pendingQuestions = bridgeState.pendingQuestions;

function pendingKey(runId: string, toolCallId: string): string {
  return `${runId}:${toolCallId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQuestions(params: unknown): AskUserQuestionQuestion[] {
  if (!isRecord(params) || !Array.isArray(params.questions)) return [];
  return params.questions
    .filter(isRecord)
    .map((question) => ({
      question: typeof question.question === 'string' ? question.question : '',
      header: typeof question.header === 'string' ? question.header : '',
      multiSelect: question.multiSelect === true,
      options: Array.isArray(question.options)
        ? question.options.filter(isRecord).map((option) => ({
          label: typeof option.label === 'string' ? option.label : '',
          description: typeof option.description === 'string' ? option.description : '',
          ...(typeof option.preview === 'string' ? { preview: option.preview } : {}),
        }))
        : [],
    }));
}

function cancelled(reason: string): AskUserQuestionResult {
  return { answers: [], cancelled: true, error: reason };
}

export function runWithAskUserQuestionBridge<T>(
  context: AskUserQuestionBridgeContext,
  callback: () => Promise<T>,
): Promise<T> {
  runs.set(context.runId, context);
  return bridgeContext.run(context, async () => {
    try {
      return await callback();
    } finally {
      cancelQuestionsForRun(context.runId);
      runs.delete(context.runId);
    }
  });
}

export function hasAskUserQuestionBridge(): boolean {
  return Boolean(bridgeContext.getStore());
}

export async function askUserQuestionViaBridge(input: {
  toolCallId: string;
  params: unknown;
  signal?: AbortSignal;
}): Promise<AskUserQuestionResult> {
  const context = bridgeContext.getStore();
  if (!context) return cancelled('no_bridge');
  return enqueueAskUserQuestion(context, input);
}

export async function askUserQuestionForRun(input: {
  runId: string;
  toolCallId: string;
  params: unknown;
  signal?: AbortSignal;
}): Promise<AskUserQuestionResult> {
  const context = runs.get(input.runId);
  if (!context) return cancelled('no_bridge');
  return enqueueAskUserQuestion(context, input);
}

function enqueueAskUserQuestion(
  context: AskUserQuestionBridgeContext,
  input: {
    toolCallId: string;
    params: unknown;
    signal?: AbortSignal;
  },
): Promise<AskUserQuestionResult> {
  const questions = normalizeQuestions(input.params);
  if (questions.length === 0) return Promise.resolve(cancelled('empty_questions'));
  const params: AskUserQuestionParams = { questions };
  const key = pendingKey(context.runId, input.toolCallId);

  if (pendingQuestions.has(key)) return Promise.resolve(cancelled('duplicate_question'));

  return new Promise<AskUserQuestionResult>((resolve, reject) => {
    let abort: (() => void) | undefined;
    const finish = (result: AskUserQuestionResult) => {
      const pending = pendingQuestions.get(key);
      if (!pending) return;
      clearTimeout(pending.timeout);
      if (abort) input.signal?.removeEventListener('abort', abort);
      pendingQuestions.delete(key);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      context.send({
        type: 'user_question_cancelled',
        runId: context.runId,
        toolCallId: input.toolCallId,
        reason: 'timeout',
      });
      finish(cancelled('timeout'));
    }, context.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    pendingQuestions.set(key, {
      runId: context.runId,
      toolCallId: input.toolCallId,
      params,
      send: context.send,
      resolve: finish,
      reject,
      timeout,
    });

    abort = () => {
      context.send({
        type: 'user_question_cancelled',
        runId: context.runId,
        toolCallId: input.toolCallId,
        reason: 'aborted',
      });
      finish(cancelled('aborted'));
    };

    if (input.signal?.aborted) {
      abort();
      return;
    }

    input.signal?.addEventListener('abort', abort, { once: true });

    context.send({
      type: 'user_question_start',
      runId: context.runId,
      toolCallId: input.toolCallId,
      questions,
    });
  });
}

function cancelQuestionsForRun(runId: string): void {
  for (const pending of Array.from(pendingQuestions.values())) {
    if (pending.runId !== runId) continue;
    pending.send({
      type: 'user_question_cancelled',
      runId,
      toolCallId: pending.toolCallId,
      reason: 'run_finished',
    });
    pending.resolve(cancelled('run_finished'));
  }
}

export function answerAskUserQuestion(input: {
  runId: string;
  toolCallId: string;
  answers: AskUserQuestionAnswer[];
  cancelled?: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
  const key = pendingKey(input.runId, input.toolCallId);
  const pending = pendingQuestions.get(key);
  if (!pending) return { ok: false, status: 404, error: 'Question is no longer pending.' };
  const validation = input.cancelled === true
    ? { ok: true as const, answers: [] }
    : validateAnswers(pending.params.questions, input.answers);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };

  const result: AskUserQuestionResult = {
    answers: validation.answers,
    cancelled: input.cancelled === true,
  };

  pending.send(input.cancelled === true
    ? {
        type: 'user_question_cancelled',
        runId: input.runId,
        toolCallId: input.toolCallId,
        reason: 'user_cancelled',
      }
    : {
        type: 'user_question_answered',
        runId: input.runId,
        toolCallId: input.toolCallId,
        answers: result.answers,
      });
  pending.resolve(result);
  return { ok: true };
}

function validateAnswers(
  questions: AskUserQuestionQuestion[],
  answers: AskUserQuestionAnswer[],
): { ok: true; answers: AskUserQuestionAnswer[] } | { ok: false; error: string } {
  if (!Array.isArray(answers) || answers.length === 0) {
    return { ok: false, error: 'At least one answer is required.' };
  }

  const seen = new Set<number>();
  for (const answer of answers) {
    if (!Number.isInteger(answer.questionIndex)) {
      return { ok: false, error: 'Answer questionIndex must be an integer.' };
    }
    if (seen.has(answer.questionIndex)) {
      return { ok: false, error: 'Each question can only be answered once.' };
    }
    seen.add(answer.questionIndex);

    const question = questions[answer.questionIndex];
    if (!question) {
      return { ok: false, error: 'Answer questionIndex does not match a pending question.' };
    }
    if (answer.question !== question.question) {
      return { ok: false, error: 'Answer question text does not match the pending question.' };
    }

    const optionLabels = new Set(question.options.map((option) => option.label));
    if (answer.kind === 'option') {
      if (question.multiSelect) {
        return { ok: false, error: 'Use a multi answer for multi-select questions.' };
      }
      if (typeof answer.answer !== 'string' || !answer.answer.trim()) {
        return { ok: false, error: 'Option answers must include a selected option.' };
      }
      if (optionLabels.size > 0 && !optionLabels.has(answer.answer)) {
        return { ok: false, error: 'Selected option is not valid for this question.' };
      }
      continue;
    }

    if (answer.kind === 'multi') {
      if (!question.multiSelect) {
        return { ok: false, error: 'Use a single answer for single-select questions.' };
      }
      const selected = Array.isArray(answer.selected) ? answer.selected : [];
      if (selected.length === 0) {
        return { ok: false, error: 'Multi-select answers must include at least one option.' };
      }
      if (optionLabels.size > 0 && selected.some((value) => !optionLabels.has(value))) {
        return { ok: false, error: 'Selected option is not valid for this question.' };
      }
      continue;
    }

    if (answer.kind === 'custom' || answer.kind === 'chat') {
      if (typeof answer.answer !== 'string' || !answer.answer.trim()) {
        return { ok: false, error: 'Custom answers must include text.' };
      }
      continue;
    }

    return { ok: false, error: 'Answer kind is not valid.' };
  }

  return { ok: true, answers };
}

export function cancelAskUserQuestion(input: {
  runId: string;
  toolCallId: string;
  reason?: string;
}): { ok: true } | { ok: false; status: number; error: string } {
  const key = pendingKey(input.runId, input.toolCallId);
  const pending = pendingQuestions.get(key);
  if (!pending) return { ok: false, status: 404, error: 'Question is no longer pending.' };
  pending.send({
    type: 'user_question_cancelled',
    runId: input.runId,
    toolCallId: input.toolCallId,
    reason: input.reason ?? 'user_cancelled',
  });
  pending.resolve(cancelled(input.reason ?? 'user_cancelled'));
  return { ok: true };
}

export function getPendingAskUserQuestionCount(): number {
  return pendingQuestions.size;
}
