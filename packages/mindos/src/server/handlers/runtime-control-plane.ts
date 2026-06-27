import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveExistingSafe, resolveSafe } from '../../foundation/security/index.js';
import { redactSensitiveText } from '../../agent/redaction.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export const MINDOS_RUNTIME_CONTROL_PLANE_FILE = '.mindos/runtime-control-plane.json';

export type RuntimeControlPlaneTriggerType = 'manual' | 'cron' | 'interval' | 'event';
export type RuntimeControlPlaneScheduleStatus = 'disabled' | 'enabled' | 'paused' | 'archived';
export type RuntimeControlPlaneOverlapPolicy = 'skip' | 'enqueue' | 'cancel-previous';
export type RuntimeControlPlaneRetryPolicy = 'never' | 'once';
export type RuntimeControlPlanePermissionMode = 'read' | 'ask' | 'auto';
export type RuntimeControlPlaneApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type RuntimeControlPlaneWakeStatus = 'pending' | 'claimed' | 'completed' | 'missed';
export type RuntimeControlPlaneFailureKind = 'runtime' | 'permission' | 'tool' | 'timeout' | 'conflict' | 'unknown';
export type RuntimeControlPlaneMailboxStatus = 'queued' | 'delivered' | 'archived';
export type RuntimeControlPlaneTaskStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'cancelled';
export type RuntimeControlPlaneTaskPriority = 'low' | 'normal' | 'high';

export type RuntimeControlPlaneTrigger = {
  type: RuntimeControlPlaneTriggerType;
  cron?: string;
  intervalMs?: number;
  event?: string;
  timezone?: string;
};

