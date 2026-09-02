import crypto from 'node:crypto';
import { redactSensitiveObject, redactSensitiveText } from '../../agent/redaction.js';
import type {
  MindosRuntimePermissionRequest,
  MindosRuntimePermissionResult,
} from '../../agent/runtime/run.js';
import { mutateStudioAutomationState } from './store.js';
import type {
  StudioAutomationApproval,
  StudioAutomationApprovalDecision,
  StudioAutomationJob,
  StudioAutomationNotification,
  StudioAutomationNotificationKind,
} from './types.js';

const MAX_NOTIFICATION_BODY = 1_000;
const MAX_PREVIEW = 1_000;

export class StudioAutomationApprovalRequiredError extends Error {
  readonly approvalId: string;
  readonly created: boolean;

  constructor(approvalId: string, created = false) {
    super(`Automation is waiting for approval: ${approvalId}`);
    this.name = 'StudioAutomationApprovalRequiredError';
    this.approvalId = approvalId;
    this.created = created;
  }
}

export type ResolveStudioAutomationApprovalResult =
  | { kind: 'resolved' | 'unchanged'; approval: StudioAutomationApproval; jobTitle?: string }
  | { kind: 'missing' | 'conflict' | 'job-missing' };

export function requestStudioAutomationPermission(
  mindRoot: string,
  job: StudioAutomationJob,
  request: MindosRuntimePermissionRequest,
  now = new Date(),
): MindosRuntimePermissionResult {
  if (job.runtime !== 'codex' && job.runtime !== 'claude') {
    throw new Error('Durable approval requests are only supported for native Codex or Claude automations.');
  }
  const runtime = job.runtime;
  const fingerprint = approvalFingerprint(job, request);
  const result = mutateStudioAutomationState(mindRoot, (state) => {
    const existing = state.approvals.find((approval) => (
      approval.jobId === job.id
      && approval.fingerprint === fingerprint
      && approval.status !== 'consumed'
    ));
    if (existing?.status === 'approved' || existing?.status === 'denied') {
      existing.status = 'consumed';
      existing.consumedAt = now.toISOString();
      state.updatedAt = now.toISOString();
      return {
        kind: 'decision' as const,
        result: permissionResult(existing),
      };
    }
    if (existing?.status === 'pending') {
      return { kind: 'pending' as const, approvalId: existing.id, created: false };
    }

    const allowDecision = selectPermissionDecision(request, 'allow');
    const denyDecision = selectPermissionDecision(request, 'deny');
    if (!allowDecision || !denyDecision) {
      throw new Error('Runtime approval request did not provide both allow and deny choices.');
    }
    const hash = crypto.createHash('sha256').update(`${job.id}\0${fingerprint}`).digest('hex').slice(0, 20);
    const action = boundedOptional(request.action, 300);
    const resource = boundedOptional(request.resource, 500);
    const preview = inputPreview(request.input);
    const approval: StudioAutomationApproval = {
      id: `approval-${hash}`,
      jobId: job.id,
      ...(job.lease?.runId ? { runId: job.lease.runId } : {}),
      fingerprint,
      runtime,
      status: 'pending',
      toolName: bounded(request.toolName, 160, 'unknown tool'),
      ...(action ? { action } : {}),
      ...(resource ? { resource } : {}),
      ...(preview ? { inputPreview: preview } : {}),
      ...(request.risk ? {
        risk: {
          level: request.risk.level,
          summary: bounded(request.risk.summary, 500, 'Runtime requested permission.'),
        },
      } : {}),
      allowDecision,
      denyDecision,
      createdAt: now.toISOString(),
    };
    state.approvals = [approval, ...state.approvals.filter((item) => item.id !== approval.id)];
    appendNotificationToState(state, {
      id: `notify-approval-${hash}`,
      jobId: job.id,
      kind: 'approval_required',
      title: `${job.title} needs approval`,
      body: approvalSummary(approval),
      createdAt: now.toISOString(),
    });
    state.updatedAt = now.toISOString();
    return { kind: 'pending' as const, approvalId: approval.id, created: true };
  });

  if (result.kind === 'decision') return result.result;
  throw new StudioAutomationApprovalRequiredError(result.approvalId, result.created);
}

