import type {
  AskUserQuestionAnswer,
  AskUserQuestionOption,
  AskUserQuestionQuestion,
  PendingAgentActionsResponse,
  PendingAutomationApproval,
  PendingAskUserQuestion,
  PendingRuntimePermission,
  RuntimePermissionOption,
} from './types';

export type PendingAgentAction = PendingRuntimePermission | PendingAskUserQuestion | PendingAutomationApproval;
export type AskUserQuestionDraft = { selected?: string[]; custom?: string };

export type NormalizedPendingAgentActions = PendingAgentActionsResponse & {
  actions: PendingAgentAction[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizePermissionOption(value: unknown): RuntimePermissionOption | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value, 'id');
  const label = stringValue(value, 'label');
  if (!id || !label) return null;
  const intent = value.intent === 'allow' || value.intent === 'deny' || value.intent === 'cancel'
    ? value.intent
    : undefined;
  const scope = value.scope === 'once' || value.scope === 'session' || value.scope === 'always' || value.scope === 'turn'
    ? value.scope
    : undefined;
  return {
    id,
    label,
    ...(stringValue(value, 'description') ? { description: stringValue(value, 'description') } : {}),
    ...(intent ? { intent } : {}),
    ...(scope ? { scope } : {}),
  };
}

function normalizePermission(value: unknown, now: number): PendingRuntimePermission | null {
  if (!isRecord(value) || value.kind !== 'runtime-permission') return null;
  const runId = stringValue(value, 'runId');
  const requestId = stringValue(value, 'requestId');
  const toolCallId = stringValue(value, 'toolCallId');
  const toolName = stringValue(value, 'toolName');
  const action = stringValue(value, 'action');
  const createdAt = finiteNumber(value, 'createdAt');
  const expiresAt = finiteNumber(value, 'expiresAt');
  const runtime = value.runtime === 'codex' || value.runtime === 'claude' ? value.runtime : undefined;
  if (!runId || !requestId || !runtime || !toolCallId || !toolName || !action
    || createdAt === undefined || expiresAt === undefined || expiresAt <= now) return null;
  if (!isRecord(value.risk)) return null;
  const level = value.risk.level;
  const summary = stringValue(value.risk, 'summary');
  if ((level !== 'low' && level !== 'medium' && level !== 'high') || !summary) return null;
  const options = Array.isArray(value.options)
    ? value.options.map(normalizePermissionOption).filter((option): option is RuntimePermissionOption => option !== null)
    : [];
  return {
    kind: 'runtime-permission',
    runId,
    requestId,
    runtime,
    toolCallId,
    toolName,
    action,
    options,
    risk: {
      level,
      summary,
      ...(Array.isArray(value.risk.reasons)
        ? { reasons: value.risk.reasons.filter((item): item is string => typeof item === 'string') }
        : {}),
    },
    createdAt,
    expiresAt,
    ...(value.input !== undefined ? { input: value.input } : {}),
    ...(stringValue(value, 'reason') ? { reason: stringValue(value, 'reason') } : {}),
    ...(stringValue(value, 'resource') ? { resource: stringValue(value, 'resource') } : {}),
  };
}

function normalizeQuestionOption(value: unknown): AskUserQuestionOption | null {
  if (!isRecord(value)) return null;
  const label = stringValue(value, 'label');
  if (!label) return null;
  return {
    label,
    description: typeof value.description === 'string' ? value.description : '',
    ...(stringValue(value, 'preview') ? { preview: stringValue(value, 'preview') } : {}),
  };
}

function normalizeQuestion(value: unknown): AskUserQuestionQuestion | null {
  if (!isRecord(value)) return null;
  const question = stringValue(value, 'question');
  if (!question) return null;
  return {
    question,
    header: stringValue(value, 'header') ?? 'Question',
    options: Array.isArray(value.options)
      ? value.options.map(normalizeQuestionOption).filter((option): option is AskUserQuestionOption => option !== null)
      : [],
    ...(value.multiSelect === true ? { multiSelect: true } : {}),
  };
}

function normalizeQuestionAction(value: unknown, now: number): PendingAskUserQuestion | null {
  if (!isRecord(value) || value.kind !== 'user-question') return null;
  const runId = stringValue(value, 'runId');
  const toolCallId = stringValue(value, 'toolCallId');
  const createdAt = finiteNumber(value, 'createdAt');
  const expiresAt = finiteNumber(value, 'expiresAt');
  const questions = Array.isArray(value.questions)
    ? value.questions.map(normalizeQuestion).filter((question): question is AskUserQuestionQuestion => question !== null)
    : [];
  if (!runId || !toolCallId || createdAt === undefined || expiresAt === undefined
    || expiresAt <= now || questions.length === 0) return null;
  return { kind: 'user-question', runId, toolCallId, questions, createdAt, expiresAt };
}