export type RuntimeControlPlaneSchedule = {
  id: string;
  title: string;
  runtimeId: string;
  status: RuntimeControlPlaneScheduleStatus;
  trigger: RuntimeControlPlaneTrigger;
  target: {
    assistantId?: string;
    command?: string;
    skillId?: string;
    cwdHint?: string;
  };
  policy: {
    permissionMode: RuntimeControlPlanePermissionMode;
    overlap: RuntimeControlPlaneOverlapPolicy;
    retry: RuntimeControlPlaneRetryPolicy;
    timeoutMs: number;
  };
  inputSummary?: string;
  nextRunAt?: string;
  lastRunId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeControlPlaneApprovalRequest = {
  id: string;
  runtimeId: string;
  runId?: string;
  scheduleId?: string;
  status: RuntimeControlPlaneApprovalStatus;
  scope: 'read' | 'write' | 'shell' | 'network' | 'mcp' | 'schedule' | 'user-extension' | 'unknown';
  summary: string;
  requestedAt: string;
  resolvedAt?: string;
  decision?: 'approve' | 'reject' | 'cancel';
};

export type RuntimeControlPlaneWakeEvent = {
  id: string;
  runtimeId?: string;
  scheduleId?: string;
  runId?: string;
  status: RuntimeControlPlaneWakeStatus;
  triggerAt: string;
  claimedAt?: string;
  completedAt?: string;
  summary?: string;
};

export type RuntimeControlPlaneFailureAudit = {
  id: string;
  runtimeId?: string;
  scheduleId?: string;
  runId?: string;
  kind: RuntimeControlPlaneFailureKind;
  summary: string;
  recoverable: boolean;
  createdAt: string;
};

export type RuntimeControlPlaneMailboxMessage = {
  id: string;
  fromRuntimeId?: string;
  toRuntimeId?: string;
  threadId?: string;
  status: RuntimeControlPlaneMailboxStatus;
  subject: string;
  summary: string;
  createdAt: string;
  deliveredAt?: string;
};

export type RuntimeControlPlaneTask = {
  id: string;
  title: string;
  status: RuntimeControlPlaneTaskStatus;
  priority: RuntimeControlPlaneTaskPriority;
  assigneeRuntimeId?: string;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeControlPlaneSnapshot = {
  schemaVersion: 1;
  updatedAt: string;
  schedules: RuntimeControlPlaneSchedule[];
  approvalQueue: RuntimeControlPlaneApprovalRequest[];
  wakeEvents: RuntimeControlPlaneWakeEvent[];
  failureAudits: RuntimeControlPlaneFailureAudit[];
  mailbox: RuntimeControlPlaneMailboxMessage[];
  tasks: RuntimeControlPlaneTask[];
  summary: {
    scheduleCount: number;
    enabledScheduleCount: number;
    pendingApprovalCount: number;
    pendingWakeCount: number;
    openTaskCount: number;
    queuedMessageCount: number;
  };
};

export type RuntimeControlPlaneMutationPayload =
  | { action: 'create-schedule'; schedule?: unknown }
  | { action: 'update-schedule'; scheduleId?: unknown; patch?: unknown }
  | { action: 'enqueue-approval'; approval?: unknown }
  | { action: 'resolve-approval'; approvalId?: unknown; decision?: unknown }
  | { action: 'record-wake'; wake?: unknown }
  | { action: 'record-failure'; failure?: unknown }
  | { action: 'send-message'; message?: unknown }
  | { action: 'upsert-task'; task?: unknown };

export type RuntimeControlPlaneMutationResult = {
  ok: true;
  action: RuntimeControlPlaneMutationPayload['action'];
  item:
    | RuntimeControlPlaneSchedule
    | RuntimeControlPlaneApprovalRequest
    | RuntimeControlPlaneWakeEvent
    | RuntimeControlPlaneFailureAudit
    | RuntimeControlPlaneMailboxMessage
    | RuntimeControlPlaneTask;
  snapshot: RuntimeControlPlaneSnapshot;
};

export type RuntimeControlPlaneServices = {
  mindRoot: string;
  now?(): Date;
};

type RuntimeControlPlaneState = Omit<RuntimeControlPlaneSnapshot, 'summary'>;
type ParseResult<T> = { value: T } | { error: string };

const MAX_SCHEDULES = 200;
const MAX_APPROVALS = 500;
const MAX_WAKE_EVENTS = 500;
const MAX_FAILURES = 500;
const MAX_MESSAGES = 500;
const MAX_TASKS = 500;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const CRON_MACRO_RE = /^@(yearly|annually|monthly|weekly|daily|hourly)$/;
const CRON_FIELD_RE = /^[A-Za-z0-9*,/\-?#LW]+$/;

export async function handleRuntimeControlPlaneGet(
  searchParams: URLSearchParams,
  services: RuntimeControlPlaneServices,
): Promise<MindosServerResponse<RuntimeControlPlaneSnapshot | { error: string }>> {
  try {
    const snapshot = filterSnapshot(readRuntimeControlPlane(services.mindRoot), {
      runtimeId: searchParams.get('runtime')?.trim(),
      limit: parseLimit(searchParams.get('limit')),
    });
    return json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleRuntimeControlPlanePost(
  body: unknown,
  services: RuntimeControlPlaneServices,
): MindosServerResponse<RuntimeControlPlaneMutationResult | { error: string }> {
  const result = applyRuntimeControlPlaneMutation(services.mindRoot, body, services.now?.() ?? new Date());
  if ('error' in result) return json({ error: result.error }, { status: 400 });
  return json(result.value, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

export function readRuntimeControlPlane(mindRoot: string): RuntimeControlPlaneSnapshot {
  const state = readRuntimeControlPlaneState(mindRoot);
  return withSummary(state);
}

export function applyRuntimeControlPlaneMutation(
  mindRoot: string,
  body: unknown,
  now: Date = new Date(),
): ParseResult<RuntimeControlPlaneMutationResult> {
  if (!isRecord(body)) return { error: 'Expected an object payload.' };
  const action = typeof body.action === 'string' ? body.action : '';
  const state = readRuntimeControlPlaneState(mindRoot);
  const nowIso = now.toISOString();

  switch (action) {
    case 'create-schedule': {
      const parsed = parseSchedule(body.schedule ?? body, state, nowIso);
      if ('error' in parsed) return parsed;
      state.schedules = [parsed.value, ...state.schedules.filter((item) => item.id !== parsed.value.id)].slice(0, MAX_SCHEDULES);
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, parsed.value, state);
    }
    case 'update-schedule': {
      const scheduleId = sanitizeId(body.scheduleId);
      if (!scheduleId) return { error: 'update-schedule requires scheduleId.' };
      const index = state.schedules.findIndex((item) => item.id === scheduleId);
      if (index < 0) return { error: `Schedule not found: ${scheduleId}` };
      const parsed = parseSchedulePatch(state.schedules[index]!, body.patch, nowIso);
      if ('error' in parsed) return parsed;
      state.schedules[index] = parsed.value;
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, parsed.value, state);
    }
    case 'enqueue-approval': {
      const parsed = parseApproval(body.approval ?? body, state, nowIso);
      if ('error' in parsed) return parsed;
      state.approvalQueue = [parsed.value, ...state.approvalQueue.filter((item) => item.id !== parsed.value.id)].slice(0, MAX_APPROVALS);
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, parsed.value, state);
    }
    case 'resolve-approval': {
      const approvalId = sanitizeId(body.approvalId);
      const decision = sanitizeEnum(body.decision, ['approve', 'reject', 'cancel'] as const);
      if (!approvalId || !decision) return { error: 'resolve-approval requires approvalId and decision.' };
      const index = state.approvalQueue.findIndex((item) => item.id === approvalId);
      if (index < 0) return { error: `Approval request not found: ${approvalId}` };
      const current = state.approvalQueue[index]!;
      const resolved: RuntimeControlPlaneApprovalRequest = {
        ...current,
        status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled',
        decision,
        resolvedAt: nowIso,
      };
      state.approvalQueue[index] = resolved;
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, resolved, state);
    }
    case 'record-wake': {
      const parsed = parseWake(body.wake ?? body, state, nowIso);
      if ('error' in parsed) return parsed;
      state.wakeEvents = [parsed.value, ...state.wakeEvents.filter((item) => item.id !== parsed.value.id)].slice(0, MAX_WAKE_EVENTS);
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, parsed.value, state);
    }
    case 'record-failure': {
      const parsed = parseFailure(body.failure ?? body, state, nowIso);
      if ('error' in parsed) return parsed;
      state.failureAudits = [parsed.value, ...state.failureAudits.filter((item) => item.id !== parsed.value.id)].slice(0, MAX_FAILURES);
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, parsed.value, state);
    }
    case 'send-message': {
      const parsed = parseMessage(body.message ?? body, state, nowIso);
      if ('error' in parsed) return parsed;
      state.mailbox = [parsed.value, ...state.mailbox.filter((item) => item.id !== parsed.value.id)].slice(0, MAX_MESSAGES);
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, parsed.value, state);
    }
    case 'upsert-task': {
      const parsed = parseTask(body.task ?? body, state, nowIso);
      if ('error' in parsed) return parsed;
      state.tasks = [parsed.value, ...state.tasks.filter((item) => item.id !== parsed.value.id)].slice(0, MAX_TASKS);
      state.updatedAt = nowIso;
      writeRuntimeControlPlaneState(mindRoot, state);
      return mutationResult(action, parsed.value, state);
    }
    default:
      return { error: `Unsupported runtime control-plane action: ${action || '(missing)'}` };
  }
}

