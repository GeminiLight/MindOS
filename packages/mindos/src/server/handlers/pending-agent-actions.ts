import {
  answerAskUserQuestionOrForward,
  cancelAskUserQuestionOrForward,
  resolveRuntimePermissionOrForward,
} from '../../agent/bridges/pending-prompt-resolution.js';
import type { AskUserQuestionAnswer } from '../../agent/bridges/user-question-bridge.js';
import { json, type MindosServerResponse } from '../response.js';
import { resolveStudioAutomationApproval } from '../automations/approvals.js';
import { buildPendingAgentActionsPayload } from '../projections/pending-actions-source.js';
import type { PendingAutomationApprovalAction } from '../projections/pending-actions.js';

type ErrorBody = { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Kept as an alias: the canonical shape lives in the pure core projection. */
export type PendingAutomationApproval = PendingAutomationApprovalAction;

export type PendingAgentActionServices = { mindRoot?: string; now?(): Date };

export function handlePendingAgentActionsGet(services: PendingAgentActionServices = {}) {
  // One shared derivation for every host: in-process bridge maps ∪ open rows
  // from the cross-process prompt store ∪ durable automation approvals.
  return json(buildPendingAgentActionsPayload({
    ...(services.mindRoot ? { mindRoot: services.mindRoot } : {}),
    ...(services.now ? { now: services.now().getTime() } : {}),
  }));
}

export function handleAutomationApprovalDecisionPost(
  body: unknown,
  services: Required<Pick<PendingAgentActionServices, 'mindRoot'>> & Pick<PendingAgentActionServices, 'now'>,
): MindosServerResponse<{ ok: true; result: 'resolved' | 'unchanged'; jobTitle: string } | ErrorBody> {
  if (!isRecord(body)) return json({ error: 'Invalid request body.' }, { status: 400 });
  const approvalId = stringField(body, 'approvalId');
  const decision = body.decision === 'allow' || body.decision === 'deny' ? body.decision : null;
  if (!approvalId || !decision) {
    return json({ error: 'approvalId and allow or deny decision are required.' }, { status: 400 });
  }
  const result = resolveStudioAutomationApproval(
    services.mindRoot,
    approvalId,
    decision,
    services.now?.() ?? new Date(),
  );
  if (result.kind === 'missing') return json({ error: `Automation approval not found: ${approvalId}` }, { status: 404 });
  if (result.kind === 'job-missing') return json({ error: 'The automation for this approval no longer exists.' }, { status: 409 });
  if (result.kind === 'conflict') return json({ error: 'This approval was already resolved or consumed with a different decision.' }, { status: 409 });
  if (!('approval' in result)) return json({ error: 'Automation approval could not be resolved.' }, { status: 409 });
  return json({ ok: true, result: result.kind, jobTitle: result.jobTitle ?? 'Automation' });
}

export function handleRuntimePermissionDecisionPost(
  body: unknown,
): MindosServerResponse<{ ok: true; forwarded?: true } | ErrorBody> {
  if (!isRecord(body)) return json({ error: 'Invalid request body.' }, { status: 400 });
  const runId = stringField(body, 'runId');
  const requestId = stringField(body, 'requestId');
  const decision = stringField(body, 'decision');
  if (!runId || !requestId || !decision) {
    return json({ error: 'runId, requestId, and decision are required.' }, { status: 400 });
  }
  // The prompt may be pending in another process; the resolver forwards the
  // decision through the cross-process store when the local map misses.
  const result = resolveRuntimePermissionOrForward({ runId, requestId, decision });
  return result.ok
    ? json({ ok: true, ...(result.forwarded ? { forwarded: true } : {}) })
    : json({ error: result.error }, { status: result.status });
}

export function handleUserQuestionDecisionPost(
  body: unknown,
): MindosServerResponse<{ ok: true; forwarded?: true } | ErrorBody> {
  if (!isRecord(body)) return json({ error: 'Invalid request body.' }, { status: 400 });
  const runId = stringField(body, 'runId');
  const toolCallId = stringField(body, 'toolCallId');
  if (!runId || !toolCallId) {
    return json({ error: 'runId and toolCallId are required.' }, { status: 400 });
  }
  const action = stringField(body, 'action') ?? 'answer';
  const result = action === 'cancel'
    ? cancelAskUserQuestionOrForward({
        runId,
        toolCallId,
        reason: stringField(body, 'reason') ?? 'user_cancelled',
      })
    : answerAskUserQuestionOrForward({
        runId,
        toolCallId,
        answers: normalizeAnswers(body.answers),
        cancelled: body.cancelled === true,
      });
  return result.ok
    ? json({ ok: true, ...(result.forwarded ? { forwarded: true } : {}) })
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