function normalizeAutomationApproval(value: unknown): PendingAutomationApproval | null {
  if (!isRecord(value) || value.kind !== 'automation-approval') return null;
  const approvalId = stringValue(value, 'approvalId');
  const jobId = stringValue(value, 'jobId');
  const jobTitle = stringValue(value, 'jobTitle');
  const toolName = stringValue(value, 'toolName');
  const createdAt = finiteNumber(value, 'createdAt');
  const runtime = value.runtime === 'codex' || value.runtime === 'claude' ? value.runtime : undefined;
  if (!approvalId || !jobId || !jobTitle || !toolName || !runtime || createdAt === undefined) return null;
  const riskRecord = isRecord(value.risk) ? value.risk : null;
  const riskLevel = riskRecord?.level === 'low' || riskRecord?.level === 'medium' || riskRecord?.level === 'high'
    ? riskRecord.level
    : undefined;
  const riskSummary = riskRecord ? stringValue(riskRecord, 'summary') : undefined;
  return {
    kind: 'automation-approval',
    approvalId,
    jobId,
    ...(stringValue(value, 'runId') ? { runId: stringValue(value, 'runId') } : {}),
    jobTitle,
    runtime,
    toolName,
    ...(stringValue(value, 'action') ? { action: stringValue(value, 'action') } : {}),
    ...(stringValue(value, 'resource') ? { resource: stringValue(value, 'resource') } : {}),
    ...(stringValue(value, 'inputPreview') ? { inputPreview: stringValue(value, 'inputPreview') } : {}),
    ...(riskLevel && riskSummary ? { risk: { level: riskLevel, summary: riskSummary } } : {}),
    createdAt,
  };
}

export function normalizePendingAgentActions(
  payload: unknown,
  now = Date.now(),
): NormalizedPendingAgentActions {
  const record = isRecord(payload) ? payload : {};
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.map((item) => normalizePermission(item, now)).filter((item): item is PendingRuntimePermission => item !== null)
    : [];
  const questions = Array.isArray(record.questions)
    ? record.questions.map((item) => normalizeQuestionAction(item, now)).filter((item): item is PendingAskUserQuestion => item !== null)
    : [];
  const automationApprovals = Array.isArray(record.automationApprovals)
    ? record.automationApprovals
      .map(normalizeAutomationApproval)
      .filter((item): item is PendingAutomationApproval => item !== null)
    : [];
  const actions = [...permissions, ...questions, ...automationApprovals].sort((left, right) =>
    left.createdAt - right.createdAt || pendingAgentActionKey(left).localeCompare(pendingAgentActionKey(right)));
  return {
    permissions,
    questions,
    automationApprovals,
    actions,
    pendingCount: actions.length,
    generatedAt: finiteNumber(record, 'generatedAt') ?? now,
  };
}

export function pendingAgentActionKey(action: PendingAgentAction): string {
  if (action.kind === 'runtime-permission') return `${action.kind}:${action.runId}:${action.requestId}`;
  if (action.kind === 'user-question') return `${action.kind}:${action.runId}:${action.toolCallId}`;
  return `${action.kind}:${action.approvalId}`;
}

export function buildAskUserQuestionAnswers(
  action: PendingAskUserQuestion,
  drafts: Record<number, AskUserQuestionDraft>,
): { ok: true; answers: AskUserQuestionAnswer[] } | { ok: false; error: string } {
  const answers: AskUserQuestionAnswer[] = [];
  for (const [questionIndex, question] of action.questions.entries()) {
    const draft = drafts[questionIndex] ?? {};
    const selected = (draft.selected ?? []).filter((label) =>
      question.options.some((option) => option.label === label));
    const custom = draft.custom?.trim() ?? '';
    if (question.multiSelect) {
      if (selected.length === 0) return incompleteAnswers();
      answers.push({ questionIndex, question: question.question, kind: 'multi', answer: null, selected });
    } else if (selected[0]) {
      answers.push({ questionIndex, question: question.question, kind: 'option', answer: selected[0] });
    } else if (custom) {
      answers.push({ questionIndex, question: question.question, kind: 'custom', answer: custom });
    } else {
      return incompleteAnswers();
    }
  }
  return { ok: true, answers };
}

function incompleteAnswers(): { ok: false; error: string } {
  return { ok: false, error: 'Answer every question before submitting.' };
}

export function compactPendingAgentActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/no longer pending|already resolved|expired/i.test(message)) {
    return 'This request was already resolved or expired.';
  }
  return message.trim() || 'Unable to update this request. Try again.';
}
