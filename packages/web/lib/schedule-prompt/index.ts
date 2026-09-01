// ─── MindOS Schedule-Prompt Extension Wrapper ─────────────────────────────────
// Wraps pi-schedule-prompt with MindOS-specific storage path (~/.mindos/).
// Instead of storing to {cwd}/.pi/schedule-prompts.json (Pi default),
// persists to ~/.mindos/schedule-prompts.json (MindOS global).
//
// Loaded by the MindOS Pi runtime host through the built-in extension registry.

import os from 'os';
import path from 'path';
import { mkdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createJiti } from 'jiti/static';
import {
  resolveBuiltinWebRuntimePackagePath,
  resolveWebAppDirFromEntry,
} from '../agent/builtin-extension-runtime';

type ExtensionAPI = {
  registerTool(tool: unknown): void;
  on(
    event: string,
    handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void,
  ): void;
};

type ExtensionContext = {
  cwd: string;
  sessionManager: {
    getSessionId(): string | undefined;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SchedulePromptJobLike = {
  id: string;
  enabled: boolean;
  session?: string;
  mindos?: unknown;
};

type CronStorageLike = {
  getAllJobs(): SchedulePromptJobLike[];
  removeJob(id: string): void;
  save?: (...args: unknown[]) => unknown;
  piDir?: string;
  storePath?: string;
};

type CronSchedulerLike = {
  start(): void;
  stop(): void;
  addJob(job: SchedulePromptJobLike): void;
  updateJob(id: string, job: SchedulePromptJobLike): void;
  removeJob(id: string): void;
};

type SchedulePromptModules = {
  CronStorage: new (homeDir: string) => CronStorageLike;
  CronScheduler: new (
    storage: CronStorageLike,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
  ) => CronSchedulerLike;
  createCronTool: (
    getStorage: () => CronStorageLike,
    getScheduler: () => CronSchedulerLike,
  ) => unknown;
};

async function loadSchedulePromptModules(): Promise<SchedulePromptModules> {
  // pi-schedule-prompt ships TypeScript source only. Keep these imports
  // dynamic so app typecheck does not typecheck the dependency's internal TS.
  const webAppDir = resolveWebAppDirFromEntry(import.meta.url);
  const storageModulePath = resolveBuiltinWebRuntimePackagePath(webAppDir, 'pi-schedule-prompt', 'src', 'storage.ts');
  const schedulerModulePath = resolveBuiltinWebRuntimePackagePath(webAppDir, 'pi-schedule-prompt', 'src', 'scheduler.ts');
  const toolModulePath = resolveBuiltinWebRuntimePackagePath(webAppDir, 'pi-schedule-prompt', 'src', 'tool.ts');
  const jiti = createJiti(toolModulePath, {
    moduleCache: false,
    tryNative: false,
  });
  const [{ CronStorage }, { CronScheduler }, { createCronTool }] = await Promise.all([
    jiti.import(storageModulePath) as Promise<{ CronStorage: SchedulePromptModules['CronStorage'] }>,
    jiti.import(schedulerModulePath) as Promise<{ CronScheduler: SchedulePromptModules['CronScheduler'] }>,
    jiti.import(toolModulePath) as Promise<{ createCronTool: SchedulePromptModules['createCronTool'] }>,
  ]);
  return { CronStorage, CronScheduler, createCronTool };
}

const SCHEDULER_RUNTIME_JOB_FIELDS = new Set([
  'lastRun',
  'lastStatus',
  'nextRun',
  'runCount',
]);

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stableJsonValue(nested)]));
}

function scheduleJobFingerprint(job: SchedulePromptJobLike): string {
  const schedulingFields = Object.fromEntries(Object.entries(job).filter(
    ([key]) => !SCHEDULER_RUNTIME_JOB_FIELDS.has(key),
  ));
  return JSON.stringify(stableJsonValue(schedulingFields));
}

/** Fingerprint only fields whose external changes require rescheduling. */
export function scheduleStoreFingerprint(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.jobs)) return null;
    const jobs = parsed.jobs.map((job) => isRecord(job)
      ? JSON.parse(scheduleJobFingerprint(job as SchedulePromptJobLike))
      : job);
    return JSON.stringify(stableJsonValue({ ...parsed, jobs }));
  } catch {
    return null;
  }
}

