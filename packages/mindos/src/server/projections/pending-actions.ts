/**
 * Pure pending-actions projection (spec-cross-process-run-events D).
 *
 * NO node imports: this module is safe inside a client bundle (the Web ask
 * panel imports it through `@geminilight/mindos/server/projections/*`) and on
 * the server (handlers + the pending-actions source). It is the single home
 * of the derivation that used to live in packages/mobile/lib/pending-agent-actions.ts:
 * validation, expiry filtering, ordering and stable keys for the payload
 * served by `GET /api/agent/pending-actions`.
 */

import type {
  AskUserQuestion,
  AskUserQuestionAnswer,
  AskUserQuestionOption,
  RuntimePermissionOption,
  RuntimePermissionRisk,
} from '../../agent/stream/stream-message-types.js';

export type PendingRuntimePermissionAction = {
  kind: 'runtime-permission';
  runId: string;
  requestId: string;
  runtime: 'codex' | 'claude';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  options: RuntimePermissionOption[];
  reason?: string;
  action: string;
  resource?: string;
  risk: RuntimePermissionRisk;
  createdAt: number;
  expiresAt: number;
};

export type PendingAskUserQuestionAction = {
  kind: 'user-question';
  runId: string;
  toolCallId: string;
  questions: AskUserQuestion[];
  createdAt: number;
  expiresAt: number;
};

export type PendingAutomationApprovalAction = {
  kind: 'automation-approval';
  approvalId: string;
  jobId: string;
  runId?: string;
  jobTitle: string;
  runtime: 'codex' | 'claude';
  toolName: string;
  action?: string;
  resource?: string;
  inputPreview?: string;
  risk?: { level: 'low' | 'medium' | 'high'; summary: string };
  createdAt: number;
};

export type PendingAgentAction =
  | PendingRuntimePermissionAction
  | PendingAskUserQuestionAction
  | PendingAutomationApprovalAction;

/** One normalized action plus its stable identity across refetches. */
export type PendingAgentActionEntry = PendingAgentAction & { key: string };

export type AskUserQuestionDraft = { selected?: string[]; custom?: string };

export type PendingAgentActionsPayload = {
  permissions: PendingRuntimePermissionAction[];
  questions: PendingAskUserQuestionAction[];
  automationApprovals: PendingAutomationApprovalAction[];
  actions: PendingAgentActionEntry[];
  pendingCount: number;
  generatedAt: number;
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
  const description = stringValue(value, 'description');
  return {
    id,
    label,
    ...(description ? { description } : {}),
    ...(intent ? { intent } : {}),
    ...(scope ? { scope } : {}),
  };
}

function normalizePermission(value: unknown, now: number): PendingRuntimePermissionAction | null {
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
  const resource = stringValue(value, 'resource');
  const reason = stringValue(value, 'reason');
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
    ...(reason ? { reason } : {}),
    ...(resource ? { resource } : {}),
  };
}

function normalizeQuestionOption(value: unknown): AskUserQuestionOption | null {
  if (!isRecord(value)) return null;
  const label = stringValue(value, 'label');
  if (!label) return null;
  const preview = stringValue(value, 'preview');
  return {
    label,
    description: typeof value.description === 'string' ? value.description : '',
    ...(preview ? { preview } : {}),
  };
}

