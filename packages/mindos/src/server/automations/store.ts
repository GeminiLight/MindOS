import crypto from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { redactSensitiveObject, redactSensitiveText } from '../../agent/redaction.js';
import {
  STUDIO_AUTOMATION_SCHEDULES,
  type StudioAutomationApproval,
  type StudioAutomationEvent,
  type StudioAutomationEventDelivery,
  type StudioAutomationJob,
  type StudioAutomationLease,
  type StudioAutomationMigration,
  type StudioAutomationNotification,
  type StudioAutomationRun,
  type StudioAutomationState,
  type StudioAutomationStatus,
} from './types.js';

export const STUDIO_AUTOMATION_STATE_FILE = '.mindos/automations/state.json';

const STORE_DIR = '.mindos/automations';
const STORE_LOCK = `${STORE_DIR}/state.lock`;
const MAX_AUTOMATIONS = 200;
const MAX_HISTORY = 50;
const MAX_APPROVALS = 500;
const MAX_NOTIFICATIONS = 500;
export const STUDIO_AUTOMATION_MAX_EVENTS = 500;
const MAX_EVENT_DELIVERIES = 200;
const LOCK_ATTEMPTS = 100;
const LOCK_WAIT_MS = 10;
const STALE_LOCK_MS = 30_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export function readStudioAutomationState(mindRoot: string): StudioAutomationState {
  const file = resolveExistingSafe(mindRoot, STUDIO_AUTOMATION_STATE_FILE);
  if (!existsSync(file)) return emptyStudioAutomationState();
  try {
    return normalizeState(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    throw new Error('Studio automation state is corrupt; the original file was preserved.');
  }
}

export function mutateStudioAutomationState<T>(
  mindRoot: string,
  operation: (state: StudioAutomationState) => T,
): T {
  return withStateLock(mindRoot, () => {
    const state = readStateUnlocked(mindRoot);
    const result = operation(state);
    writeStateUnlocked(mindRoot, state);
    return result;
  });
}

export function emptyStudioAutomationState(): StudioAutomationState {
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    migration: { importedCount: 0, externalSchedulePromptJobs: 0 },
    automations: [],
    approvals: [],
    notifications: [],
    events: [],
  };
}