export function resolveStudioAutomationApproval(
  mindRoot: string,
  approvalId: string,
  decision: StudioAutomationApprovalDecision,
  now = new Date(),
): ResolveStudioAutomationApprovalResult {
  return mutateStudioAutomationState(mindRoot, (state) => {
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval) return { kind: 'missing' as const };
    if (approval.status === 'consumed') return { kind: 'conflict' as const };
    if (approval.decision) {
      const jobTitle = state.automations.find((item) => item.id === approval.jobId)?.title;
      return approval.decision === decision
        ? { kind: 'unchanged' as const, approval: structuredClone(approval), ...(jobTitle ? { jobTitle } : {}) }
        : { kind: 'conflict' as const };
    }
    const job = state.automations.find((item) => item.id === approval.jobId);
    if (!job) return { kind: 'job-missing' as const };
    approval.decision = decision;
    approval.status = decision === 'allow' ? 'approved' : 'denied';
    approval.resolvedAt = now.toISOString();
    job.nextRunAt = now.toISOString();
    job.retryAttempt = Math.max(1, job.history[0]?.attempt ?? 1);
    job.updatedAt = now.toISOString();
    for (const notification of state.notifications) {
      if (notification.kind === 'approval_required' && notification.jobId === approval.jobId && !notification.readAt) {
        notification.readAt = now.toISOString();
      }
    }
    state.updatedAt = now.toISOString();
    return { kind: 'resolved' as const, approval: structuredClone(approval), jobTitle: job.title };
  });
}

export function appendStudioAutomationNotification(
  mindRoot: string,
  input: {
    id: string;
    jobId: string;
    runId?: string;
    kind: StudioAutomationNotificationKind;
    title: string;
    body: string;
    createdAt: string;
  },
): StudioAutomationNotification {
  return mutateStudioAutomationState(mindRoot, (state) => {
    const notification: StudioAutomationNotification = {
      id: safeId(input.id),
      jobId: safeId(input.jobId),
      ...(input.runId ? { runId: safeId(input.runId) } : {}),
      kind: input.kind,
      title: bounded(input.title, 200, 'Automation update'),
      body: bounded(input.body, MAX_NOTIFICATION_BODY, 'Automation state changed.'),
      createdAt: new Date(input.createdAt).toISOString(),
    };
    appendNotificationToState(state, notification);
    state.updatedAt = notification.createdAt;
    return structuredClone(state.notifications.find((item) => item.id === notification.id)!);
  });
}

export function acknowledgeStudioAutomationNotification(
  mindRoot: string,
  notificationId: string,
  now = new Date(),
): 'updated' | 'unchanged' | 'missing' {
  return mutateStudioAutomationState(mindRoot, (state) => {
    const notification = state.notifications.find((item) => item.id === notificationId);
    if (!notification) return 'missing';
    if (notification.readAt) return 'unchanged';
    notification.readAt = now.toISOString();
    state.updatedAt = now.toISOString();
    return 'updated';
  });
}

export function acknowledgeAllStudioAutomationNotifications(mindRoot: string, now = new Date()): number {
  return mutateStudioAutomationState(mindRoot, (state) => {
    let updated = 0;
    for (const notification of state.notifications) {
      if (notification.readAt) continue;
      notification.readAt = now.toISOString();
      updated += 1;
    }
    if (updated > 0) state.updatedAt = now.toISOString();
    return updated;
  });
}

function appendNotificationToState(
  state: { notifications: StudioAutomationNotification[] },
  notification: StudioAutomationNotification,
): void {
  if (state.notifications.some((item) => item.id === notification.id)) return;
  state.notifications = [notification, ...state.notifications];
}

function approvalFingerprint(job: StudioAutomationJob, request: MindosRuntimePermissionRequest): string {
  const canonical = stableStringify({
    jobId: job.id,
    runtime: request.runtime,
    toolName: request.toolName,
    action: request.action ?? null,
    resource: request.resource ?? null,
    input: request.input,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function selectPermissionDecision(request: MindosRuntimePermissionRequest, intent: 'allow' | 'deny'): string | undefined {
  return request.options.find((option) => option.intent === intent)?.id
    ?? request.options.find((option) => intent === 'allow'
      ? /allow|accept|approve/i.test(`${option.id} ${option.label}`)
      : /deny|decline|reject/i.test(`${option.id} ${option.label}`))?.id;
}

function permissionResult(approval: StudioAutomationApproval): MindosRuntimePermissionResult {
  const allow = approval.decision === 'allow';
  return {
    decision: allow ? approval.allowDecision : approval.denyDecision,
    decisionIntent: allow ? 'allow' : 'deny',
    decisionScope: 'once',
    decisionLabel: allow ? 'Allow once' : 'Deny',
  };
}

function approvalSummary(approval: StudioAutomationApproval): string {
  const target = approval.resource ? ` for ${approval.resource}` : '';
  const risk = approval.risk?.summary ? ` ${approval.risk.summary}` : '';
  return bounded(`${approval.runtime} requested ${approval.toolName}${target}.${risk}`, MAX_NOTIFICATION_BODY, 'Runtime approval required.');
}

function inputPreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return boundedOptional(stableStringify(redactSensitiveObject(value)), MAX_PREVIEW);
  } catch {
    return undefined;
  }
}

function boundedOptional(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = redactSensitiveText(value).replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function bounded(value: unknown, max: number, fallback: string): string {
  return boundedOptional(value, max) ?? fallback;
}

function safeId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return normalized || `automation-${crypto.randomBytes(6).toString('hex')}`;
}