function readRuntimeControlPlaneState(mindRoot: string): RuntimeControlPlaneState {
  const empty = emptyState();
  try {
    const file = runtimeControlPlanePath(mindRoot);
    if (!existsSync(file)) return empty;
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<RuntimeControlPlaneState>;
    return normalizeState(parsed);
  } catch {
    return empty;
  }
}

function writeRuntimeControlPlaneState(mindRoot: string, state: RuntimeControlPlaneState): void {
  const file = runtimeControlPlanePath(mindRoot);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    renameSync(tmp, file);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* ignore cleanup */ }
    throw error;
  }
}

function runtimeControlPlanePath(mindRoot: string): string {
  if (!existsSync(mindRoot)) return join(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE);
  return existsSync(resolveSafe(mindRoot, '.mindos'))
    ? resolveExistingSafe(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE)
    : resolveSafe(mindRoot, MINDOS_RUNTIME_CONTROL_PLANE_FILE);
}

function emptyState(): RuntimeControlPlaneState {
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    schedules: [],
    approvalQueue: [],
    wakeEvents: [],
    failureAudits: [],
    mailbox: [],
    tasks: [],
  };
}

function normalizeState(value: Partial<RuntimeControlPlaneState>): RuntimeControlPlaneState {
  return {
    schemaVersion: 1,
    updatedAt: sanitizeIso(value.updatedAt) ?? new Date(0).toISOString(),
    schedules: Array.isArray(value.schedules) ? value.schedules.filter(isSchedule).slice(0, MAX_SCHEDULES) : [],
    approvalQueue: Array.isArray(value.approvalQueue) ? value.approvalQueue.filter(isApproval).slice(0, MAX_APPROVALS) : [],
    wakeEvents: Array.isArray(value.wakeEvents) ? value.wakeEvents.filter(isWake).slice(0, MAX_WAKE_EVENTS) : [],
    failureAudits: Array.isArray(value.failureAudits) ? value.failureAudits.filter(isFailure).slice(0, MAX_FAILURES) : [],
    mailbox: Array.isArray(value.mailbox) ? value.mailbox.filter(isMessage).slice(0, MAX_MESSAGES) : [],
    tasks: Array.isArray(value.tasks) ? value.tasks.filter(isTask).slice(0, MAX_TASKS) : [],
  };
}

