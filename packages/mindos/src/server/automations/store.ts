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
import { redactSensitiveText } from '../../agent/redaction.js';
import {
  STUDIO_AUTOMATION_SCHEDULES,
  type StudioAutomationJob,
  type StudioAutomationLease,
  type StudioAutomationMigration,
  type StudioAutomationRun,
  type StudioAutomationState,
  type StudioAutomationStatus,
} from './types.js';

export const STUDIO_AUTOMATION_STATE_FILE = '.mindos/automations/state.json';

const STORE_DIR = '.mindos/automations';
const STORE_LOCK = `${STORE_DIR}/state.lock`;
const MAX_AUTOMATIONS = 200;
const MAX_HISTORY = 50;
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
  return {
    id,
    title,
    prompt,
    scope: value.scope === 'project' || value.scope === 'mind' ? value.scope : 'worktree',
    ...(text(value.projectId, 120) ? { projectId: text(value.projectId, 120) } : {}),
    schedule,
    timezone: safeTimezone(value.timezone),
    model: value.model === 'gpt-5.5' || value.model === 'claude-code' || value.model === 'local-agent' ? value.model : 'mindos-auto',
    effort: value.effort === 'normal' || value.effort === 'extra-high' ? value.effort : 'high',
    permissionMode: value.permissionMode === 'auto' ? 'auto' : 'read',
    status,
    retry: value.retry === 'never' ? 'never' : 'once',
    timeoutMs: clampInteger(value.timeoutMs, 1_000, 3_600_000, 600_000),
    overlap: 'skip',
    runtime: 'mindos-pi',
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
  return { runId, ownerId, occurrenceAt, claimedAt, expiresAt, attempt: Math.max(1, finiteInteger(value.attempt, 1)) };
}

function isRunStatus(value: unknown): value is StudioAutomationRun['status'] {
  return value === 'running' || value === 'success' || value === 'error' || value === 'timed_out' || value === 'interrupted';
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
