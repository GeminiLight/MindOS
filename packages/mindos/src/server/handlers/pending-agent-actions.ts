import {
  listPendingRuntimePermissions,
  resolveRuntimePermission,
} from '../../agent/bridges/runtime-permission-bridge.js';
import {
  answerAskUserQuestion,
  cancelAskUserQuestion,
  listPendingAskUserQuestions,
  type AskUserQuestionAnswer,
} from '../../agent/bridges/user-question-bridge.js';
import { json, type MindosServerResponse } from '../response.js';

type ErrorBody = { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function handlePendingAgentActionsGet() {
  const permissions = listPendingRuntimePermissions();
  const questions = listPendingAskUserQuestions();
  return json({
    permissions,
    questions,
    pendingCount: permissions.length + questions.length,
    generatedAt: Date.now(),
  });
}

export function handleRuntimePermissionDecisionPost(
  body: unknown,
): MindosServerResponse<{ ok: true } | ErrorBody> {
  if (!isRecord(body)) return json({ error: 'Invalid request body.' }, { status: 400 });
  const runId = stringField(body, 'runId');
  const requestId = stringField(body, 'requestId');
  const decision = stringField(body, 'decision');
  if (!runId || !requestId || !decision) {
    return json({ error: 'runId, requestId, and decision are required.' }, { status: 400 });
  }
  const result = resolveRuntimePermission({ runId, requestId, decision });
  return result.ok
    ? json({ ok: true })
    : json({ error: result.error }, { status: result.status });
}

export function handleUserQuestionDecisionPost(
  body: unknown,
): MindosServerResponse<{ ok: true } | ErrorBody> {
  if (!isRecord(body)) return json({ error: 'Invalid request body.' }, { status: 400 });
  const runId = stringField(body, 'runId');
  const toolCallId = stringField(body, 'toolCallId');
  if (!runId || !toolCallId) {
    return json({ error: 'runId and toolCallId are required.' }, { status: 400 });
  }
  const action = stringField(body, 'action') ?? 'answer';
  const result = action === 'cancel'
    ? cancelAskUserQuestion({
        runId,
        toolCallId,
        reason: stringField(body, 'reason') ?? 'user_cancelled',
      })
    : answerAskUserQuestion({
        runId,
        toolCallId,
        answers: normalizeAnswers(body.answers),
        cancelled: body.cancelled === true,
      });
  return result.ok
    ? json({ ok: true })
    : json({ error: result.error }, { status: result.status });
}

function normalizeAnswers(value: unknown): AskUserQuestionAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((answer) => ({
    questionIndex: typeof answer.questionIndex === 'number' ? answer.questionIndex : -1,
    question: typeof answer.question === 'string' ? answer.question : '',
    kind: answer.kind === 'custom' || answer.kind === 'chat' || answer.kind === 'multi'
      ? answer.kind
      : 'option',
    answer: typeof answer.answer === 'string' ? answer.answer : null,
    ...(Array.isArray(answer.selected)
      ? { selected: answer.selected.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(typeof answer.notes === 'string' ? { notes: answer.notes } : {}),
    ...(typeof answer.preview === 'string' ? { preview: answer.preview } : {}),
  }));
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