function withSummary(state: RuntimeControlPlaneState): RuntimeControlPlaneSnapshot {
  return {
    ...state,
    summary: {
      scheduleCount: state.schedules.length,
      enabledScheduleCount: state.schedules.filter((item) => item.status === 'enabled').length,
      pendingApprovalCount: state.approvalQueue.filter((item) => item.status === 'pending').length,
      pendingWakeCount: state.wakeEvents.filter((item) => item.status === 'pending').length,
      openTaskCount: state.tasks.filter((item) => item.status === 'todo' || item.status === 'doing' || item.status === 'blocked').length,
      queuedMessageCount: state.mailbox.filter((item) => item.status === 'queued').length,
    },
  };
}

function filterSnapshot(
  snapshot: RuntimeControlPlaneSnapshot,
  options: { runtimeId?: string; limit: number },
): RuntimeControlPlaneSnapshot {
  const runtimeId = options.runtimeId && SAFE_ID_RE.test(options.runtimeId) ? options.runtimeId : undefined;
  const state: RuntimeControlPlaneState = {
    schemaVersion: 1,
    updatedAt: snapshot.updatedAt,
    schedules: snapshot.schedules.filter((item) => !runtimeId || item.runtimeId === runtimeId).slice(0, options.limit),
    approvalQueue: snapshot.approvalQueue.filter((item) => !runtimeId || item.runtimeId === runtimeId).slice(0, options.limit),
    wakeEvents: snapshot.wakeEvents.filter((item) => !runtimeId || item.runtimeId === runtimeId).slice(0, options.limit),
    failureAudits: snapshot.failureAudits.filter((item) => !runtimeId || item.runtimeId === runtimeId).slice(0, options.limit),
    mailbox: snapshot.mailbox.filter((item) => !runtimeId || item.fromRuntimeId === runtimeId || item.toRuntimeId === runtimeId).slice(0, options.limit),
    tasks: snapshot.tasks.filter((item) => !runtimeId || item.assigneeRuntimeId === runtimeId).slice(0, options.limit),
  };
  return withSummary(state);
}