function readStateUnlocked(mindRoot: string): StudioAutomationState {
  const file = resolveExistingSafe(mindRoot, STUDIO_AUTOMATION_STATE_FILE);
  if (!existsSync(file)) return emptyStudioAutomationState();
  try {
    return normalizeState(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    throw new Error('Studio automation state is corrupt; the original file was preserved.');
  }
}

function writeStateUnlocked(mindRoot: string, state: StudioAutomationState): void {
  state.schemaVersion = 1;
  state.automations = state.automations.slice(0, MAX_AUTOMATIONS).map((job) => ({
    ...job,
    history: job.history.slice(0, MAX_HISTORY),
  }));
  state.approvals = state.approvals.slice(0, MAX_APPROVALS);
  state.notifications = state.notifications.slice(0, MAX_NOTIFICATIONS);
  state.events = boundEventsWithoutEvictingActive(state.events).map((event) => ({
    ...event,
    deliveries: event.deliveries.slice(0, MAX_EVENT_DELIVERIES),
  }));
  const file = resolveExistingSafe(mindRoot, STUDIO_AUTOMATION_STATE_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function withStateLock<T>(mindRoot: string, operation: () => T): T {
  const directory = resolveExistingSafe(mindRoot, STORE_DIR);
  mkdirSync(directory, { recursive: true });
  const lock = resolveExistingSafe(mindRoot, STORE_LOCK);
  acquireDirectoryLock(lock);
  try {
    return operation();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function acquireDirectoryLock(lock: string): void {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(path.join(lock, 'owner'), `${process.pid}\n${Date.now()}\n`, { encoding: 'utf-8', mode: 0o600 });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (isStaleLock(lock)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
    }
  }
  throw new Error('Studio automation state is busy; retry shortly.');
}

function isStaleLock(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function normalizeState(value: unknown): StudioAutomationState {
  const record = isRecord(value) ? value : {};
  return {
    schemaVersion: 1,
    updatedAt: iso(record.updatedAt) ?? new Date(0).toISOString(),
    migration: normalizeMigration(record.migration),
    automations: Array.isArray(record.automations)
      ? record.automations.map(normalizeJob).filter((job): job is StudioAutomationJob => job !== null).slice(0, MAX_AUTOMATIONS)
      : [],
    approvals: Array.isArray(record.approvals)
      ? record.approvals.map(normalizeApproval).filter((approval): approval is StudioAutomationApproval => approval !== null).slice(0, MAX_APPROVALS)
      : [],
    notifications: Array.isArray(record.notifications)
      ? record.notifications.map(normalizeNotification).filter((notification): notification is StudioAutomationNotification => notification !== null).slice(0, MAX_NOTIFICATIONS)
      : [],
    events: Array.isArray(record.events)
      ? boundEventsWithoutEvictingActive(
          record.events.map(normalizeEvent).filter((event): event is StudioAutomationEvent => event !== null),
        )
      : [],
  };
}

function normalizeMigration(value: unknown): StudioAutomationMigration {
  const record = isRecord(value) ? value : {};
  const pendingLegacyJobs = Array.isArray(record.pendingLegacyJobs)
    ? record.pendingLegacyJobs.flatMap((item) => {
        if (!isRecord(item)) return [];
        const id = safeId(item.id);
        const status: StudioAutomationStatus | null = item.status === 'active' || item.status === 'paused'
          ? item.status
          : null;
        return id && status ? [{ id, status }] : [];
      }).slice(0, MAX_AUTOMATIONS)
    : [];
  return {
    ...(iso(record.completedAt) ? { completedAt: iso(record.completedAt) } : {}),
    importedCount: finiteInteger(record.importedCount, 0),
    externalSchedulePromptJobs: finiteInteger(record.externalSchedulePromptJobs, 0),
    ...(text(record.legacyStorePath, 1_000) ? { legacyStorePath: text(record.legacyStorePath, 1_000) } : {}),
    ...(text(record.warning, 1_000) ? { warning: redactSensitiveText(text(record.warning, 1_000)!) } : {}),
    ...(pendingLegacyJobs.length > 0 ? { pendingLegacyJobs } : {}),
  };
}

function normalizeJob(value: unknown): StudioAutomationJob | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  const title = text(value.title, 160);
  const prompt = text(value.prompt, 4_000);
  const schedule = typeof value.schedule === 'string' && STUDIO_AUTOMATION_SCHEDULES.includes(value.schedule as never)
    ? value.schedule as StudioAutomationJob['schedule']
    : null;
  if (!id || !title || !prompt || !schedule) return null;
  const createdAt = iso(value.createdAt) ?? new Date(0).toISOString();
  // A malformed persisted status must never opt a job into unattended work.
  const status: StudioAutomationStatus = value.status === 'active' ? 'active' : 'paused';
  const history = Array.isArray(value.history)
    ? value.history.map(normalizeRun).filter((run): run is StudioAutomationRun => run !== null).slice(0, MAX_HISTORY)
    : [];
  const model = value.model === 'gpt-5.5' || value.model === 'claude-code' || value.model === 'codex'
    ? value.model
    : value.model === 'local-agent'
      ? 'codex'
      : 'mindos-auto';
  const runtime = model === 'codex' ? 'codex' : model === 'claude-code' ? 'claude' : 'mindos-pi';
  const permissionMode = value.permissionMode === 'auto'
    ? 'auto'
    : value.permissionMode === 'ask' && runtime !== 'mindos-pi'
      ? 'ask'
      : 'read';
  return {
    id,
    title,
    prompt,
    scope: value.scope === 'project' || value.scope === 'mind' ? value.scope : 'worktree',
    ...(text(value.projectId, 120) ? { projectId: text(value.projectId, 120) } : {}),
    schedule,
    timezone: safeTimezone(value.timezone),
    model,
    effort: value.effort === 'normal' || value.effort === 'extra-high' ? value.effort : 'high',
    permissionMode,
    status,
    retry: value.retry === 'never' ? 'never' : 'once',
    timeoutMs: clampInteger(value.timeoutMs, 1_000, 3_600_000, 600_000),
    overlap: 'skip',
    runtime,
    source: 'mindos-durable',
    controlPlaneScheduleId: safeId(value.controlPlaneScheduleId) ?? `studio-automation-${id.replace(/^studio-/, '')}`,
    createdAt,
    updatedAt: iso(value.updatedAt) ?? createdAt,
    ...(iso(value.nextRunAt) ? { nextRunAt: iso(value.nextRunAt) } : {}),
    ...(finiteInteger(value.retryAttempt, 0) > 0 ? { retryAttempt: finiteInteger(value.retryAttempt, 0) } : {}),
    runCount: finiteInteger(value.runCount, 0),
    ...(iso(value.lastRun) ? { lastRun: iso(value.lastRun) } : {}),
    lastStatus: isRunStatus(value.lastStatus) || value.lastStatus === 'pending' ? value.lastStatus : 'pending',
    ...(text(value.lastError, 1_000) ? { lastError: redactSensitiveText(text(value.lastError, 1_000)!) } : {}),
    ...(normalizeLease(value.lease) ? { lease: normalizeLease(value.lease)! } : {}),
    history,
    trigger: normalizeTrigger(value.trigger, schedule, safeTimezone(value.timezone)),
  };
}

function normalizeRun(value: unknown): StudioAutomationRun | null {
  if (!isRecord(value) || !safeId(value.id) || !isRunStatus(value.status)) return null;
  const startedAt = iso(value.startedAt);
  const occurrenceAt = iso(value.occurrenceAt);
  if (!startedAt || !occurrenceAt) return null;
  return {
    id: safeId(value.id)!,
    status: value.status,
    attempt: Math.max(1, finiteInteger(value.attempt, 1)),
    occurrenceAt,
    startedAt,
    ...(iso(value.finishedAt) ? { finishedAt: iso(value.finishedAt) } : {}),
    ...(typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? { durationMs: Math.max(0, Math.floor(value.durationMs)) } : {}),
    ...(text(value.artifactPath, 1_000) ? { artifactPath: text(value.artifactPath, 1_000) } : {}),
    ...(text(value.outputPreview, 1_000) ? { outputPreview: text(value.outputPreview, 1_000) } : {}),
    ...(text(value.error, 1_000) ? { error: redactSensitiveText(text(value.error, 1_000)!) } : {}),
    ...(safeId(value.eventId) ? { eventId: safeId(value.eventId) } : {}),
    ...(safeId(value.eventDeliveryId) ? { eventDeliveryId: safeId(value.eventDeliveryId) } : {}),
  };
}

function normalizeLease(value: unknown): StudioAutomationLease | null {
  if (!isRecord(value)) return null;
  const runId = safeId(value.runId);
  const ownerId = safeId(value.ownerId);
  const occurrenceAt = iso(value.occurrenceAt);
  const claimedAt = iso(value.claimedAt);
  const expiresAt = iso(value.expiresAt);
  if (!runId || !ownerId || !occurrenceAt || !claimedAt || !expiresAt) return null;
  return {
    runId,
    ownerId,
    occurrenceAt,
    claimedAt,
    expiresAt,
    attempt: Math.max(1, finiteInteger(value.attempt, 1)),
    ...(safeId(value.eventId) ? { eventId: safeId(value.eventId) } : {}),
    ...(safeId(value.eventDeliveryId) ? { eventDeliveryId: safeId(value.eventDeliveryId) } : {}),
  };
}

function normalizeTrigger(
  value: unknown,
  schedule: StudioAutomationJob['schedule'],
  timezone: string,
): StudioAutomationJob['trigger'] {
  if (!isRecord(value)) {
    return schedule === 'manual' ? { type: 'manual' } : { type: 'schedule', schedule, timezone };
  }
  if (value.type === 'event') {
    const sources = normalizePatternList(value.sources);
    const events = normalizePatternList(value.events);
    if (sources.length > 0 && events.length > 0) {
      const storm = isRecord(value.storm) ? value.storm : {};
      const where = normalizeMetadataFilter(value.where);
      return {
        type: 'event',
        sources,
        events,
        ...(where ? { where } : {}),
        debounceMs: clampInteger(value.debounceMs, 0, 60 * 60_000, 0),
        storm: {
          windowMs: clampInteger(storm.windowMs, 1_000, 60 * 60_000, 60_000),
          maxEvents: clampInteger(storm.maxEvents, 1, 10_000, 100),
        },
      };
    }
  }
  if (value.type === 'manual') return { type: 'manual' };
  return schedule === 'manual' ? { type: 'manual' } : { type: 'schedule', schedule, timezone };
}

export function isTerminalStudioAutomationEvent(event: StudioAutomationEvent): boolean {
  return event.deliveries.every((delivery) => (
    delivery.status === 'succeeded'
    || delivery.status === 'failed'
    || delivery.status === 'superseded'
    || delivery.status === 'suppressed'
  ));
}

function boundEventsWithoutEvictingActive(events: StudioAutomationEvent[]): StudioAutomationEvent[] {
  if (events.length <= STUDIO_AUTOMATION_MAX_EVENTS) return events;
  const active = events.filter((event) => !isTerminalStudioAutomationEvent(event));
  if (active.length > STUDIO_AUTOMATION_MAX_EVENTS) {
    throw new Error(
      `Studio automation state has ${active.length} events with active deliveries; none were evicted.`,
    );
  }
  const activeIds = new Set(active.map((event) => event.id));
  const keepTerminalIds = new Set(
    events
      .filter((event) => isTerminalStudioAutomationEvent(event))
      .slice(0, STUDIO_AUTOMATION_MAX_EVENTS - active.length)
      .map((event) => event.id),
  );
  return events.filter((event) => activeIds.has(event.id) || keepTerminalIds.has(event.id));
}

function normalizeMetadataFilter(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, item]) => (
    metadataFilterKey(key) && metadataFilterValue(item) ? [[key, item] as const] : []
  )).slice(0, 20);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function metadataFilterKey(value: string): boolean {
  const segments = value.split('.');
  return segments.length <= 4 && segments.every((segment) => (
    /^[A-Za-z0-9][A-Za-z0-9_:-]{0,79}$/.test(segment)
    && segment !== '__proto__'
    && segment !== 'constructor'
    && segment !== 'prototype'
  ));
}

function metadataFilterValue(value: unknown): value is string | number | boolean {
  return typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= 500);
}

function normalizeEvent(value: unknown): StudioAutomationEvent | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const id = safeId(value.id);
  const source = eventToken(value.source);
  const key = text(value.key, 500);
  const type = eventToken(value.type);
  const occurredAt = iso(value.occurredAt);
  const receivedAt = iso(value.receivedAt);
  if (!id || !source || !key || !type || !occurredAt || !receivedAt) return null;
  const payload = isRecord(value.payload)
    ? redactSensitiveObject(value.payload) as Record<string, unknown>
    : {};
  const deliveries = Array.isArray(value.deliveries)
    ? value.deliveries.map(normalizeEventDelivery).filter((delivery): delivery is StudioAutomationEventDelivery => delivery !== null).slice(0, MAX_EVENT_DELIVERIES)
    : [];
  return { schemaVersion: 1, id, source, key, type, occurredAt, receivedAt, payload, deliveries };
}