function normalizeQuestion(value: unknown): AskUserQuestion | null {
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

function normalizeQuestionAction(value: unknown, now: number): PendingAskUserQuestionAction | null {
  if (!isRecord(value) || value.kind !== 'user-question') return null;
  const runId = stringValue(value, 'runId');
  const toolCallId = stringValue(value, 'toolCallId');
  const createdAt = finiteNumber(value, 'createdAt');
  const expiresAt = finiteNumber(value, 'expiresAt');
  const questions = Array.isArray(value.questions)
    ? value.questions.map(normalizeQuestion).filter((question): question is AskUserQuestion => question !== null)
    : [];
  if (!runId || !toolCallId || createdAt === undefined || expiresAt === undefined
    || expiresAt <= now || questions.length === 0) return null;
  return { kind: 'user-question', runId, toolCallId, questions, createdAt, expiresAt };
}

function normalizeAutomationApproval(value: unknown): PendingAutomationApprovalAction | null {
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
  const approvalRunId = stringValue(value, 'runId');
  const action = stringValue(value, 'action');
  const resource = stringValue(value, 'resource');
  const inputPreview = stringValue(value, 'inputPreview');
  return {
    kind: 'automation-approval',
    approvalId,
    jobId,
    ...(approvalRunId ? { runId: approvalRunId } : {}),
    jobTitle,
    runtime,
    toolName,
    ...(action ? { action } : {}),
    ...(resource ? { resource } : {}),
    ...(inputPreview ? { inputPreview } : {}),
    ...(riskLevel && riskSummary ? { risk: { level: riskLevel, summary: riskSummary } } : {}),
    createdAt,
  };
}

export function pendingAgentActionKey(action: PendingAgentAction): string {
  if (action.kind === 'runtime-permission') return `${action.kind}:${action.runId}:${action.requestId}`;
  if (action.kind === 'user-question') return `${action.kind}:${action.runId}:${action.toolCallId}`;
  return `${action.kind}:${action.approvalId}`;
}

/**
 * Validates and orders a raw pending-actions payload (any process, any mix of
 * sources). Malformed or expired entries are dropped, `actions` merges the
 * three groups oldest-first with a stable `key` per entry.
 */
export function normalizePendingAgentActions(payload: unknown, now = Date.now()): PendingAgentActionsPayload {
  const record = isRecord(payload) ? payload : {};
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.map((item) => normalizePermission(item, now)).filter((item): item is PendingRuntimePermissionAction => item !== null)
    : [];
  const questions = Array.isArray(record.questions)
    ? record.questions.map((item) => normalizeQuestionAction(item, now)).filter((item): item is PendingAskUserQuestionAction => item !== null)
    : [];
  const automationApprovals = Array.isArray(record.automationApprovals)
    ? record.automationApprovals
      .map(normalizeAutomationApproval)
      .filter((item): item is PendingAutomationApprovalAction => item !== null)
    : [];
  const actions: PendingAgentActionEntry[] = [...permissions, ...questions, ...automationApprovals]
    .sort((left, right) =>
      left.createdAt - right.createdAt || pendingAgentActionKey(left).localeCompare(pendingAgentActionKey(right)))
    .map((action) => ({ ...action, key: pendingAgentActionKey(action) }));
  return {
    permissions,
    questions,
    automationApprovals,
    actions,
    pendingCount: actions.length,
    generatedAt: finiteNumber(record, 'generatedAt') ?? now,
  };
}

/** Turns UI draft state (option selections / custom text) into wire answers. */
export function buildAskUserQuestionAnswers(
  action: PendingAskUserQuestionAction,
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

const PENDING_ACTION_EVENT_CATEGORIES = new Set(['permission', 'question']);
const PENDING_ACTION_RUN_TERMINAL_TYPES = new Set(['run_completed', 'run_failed', 'run_canceled']);

/** Structural view of the server events both clients deliver. */
export type PendingAgentActionEventLike = {
  type: string;
  event?: { type?: string; category?: string } | null;
};

/**
 * Only triggers that can add or remove a pending action should cause a
 * re-fetch: the dedicated `run.pending-actions.changed` event (emitted in any
 * process), permission / question ledger events, and run terminations (a run
 * that ends takes its open prompts with it). Tool and text events are ignored
 * so a busy run does not turn into one request per tool call.
 */
export function isPendingAgentActionEvent(event: PendingAgentActionEventLike | null | undefined): boolean {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'run.pending-actions.changed') return true;
  if (event.type !== 'agent-run.event') return false;
  const summary = event.event;
  if (!summary || typeof summary !== 'object') return false;
  return PENDING_ACTION_EVENT_CATEGORIES.has(String(summary.category ?? ''))
    || PENDING_ACTION_RUN_TERMINAL_TYPES.has(String(summary.type ?? ''));
}