function readScheduleStoreFingerprint(storePath: string): string | null {
  try {
    return scheduleStoreFingerprint(readFileSync(storePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Mark synchronous CronStorage writes so the file watcher does not reload its own scheduler. */
export function observeScheduleStorageWrites(storage: CronStorageLike, onWrite: () => void): void {
  if (typeof storage.save !== 'function') return;
  const originalSave = storage.save.bind(storage);
  storage.save = (...args: unknown[]) => {
    const result = originalSave(...args);
    onWrite();
    return result;
  };
}

/** Create a CronStorage that persists to ~/.mindos/schedule-prompts.json */
function createMindOSStorage(CronStorage: SchedulePromptModules['CronStorage']): CronStorageLike {
  const mindosDir = path.join(os.homedir(), '.mindos');
  const storage = new CronStorage(os.homedir());
  // Patch internal paths: ~/.pi/ → ~/.mindos/
  storage.piDir = mindosDir;
  storage.storePath = path.join(mindosDir, 'schedule-prompts.json');
  return storage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMindosStudioAutomationJob(job: SchedulePromptJobLike): boolean {
  const metadata = isRecord(job.mindos) ? job.mindos : null;
  return metadata?.schemaVersion === 1 && metadata.source === 'mindos-studio-automation';
}

export function createMindosSchedulePromptExtension(
  moduleLoader: () => Promise<SchedulePromptModules> = loadSchedulePromptModules,
) {
  return async function mindosSchedulePrompt(pi: ExtensionAPI) {
    const { CronStorage, CronScheduler, createCronTool } = await moduleLoader();
    let storage: CronStorageLike;
    let scheduler: CronSchedulerLike;
    let storeWatcher: FSWatcher | null = null;
    let storePollTimer: ReturnType<typeof setInterval> | null = null;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStoreMtimeMs: number | null = null;
    let lastStoreFingerprint: string | null = null;
    let scheduledJobs = new Map<string, SchedulePromptJobLike>();
    let sessionContext: ExtensionContext;

    // Register the tool once with getter functions
    const tool = createCronTool(
      () => storage,
      () => scheduler,
    );
    pi.registerTool(tool);

    // --- Session initialization ---

    const stopStoreWatcher = () => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      if (storePollTimer) {
        clearInterval(storePollTimer);
        storePollTimer = null;
      }
      if (storeWatcher) {
        storeWatcher.close();
        storeWatcher = null;
      }
      lastStoreMtimeMs = null;
      lastStoreFingerprint = null;
    };

    const jobsLoadedForSession = () => {
      const sessionId = sessionContext?.sessionManager.getSessionId();
      return storage.getAllJobs().filter((job) => !job.session || job.session === sessionId);
    };

    const refreshScheduledJobsSnapshot = () => {
      if (!storage || !sessionContext) return;
      scheduledJobs = new Map(jobsLoadedForSession().map((job) => [job.id, job]));
    };

    const reconcileSchedulerFromStore = () => {
      if (!storage || !scheduler || !sessionContext) return;
      const nextJobs = new Map(jobsLoadedForSession().map((job) => [job.id, job]));
      for (const id of scheduledJobs.keys()) {
        if (!nextJobs.has(id)) scheduler.removeJob(id);
      }
      for (const [id, job] of nextJobs) {
        const previous = scheduledJobs.get(id);
        if (!previous) scheduler.addJob(job);
        else if (scheduleJobFingerprint(previous) !== scheduleJobFingerprint(job)) {
          scheduler.updateJob(id, job);
        }
      }
      scheduledJobs = nextJobs;
    };

    const scheduleStoreReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        reconcileSchedulerFromStore();
      }, 250);
    };

    const watchScheduleStore = () => {
      stopStoreWatcher();
      const storePath = storage.storePath ?? path.join(os.homedir(), '.mindos', 'schedule-prompts.json');
      const storeDir = path.dirname(storePath);
      const readStoreMtimeMs = () => {
        try {
          return statSync(storePath).mtimeMs;
        } catch {
          return null;
        }
      };
      const reloadIfStoreChanged = () => {
        const nextMtimeMs = readStoreMtimeMs();
        if (nextMtimeMs === lastStoreMtimeMs) return;
        lastStoreMtimeMs = nextMtimeMs;
        const nextFingerprint = readScheduleStoreFingerprint(storePath);
        if (nextFingerprint === lastStoreFingerprint) return;
        lastStoreFingerprint = nextFingerprint;
        scheduleStoreReload();
      };
      try {
        mkdirSync(storeDir, { recursive: true });
        lastStoreMtimeMs = readStoreMtimeMs();
        lastStoreFingerprint = readScheduleStoreFingerprint(storePath);
        storeWatcher = watch(storeDir, (eventType, filename) => {
          if (eventType !== 'change' && eventType !== 'rename') return;
          const changed = filename ? String(filename) : undefined;
          if (changed && changed !== path.basename(storePath)) return;
          reloadIfStoreChanged();
        });
        storePollTimer = setInterval(reloadIfStoreChanged, 1_000);
        storeWatcher.on('error', () => {
          stopStoreWatcher();
        });
      } catch {
        stopStoreWatcher();
      }
    };

    const stopSessionRuntime = () => {
      stopStoreWatcher();
      if (scheduler) {
        scheduler.stop();
      }
      scheduledJobs = new Map();
    };

    const initializeSession = (ctx: ExtensionContext) => {
      stopSessionRuntime();
      sessionContext = ctx;
      storage = createMindOSStorage(CronStorage);
      observeScheduleStorageWrites(storage, () => {
        const storePath = storage.storePath ?? path.join(os.homedir(), '.mindos', 'schedule-prompts.json');
        lastStoreFingerprint = readScheduleStoreFingerprint(storePath);
        refreshScheduledJobsSnapshot();
      });
      scheduler = new CronScheduler(storage, pi, ctx);
      scheduler.start();
      refreshScheduledJobsSnapshot();
      watchScheduleStore();
    };

    const cleanupSession = (ctx: ExtensionContext) => {
      stopSessionRuntime();
      if (storage) {
        const sessionId = ctx.sessionManager.getSessionId();
        const jobs = storage.getAllJobs();
        const disabledJobs = jobs.filter((job) => (
          !job.enabled
          && (!job.session || job.session === sessionId)
          && !isMindosStudioAutomationJob(job)
        ));
        for (const job of disabledJobs) {
          storage.removeJob(job.id);
        }
      }
    };

    // --- Lifecycle events ---

    pi.on('session_start', async (event, ctx) => {
      if (isRecord(event) && event.reason !== 'startup' && storage) {
        cleanupSession(ctx);
      }
      initializeSession(ctx);
    });

    pi.on('session_switch', async (_event, ctx) => {
      cleanupSession(ctx);
      initializeSession(ctx);
    });

    pi.on('session_fork', async (_event, ctx) => {
      cleanupSession(ctx);
      initializeSession(ctx);
    });

    pi.on('session_shutdown', async (_event, ctx) => {
      cleanupSession(ctx);
    });
  };
}

export default createMindosSchedulePromptExtension();
