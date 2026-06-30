import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  applyRuntimeControlPlaneMutation,
  readRuntimeControlPlane,
  type RuntimeControlPlaneSchedule,
  type RuntimeControlPlaneTrigger,
} from '@geminilight/mindos/server';
import type {
  StudioAutomation,
  StudioAutomationDraft,
  StudioAutomationEffort,
  StudioAutomationModel,
  StudioAutomationPayload,
  StudioAutomationSchedule,
  StudioAutomationScope,
  StudioAutomationStatus,
} from './studio-automations';

const STORE_VERSION = 1;
const STUDIO_SOURCE = 'mindos-studio-automation';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const MAX_JOBS = 200;

type SchedulePromptJobType = 'cron' | 'once' | 'interval';
type SchedulePromptJobStatus = 'success' | 'error' | 'running';

type StudioScheduleMetadata = {
  schemaVersion: 1;
  source: typeof STUDIO_SOURCE;
  scope: StudioAutomationScope;
  projectId?: string;
  studioSchedule: StudioAutomationSchedule;
  model: StudioAutomationModel;
  effort: StudioAutomationEffort;
  controlPlaneScheduleId: string;
  manualOnly?: boolean;
};

type SchedulePromptJob = {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  type: SchedulePromptJobType;
  intervalMs?: number;
  createdAt: string;
  lastRun?: string;
  lastStatus?: SchedulePromptJobStatus;
  nextRun?: string;
  runCount: number;
  description?: string;
  mindos?: StudioScheduleMetadata;
};

type SchedulePromptStore = {
  jobs: SchedulePromptJob[];
  version: number;
};

export type StudioAutomationRuntimeServices = {
  homeDir?: string;
  mindRoot: string;
  now?(): Date;
};

export type StudioAutomationMutation =
  | { action: 'create'; draft?: unknown }
  | { action: 'update'; id?: unknown; draft?: unknown }
  | { action: 'set-status'; id?: unknown; status?: unknown }
  | { action: 'delete'; id?: unknown };

type ScheduleMapping = {
  type: SchedulePromptJobType;
  schedule: string;
  intervalMs?: number;
  trigger: RuntimeControlPlaneTrigger;
  manualOnly?: boolean;
};

export function readStudioAutomationPayload(
  services: StudioAutomationRuntimeServices,
): StudioAutomationPayload {
  const home = services.homeDir ?? homedir();
  const store = readSchedulePromptStore(home);
  const jobs = studioJobs(store);
  const controlPlane = readRuntimeControlPlane(services.mindRoot);
  const controlPlaneById = new Map(controlPlane.schedules.map((schedule) => [schedule.id, schedule]));

  const automations = jobs.map((job) => automationFromJob(job, controlPlaneById.get(controlPlaneIdForJob(job))));
  const enabled = automations.filter((automation) => automation.status === 'active').length;

  return {
    schemaVersion: 1,
    generatedAt: (services.now?.() ?? new Date()).toISOString(),
    automations,
    summary: {
      total: automations.length,
      enabled,
      paused: automations.length - enabled,
      externalSchedulePromptJobs: store.jobs.length - jobs.length,
      scheduleStorePath: schedulePromptStorePath(home),
      controlPlaneScheduleCount: controlPlane.summary.scheduleCount,
    },
  };
}

