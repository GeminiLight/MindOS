import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { redactSensitiveText } from '../../agent/redaction.js';
import { nextAutomationRunAt } from './schedule.js';
import { mutateStudioAutomationState, readStudioAutomationState } from './store.js';
import {
  STUDIO_AUTOMATION_SCHEDULES,
  type StudioAutomationEffort,
  type StudioAutomationJob,
  type StudioAutomationModel,
  type StudioAutomationSchedule,
  type StudioAutomationScope,
} from './types.js';

const LEGACY_SOURCE = 'mindos-studio-automation';
const LEGACY_STORE = '.mindos/schedule-prompts.json';
const MAX_LEGACY_JOBS = 1_000;

type LegacyJob = {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  runCount: number;
  lastRun?: string;
  lastStatus?: 'success' | 'error' | 'running';
  mindos: {
    schemaVersion: 1;
    source: typeof LEGACY_SOURCE;
    scope: StudioAutomationScope;
    projectId?: string;
    studioSchedule: StudioAutomationSchedule;
    model: StudioAutomationModel;
    effort: StudioAutomationEffort;
    controlPlaneScheduleId: string;
  };
};

export function migrateLegacyStudioAutomations(
  mindRoot: string,
  homeDir: string | undefined,
  now = new Date(),
): void {
  const current = readStudioAutomationState(mindRoot);
  if (current.migration.completedAt || !homeDir) return;
  const storePath = path.join(homeDir, LEGACY_STORE);
  if (!existsSync(storePath)) {
    if (current.migration.pendingLegacyJobs?.length) {
      finalizePendingLegacyJobs(
        mindRoot,
        current.migration.pendingLegacyJobs,
        now,
        storePath,
        current.migration.externalSchedulePromptJobs,
      );
      return;
    }
    mutateStudioAutomationState(mindRoot, (state) => {
      state.migration = {
        completedAt: now.toISOString(),
        importedCount: 0,
        externalSchedulePromptJobs: 0,
        legacyStorePath: storePath,
      };
      state.updatedAt = now.toISOString();
    });
    return;
  }

  try {
    const safeStorePath = resolveExistingSafe(homeDir, LEGACY_STORE);
    const parsed = JSON.parse(readFileSync(safeStorePath, 'utf-8')) as { jobs?: unknown[]; version?: unknown };
    if (!Array.isArray(parsed.jobs)) throw new Error('Legacy schedule store does not contain a jobs array.');
    const jobs = parsed.jobs.slice(0, MAX_LEGACY_JOBS);
    const studioJobs = jobs.map(normalizeLegacyJob).filter((job): job is LegacyJob => job !== null);
    const externalCount = jobs.length - studioJobs.length;
    const imported = studioJobs.map((job) => legacyJobToDurable(job, now));
    const previouslyPending = new Map(
      (current.migration.pendingLegacyJobs ?? []).map((job) => [job.id, job.status]),
    );
    const pendingLegacyJobs = imported.map((job) => ({
      id: job.id,
      status: previouslyPending.get(job.id) ?? job.status,
    }));

    mutateStudioAutomationState(mindRoot, (state) => {
      for (const desired of imported) {
        const index = state.automations.findIndex((job) => job.id === desired.id);
        const existing = index >= 0 ? state.automations[index] : undefined;
        if (existing && !previouslyPending.has(desired.id) && !sameLegacyIdentity(existing, desired)) {
          throw new Error(`Legacy Studio automation id conflicts with durable job: ${desired.id}`);
        }
        const staged: StudioAutomationJob = {
          ...desired,
          ...(existing ? {
            history: existing.history,
            runCount: Math.max(existing.runCount, desired.runCount),
          } : {}),
          status: 'paused',
        };
        delete staged.nextRunAt;
        if (index >= 0) state.automations[index] = staged;
        else state.automations.unshift(staged);
      }
      state.migration = {
        importedCount: pendingLegacyJobs.length,
        externalSchedulePromptJobs: externalCount,
        legacyStorePath: safeStorePath,
        ...(pendingLegacyJobs.length > 0 ? { pendingLegacyJobs } : {}),
      };
      state.updatedAt = now.toISOString();
    });

    const pendingIds = new Set(pendingLegacyJobs.map((job) => job.id));
    let changed = false;
    const disabledJobs = jobs.map((job) => {
      const normalized = normalizeLegacyJob(job);
      if (!normalized || !pendingIds.has(normalized.id) || !normalized.enabled || !isRecord(job)) return job;
      changed = true;
      return { ...job, enabled: false };
    });
    if (changed) writeLegacyStore(safeStorePath, { ...parsed, jobs: disabledJobs });
    finalizePendingLegacyJobs(mindRoot, pendingLegacyJobs, now, safeStorePath, externalCount);
  } catch (error) {
    mutateStudioAutomationState(mindRoot, (state) => {
      delete state.migration.completedAt;
      state.migration = {
        ...state.migration,
        externalSchedulePromptJobs: state.migration.externalSchedulePromptJobs,
        legacyStorePath: storePath,
        warning: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 1_000),
      };
      state.updatedAt = now.toISOString();
    });
  }
}