function parseSchedule(raw: unknown, state: RuntimeControlPlaneState, nowIso: string): ParseResult<RuntimeControlPlaneSchedule> {
  if (!isRecord(raw)) return { error: 'Schedule must be an object.' };
  const runtimeId = sanitizeId(raw.runtimeId);
  if (!runtimeId) return { error: 'Schedule requires runtimeId.' };
  const title = sanitizeRequiredString(raw.title ?? raw.name, 160, 'Schedule requires title.');
  if ('error' in title) return title;
  const trigger = parseTrigger(raw.trigger);
  if ('error' in trigger) return trigger;
  return {
    value: {
      id: sanitizeId(raw.id) ?? nextId('schedule', state.schedules.map((item) => item.id), nowIso),
      title: title.value,
      runtimeId,
      status: sanitizeEnum(raw.status, ['disabled', 'enabled', 'paused', 'archived'] as const) ?? 'disabled',
      trigger: trigger.value,
      target: {
        ...(sanitizeId(raw.assistantId ?? (isRecord(raw.target) ? raw.target.assistantId : undefined)) ? { assistantId: sanitizeId(raw.assistantId ?? (isRecord(raw.target) ? raw.target.assistantId : undefined)) } : {}),
        ...(sanitizeString(raw.command ?? (isRecord(raw.target) ? raw.target.command : undefined), 160) ? { command: sanitizeString(raw.command ?? (isRecord(raw.target) ? raw.target.command : undefined), 160) } : {}),
        ...(sanitizeId(raw.skillId ?? (isRecord(raw.target) ? raw.target.skillId : undefined)) ? { skillId: sanitizeId(raw.skillId ?? (isRecord(raw.target) ? raw.target.skillId : undefined)) } : {}),
        ...(sanitizeString(raw.cwdHint ?? (isRecord(raw.target) ? raw.target.cwdHint : undefined), 500) ? { cwdHint: sanitizeString(raw.cwdHint ?? (isRecord(raw.target) ? raw.target.cwdHint : undefined), 500) } : {}),
      },
      policy: parsePolicy(raw.policy),
      ...(sanitizeString(raw.inputSummary, 1000) ? { inputSummary: sanitizeString(raw.inputSummary, 1000) } : {}),
      ...(sanitizeIso(raw.nextRunAt) ? { nextRunAt: sanitizeIso(raw.nextRunAt) } : {}),
      ...(sanitizeId(raw.lastRunId) ? { lastRunId: sanitizeId(raw.lastRunId) } : {}),
      createdAt: sanitizeIso(raw.createdAt) ?? nowIso,
      updatedAt: nowIso,
    },
  };
}

function parseSchedulePatch(
  current: RuntimeControlPlaneSchedule,
  raw: unknown,
  nowIso: string,
): ParseResult<RuntimeControlPlaneSchedule> {
  if (!isRecord(raw)) return { error: 'Schedule patch must be an object.' };
  const trigger = raw.trigger === undefined ? { value: current.trigger } : parseTrigger(raw.trigger);
  if ('error' in trigger) return trigger;
  return {
    value: {
      ...current,
      ...(sanitizeString(raw.title ?? raw.name, 160) ? { title: sanitizeString(raw.title ?? raw.name, 160)! } : {}),
      ...(sanitizeEnum(raw.status, ['disabled', 'enabled', 'paused', 'archived'] as const) ? { status: sanitizeEnum(raw.status, ['disabled', 'enabled', 'paused', 'archived'] as const)! } : {}),
      trigger: trigger.value,
      target: {
        ...current.target,
        ...(sanitizeId(raw.assistantId) ? { assistantId: sanitizeId(raw.assistantId) } : {}),
        ...(sanitizeString(raw.command, 160) ? { command: sanitizeString(raw.command, 160) } : {}),
        ...(sanitizeId(raw.skillId) ? { skillId: sanitizeId(raw.skillId) } : {}),
        ...(sanitizeString(raw.cwdHint, 500) ? { cwdHint: sanitizeString(raw.cwdHint, 500) } : {}),
      },
      policy: raw.policy === undefined ? current.policy : parsePolicy(raw.policy),
      ...(sanitizeString(raw.inputSummary, 1000) ? { inputSummary: sanitizeString(raw.inputSummary, 1000) } : {}),
      ...(sanitizeIso(raw.nextRunAt) ? { nextRunAt: sanitizeIso(raw.nextRunAt) } : {}),
      ...(sanitizeId(raw.lastRunId) ? { lastRunId: sanitizeId(raw.lastRunId) } : {}),
      updatedAt: nowIso,
    },
  };
}

