// ─── MindOS Schedule-Prompt Extension Wrapper ─────────────────────────────────
// Wraps pi-schedule-prompt with MindOS-specific storage path (~/.mindos/).
// Instead of storing to {cwd}/.pi/schedule-prompts.json (Pi default),
// persists to ~/.mindos/schedule-prompts.json (MindOS global).
//
// Loaded as an extension by DefaultResourceLoader in ask/route.ts.

import os from 'os';
import path from 'path';
import { mkdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createJiti } from 'jiti/static';
import {
  resolveBuiltinWebRuntimePackagePath,
  resolveWebAppDirFromEntry,
} from '../agent/builtin-extension-runtime';

type ExtensionAPI = {
  registerTool(tool: unknown): void;
  on(event: string, handler: () => Promise<void> | void): void;
};

type SchedulePromptJobLike = {
  id: string;
  enabled: boolean;
  mindos?: unknown;
};

type CronStorageLike = {
  getAllJobs(): SchedulePromptJobLike[];
  removeJob(id: string): void;
  piDir?: string;
  storePath?: string;
};

type CronSchedulerLike = {
  start(): void;
  stop(): void;
};

type SchedulePromptModules = {
  CronStorage: new (homeDir: string) => CronStorageLike;
  CronScheduler: new (storage: CronStorageLike, pi: ExtensionAPI) => CronSchedulerLike;
  createCronTool: (
    getStorage: () => CronStorageLike,
    getScheduler: () => CronSchedulerLike,
  ) => unknown;
};

async function loadSchedulePromptModules(): Promise<SchedulePromptModules> {
  // pi-schedule-prompt 0.1.2 ships TypeScript source only. Keep these imports
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

export default async function mindosSchedulePrompt(pi: ExtensionAPI) {
  const { CronStorage, CronScheduler, createCronTool } = await loadSchedulePromptModules();
  let storage: CronStorageLike;
  let scheduler: CronSchedulerLike;
  let storeWatcher: FSWatcher | null = null;
  let storePollTimer: ReturnType<typeof setInterval> | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let lastStoreMtimeMs: number | null = null;

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
  };

  const reloadSchedulerFromStore = () => {
    if (!storage || !scheduler) return;
    scheduler.stop();
    scheduler = new CronScheduler(storage, pi);
    scheduler.start();
  };

  const scheduleStoreReload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      reloadSchedulerFromStore();
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
      scheduleStoreReload();
    };
    try {
      mkdirSync(storeDir, { recursive: true });
      lastStoreMtimeMs = readStoreMtimeMs();
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

  const initializeSession = () => {
    storage = createMindOSStorage(CronStorage);
    scheduler = new CronScheduler(storage, pi);
    scheduler.start();
    watchScheduleStore();
  };

  const cleanupSession = () => {
    stopStoreWatcher();
    if (scheduler) {
      scheduler.stop();
    }
    if (storage) {
      const jobs = storage.getAllJobs();
      const disabledJobs = jobs.filter((j) => !j.enabled && !isMindosStudioAutomationJob(j));
      for (const job of disabledJobs) {
        storage.removeJob(job.id);
      }
    }
  };

  // --- Lifecycle events ---

  pi.on('session_start', async () => {
    initializeSession();
  });

  pi.on('session_switch', async () => {
    cleanupSession();
    initializeSession();
  });

  pi.on('session_fork', async () => {
    cleanupSession();
    initializeSession();
  });

  pi.on('session_shutdown', async () => {
    cleanupSession();
  });
}