function finalizePendingLegacyJobs(
  mindRoot: string,
  pendingLegacyJobs: Array<{ id: string; status: 'active' | 'paused' }>,
  now: Date,
  legacyStorePath: string,
  externalSchedulePromptJobs: number,
): void {
  mutateStudioAutomationState(mindRoot, (state) => {
    for (const pending of pendingLegacyJobs) {
      const job = state.automations.find((item) => item.id === pending.id);
      if (!job) continue;
      job.status = pending.status;
      if (pending.status === 'active') {
        const nextRunAt = nextAutomationRunAt(job.schedule, now, job.timezone);
        if (nextRunAt) job.nextRunAt = nextRunAt;
        else delete job.nextRunAt;
      } else {
        delete job.nextRunAt;
      }
      job.updatedAt = now.toISOString();
    }
    state.migration = {
      completedAt: now.toISOString(),
      importedCount: pendingLegacyJobs.length,
      externalSchedulePromptJobs,
      legacyStorePath,
    };
    state.updatedAt = now.toISOString();
  });
}

function sameLegacyIdentity(existing: StudioAutomationJob, desired: StudioAutomationJob): boolean {
  return existing.id === desired.id
    && existing.source === 'mindos-durable'
    && existing.controlPlaneScheduleId === desired.controlPlaneScheduleId
    && existing.prompt === desired.prompt;
}

function legacyJobToDurable(job: LegacyJob, now: Date): StudioAutomationJob {
  const status = job.enabled ? 'active' : 'paused';
  const createdAt = validIso(job.createdAt) ?? now.toISOString();
  const lastRun = validIso(job.lastRun);
  return {
    id: job.id,
    title: job.name,
    prompt: job.prompt,
    scope: job.mindos.scope,
    ...(job.mindos.projectId ? { projectId: job.mindos.projectId } : {}),
    schedule: job.mindos.studioSchedule,
    timezone: 'Asia/Shanghai',
    model: job.mindos.model,
    effort: job.mindos.effort,
    permissionMode: 'read',
    status,
    retry: 'once',
    timeoutMs: 600_000,
    overlap: 'skip',
    runtime: 'mindos-pi',
    source: 'mindos-durable',
    controlPlaneScheduleId: job.mindos.controlPlaneScheduleId,
    createdAt,
    updatedAt: now.toISOString(),
    ...(status === 'active' && nextAutomationRunAt(job.mindos.studioSchedule, now, 'Asia/Shanghai')
      ? { nextRunAt: nextAutomationRunAt(job.mindos.studioSchedule, now, 'Asia/Shanghai') }
      : {}),
    runCount: Math.max(0, Math.floor(job.runCount)),
    ...(lastRun ? { lastRun } : {}),
    lastStatus: job.lastStatus === 'running'
      ? 'interrupted'
      : job.lastStatus === 'success' || job.lastStatus === 'error'
        ? job.lastStatus
        : 'pending',
    ...(job.lastStatus === 'running'
      ? { lastError: 'Legacy automation was interrupted during durable migration.' }
      : {}),
    history: [],
  };
}

function normalizeLegacyJob(value: unknown): LegacyJob | null {
  if (!isRecord(value) || !isRecord(value.mindos)) return null;
  const metadata = value.mindos;
  const id = safeId(value.id);
  const name = text(value.name, 160);
  const prompt = text(value.prompt, 4_000);
  const schedule = typeof metadata.studioSchedule === 'string' && STUDIO_AUTOMATION_SCHEDULES.includes(metadata.studioSchedule as never)
    ? metadata.studioSchedule as StudioAutomationSchedule
    : null;
  if (!id || !name || !prompt || !schedule || metadata.source !== LEGACY_SOURCE || metadata.schemaVersion !== 1) return null;
  const scope = metadata.scope === 'project' || metadata.scope === 'mind' ? metadata.scope : 'worktree';
  const model = metadata.model === 'gpt-5.5' || metadata.model === 'claude-code' || metadata.model === 'local-agent'
    ? metadata.model
    : 'mindos-auto';
  const effort = metadata.effort === 'normal' || metadata.effort === 'extra-high' ? metadata.effort : 'high';
  return {
    id,
    name,
    prompt,
    enabled: value.enabled === true,
    createdAt: validIso(value.createdAt) ?? new Date(0).toISOString(),
    runCount: typeof value.runCount === 'number' && Number.isFinite(value.runCount) ? Math.max(0, Math.floor(value.runCount)) : 0,
    ...(validIso(value.lastRun) ? { lastRun: validIso(value.lastRun) } : {}),
    ...(value.lastStatus === 'success' || value.lastStatus === 'error' || value.lastStatus === 'running' ? { lastStatus: value.lastStatus } : {}),
    mindos: {
      schemaVersion: 1,
      source: LEGACY_SOURCE,
      scope,
      ...(text(metadata.projectId, 120) ? { projectId: text(metadata.projectId, 120) } : {}),
      studioSchedule: schedule,
      model,
      effort,
      controlPlaneScheduleId: safeId(metadata.controlPlaneScheduleId) ?? `studio-automation-${id.replace(/^studio-/, '')}`,
    },
  };
}

function writeLegacyStore(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function safeId(value: unknown): string | undefined {
  const result = text(value, 120);
  return result && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(result) ? result : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function validIso(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