function parseTrigger(raw: unknown): ParseResult<RuntimeControlPlaneTrigger> {
  if (!isRecord(raw)) return { error: 'Schedule requires trigger.' };
  const type = sanitizeEnum(raw.type, ['manual', 'cron', 'interval', 'event'] as const);
  if (!type) return { error: 'Trigger type must be manual, cron, interval, or event.' };
  const trigger: RuntimeControlPlaneTrigger = { type };
  if (type === 'cron') {
    const cron = sanitizeCron(raw.cron ?? raw.expression);
    if (!cron) return { error: 'Cron trigger requires a safe 5/6-field expression or @daily-style macro.' };
    trigger.cron = cron;
  }
  if (type === 'interval') {
    const intervalMs = sanitizeInteger(raw.intervalMs, 60_000, 1000 * 60 * 60 * 24 * 30);
    if (!intervalMs) return { error: 'Interval trigger requires intervalMs between 60000 and 2592000000.' };
    trigger.intervalMs = intervalMs;
  }
  if (type === 'event') {
    const event = sanitizeString(raw.event, 160);
    if (!event) return { error: 'Event trigger requires event.' };
    trigger.event = event;
  }
  const timezone = sanitizeString(raw.timezone, 120);
  if (timezone) trigger.timezone = timezone;
  return { value: trigger };
}

function parsePolicy(raw: unknown): RuntimeControlPlaneSchedule['policy'] {
  const policy = isRecord(raw) ? raw : {};
  return {
    permissionMode: sanitizeEnum(policy.permissionMode, ['read', 'ask', 'auto'] as const) ?? 'ask',
    overlap: sanitizeEnum(policy.overlap, ['skip', 'enqueue', 'cancel-previous'] as const) ?? 'skip',
    retry: sanitizeEnum(policy.retry, ['never', 'once'] as const) ?? 'never',
    timeoutMs: sanitizeInteger(policy.timeoutMs, 1_000, 1000 * 60 * 60) ?? 1000 * 60 * 10,
  };
}

function parseApproval(raw: unknown, state: RuntimeControlPlaneState, nowIso: string): ParseResult<RuntimeControlPlaneApprovalRequest> {
  if (!isRecord(raw)) return { error: 'Approval request must be an object.' };
  const runtimeId = sanitizeId(raw.runtimeId);
  if (!runtimeId) return { error: 'Approval request requires runtimeId.' };
  const summary = sanitizeRequiredString(raw.summary, 1000, 'Approval request requires summary.');
  if ('error' in summary) return summary;
  return {
    value: {
      id: sanitizeId(raw.id) ?? nextId('approval', state.approvalQueue.map((item) => item.id), nowIso),
      runtimeId,
      ...(sanitizeId(raw.runId) ? { runId: sanitizeId(raw.runId) } : {}),
      ...(sanitizeId(raw.scheduleId) ? { scheduleId: sanitizeId(raw.scheduleId) } : {}),
      status: 'pending',
      scope: sanitizeEnum(raw.scope, ['read', 'write', 'shell', 'network', 'mcp', 'schedule', 'user-extension', 'unknown'] as const) ?? 'unknown',
      summary: summary.value,
      requestedAt: sanitizeIso(raw.requestedAt) ?? nowIso,
    },
  };
}