export function mutateStudioAutomations(
  body: unknown,
  services: StudioAutomationRuntimeServices,
): { status: number; body: StudioAutomationPayload | { error: string } } {
  if (!isRecord(body)) return { status: 400, body: { error: 'Expected an object payload.' } };
  const action = typeof body.action === 'string' ? body.action : '';
  const now = services.now?.() ?? new Date();
  const nowIso = now.toISOString();
  const home = services.homeDir ?? homedir();
  const store = readSchedulePromptStore(home);

  if (action === 'create') {
    const draft = parseDraft(body.draft ?? body);
    if ('error' in draft) return { status: 400, body: { error: draft.error } };
    const job = buildJobFromDraft(draft.value, store, nowIso);
    store.jobs = [job, ...store.jobs.filter((item) => item.id !== job.id)].slice(0, MAX_JOBS);
    writeSchedulePromptStore(home, store);
    syncControlPlaneSchedule(job, services.mindRoot, now);
    return { status: 201, body: readStudioAutomationPayload({ ...services, homeDir: home, now: () => now }) };
  }

  if (action === 'update') {
    const id = sanitizeId(body.id);
    if (!id) return { status: 400, body: { error: 'update requires id.' } };
    const draft = parseDraft(body.draft ?? body);
    if ('error' in draft) return { status: 400, body: { error: draft.error } };
    const index = store.jobs.findIndex((job) => job.id === id && isStudioJob(job));
    if (index < 0) return { status: 404, body: { error: `Automation not found: ${id}` } };
    const updated = updateJobFromDraft(store.jobs[index]!, draft.value, nowIso);
    store.jobs[index] = updated;
    writeSchedulePromptStore(home, store);
    syncControlPlaneSchedule(updated, services.mindRoot, now);
    return { status: 200, body: readStudioAutomationPayload({ ...services, homeDir: home, now: () => now }) };
  }

  if (action === 'set-status') {
    const id = sanitizeId(body.id);
    const status = sanitizeStatus(body.status);
    if (!id || !status) return { status: 400, body: { error: 'set-status requires id and status.' } };
    const index = store.jobs.findIndex((job) => job.id === id && isStudioJob(job));
    if (index < 0) return { status: 404, body: { error: `Automation not found: ${id}` } };
    const job = store.jobs[index]!;
    const next: SchedulePromptJob = {
      ...job,
      enabled: job.mindos?.manualOnly ? false : status === 'active',
    };
    store.jobs[index] = next;
    writeSchedulePromptStore(home, store);
    syncControlPlaneSchedule(next, services.mindRoot, now, status);
    return { status: 200, body: readStudioAutomationPayload({ ...services, homeDir: home, now: () => now }) };
  }

  if (action === 'delete') {
    const id = sanitizeId(body.id);
    if (!id) return { status: 400, body: { error: 'delete requires id.' } };
    const existing = store.jobs.find((job) => job.id === id && isStudioJob(job));
    if (!existing) return { status: 404, body: { error: `Automation not found: ${id}` } };
    store.jobs = store.jobs.filter((job) => job.id !== id);
    writeSchedulePromptStore(home, store);
    archiveControlPlaneSchedule(existing, services.mindRoot, now);
    return { status: 200, body: readStudioAutomationPayload({ ...services, homeDir: home, now: () => now }) };
  }

  return { status: 400, body: { error: `Unsupported studio automation action: ${action || '(missing)'}` } };
}

function readSchedulePromptStore(home: string): SchedulePromptStore {
  const file = schedulePromptStorePath(home);
  try {
    if (!existsSync(file)) return { jobs: [], version: STORE_VERSION };
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SchedulePromptStore>;
    return {
      version: STORE_VERSION,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs.filter(isSchedulePromptJob).slice(0, MAX_JOBS) : [],
    };
  } catch {
    return { jobs: [], version: STORE_VERSION };
  }
}

