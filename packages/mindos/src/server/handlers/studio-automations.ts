import crypto from 'node:crypto';
import path from 'node:path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import { applyRuntimeControlPlaneMutation, readRuntimeControlPlane } from './runtime-control-plane.js';
import { migrateLegacyStudioAutomations } from '../automations/migration.js';
import {
  DEFAULT_AUTOMATION_TIMEZONE,
  assertValidTimezone,
  automationTrigger,
  nextAutomationRunAt,
} from '../automations/schedule.js';
import {
  mutateStudioAutomationState,
  readStudioAutomationState,
} from '../automations/store.js';
import {
  STUDIO_AUTOMATION_SCHEDULES,
  type StudioAutomationDraft,
  type StudioAutomationJob,
  type StudioAutomationPayload,
  type StudioAutomationStatus,
} from '../automations/types.js';

export {
  claimNextDueStudioAutomation,
  recoverStaleStudioAutomationLeases,
  tickStudioAutomationWorker,
} from '../automations/worker.js';
export { readStudioAutomationState } from '../automations/store.js';
export type * from '../automations/types.js';

export type StudioAutomationServices = {
  mindRoot: string;
  homeDir?: string;
  now?(): Date;
};

type HandlerPayload = StudioAutomationPayload | { error: string };

export function handleStudioAutomationsGet(
  services: StudioAutomationServices,
): MindosServerResponse<StudioAutomationPayload | { error: string }> {
  try {
    const now = services.now?.() ?? new Date();
    migrateLegacyStudioAutomations(services.mindRoot, services.homeDir, now);
    syncAllControlPlaneSchedules(services.mindRoot, now);
    return json(buildPayload(services.mindRoot, now), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleStudioAutomationsPost(
  body: unknown,
  services: StudioAutomationServices,
): MindosServerResponse<HandlerPayload> {
  try {
    if (!isRecord(body)) return json({ error: 'Expected an object payload.' }, { status: 400 });
    const action = typeof body.action === 'string' ? body.action : '';
    const now = services.now?.() ?? new Date();
    migrateLegacyStudioAutomations(services.mindRoot, services.homeDir, now);

    if (action === 'create') {
      const parsed = parseDraft(body.draft ?? body);
      if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });
      const job = mutateStudioAutomationState(services.mindRoot, (state) => {
        const created = createJob(parsed.value, state.automations, now);
        state.automations = [created, ...state.automations.filter((item) => item.id !== created.id)];
        state.updatedAt = now.toISOString();
        return created;
      });
      syncControlPlaneSchedule(services.mindRoot, job, now);
      return json(buildPayload(services.mindRoot, now), { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }

    const id = safeId(body.id);
    if (!id) return json({ error: `${action || 'mutation'} requires id.` }, { status: 400 });

    if (action === 'update') {
      const parsed = parseDraft(body.draft ?? body);
      if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });
      const updated = mutateStudioAutomationState(services.mindRoot, (state) => {
        const index = state.automations.findIndex((job) => job.id === id);
        if (index < 0) return null;
        const current = state.automations[index]!;
        const next = updateJob(current, parsed.value, now);
        state.automations[index] = next;
        state.updatedAt = now.toISOString();
        return next;
      });
      if (!updated) return json({ error: `Automation not found: ${id}` }, { status: 404 });
      syncControlPlaneSchedule(services.mindRoot, updated, now);
      return json(buildPayload(services.mindRoot, now), { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'set-status') {
      const status = body.status === 'active' || body.status === 'paused' ? body.status : null;
      if (!status) return json({ error: 'set-status requires active or paused status.' }, { status: 400 });
      const updated = mutateStudioAutomationState(services.mindRoot, (state) => {
        const job = state.automations.find((item) => item.id === id);
        if (!job) return null;
        job.status = status;
        job.updatedAt = now.toISOString();
        delete job.retryAttempt;
        if (status === 'paused') {
          delete job.nextRunAt;
        } else {
          const nextRunAt = nextAutomationRunAt(job.schedule, now, job.timezone);
          if (nextRunAt) job.nextRunAt = nextRunAt;
          else delete job.nextRunAt;
        }
        state.updatedAt = now.toISOString();
        return { ...job };
      });
      if (!updated) return json({ error: `Automation not found: ${id}` }, { status: 404 });
      syncControlPlaneSchedule(services.mindRoot, updated, now);
      return json(buildPayload(services.mindRoot, now), { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'run-now') {
      const updated = mutateStudioAutomationState(services.mindRoot, (state) => {
        const job = state.automations.find((item) => item.id === id);
        if (!job) return { kind: 'missing' as const };
        if (job.status !== 'active') return { kind: 'paused' as const };
        if (job.lease) return { kind: 'running' as const };
        job.nextRunAt = now.toISOString();
        job.retryAttempt = 1;
        job.updatedAt = now.toISOString();
        state.updatedAt = now.toISOString();
        return { kind: 'updated' as const, job: { ...job } };
      });
      if (updated.kind === 'missing') return json({ error: `Automation not found: ${id}` }, { status: 404 });
      if (updated.kind === 'paused') return json({ error: 'Paused automations cannot run. Resume it first.' }, { status: 409 });
      if (updated.kind === 'running') return json({ error: 'Automation is already running.' }, { status: 409 });
      syncControlPlaneSchedule(services.mindRoot, updated.job, now);
      return json(buildPayload(services.mindRoot, now), { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'delete') {
      const removed = mutateStudioAutomationState(services.mindRoot, (state) => {
        const job = state.automations.find((item) => item.id === id);
        if (!job) return null;
        if (job.lease) return { running: true as const, job };
        state.automations = state.automations.filter((item) => item.id !== id);
        state.updatedAt = now.toISOString();
        return { running: false as const, job };
      });
      if (!removed) return json({ error: `Automation not found: ${id}` }, { status: 404 });
      if (removed.running) return json({ error: 'Running automations cannot be deleted.' }, { status: 409 });
      archiveControlPlaneSchedule(services.mindRoot, removed.job, now);
      return json(buildPayload(services.mindRoot, now), { headers: { 'Cache-Control': 'no-store' } });
    }

    return json({ error: `Unsupported studio automation action: ${action || '(missing)'}` }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

function buildPayload(mindRoot: string, now: Date): StudioAutomationPayload {
  const state = readStudioAutomationState(mindRoot);
  const controlPlane = readRuntimeControlPlane(mindRoot);
  const automations = state.automations.map((job) => ({
    id: job.id,
    title: job.title,
    prompt: job.prompt,
    scope: job.scope,
    ...(job.projectId ? { projectId: job.projectId } : {}),
    schedule: job.schedule,
    timezone: job.timezone,
    model: job.model,
    effort: job.effort,
    permissionMode: job.permissionMode,
    status: job.status,
    retry: job.retry,
    timeoutMs: job.timeoutMs,
    updated: job.updatedAt,
    ...(job.lastRun ? { lastRun: job.lastRun } : {}),
    nextRun: job.status === 'paused' ? 'Paused' : job.lease ? 'Running' : job.nextRunAt ?? (job.schedule === 'manual' ? 'Manual' : undefined),
    runCount: job.runCount,
    lastStatus: job.lease ? 'running' as const : job.lastStatus,
    ...(job.lastError ? { lastError: job.lastError } : {}),
    recentRuns: job.history.slice(0, 10),
    runtime: job.runtime,
    source: job.source,
    controlPlaneScheduleId: job.controlPlaneScheduleId,
  }));
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    automations,
    summary: {
      total: automations.length,
      enabled: automations.filter((job) => job.status === 'active').length,
      paused: automations.filter((job) => job.status === 'paused').length,
      running: automations.filter((job) => job.lastStatus === 'running').length,
      failed: automations.filter((job) => job.lastStatus === 'error' || job.lastStatus === 'timed_out' || job.lastStatus === 'interrupted').length,
      externalSchedulePromptJobs: state.migration.externalSchedulePromptJobs,
      migratedLegacyJobs: state.migration.importedCount,
      ...(state.migration.warning ? { migrationWarning: state.migration.warning } : {}),
      scheduleStorePath: path.join(mindRoot, '.mindos/automations/state.json'),
      controlPlaneScheduleCount: controlPlane.summary.scheduleCount,
    },
  };
}

function createJob(draft: StudioAutomationDraft, existing: StudioAutomationJob[], now: Date): StudioAutomationJob {
  const id = nextId(draft.title || titleFromPrompt(draft.prompt), existing.map((job) => job.id));
  const nextRunAt = nextAutomationRunAt(draft.schedule, now, draft.timezone);
  return {
    id,
    title: draft.title || titleFromPrompt(draft.prompt),
    prompt: draft.prompt,
    scope: draft.scope,
    ...(draft.projectId ? { projectId: draft.projectId } : {}),
    schedule: draft.schedule,
    timezone: draft.timezone,
    model: draft.model,
    effort: draft.effort,
    permissionMode: draft.permissionMode,
    status: 'active',
    retry: draft.retry,
    timeoutMs: draft.timeoutMs,
    overlap: 'skip',
    runtime: 'mindos-pi',
    source: 'mindos-durable',
    controlPlaneScheduleId: `studio-automation-${id.replace(/^studio-/, '')}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...(nextRunAt ? { nextRunAt } : {}),
    runCount: 0,
    lastStatus: 'pending',
    history: [],
  };
}

function updateJob(current: StudioAutomationJob, draft: StudioAutomationDraft, now: Date): StudioAutomationJob {
  const nextRunAt = current.status === 'active' ? nextAutomationRunAt(draft.schedule, now, draft.timezone) : undefined;
  return {
    ...current,
    title: draft.title || titleFromPrompt(draft.prompt),
    prompt: draft.prompt,
    scope: draft.scope,
    ...(draft.projectId ? { projectId: draft.projectId } : { projectId: undefined }),
    schedule: draft.schedule,
    timezone: draft.timezone,
    model: draft.model,
    effort: draft.effort,
    permissionMode: draft.permissionMode,
    retry: draft.retry,
    timeoutMs: draft.timeoutMs,
    updatedAt: now.toISOString(),
    ...(nextRunAt ? { nextRunAt } : { nextRunAt: undefined }),
    retryAttempt: undefined,
    lastError: current.lastStatus === 'error' ? undefined : current.lastError,
  };
}

function parseDraft(value: unknown): { value: StudioAutomationDraft } | { error: string } {
  if (!isRecord(value)) return { error: 'Automation draft must be an object.' };
  const prompt = text(value.prompt, 4_000);
  if (!prompt) return { error: 'Automation prompt is required.' };
  const title = text(value.title, 160) ?? '';
  if (value.scope !== undefined && value.scope !== 'project' && value.scope !== 'mind' && value.scope !== 'worktree') {
    return { error: 'Automation scope is invalid.' };
  }
  const scope = value.scope === 'project' || value.scope === 'mind' ? value.scope : 'worktree';
  if (value.schedule !== undefined && (
    typeof value.schedule !== 'string' || !STUDIO_AUTOMATION_SCHEDULES.includes(value.schedule as never)
  )) {
    return { error: 'Automation schedule is invalid.' };
  }
  const schedule = typeof value.schedule === 'string'
    ? value.schedule as StudioAutomationDraft['schedule']
    : 'daily-0900';
  if (value.model !== undefined && value.model !== 'mindos-auto' && value.model !== 'gpt-5.5'
    && value.model !== 'claude-code' && value.model !== 'local-agent') {
    return { error: 'Automation model is invalid.' };
  }
  const model = value.model === 'gpt-5.5' || value.model === 'claude-code' || value.model === 'local-agent'
    ? value.model
    : 'mindos-auto';
  if (value.effort !== undefined && value.effort !== 'normal' && value.effort !== 'high' && value.effort !== 'extra-high') {
    return { error: 'Automation effort is invalid.' };
  }
  const effort = value.effort === 'normal' || value.effort === 'extra-high' ? value.effort : 'high';
  const permissionMode = value.permissionMode === undefined || value.permissionMode === 'read'
    ? 'read'
    : value.permissionMode === 'auto'
      ? 'auto'
      : null;
  if (!permissionMode) return { error: 'Unattended automations only support read or explicit auto permission.' };
  const timezone = text(value.timezone, 100) ?? DEFAULT_AUTOMATION_TIMEZONE;
  try { assertValidTimezone(timezone); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  return {
    value: {
      title,
      prompt,
      scope,
      ...(text(value.projectId, 120) ? { projectId: text(value.projectId, 120) } : {}),
      schedule,
      timezone,
      model,
      effort,
      permissionMode,
      retry: value.retry === 'never' ? 'never' : 'once',
      timeoutMs: clampNumber(value.timeoutMs, 1_000, 3_600_000, 600_000),
    },
  };
}

function syncAllControlPlaneSchedules(mindRoot: string, now: Date): void {
  for (const job of readStudioAutomationState(mindRoot).automations) syncControlPlaneSchedule(mindRoot, job, now);
}

export function syncControlPlaneSchedule(mindRoot: string, job: StudioAutomationJob, now: Date): void {
  const existing = readRuntimeControlPlane(mindRoot).schedules.some((schedule) => schedule.id === job.controlPlaneScheduleId);
  const schedule = {
    id: job.controlPlaneScheduleId,
    title: job.title,
    runtimeId: 'mindos',
    status: job.status === 'paused' ? 'paused' : 'enabled',
    trigger: automationTrigger(job.schedule, job.timezone),
    target: {
      assistantId: 'mindos-pi',
      command: job.prompt.slice(0, 160),
      ...(job.projectId ? { cwdHint: job.projectId } : {}),
    },
    policy: {
      permissionMode: job.permissionMode,
      overlap: job.overlap,
      retry: job.retry,
      timeoutMs: job.timeoutMs,
    },
    inputSummary: job.prompt.slice(0, 1_000),
    nextRunAt: job.nextRunAt ?? null,
    ...(job.history[0] ? { lastRunId: job.history[0].id } : {}),
  };
  applyRuntimeControlPlaneMutation(mindRoot, existing
    ? { action: 'update-schedule', scheduleId: job.controlPlaneScheduleId, patch: schedule }
    : { action: 'create-schedule', schedule }, now);
}

function archiveControlPlaneSchedule(mindRoot: string, job: StudioAutomationJob, now: Date): void {
  if (!readRuntimeControlPlane(mindRoot).schedules.some((schedule) => schedule.id === job.controlPlaneScheduleId)) return;
  applyRuntimeControlPlaneMutation(mindRoot, {
    action: 'update-schedule',
    scheduleId: job.controlPlaneScheduleId,
    patch: { status: 'archived' },
  }, now);
}

function nextId(title: string, existingIds: string[]): string {
  const base = `studio-${slugify(title)}`;
  if (!existingIds.includes(base)) return base;
  for (let index = 2; index < 1_000; index += 1) {
    if (!existingIds.includes(`${base}-${index}`)) return `${base}-${index}`;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'automation';
}

function titleFromPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 56) || 'Untitled automation';
}

function safeId(value: unknown): string | undefined {
  const id = text(value, 120);
  return id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ? id : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