function parseWake(raw: unknown, state: RuntimeControlPlaneState, nowIso: string): ParseResult<RuntimeControlPlaneWakeEvent> {
  if (!isRecord(raw)) return { error: 'Wake event must be an object.' };
  const triggerAt = sanitizeIso(raw.triggerAt) ?? nowIso;
  const status = sanitizeEnum(raw.status, ['pending', 'claimed', 'completed', 'missed'] as const) ?? 'pending';
  return {
    value: {
      id: sanitizeId(raw.id) ?? nextId('wake', state.wakeEvents.map((item) => item.id), nowIso),
      ...(sanitizeId(raw.runtimeId) ? { runtimeId: sanitizeId(raw.runtimeId) } : {}),
      ...(sanitizeId(raw.scheduleId) ? { scheduleId: sanitizeId(raw.scheduleId) } : {}),
      ...(sanitizeId(raw.runId) ? { runId: sanitizeId(raw.runId) } : {}),
      status,
      triggerAt,
      ...(sanitizeIso(raw.claimedAt) ? { claimedAt: sanitizeIso(raw.claimedAt) } : {}),
      ...(sanitizeIso(raw.completedAt) ? { completedAt: sanitizeIso(raw.completedAt) } : {}),
      ...(sanitizeString(raw.summary, 1000) ? { summary: sanitizeString(raw.summary, 1000) } : {}),
    },
  };
}

function parseFailure(raw: unknown, state: RuntimeControlPlaneState, nowIso: string): ParseResult<RuntimeControlPlaneFailureAudit> {
  if (!isRecord(raw)) return { error: 'Failure audit must be an object.' };
  const summary = sanitizeRequiredString(raw.summary, 1000, 'Failure audit requires summary.');
  if ('error' in summary) return summary;
  return {
    value: {
      id: sanitizeId(raw.id) ?? nextId('failure', state.failureAudits.map((item) => item.id), nowIso),
      ...(sanitizeId(raw.runtimeId) ? { runtimeId: sanitizeId(raw.runtimeId) } : {}),
      ...(sanitizeId(raw.scheduleId) ? { scheduleId: sanitizeId(raw.scheduleId) } : {}),
      ...(sanitizeId(raw.runId) ? { runId: sanitizeId(raw.runId) } : {}),
      kind: sanitizeEnum(raw.kind, ['runtime', 'permission', 'tool', 'timeout', 'conflict', 'unknown'] as const) ?? 'unknown',
      summary: summary.value,
      recoverable: typeof raw.recoverable === 'boolean' ? raw.recoverable : false,
      createdAt: sanitizeIso(raw.createdAt) ?? nowIso,
    },
  };
}

function parseMessage(raw: unknown, state: RuntimeControlPlaneState, nowIso: string): ParseResult<RuntimeControlPlaneMailboxMessage> {
  if (!isRecord(raw)) return { error: 'Mailbox message must be an object.' };
  const subject = sanitizeRequiredString(raw.subject, 200, 'Mailbox message requires subject.');
  if ('error' in subject) return subject;
  const summary = sanitizeRequiredString(raw.summary, 1000, 'Mailbox message requires summary.');
  if ('error' in summary) return summary;
  return {
    value: {
      id: sanitizeId(raw.id) ?? nextId('message', state.mailbox.map((item) => item.id), nowIso),
      ...(sanitizeId(raw.fromRuntimeId) ? { fromRuntimeId: sanitizeId(raw.fromRuntimeId) } : {}),
      ...(sanitizeId(raw.toRuntimeId) ? { toRuntimeId: sanitizeId(raw.toRuntimeId) } : {}),
      ...(sanitizeId(raw.threadId) ? { threadId: sanitizeId(raw.threadId) } : {}),
      status: sanitizeEnum(raw.status, ['queued', 'delivered', 'archived'] as const) ?? 'queued',
      subject: subject.value,
      summary: summary.value,
      createdAt: sanitizeIso(raw.createdAt) ?? nowIso,
      ...(sanitizeIso(raw.deliveredAt) ? { deliveredAt: sanitizeIso(raw.deliveredAt) } : {}),
    },
  };
}