function normalizeEventDelivery(value: unknown): StudioAutomationEventDelivery | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  const jobId = safeId(value.jobId);
  const createdAt = iso(value.createdAt);
  const updatedAt = iso(value.updatedAt);
  const statuses: StudioAutomationEventDelivery['status'][] = [
    'pending', 'claimed', 'waiting_approval', 'succeeded', 'failed', 'superseded', 'suppressed',
  ];
  if (!id || !jobId || !createdAt || !updatedAt || !statuses.includes(value.status as never)) return null;
  return {
    id,
    jobId,
    status: value.status as StudioAutomationEventDelivery['status'],
    attempt: Math.max(1, finiteInteger(value.attempt, 1)),
    createdAt,
    updatedAt,
    ...(iso(value.nextAttemptAt) ? { nextAttemptAt: iso(value.nextAttemptAt) } : {}),
    ...(safeId(value.runId) ? { runId: safeId(value.runId) } : {}),
    ...(safeId(value.ownerId) ? { ownerId: safeId(value.ownerId) } : {}),
    ...(iso(value.leaseExpiresAt) ? { leaseExpiresAt: iso(value.leaseExpiresAt) } : {}),
    ...(iso(value.finishedAt) ? { finishedAt: iso(value.finishedAt) } : {}),
    ...(text(value.reason, 1_000) ? { reason: redactSensitiveText(text(value.reason, 1_000)!) } : {}),
    ...(text(value.error, 1_000) ? { error: redactSensitiveText(text(value.error, 1_000)!) } : {}),
  };
}