function writeSchedulePromptStore(home: string, store: SchedulePromptStore): void {
  const file = schedulePromptStorePath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify({ jobs: store.jobs.slice(0, MAX_JOBS), version: STORE_VERSION }, null, 2)}\n`, 'utf-8');
    renameSync(tmp, file);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* ignore cleanup */ }
    throw error;
  }
}

function schedulePromptStorePath(home: string): string {
  return path.join(home, '.mindos', 'schedule-prompts.json');
}

function studioJobs(store: SchedulePromptStore): SchedulePromptJob[] {
  return store.jobs.filter(isStudioJob);
}

function isStudioJob(job: SchedulePromptJob): boolean {
  return job.mindos?.schemaVersion === 1 && job.mindos.source === STUDIO_SOURCE;
}

function buildJobFromDraft(draft: StudioAutomationDraft, store: SchedulePromptStore, nowIso: string): SchedulePromptJob {
  const title = draft.title.trim() || titleFromPrompt(draft.prompt);
  const mapping = scheduleMapping(draft.schedule);
  const id = nextJobId(title, store.jobs.map((job) => job.id));
  const controlPlaneScheduleId = controlPlaneIdForId(id);
  return {
    id,
    name: title,
    schedule: mapping.schedule,
    prompt: draft.prompt.trim(),
    enabled: !mapping.manualOnly,
    type: mapping.type,
    ...(mapping.intervalMs ? { intervalMs: mapping.intervalMs } : {}),
    createdAt: nowIso,
    runCount: 0,
    description: descriptionFromDraft(draft),
    mindos: {
      schemaVersion: 1,
      source: STUDIO_SOURCE,
      scope: draft.scope,
      ...(draft.projectId ? { projectId: draft.projectId } : {}),
      studioSchedule: draft.schedule,
      model: draft.model,
      effort: draft.effort,
      controlPlaneScheduleId,
      ...(mapping.manualOnly ? { manualOnly: true } : {}),
    },
  };
}

function updateJobFromDraft(job: SchedulePromptJob, draft: StudioAutomationDraft, nowIso: string): SchedulePromptJob {
  const title = draft.title.trim() || titleFromPrompt(draft.prompt);
  const mapping = scheduleMapping(draft.schedule);
  return {
    ...job,
    name: title,
    schedule: mapping.schedule,
    prompt: draft.prompt.trim(),
    enabled: mapping.manualOnly ? false : job.enabled,
    type: mapping.type,
    ...(mapping.intervalMs ? { intervalMs: mapping.intervalMs } : { intervalMs: undefined }),
    description: descriptionFromDraft(draft),
    mindos: {
      schemaVersion: 1,
      source: STUDIO_SOURCE,
      scope: draft.scope,
      ...(draft.projectId ? { projectId: draft.projectId } : {}),
      studioSchedule: draft.schedule,
      model: draft.model,
      effort: draft.effort,
      controlPlaneScheduleId: job.mindos?.controlPlaneScheduleId ?? controlPlaneIdForJob(job),
      ...(mapping.manualOnly ? { manualOnly: true } : {}),
    },
    lastStatus: job.lastStatus === 'error' ? undefined : job.lastStatus,
    nextRun: undefined,
    createdAt: job.createdAt || nowIso,
  };
}

function automationFromJob(job: SchedulePromptJob, controlPlaneSchedule: RuntimeControlPlaneSchedule | undefined): StudioAutomation {
  const metadata = job.mindos!;
  const manualOnly = metadata.manualOnly || metadata.studioSchedule === 'manual';
  const status: StudioAutomationStatus = manualOnly || !job.enabled ? 'paused' : 'active';
  return {
    id: job.id,
    title: job.name,
    prompt: job.prompt,
    scope: metadata.scope,
    ...(metadata.projectId ? { projectId: metadata.projectId } : {}),
    schedule: metadata.studioSchedule,
    model: metadata.model,
    effort: metadata.effort,
    status,
    updated: controlPlaneSchedule?.updatedAt ?? job.createdAt,
    lastRun: job.lastRun,
    nextRun: status === 'paused'
      ? 'Paused'
      : job.nextRun ?? controlPlaneSchedule?.nextRunAt ?? (manualOnly ? 'Manual' : undefined),
    runCount: Number.isFinite(job.runCount) ? job.runCount : 0,
    lastStatus: job.lastStatus ?? 'pending',
    runtime: 'mindos-pi',
    source: 'schedule-prompt',
    controlPlaneScheduleId: metadata.controlPlaneScheduleId,
  };
}

function syncControlPlaneSchedule(
  job: SchedulePromptJob,
  mindRoot: string,
  now: Date,
  requestedStatus?: StudioAutomationStatus,
): void {
  const metadata = job.mindos;
  if (!metadata) return;
  const scheduleId = metadata.controlPlaneScheduleId;
  const existing = readRuntimeControlPlane(mindRoot).schedules.some((schedule) => schedule.id === scheduleId);
  const trigger = scheduleMapping(metadata.studioSchedule).trigger;
  const status = metadata.manualOnly
    ? 'disabled'
    : requestedStatus === 'paused'
      ? 'paused'
      : job.enabled
        ? 'enabled'
        : 'paused';
  const schedule = {
    id: scheduleId,
    title: job.name,
    runtimeId: 'mindos',
    status,
    trigger,
    target: {
      assistantId: 'mindos-pi',
      command: job.prompt.slice(0, 160),
      ...(metadata.projectId ? { cwdHint: metadata.projectId } : {}),
    },
    policy: {
      permissionMode: metadata.model === 'local-agent' ? 'ask' : 'auto',
      overlap: 'skip',
      retry: 'once',
      timeoutMs: 1000 * 60 * 10,
    },
    inputSummary: job.prompt,
    ...(job.nextRun ? { nextRunAt: job.nextRun } : {}),
    ...(job.lastRun ? { lastRunId: `schedule-prompt:${job.id}:${job.lastRun}` } : {}),
  };

  applyRuntimeControlPlaneMutation(
    mindRoot,
    existing
      ? { action: 'update-schedule', scheduleId, patch: schedule }
      : { action: 'create-schedule', schedule },
    now,
  );
}

function archiveControlPlaneSchedule(job: SchedulePromptJob, mindRoot: string, now: Date): void {
  const scheduleId = controlPlaneIdForJob(job);
  const existing = readRuntimeControlPlane(mindRoot).schedules.some((schedule) => schedule.id === scheduleId);
  if (!existing) return;
  applyRuntimeControlPlaneMutation(mindRoot, {
    action: 'update-schedule',
    scheduleId,
    patch: { status: 'archived' },
  }, now);
}

function scheduleMapping(schedule: StudioAutomationSchedule): ScheduleMapping {
  switch (schedule) {
    case 'manual':
      return {
        type: 'cron',
        schedule: '0 0 0 1 1 *',
        trigger: { type: 'manual', timezone: DEFAULT_TIMEZONE },
        manualOnly: true,
      };
    case 'hourly':
      return cronMapping('0 0 * * * *', schedule);
    case 'every-2-hours':
      return cronMapping('0 0 */2 * * *', schedule);
    case 'every-4-hours':
      return cronMapping('0 0 */4 * * *', schedule);
    case 'daily-0900':
      return cronMapping('0 0 9 * * *', schedule);
    case 'daily-1800':
      return cronMapping('0 0 18 * * *', schedule);
    case 'twice-daily':
      return cronMapping('0 0 9,18 * * *', schedule);
    case 'weekdays-0900':
      return cronMapping('0 0 9 * * 1-5', schedule);
    case 'weekdays-1800':
      return cronMapping('0 0 18 * * 1-5', schedule);
    case 'weekly-monday-0900':
      return cronMapping('0 0 9 * * 1', schedule);
    case 'weekly-friday-1730':
    case 'weekly-review':
      return cronMapping('0 30 17 * * 5', schedule);
    case 'monthly-first-0900':
      return cronMapping('0 0 9 1 * *', schedule);
    case 'monthly-last-1700':
      return cronMapping('0 0 17 L * *', schedule);
    default:
      return cronMapping('0 0 9 * * *', schedule);
  }
}

function cronMapping(cron: string, _schedule: StudioAutomationSchedule): ScheduleMapping {
  return {
    type: 'cron',
    schedule: cron,
    trigger: { type: 'cron', cron, timezone: DEFAULT_TIMEZONE },
  };
}

function parseDraft(raw: unknown): { value: StudioAutomationDraft } | { error: string } {
  if (!isRecord(raw)) return { error: 'Automation draft must be an object.' };
  const prompt = sanitizeString(raw.prompt, 4000);
  if (!prompt) return { error: 'Automation prompt is required.' };
  return {
    value: {
      title: sanitizeString(raw.title, 160) ?? '',
      prompt,
      scope: sanitizeEnum(raw.scope, ['worktree', 'project', 'mind'] as const) ?? 'worktree',
      ...(sanitizeString(raw.projectId, 120) ? { projectId: sanitizeString(raw.projectId, 120) } : {}),
      schedule: sanitizeEnum(raw.schedule, [
        'manual',
        'hourly',
        'every-2-hours',
        'every-4-hours',
        'daily-0900',
        'daily-1800',
        'twice-daily',
        'weekdays-0900',
        'weekdays-1800',
        'weekly-monday-0900',
        'weekly-friday-1730',
        'weekly-review',
        'monthly-first-0900',
        'monthly-last-1700',
      ] as const) ?? 'daily-0900',
      model: sanitizeEnum(raw.model, ['mindos-auto', 'gpt-5.5', 'claude-code', 'local-agent'] as const) ?? 'mindos-auto',
      effort: sanitizeEnum(raw.effort, ['normal', 'high', 'extra-high'] as const) ?? 'high',
    },
  };
}

function descriptionFromDraft(draft: StudioAutomationDraft): string {
  const scope = draft.scope === 'project' && draft.projectId ? `project:${draft.projectId}` : draft.scope;
  return `MindOS Studio automation · ${scope} · ${draft.model} · ${draft.effort}`;
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, ' ').slice(0, 56);
  return compact || 'Untitled automation';
}

function controlPlaneIdForJob(job: SchedulePromptJob): string {
  return job.mindos?.controlPlaneScheduleId ?? controlPlaneIdForId(job.id);
}

function controlPlaneIdForId(id: string): string {
  return `studio-automation-${id.replace(/^studio-/, '')}`;
}

function nextJobId(title: string, existing: string[]): string {
  const base = `studio-${slugify(title)}`;
  const existingSet = new Set(existing);
  if (!existingSet.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingSet.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'automation';
}

function sanitizeStatus(value: unknown): StudioAutomationStatus | undefined {
  return sanitizeEnum(value, ['active', 'paused'] as const);
}

function sanitizeId(value: unknown): string | undefined {
  const text = sanitizeString(value, 120);
  return text && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text) ? text : undefined;
}

function sanitizeString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function sanitizeEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function isSchedulePromptJob(value: unknown): value is SchedulePromptJob {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.schedule === 'string'
    && typeof value.prompt === 'string'
    && typeof value.enabled === 'boolean'
    && (value.type === 'cron' || value.type === 'once' || value.type === 'interval');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