function parseTask(raw: unknown, state: RuntimeControlPlaneState, nowIso: string): ParseResult<RuntimeControlPlaneTask> {
  if (!isRecord(raw)) return { error: 'Task must be an object.' };
  const title = sanitizeRequiredString(raw.title, 200, 'Task requires title.');
  if ('error' in title) return title;
  const existing = state.tasks.find((item) => item.id === sanitizeId(raw.id));
  return {
    value: {
      id: sanitizeId(raw.id) ?? nextId('task', state.tasks.map((item) => item.id), nowIso),
      title: title.value,
      status: sanitizeEnum(raw.status, ['todo', 'doing', 'blocked', 'done', 'cancelled'] as const) ?? existing?.status ?? 'todo',
      priority: sanitizeEnum(raw.priority, ['low', 'normal', 'high'] as const) ?? existing?.priority ?? 'normal',
      ...(sanitizeId(raw.assigneeRuntimeId) ? { assigneeRuntimeId: sanitizeId(raw.assigneeRuntimeId) } : {}),
      ...(sanitizeId(raw.sourceMessageId) ? { sourceMessageId: sanitizeId(raw.sourceMessageId) } : {}),
      createdAt: existing?.createdAt ?? sanitizeIso(raw.createdAt) ?? nowIso,
      updatedAt: nowIso,
    },
  };
}

function mutationResult(
  action: RuntimeControlPlaneMutationPayload['action'],
  item: RuntimeControlPlaneMutationResult['item'],
  state: RuntimeControlPlaneState,
): ParseResult<RuntimeControlPlaneMutationResult> {
  return {
    value: {
      ok: true,
      action,
      item,
      snapshot: withSummary(state),
    },
  };
}

function sanitizeRequiredString(value: unknown, max: number, error: string): ParseResult<string> {
  const sanitized = sanitizeString(value, max);
  return sanitized ? { value: sanitized } : { error };
}

function sanitizeString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = redactSensitiveText(value.trim());
  return redacted ? redacted.slice(0, max) : undefined;
}

function sanitizeId(value: unknown): string | undefined {
  const text = sanitizeString(value, 120);
  return text && SAFE_ID_RE.test(text) ? text : undefined;
}

function sanitizeIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function sanitizeInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const next = Math.floor(value);
  if (next < min || next > max) return undefined;
  return next;
}

function sanitizeCron(value: unknown): string | undefined {
  const text = sanitizeString(value, 120);
  if (!text) return undefined;
  if (CRON_MACRO_RE.test(text)) return text;
  const fields = text.split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return undefined;
  return fields.every((field) => CRON_FIELD_RE.test(field)) ? text : undefined;
}

function sanitizeEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function nextId(prefix: string, existing: string[], nowIso: string): string {
  const base = `${prefix}-${new Date(nowIso).getTime().toString(36)}`;
  const existingSet = new Set(existing);
  if (!existingSet.has(base)) return base;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingSet.has(candidate)) return candidate;
  }
  return `${base}-${existing.length + 1}`;
}

function parseLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 50;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 200)) : 50;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value: object, keys: string[]): boolean {
  return keys.every((key) => key in value);
}

function isSchedule(value: unknown): value is RuntimeControlPlaneSchedule {
  return isRecord(value) && hasKeys(value, ['id', 'title', 'runtimeId', 'status', 'trigger', 'target', 'policy', 'createdAt', 'updatedAt']);
}

function isApproval(value: unknown): value is RuntimeControlPlaneApprovalRequest {
  return isRecord(value) && hasKeys(value, ['id', 'runtimeId', 'status', 'scope', 'summary', 'requestedAt']);
}

function isWake(value: unknown): value is RuntimeControlPlaneWakeEvent {
  return isRecord(value) && hasKeys(value, ['id', 'status', 'triggerAt']);
}

function isFailure(value: unknown): value is RuntimeControlPlaneFailureAudit {
  return isRecord(value) && hasKeys(value, ['id', 'kind', 'summary', 'recoverable', 'createdAt']);
}

function isMessage(value: unknown): value is RuntimeControlPlaneMailboxMessage {
  return isRecord(value) && hasKeys(value, ['id', 'status', 'subject', 'summary', 'createdAt']);
}

function isTask(value: unknown): value is RuntimeControlPlaneTask {
  return isRecord(value) && hasKeys(value, ['id', 'title', 'status', 'priority', 'createdAt', 'updatedAt']);
}