function normalizePatternList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    if (item === '*') return ['*'];
    const token = eventToken(item);
    return token ? [token] : [];
  }))].slice(0, 100);
}

function eventToken(value: unknown): string | undefined {
  const token = text(value, 160);
  return token && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(token) ? token : undefined;
}

function isRunStatus(value: unknown): value is StudioAutomationRun['status'] {
  return value === 'running' || value === 'waiting_approval' || value === 'success' || value === 'error' || value === 'timed_out' || value === 'interrupted';
}

function normalizeApproval(value: unknown): StudioAutomationApproval | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  const jobId = safeId(value.jobId);
  const fingerprint = text(value.fingerprint, 128);
  const toolName = text(value.toolName, 160);
  const createdAt = iso(value.createdAt);
  const runtime = value.runtime === 'codex' || value.runtime === 'claude' ? value.runtime : null;
  const status = value.status === 'pending' || value.status === 'approved' || value.status === 'denied' || value.status === 'consumed'
    ? value.status
    : null;
  const allowDecision = text(value.allowDecision, 160);
  const denyDecision = text(value.denyDecision, 160);
  if (!id || !jobId || !fingerprint || !toolName || !createdAt || !runtime || !status || !allowDecision || !denyDecision) return null;
  const riskRecord = isRecord(value.risk) ? value.risk : {};
  const riskLevel = riskRecord.level === 'low' || riskRecord.level === 'medium' || riskRecord.level === 'high'
    ? riskRecord.level
    : null;
  const riskSummary = text(riskRecord.summary, 500);
  const deliveryRecord = isRecord(value.delivery) ? value.delivery : {};
  const deliveryStatus = deliveryRecord.status === 'sent' || deliveryRecord.status === 'failed'
    ? deliveryRecord.status
    : null;
  const deliveryAttemptedAt = iso(deliveryRecord.attemptedAt);
  return {
    id,
    jobId,
    ...(safeId(value.runId) ? { runId: safeId(value.runId) } : {}),
    fingerprint,
    runtime,
    status,
    toolName,
    ...(text(value.action, 300) ? { action: text(value.action, 300) } : {}),
    ...(text(value.resource, 500) ? { resource: text(value.resource, 500) } : {}),
    ...(text(value.inputPreview, 1_000) ? { inputPreview: redactSensitiveText(text(value.inputPreview, 1_000)!) } : {}),
    ...(riskLevel && riskSummary ? { risk: { level: riskLevel, summary: redactSensitiveText(riskSummary) } } : {}),
    allowDecision,
    denyDecision,
    ...(value.decision === 'allow' || value.decision === 'deny' ? { decision: value.decision } : {}),
    createdAt,
    ...(iso(value.resolvedAt) ? { resolvedAt: iso(value.resolvedAt) } : {}),
    ...(iso(value.consumedAt) ? { consumedAt: iso(value.consumedAt) } : {}),
    ...(deliveryRecord.channel === 'feishu' && deliveryStatus && deliveryAttemptedAt ? {
      delivery: {
        channel: 'feishu',
        status: deliveryStatus,
        attemptedAt: deliveryAttemptedAt,
        ...(text(deliveryRecord.messageId, 200) ? { messageId: text(deliveryRecord.messageId, 200) } : {}),
        ...(text(deliveryRecord.error, 500)
          ? { error: redactSensitiveText(text(deliveryRecord.error, 500)!) }
          : {}),
      },
    } : {}),
  };
}

function normalizeNotification(value: unknown): StudioAutomationNotification | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  const jobId = safeId(value.jobId);
  const title = text(value.title, 200);
  const body = text(value.body, 1_000);
  const createdAt = iso(value.createdAt);
  const kind = value.kind === 'failure' || value.kind === 'timeout' || value.kind === 'interrupted' || value.kind === 'approval_required'
    ? value.kind
    : null;
  if (!id || !jobId || !title || !body || !createdAt || !kind) return null;
  return {
    id,
    jobId,
    ...(safeId(value.runId) ? { runId: safeId(value.runId) } : {}),
    kind,
    title: redactSensitiveText(title),
    body: redactSensitiveText(body),
    createdAt,
    ...(iso(value.readAt) ? { readAt: iso(value.readAt) } : {}),
  };
}

function safeId(value: unknown): string | undefined {
  const normalized = text(value, 120);
  return normalized && SAFE_ID.test(normalized) ? normalized : undefined;
}

function safeTimezone(value: unknown): string {
  const timezone = text(value, 100) ?? 'Asia/Shanghai';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'Asia/Shanghai';
  }
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function iso(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
